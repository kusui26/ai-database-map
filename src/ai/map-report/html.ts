/**
 * **地図レポートの HTML**（PR-13・`docs/260912_gui_chat_protocol.md` §4.3(b)）。
 *
 * 母艦（MulmoTerminal / MulmoClaude）の `presentHtml` に渡せる**自己完結の 1 ページ**を組む。
 * 生成は純粋（タイルの時刻解決・DB 参照は呼び出し側が済ませて渡す）なので、
 * ネットワーク無しでテストできる。
 *
 * 守っている制約（§3 の表・§4.3(b)）：
 * - **fetch / XHR / WebSocket を使わない**。母艦の CSP は `connect-src 'none'` なので、
 *   通信する地図（MapLibre）は動かない。タイルは Leaflet が `<img>` で読む
 * - **外部スクリプトを読まない**（Leaflet はインライン同梱）。オフラインでも枠と凡例は出る
 * - **印の意味は Web UI と同じ**：起点＝アクセントの点／行き先＝緑の番号丸／
 *   一覧の駅＝アクセントの輪（`stations-highlight` と同じ）／半径円＝アクセントの薄い円
 * - **出典・限界・免責・生成時刻を必ず本文に出す**。地図だけを切り取って使われても、
 *   何のデータで、いつの、何が言えないかが読める（`docs/260824_flood.md` §7.5）
 * - 本文・ラベルは**すべてエスケープ**して書き出す（`shared/viewer/vnode.ts` の直列化）
 */

import { type MapScene, type ScenePoint } from '@/domain/map/scene'
import { ACCENT_COLOR } from '@/shared/constants'
import { el, escapeText, vnodeToHtml, type VNode } from '@/shared/viewer/vnode'

/**
 * ベースマップ（地理院 淡色**ラスタ**）。
 * Web UI はベクタタイルだが、ここは `<img>` で読める形でなければならない。
 */
export const BASEMAP_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'

/** ベースマップの出典（配信元の表記どおり）。 */
export const BASEMAP_ATTRIBUTION = '出典：地理院タイル（国土地理院）'

/** 行き先（避難先）の色（`evacuationPointsSource.ts` と同じ値）。 */
const DESTINATION_COLOR = '#047857'

/** 地理院ラスタの最大配信ズーム。 */
const BASEMAP_MAX_NATIVE_ZOOM = 18

/**
 * 駅名を地図に出す上限。
 * これを超えると名前が重なって**どれも読めなくなる**ので、点だけにして一覧に任せる
 * （実機で 5 件の避難先の名前が重なり、判読できなくなったのが発端）。
 */
const MAX_LABELLED_STATIONS = 12

/** 時刻を差し込み終えた、そのまま `L.tileLayer` に渡せる 1 枚。 */
export type MapReportLayer = {
  readonly key: string
  readonly labelJa: string
  /** `{z}/{x}/{y}` だけが残った URL（キキクルの時刻は解決済み）。 */
  readonly url: string
  readonly opacity: number
  readonly minZoom: number
  readonly maxNativeZoom: number
  readonly attribution: string
  /** キキクルのように「いつの面か」が要るレイヤの表示（無ければ null）。 */
  readonly timeLabelJa: string | null
}

export type MapReportInput = {
  readonly title: string
  readonly scene: MapScene
  readonly layers: readonly MapReportLayer[]
  /** 限界・注意（ハザードの免責、描けなかったもの、など）。**全部出す**。 */
  readonly notesJa: readonly string[]
  readonly generatedAtJa: string
  readonly assets: { readonly js: string; readonly css: string; readonly version: string }
}

/** 駅名を地図に出せる件数を超えたか（超えたら本文で断る）。 */
export function stationLabelsOmitted(scene: MapScene): boolean {
  return scene.points.filter((point) => point.kind === 'station').length > MAX_LABELLED_STATIONS
}

/** 地図が接続する（＝タイル画像を取る）ホスト。CSP の `img-src` に宣言する。 */
export function mapReportTileOrigins(
  layers: readonly { readonly url: string }[],
): readonly string[] {
  const urls = [BASEMAP_TILE_URL, ...layers.map((layer) => layer.url)]
  return [...new Set(urls.map((url) => new URL(url.replace(/\{[a-z]+\}/g, '0')).origin))]
}

// --- 本文（凡例・注記） -------------------------------------------------

/** 凡例の 1 行（色の見本＋名前＋出典）。 */
function legendRow(swatch: VNode, labelJa: string, sourceJa: string | null): VNode {
  return el('li', {
    cls: 'legend-row',
    children: [
      swatch,
      el('span', { cls: 'legend-label', text: labelJa }),
      sourceJa === null ? null : el('span', { cls: 'legend-source', text: sourceJa }),
    ],
  })
}

/** 印の凡例（この地図に実際に出ている印だけ）。 */
function markerLegend(points: readonly ScenePoint[], hasCircle: boolean): readonly VNode[] {
  const kinds = new Set(points.map((point) => point.kind))
  return [
    ...(kinds.has('origin')
      ? [legendRow(el('span', { cls: 'sw mk-origin' }), '起点（聞かれた場所）', null)]
      : []),
    ...(kinds.has('destination')
      ? [
          legendRow(
            el('span', { cls: 'sw mk-dest', text: '1' }),
            '行き先（番号は一覧と同じ）',
            null,
          ),
        ]
      : []),
    ...(kinds.has('station')
      ? [legendRow(el('span', { cls: 'sw mk-station' }), '一覧の駅', null)]
      : []),
    ...(hasCircle ? [legendRow(el('span', { cls: 'sw sw-circle' }), '集計の半径', null)] : []),
  ]
}

/** ハザードの面の凡例（不透明度と出典、キキクルは「いつの面か」も）。 */
function layerLegend(layers: readonly MapReportLayer[]): readonly VNode[] {
  return layers.map((layer) =>
    legendRow(
      el('span', { cls: 'sw sw-layer', style: { opacity: String(layer.opacity) } }),
      layer.timeLabelJa === null ? layer.labelJa : `${layer.labelJa}（${layer.timeLabelJa}）`,
      layer.attribution,
    ),
  )
}

/**
 * 地図の番号 → 名前の一覧。
 * 行き先は近接して並ぶことが多く、名前を地図に重ねると**どれも読めなくなる**——
 * 地図には番号だけを置き、名前はここで読ませる（一覧パネルと同じ並び）。
 */
function numberedList(points: readonly ScenePoint[]): readonly VNode[] {
  const destinations = points.filter(
    (point) => point.kind === 'destination' && point.index !== null,
  )
  if (destinations.length === 0) return []
  return [
    el('section', {
      cls: 'numbered',
      children: [
        el('h2', { text: '地図の番号' }),
        el('ol', {
          children: destinations.map((point) =>
            el('li', {
              attrs: { value: point.index ?? 1 },
              text: point.labelJa ?? '（名前なし）',
            }),
          ),
        }),
      ],
    }),
  ]
}

/** 本文（地図の下に置く凡例と注記）。 */
function bodySections(input: MapReportInput): string {
  const rows = [
    ...markerLegend(input.scene.points, input.scene.circle !== null),
    ...layerLegend(input.layers),
    legendRow(el('span', { cls: 'sw sw-base' }), '背景地図', BASEMAP_ATTRIBUTION),
  ]
  const sections = [
    el('h1', { text: input.title }),
    el('div', { attrs: { id: 'map', role: 'application', 'aria-label': input.title } }),
    el('section', {
      cls: 'legend',
      children: [el('h2', { text: '凡例と出典' }), el('ul', { children: rows })],
    }),
    ...numberedList(input.scene.points),
    el('section', {
      cls: 'notes',
      children: [
        el('h2', { text: '読むときの注意' }),
        el('ul', {
          children: input.notesJa.map((note) => el('li', { text: note })),
        }),
      ],
    }),
    el('footer', {
      text: `${input.generatedAtJa} 生成 ／ AI Database Map ／ 地図描画 Leaflet ${input.assets.version}`,
    }),
  ]
  return sections.map(vnodeToHtml).join('\n')
}

// --- 描画スクリプト -----------------------------------------------------

/** ブラウザへ渡す描画データ（**JSON だけ**・関数は無い）。 */
type MapReportData = {
  readonly basemap: {
    readonly url: string
    readonly attribution: string
    readonly maxNativeZoom: number
  }
  readonly layers: readonly Omit<MapReportLayer, 'labelJa' | 'key' | 'timeLabelJa'>[]
  readonly points: readonly ScenePoint[]
  readonly circle: MapScene['circle']
  readonly focus: MapScene['focus']
  readonly maxLabelledStations: number
}

/**
 * 埋め込む JSON。`<` を退避して `</script>` での抜け出しを塞ぐ
 * （ラベルはツール入力に由来しうるので、ここは必ず通す）。
 */
function embeddedJson(data: MapReportData): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

/**
 * 描画本体。**fetch も XHR も使わない**（タイルは Leaflet が `<img>` で読む）。
 * マーカーは `document.createElement` ＋ `textContent` で組む（`innerHTML` を使わない）。
 */
const DRAW_JS = /* js */ `
'use strict';
(function () {
  var D = window.MAP_DATA;
  var map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
  L.tileLayer(D.basemap.url, {
    attribution: D.basemap.attribution, maxZoom: 19, maxNativeZoom: D.basemap.maxNativeZoom
  }).addTo(map);
  // ハザードの面は base 先・overlay 後の順で渡ってくる（domain/map/scene の描画順）。
  D.layers.forEach(function (layer) {
    L.tileLayer(layer.url, {
      opacity: layer.opacity, minZoom: layer.minZoom, maxZoom: 19,
      maxNativeZoom: layer.maxNativeZoom, attribution: layer.attribution
    }).addTo(map);
  });

  var bounds = [];
  if (D.circle !== null) {
    L.circle([D.circle.lat, D.circle.lon], {
      radius: D.circle.radiusM, color: '${ACCENT_COLOR}', weight: 1.5,
      opacity: 0.5, fillColor: '${ACCENT_COLOR}', fillOpacity: 0.08
    }).addTo(map);
    bounds.push([D.circle.lat, D.circle.lon]);
  }

  var labelledStations = D.points.filter(function (p) { return p.kind === 'station'; }).length
    <= D.maxLabelledStations;
  function showsLabel(point) {
    // 行き先は番号で示し、名前は本文の一覧で読む（重なって読めなくなるため）。
    if (point.kind === 'destination') return false;
    if (point.kind === 'station') return labelledStations;
    return true;
  }
  function markerElement(point) {
    var wrap = document.createElement('div');
    wrap.className = 'mk';
    if (point.labelJa && showsLabel(point)) {
      var label = document.createElement('div');
      label.className = 'mk-label mk-label-' + point.kind;
      label.textContent = point.labelJa;
      wrap.appendChild(label);
    }
    var dot = document.createElement('div');
    dot.className = 'mk-' + point.kind;
    if (point.kind === 'destination' && point.index !== null) dot.textContent = String(point.index);
    dot.title = point.labelJa || '';
    wrap.appendChild(dot);
    return wrap;
  }
  D.points.forEach(function (point) {
    L.marker([point.lat, point.lon], {
      icon: L.divIcon({ html: markerElement(point), className: '', iconSize: null }),
      keyboard: false, title: point.labelJa || ''
    }).addTo(map);
    bounds.push([point.lat, point.lon]);
  });

  // 収まりを決める：円があれば円が入る範囲、点が複数なら全部、1 点なら寄る。
  if (D.circle !== null) {
    map.fitBounds(L.latLng(D.circle.lat, D.circle.lon).toBounds(D.circle.radiusM * 2.4), { padding: [16, 16] });
  } else if (bounds.length > 1) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 15 });
  } else if (bounds.length === 1) {
    map.setView(bounds[0], (D.focus && D.focus.zoom) || 14);
  } else if (D.focus !== null) {
    map.setView([D.focus.lat, D.focus.lon], D.focus.zoom || 12);
  } else {
    map.setView([36.2, 138.2], 5); // 日本全体（描くものが無いときの既定）
  }
})();
`

/** ページの見た目（印の意味は Web UI と同じ・`shared/viewer/styles.ts` と同系の地味さ）。 */
const PAGE_CSS = /* css */ `
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.7 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #0f172a;
         background: #fff; padding: 16px; max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 17px; margin-bottom: 10px; }
  h2 { font-size: 13px; color: #475569; margin: 14px 0 6px; }
  #map { height: min(62vh, 560px); min-height: 320px; border: 1px solid #e2e8f0;
         border-radius: 12px; overflow: hidden; }
  .legend ul, .notes ul { list-style: none; padding: 0; }
  .legend-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; margin: 3px 0; }
  .legend-label { font-weight: 600; }
  .legend-source { color: #64748b; font-size: 11.5px; }
  .numbered ol { margin: 0; padding-left: 1.6em; font-size: 12.5px; }
  .numbered li { margin: 2px 0; }
  .notes li { font-size: 12.5px; color: #475569; margin: 3px 0; padding-left: 1em;
              text-indent: -1em; }
  .notes li::before { content: "・"; }
  footer { margin-top: 14px; font-size: 11.5px; color: #94a3b8; }
  .sw { display: inline-block; width: 18px; height: 18px; flex: 0 0 18px; border-radius: 50%; }
  .sw-circle { background: ${ACCENT_COLOR}14; border: 1.5px solid ${ACCENT_COLOR}80; }
  .sw-layer { background: #dc2626; border-radius: 4px; }
  .sw-base { background: #e8ecef; border: 1px solid #cbd5e1; border-radius: 4px; }
  .mk { position: relative; }
  .mk-origin, .sw.mk-origin { width: 14px; height: 14px; border-radius: 50%;
    background: ${ACCENT_COLOR}; border: 2px solid #fff; box-shadow: 0 0 0 4px ${ACCENT_COLOR}40; }
  .mk-destination, .sw.mk-dest { width: 22px; height: 22px; border-radius: 50%;
    background: ${DESTINATION_COLOR}; border: 2px solid #fff; color: #fff; font-size: 12px;
    font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .mk-station, .sw.mk-station { width: 16px; height: 16px; border-radius: 50%;
    background: ${ACCENT_COLOR}24; border: 2.5px solid ${ACCENT_COLOR}; }
  .mk-label { position: absolute; bottom: calc(100% + 3px); left: 50%; transform: translateX(-50%);
    white-space: nowrap; font-size: 12px; font-weight: 600;
    text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff; }
  .mk-label-origin, .mk-label-station { color: ${ACCENT_COLOR}; }
  .mk-label-destination { color: ${DESTINATION_COLOR}; }
  .leaflet-div-icon { background: transparent; border: 0; }
`

/** 地図レポート 1 ページを組み立てる。 */
export function buildMapReportHtml(input: MapReportInput): string {
  const data: MapReportData = {
    basemap: {
      url: BASEMAP_TILE_URL,
      attribution: BASEMAP_ATTRIBUTION,
      maxNativeZoom: BASEMAP_MAX_NATIVE_ZOOM,
    },
    layers: input.layers.map((layer) => ({
      url: layer.url,
      opacity: layer.opacity,
      minZoom: layer.minZoom,
      maxNativeZoom: layer.maxNativeZoom,
      attribution: layer.attribution,
    })),
    points: input.scene.points,
    circle: input.scene.circle,
    focus: input.scene.focus,
    maxLabelledStations: MAX_LABELLED_STATIONS,
  }
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeText(input.title)}</title>`,
    `<style>${input.assets.css}\n${PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    bodySections(input),
    `<script>${input.assets.js}</script>`,
    `<script>window.MAP_DATA = ${embeddedJson(data)};</script>`,
    `<script>${DRAW_JS}</script>`,
    '</body>',
    '</html>',
  ].join('\n')
}
