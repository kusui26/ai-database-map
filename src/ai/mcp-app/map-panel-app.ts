/**
 * 地図つきパネル・ビューア（MCP Apps・PR-9b・`docs/260828_research_claude_auth.md` §4.6）。
 *
 * `panel-app.ts` と同じ部品でパネルを描き、その上に **MapLibre の地図**を足して
 * `structuredContent.mapActions` を **Web UI（`useApplyMapActions` ＋ map/…Source）と
 * 同じ意味論**で描く単一 HTML。座標を持つ操作を返すツール（駅詳細・ハザード 4 種）だけが
 * 参照する（`mcp-tools.ts` の `mapUi`）。
 *
 * 設計判断（docs ✅ PR-9b 参照）：
 * - **MapLibre はインライン同梱**（`node_modules` の配布ファイルをサーバ側で読み込んで埋める）。
 *   外部 script 読み込み（CSP `resourceDomains`）はホスト実装が未検証なのに対し、
 *   インライン script は既定 CSP（`script-src 'unsafe-inline'`）で動くと**実機証明済み**
 *   （PR-9 の probe）。バージョンは package.json と常に一致（コピーを持たない）
 * - **タイルは実行時に外部ホストから取る**（fetch → CSP `connectDomains`。probe で GSI に
 *   HTTP 200 を確認済みの経路）。宣言するホストは**ハザード・カタログから算出**する
 *   （手書きリストにしない・レイヤを足せば自動で追随）
 * - **ハザードレイヤの定義（URL・ズーム・出典・base/overlay・地形）はカタログの射影**を
 *   埋め込む（`shared/hazard` 経由・単一の真実）。キキクルは Web UI と同じく
 *   `timesUrl` の最新時刻を差し込んでから載せる（解決できないレイヤは載せない＝
 *   「白い地図＝安全」を作らない・§7.5-1）
 * - 地図はマーカー（DOM）で描き、symbol レイヤを使わない——**グリフ（フォント PBF）の
 *   外部ホストを増やさない**ため
 * - 地図の失敗はパネルを道連れにしない（try/catch して地図だけ畳む）
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCENT_COLOR,
  HAZARD_OPACITY_DEFAULT,
  HAZARD_OPACITY_MAX,
  HAZARD_OPACITY_MIN,
  HAZARD_TERRAIN_OPACITY_SCALE,
} from '@/shared/constants'
import { hazardLayers } from '@/shared/hazard'
import { MAP_TILE_ORIGIN } from './meta'
import { buildViewerHtml } from './panel-app'

/** ベースマップ（地理院 淡色ラスタ）。probe で到達を実機証明済みのホスト。 */
const BASEMAP_TILE_URL = `${MAP_TILE_ORIGIN}/xyz/pale/{z}/{x}/{y}.png`

/** ベースマップの出典（カタログの地理院タイルと同文＝MapLibre が重複表示を畳む）。 */
const BASEMAP_ATTRIBUTION = '出典：地理院タイル（国土地理院）'

/** 行き先（避難先）の色（`evacuationPointsSource.ts` と同じ値。変えるときは両方）。 */
const DESTINATION_COLOR = '#047857'

/** ビューアに埋め込むハザードレイヤの射影（カタログが単一の真実）。 */
type ViewerHazardLayer = {
  readonly key: string
  readonly url: string
  readonly timesUrl: string | null
  readonly minZoom: number
  readonly maxZoom: number
  /** base の上に重ねてよいレイヤか（描画順は base 先・overlay 後）。 */
  readonly overlay: boolean
  /** 参考：地形か（不透明度を一段薄くする・§3.7）。 */
  readonly terrain: boolean
  readonly attribution: string
}

/** ラスタとして描けるレイヤだけを、カタログ順のまま射影する。 */
function viewerHazardLayers(): readonly ViewerHazardLayer[] {
  return hazardLayers.flatMap((layer) => {
    if (layer.tile === null || layer.tile.format !== 'png') return []
    return [
      {
        key: layer.key,
        url: layer.tile.url,
        timesUrl: layer.tile.timesUrl,
        minZoom: layer.tile.minZoom,
        maxZoom: layer.tile.maxZoom,
        overlay: layer.display === 'overlay',
        terrain: layer.group === 'terrain',
        attribution: layer.attribution,
      },
    ]
  })
}

const VIEWER_HAZARD_LAYERS = viewerHazardLayers()

/** URL テンプレート → オリジン（`{z}` 等のプレースホルダは仮埋めして読む）。 */
function originOf(urlTemplate: string): string {
  return new URL(urlTemplate.replace(/\{[a-z]+\}/g, '0')).origin
}

/**
 * 地図が接続するオリジン（CSP `connectDomains` に宣言する・重複なし）。
 * ベースマップ＋カタログのタイル URL・キキクルの時刻取得先から**算出**する。
 */
export const MAP_CONNECT_ORIGINS: readonly string[] = [
  ...new Set([
    MAP_TILE_ORIGIN,
    ...VIEWER_HAZARD_LAYERS.flatMap((layer) => [
      originOf(layer.url),
      ...(layer.timesUrl === null ? [] : [originOf(layer.timesUrl)]),
    ]),
  ]),
]

/** インライン `<script>` に埋めて安全な形へ（`</script>` 混入は組み立てを壊すので拒否）。 */
function inlineSafeScript(source: string, label: string): string {
  if (/<\/script/i.test(source)) {
    throw new Error(`${label} に </script> が含まれるためインライン化できません`)
  }
  // sourceMappingURL は iframe では 404 を出すだけなので落とす。
  return source.replace(/^\/\/# sourceMappingURL=.*$/m, '')
}

/** インライン `<style>` に埋めて安全な形へ。 */
function inlineSafeStyle(source: string, label: string): string {
  if (/<\/style/i.test(source)) {
    throw new Error(`${label} に </style> が含まれるためインライン化できません`)
  }
  return source
}

/** MapLibre の配布ファイルを読む（無ければ文脈つきで即失敗＝壊れた UI を配らない）。 */
function readMaplibreDist(file: string): string {
  const path = join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', file)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`MapLibre の配布ファイルを読めません（${path}）: ${reason}`, { cause: error })
  }
}

const MAPLIBRE_JS = inlineSafeScript(readMaplibreDist('maplibre-gl.js'), 'maplibre-gl.js')
const MAPLIBRE_CSS = inlineSafeStyle(readMaplibreDist('maplibre-gl.css'), 'maplibre-gl.css')

/** 地図モジュールへ渡す埋め込みデータ（すべて共有カタログ・定数由来）。 */
const MAP_DATA_JS = inlineSafeScript(
  `var MAP_DATA = ${JSON.stringify({
    layers: VIEWER_HAZARD_LAYERS,
    basemap: { url: BASEMAP_TILE_URL, attribution: BASEMAP_ATTRIBUTION },
    accent: ACCENT_COLOR,
    destination: DESTINATION_COLOR,
    opacity: {
      def: HAZARD_OPACITY_DEFAULT,
      min: HAZARD_OPACITY_MIN,
      max: HAZARD_OPACITY_MAX,
      terrain: HAZARD_TERRAIN_OPACITY_SCALE,
    },
  })};`,
  'MAP_DATA',
)

/** 地図まわりの追加スタイル（マーカーは DOM で描く＝グリフ不要）。 */
const MAP_CSS = /* css */ `
  #map-wrap { position: relative; margin-bottom: 10px; }
  #map { height: 300px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
  #map-note { margin-top: 4px; }
  .map-fs-btn { position: absolute; top: 8px; right: 8px; z-index: 10; border: 1px solid #e2e8f0;
                border-radius: 8px; background: #fff; padding: 2px 8px; font-size: 13px;
                cursor: pointer; color: #334155; }
  .mk { position: relative; }
  .mk-origin { width: 14px; height: 14px; border-radius: 50%; background: ${ACCENT_COLOR};
               border: 2px solid #fff; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.25); }
  .mk-dest { width: 22px; height: 22px; border-radius: 50%; background: ${DESTINATION_COLOR};
             border: 2px solid #fff; color: #fff; font-size: 12px; font-weight: 600;
             display: flex; align-items: center; justify-content: center; }
  .mk-label { position: absolute; bottom: calc(100% + 3px); left: 50%; transform: translateX(-50%);
              white-space: nowrap; font-size: 12px; font-weight: 600;
              text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff; }
  .mk-label-origin { color: ${ACCENT_COLOR}; }
  .mk-label-dest { color: ${DESTINATION_COLOR}; }
`

/**
 * 地図モジュール。`window.renderMapActions` を定義し、ビューア本体（`VIEWER_JS`）の
 * `render()` が tool-result のたびに呼ぶ。**mapActions の 7 型すべてを列挙**する
 * （`highlightStations` は座標を持たないため、この iframe では描かないと明記して無視）。
 */
const MAP_JS = /* js */ `
'use strict';
(function () {
  var state = { map: null, ready: false, queue: [], markers: [], hazardIds: [], token: 0 };
  var LAYER_BY_KEY = {};
  MAP_DATA.layers.forEach(function (l) { LAYER_BY_KEY[l.key] = l; });
  var EMPTY_FC = { type: 'FeatureCollection', features: [] };

  function clampOpacity(v) {
    if (typeof v !== 'number' || !isFinite(v)) return MAP_DATA.opacity.def;
    return Math.min(MAP_DATA.opacity.max, Math.max(MAP_DATA.opacity.min, v));
  }
  function opacityFor(layer, v) {
    return layer.terrain ? clampOpacity(v) * MAP_DATA.opacity.terrain : clampOpacity(v);
  }

  // --- mapActions → 描くものの集約（Web UI の useApplyMapActions と同じ読み方） ----
  function collectDrawState(actions) {
    var st = { points: [], circle: null, layers: [], opacity: undefined, fly: null };
    (actions || []).forEach(function (action) {
      switch (action.type) {
        case 'flyTo':
          st.fly = { lon: action.lon, lat: action.lat, zoom: action.zoom };
          break;
        case 'selectStation': // 座標を持たない。駅詳細では直前の flyTo が中心を与える。
          if (typeof action.radiusM === 'number') st.circle = { radiusM: action.radiusM };
          break;
        case 'highlightStations': // grp のみ（座標なし）→ この iframe では描かない（一覧パネルで読む）。
          break;
        case 'clearOverlays':
          st.points = []; st.circle = null; st.layers = [];
          break;
        case 'setHazardLayers':
          st.layers = (action.layers || []).filter(function (k) { return LAYER_BY_KEY[k] !== undefined; });
          st.opacity = action.opacity;
          break;
        case 'showPoint':
          st.points.push({ lon: action.lon, lat: action.lat, labelJa: action.labelJa || null, kind: 'origin' });
          break;
        case 'highlightPoints':
          (action.points || []).forEach(function (p, i) {
            st.points.push({ lon: p.lon, lat: p.lat, labelJa: p.labelJa, kind: 'dest', index: i + 1 });
          });
          break;
      }
    });
    if (st.circle !== null && st.fly === null) st.circle = null;
    if (st.circle !== null) { st.circle.lon = st.fly.lon; st.circle.lat = st.fly.lat; }
    // 半径円だけだと中心（駅）が読めない——Web UI の選択駅ドットに合わせ、中心の印を置く。
    if (st.circle !== null && st.points.length === 0) {
      st.points.push({ lon: st.circle.lon, lat: st.circle.lat, labelJa: null, kind: 'origin' });
    }
    st.drawable = st.points.length > 0 || st.circle !== null || st.layers.length > 0 || st.fly !== null;
    return st;
  }

  // 半径円（shared/geo.circlePolygon と同じ近似：緯度で経度を cos 補正・64 分割）。
  function ringCoords(lon, lat, radiusM) {
    var dLat = radiusM / 111320;
    var dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
    var ring = [];
    for (var i = 0; i < 64; i += 1) {
      var a = (2 * Math.PI * i) / 64;
      ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    ring.push(ring[0]);
    return ring;
  }

  function baseStyle() {
    return {
      version: 8,
      sources: { base: { type: 'raster', tiles: [MAP_DATA.basemap.url], tileSize: 256,
                         maxzoom: 18, attribution: MAP_DATA.basemap.attribution } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#e8ecef' } },
        { id: 'base', type: 'raster', source: 'base' }
      ]
    };
  }

  function ensureMap(cb) {
    if (state.ready) { cb(); return; }
    state.queue.push(cb);
    if (state.map !== null) return;
    var map = new maplibregl.Map({
      container: 'map', style: baseStyle(), center: [139.767, 35.681], zoom: 9,
      minZoom: 4, maxZoom: 17, attributionControl: { compact: false }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.on('load', function () {
      map.addSource('radius', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius',
        paint: { 'fill-color': MAP_DATA.accent, 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'radius-line', type: 'line', source: 'radius',
        paint: { 'line-color': MAP_DATA.accent, 'line-width': 1.5, 'line-opacity': 0.5 } });
      state.ready = true;
      state.queue.splice(0).forEach(function (f) { f(); });
    });
    state.map = map;
  }

  // --- マーカー（DOM。起点＝アクセントの点／行き先＝緑の番号丸・Web UI と同じ使い分け） --
  function markerElement(point) {
    var wrap = document.createElement('div');
    wrap.className = 'mk';
    if (point.labelJa) {
      var label = document.createElement('div');
      label.className = 'mk-label ' + (point.kind === 'dest' ? 'mk-label-dest' : 'mk-label-origin');
      label.textContent = point.labelJa;
      wrap.appendChild(label);
    }
    var dot = document.createElement('div');
    dot.className = point.kind === 'dest' ? 'mk-dest' : 'mk-origin';
    if (point.kind === 'dest') dot.textContent = String(point.index);
    dot.title = point.labelJa || '';
    wrap.appendChild(dot);
    return wrap;
  }
  function setMarkers(points) {
    state.markers.splice(0).forEach(function (m) { m.remove(); });
    points.forEach(function (p) {
      var marker = new maplibregl.Marker({ element: markerElement(p) })
        .setLngLat([p.lon, p.lat]).addTo(state.map);
      state.markers.push(marker);
    });
  }

  function setCircle(circle) {
    var source = state.map.getSource('radius');
    if (!source) return;
    source.setData(circle === null ? EMPTY_FC : { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [ringCoords(circle.lon, circle.lat, circle.radiusM)] }
    }] });
  }

  // --- ハザードレイヤ（base 先・overlay 後＝Web UI の hazardDrawOrder と同じ規則） ------
  function drawOrder(keys) {
    var isOverlay = function (k) { return LAYER_BY_KEY[k].overlay; };
    return keys.filter(function (k) { return !isOverlay(k); }).concat(keys.filter(isOverlay));
  }
  // キキクルは最新時刻を差し込んでから使う（差し込めないレイヤは載せない・§7.5-1）。
  function resolveTileUrl(layer) {
    if (layer.timesUrl === null) return Promise.resolve(layer.url);
    var matched = /\\/surf\\/([a-z_]+)\\//.exec(layer.url);
    var element = matched ? matched[1] : null;
    return fetch(layer.timesUrl)
      .then(function (res) { return res.json(); })
      .then(function (times) {
        var newest = null;
        (times || []).forEach(function (t) {
          if (element !== null && t.elements !== undefined && t.elements.indexOf(element) < 0) return;
          if (newest === null || t.basetime > newest.basetime) newest = t;
        });
        if (newest === null) return null;
        var url = layer.url.replace('{basetime}', newest.basetime)
          .replace('{member}', newest.member).replace('{validtime}', newest.validtime);
        // ⚠ {z}/{x}/{y} は MapLibre が埋めるので残ってよい。検査するのは時刻の 3 つだけ
        // （domain の resolveTileUrl と同じ規則。'{' 全部を弾くと全キキクルが消える）。
        var left = ['{basetime}', '{member}', '{validtime}'].some(function (p) {
          return url.indexOf(p) >= 0;
        });
        return left ? null : url;
      })
      .catch(function (e) { console.error('キキクルの時刻を取得できませんでした', e); return null; });
  }
  function removeHazardLayers() {
    state.hazardIds.splice(0).forEach(function (id) {
      if (state.map.getLayer(id)) state.map.removeLayer(id);
      if (state.map.getSource(id)) state.map.removeSource(id);
    });
  }
  function addHazardLayer(key, url, opacity) {
    var layer = LAYER_BY_KEY[key];
    var id = 'hazard-' + key;
    state.map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256,
      minzoom: layer.minZoom, maxzoom: layer.maxZoom, attribution: layer.attribution });
    state.map.addLayer({ id: id, type: 'raster', source: id,
      paint: { 'raster-opacity': opacityFor(layer, opacity) } }, 'radius-fill');
    state.hazardIds.push(id);
  }
  function syncHazard(keys, opacity, token) {
    removeHazardLayers();
    var ordered = drawOrder(keys);
    var note = document.getElementById('map-note');
    note.hidden = !ordered.some(function (k) { return LAYER_BY_KEY[k].timesUrl !== null; });
    Promise.all(ordered.map(function (k) { return resolveTileUrl(LAYER_BY_KEY[k]); }))
      .then(function (urls) {
        if (token !== state.token) return; // 古い結果の描画要求は捨てる
        ordered.forEach(function (k, i) { if (urls[i] !== null) addHazardLayer(k, urls[i], opacity); });
      });
  }

  function fitCamera(st) {
    var coords = st.points.map(function (p) { return [p.lon, p.lat]; });
    if (st.circle !== null) ringCoords(st.circle.lon, st.circle.lat, st.circle.radiusM)
      .forEach(function (c) { coords.push(c); });
    if (coords.length === 0 && st.fly !== null) {
      state.map.jumpTo({ center: [st.fly.lon, st.fly.lat], zoom: st.fly.zoom || 14 });
      return;
    }
    if (coords.length === 0) return;
    if (coords.length === 1) {
      state.map.jumpTo({ center: coords[0], zoom: (st.fly && st.fly.zoom) || 15 });
      return;
    }
    var bounds = coords.reduce(function (b, c) { return b.extend(c); },
      new maplibregl.LngLatBounds(coords[0], coords[0]));
    state.map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }

  // --- 入口（VIEWER_JS の render() が tool-result のたびに呼ぶ） -----------------------
  window.renderMapActions = function (sc) {
    var st = collectDrawState(sc.mapActions);
    var wrap = document.getElementById('map-wrap');
    state.token += 1;
    var token = state.token;
    if (!st.drawable) { wrap.hidden = true; return; } // 前の結果の地図を残して誤読させない
    wrap.hidden = false;
    ensureMap(function () {
      if (token !== state.token) return;
      setMarkers(st.points);
      setCircle(st.circle);
      syncHazard(st.layers, st.opacity, token);
      fitCamera(st);
      state.map.resize();
    });
  };

  // 全画面はホスト裁量（ui/request-display-mode）。拒否されても地図は inline のまま使える。
  var fsBtn = document.getElementById('map-fs');
  if (fsBtn) fsBtn.addEventListener('click', function () {
    try { post({ id: 9000, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } }); }
    catch (e) { console.error('表示モードの変更を要求できませんでした', e); }
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { if (state.map !== null) state.map.resize(); })
      .observe(document.getElementById('map'));
  }
})();
`

/** 地図コンテナ（`#root` の前・結果が来るまで畳んでおく）。 */
const MAP_BODY_PREFIX_HTML = /* html */ `
<div id="map-wrap" hidden>
  <div id="map" role="application" aria-label="結果の地図（ドラッグで移動・ホイールで拡大縮小）"></div>
  <button id="map-fs" class="map-fs-btn" type="button" title="全画面で見る">⤢</button>
  <div id="map-note" class="muted" hidden>キキクル（危険度分布）は取得時点の最新の面です（10 分毎更新）。</div>
</div>`

/** 地図つき版（`mapUi` のツールが参照）。MapLibre 同梱のため約 1.1MB。 */
export const MAP_PANEL_APP_HTML = buildViewerHtml({
  title: 'AI Database Map 地図パネル',
  extraCss: `${MAPLIBRE_CSS}\n${MAP_CSS}`,
  bodyPrefixHtml: MAP_BODY_PREFIX_HTML,
  preludeScripts: [MAPLIBRE_JS, MAP_DATA_JS, MAP_JS],
})
