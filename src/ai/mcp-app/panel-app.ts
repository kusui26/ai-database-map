/**
 * パネル・ビューア（MCP Apps・PR-9 スパイク）。
 *
 * ツール結果の `structuredContent.panels`（GUI Chat Protocol）を、対応ホスト
 * （Claude.ai / Claude Desktop 等）の sandboxed iframe に描く**単一 HTML**。
 *
 * 設計判断：
 * - **依存ゼロ・ビルドなし**：チャートは手書き SVG。既定 CSP（外部接続ゼロ）のまま動く。
 *   Chart.js 等の同梱はサイズと CSP の都合で見送り（スパイクの範囲・docs ✅ 参照）
 * - **ハンドシェイクは仕様どおり自前実装**（`ui/initialize` → `ui/notifications/initialized` →
 *   `ui/notifications/tool-result` を受信）。ext-apps SDK はバンドラ前提なので使わない
 * - **XSS 安全**：DOM は createElement / textContent のみで組む（innerHTML 不使用）。
 *   出典の URL もテキスト表示（リンク遷移は CSP とホスト裁量に依存するため開かない）
 * - **フォールバック**：panels が無い結果は content の text をそのまま表示
 * - 危険度の配色はアプリの HAZARD_LEVEL_COLORS と同じ値（変えるときは両方）
 */

export const PANEL_APP_HTML = /* html */ `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>AI Database Map パネル</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.6 system-ui, -apple-system, "Hiragino Sans", sans-serif;
         color: #0f172a; background: #fff; padding: 12px; }
  .panel { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .title { font-weight: 600; margin-bottom: 6px; }
  .muted { color: #64748b; font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { border: 1px solid #e2e8f0; border-radius: 999px; padding: 1px 8px; font-size: 11px;
          background: #f8fafc; }
  .warn { color: #b45309; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  svg { display: block; width: 100%; height: auto; }
  .bar-row { display: grid; grid-template-columns: 7em 1fr 6.5em; gap: 8px; align-items: center;
             font-size: 12px; margin: 3px 0; }
  .bar-track { background: #f1f5f9; border-radius: 4px; height: 12px; }
  .bar-fill { background: #6366f1; border-radius: 4px; height: 12px; }
  .level { display: inline-block; border-radius: 999px; padding: 1px 10px; color: #fff;
           font-size: 12px; font-weight: 600; }
  ul { padding-left: 18px; }
  li { margin: 2px 0; }
  .notes { background: #f8fafc; border-radius: 8px; padding: 8px 10px; margin-top: 8px;
           font-size: 11px; color: #475569; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; }
</style>
</head>
<body>
<div id="root" aria-live="polite"><p class="muted">結果を待っています…</p></div>
<script>
'use strict';
// --- 最小の JSON-RPC（ext-apps 2026-01-26） ------------------------------
var nextId = 1;
function post(msg) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); }
window.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.jsonrpc !== '2.0') return;
  if (data.method === 'ui/notifications/tool-result') render(data.params || {});
  if (data.id === 1) post({ method: 'ui/notifications/initialized' }); // initialize の応答が来た
});
post({ id: nextId++, method: 'ui/initialize',
       params: { appCapabilities: { availableDisplayModes: ['inline'] } } });

// --- DOM ヘルパ（createElement / textContent だけで組む＝XSS 安全） ------
function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
  return node;
}
function chip(text, warn) { return el('span', 'chip' + (warn ? ' warn' : ''), text); }
function flagsRow(flags) {
  var box = el('div', 'chips');
  (flags || []).forEach(function (f) { box.appendChild(chip('⚠ ' + f.label, f.level === 'warn')); });
  return (flags || []).length ? box : null;
}
var PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];
var LEVEL_COLORS = { none: '#94a3b8', caution: '#eab308', warning: '#f97316',
                     danger: '#dc2626', critical: '#7f1d1d' };

// --- SVG チャート（数値→座標は線形。null は線を切る） --------------------
function svgEl(name, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
  return node;
}
function extent(values) {
  var min = Infinity, max = -Infinity;
  values.forEach(function (v) { if (v !== null && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } });
  if (min === Infinity) { min = 0; max = 1; }
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}
function chartFrame(w, h, pad) {
  var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
  svg.appendChild(svgEl('line', { x1: pad, y1: h - pad, x2: w - 8, y2: h - pad, stroke: '#cbd5e1' }));
  svg.appendChild(svgEl('line', { x1: pad, y1: 8, x2: pad, y2: h - pad, stroke: '#cbd5e1' }));
  return svg;
}
function tickText(svg, x, y, text, anchor) {
  var t = svgEl('text', { x: x, y: y, 'font-size': 10, fill: '#64748b', 'text-anchor': anchor || 'middle' });
  t.textContent = text; svg.appendChild(t);
}
function trendSvg(panel) {
  var w = 560, h = 220, pad = 44;
  var xs = [], ys = [];
  (panel.series || []).forEach(function (s) { (s.points || []).forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
  if (panel.stacked) { ys = ys.concat(stackTotals(panel)); }
  var xe = extent(xs), ye = extent(ys.concat([0]));
  var X = function (v) { return pad + ((v - xe[0]) / (xe[1] - xe[0])) * (w - pad - 16); };
  var Y = function (v) { return (h - pad) - ((v - ye[0]) / (ye[1] - ye[0])) * (h - pad - 16); };
  var svg = chartFrame(w, h, pad);
  [ye[0], (ye[0] + ye[1]) / 2, ye[1]].forEach(function (v) { tickText(svg, pad - 6, Y(v) + 3, fmtNum(v), 'end'); });
  var xt = Array.from(new Set(xs)).sort(function (a, b) { return a - b; });
  var step = Math.max(1, Math.ceil(xt.length / 8));
  xt.forEach(function (v, i) { if (i % step === 0) tickText(svg, X(v), h - pad + 14, String(v)); });
  if (panel.stacked) { stackedBars(svg, panel, X, Y, xt); return svg; }
  (panel.series || []).forEach(function (s, si) {
    var color = s.color || PALETTE[si % PALETTE.length];
    var run = [];
    var flush = function () {
      if (run.length > 1) svg.appendChild(svgEl('polyline', { points: run.join(' '), fill: 'none',
        stroke: color, 'stroke-width': 2, 'stroke-dasharray': s.dashed ? '5 4' : 'none' }));
      if (run.length === 1) { var xy = run[0].split(','); svg.appendChild(svgEl('circle', { cx: xy[0], cy: xy[1], r: 2.5, fill: color })); }
      run = [];
    };
    (s.points || []).forEach(function (p) { if (p.y === null) { flush(); } else { run.push(X(p.x) + ',' + Y(p.y)); } });
    flush();
  });
  return svg;
}
function stackTotals(panel) {
  var byX = {};
  (panel.series || []).forEach(function (s) { (s.points || []).forEach(function (p) {
    if (p.y !== null) byX[p.x] = (byX[p.x] || 0) + p.y; }); });
  return Object.keys(byX).map(function (k) { return byX[k]; });
}
function stackedBars(svg, panel, X, Y, xt) {
  var bw = Math.max(6, Math.min(28, 300 / Math.max(1, xt.length)));
  xt.forEach(function (x) {
    var y0 = 0;
    (panel.series || []).forEach(function (s, si) {
      var pt = (s.points || []).find(function (p) { return p.x === x && p.y !== null; });
      if (!pt) return;
      var y1 = y0 + pt.y;
      svg.appendChild(svgEl('rect', { x: X(x) - bw / 2, y: Y(y1), width: bw,
        height: Math.max(0, Y(y0) - Y(y1)), fill: s.color || PALETTE[si % PALETTE.length] }));
      y0 = y1;
    });
    var total = ((panel.totals || []).find(function (t) { return t.x === x; }) || {}).y;
    if (total === undefined) total = y0;
    if (total !== null) tickText(svg, X(x), Y(y0) - 4, fmtNum(total));
  });
}
function scatterSvg(panel) {
  var w = 560, h = 260, pad = 44;
  var xe = extent((panel.points || []).map(function (p) { return p.x; }));
  var ye = extent((panel.points || []).map(function (p) { return p.y; }));
  var X = function (v) { return pad + ((v - xe[0]) / (xe[1] - xe[0])) * (w - pad - 16); };
  var Y = function (v) { return (h - pad) - ((v - ye[0]) / (ye[1] - ye[0])) * (h - pad - 16); };
  var svg = chartFrame(w, h, pad);
  [xe[0], xe[1]].forEach(function (v) { tickText(svg, X(v), h - pad + 14, fmtNum(v)); });
  [ye[0], ye[1]].forEach(function (v) { tickText(svg, pad - 6, Y(v) + 3, fmtNum(v), 'end'); });
  (panel.points || []).forEach(function (p) {
    var dot = svgEl('circle', { cx: X(p.x), cy: Y(p.y), r: 3,
      fill: PALETTE[(p.cluster || 0) % PALETTE.length], 'fill-opacity': 0.75 });
    var tip = svgEl('title', {}); tip.textContent = p.name + ' (' + fmtNum(p.x) + ', ' + fmtNum(p.y) + ')';
    dot.appendChild(tip); svg.appendChild(dot);
  });
  return svg;
}
function fmtNum(v) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  var abs = Math.abs(v);
  var s = abs >= 100 ? Math.round(v).toLocaleString('ja-JP')
        : Math.round(v * 10) / 10;
  return String(s);
}

// --- パネル別レンダラ ----------------------------------------------------
function titleRow(box, panel, extra) {
  var t = panel.title || extra || '';
  if (panel.unit) t += '（' + panel.unit + '）';
  if (t) box.appendChild(el('div', 'title', t));
}
var RENDERERS = {
  stationCard: function (p, box) {
    box.appendChild(el('div', 'title', p.label + '（' + p.prefecture + '）'));
    if (p.operators) box.appendChild(el('div', 'muted', p.operators));
    if (p.paxLatest !== null) box.appendChild(el('div', 'muted', '乗降客数（最新年）: ' + Number(p.paxLatest).toLocaleString('ja-JP') + ' 人/日'));
    var f = flagsRow(p.badges); if (f) box.appendChild(f);
  },
  trendChart: function (p, box) {
    titleRow(box, p);
    box.appendChild(trendSvg(p));
    var legend = el('div', 'chips');
    (p.series || []).forEach(function (s, i) {
      var c = chip(s.label); c.style.borderColor = s.color || PALETTE[i % PALETTE.length]; legend.appendChild(c);
    });
    box.appendChild(legend);
    (p.stats || []).length && box.appendChild((function () {
      var row = el('div', 'chips');
      p.stats.forEach(function (s) { row.appendChild(chip(s.label + ' ' + s.value, s.flagged)); });
      return row; })());
    var f = flagsRow(p.flags); if (f) box.appendChild(f);
  },
  statTable: function (p, box) {
    titleRow(box, p);
    var table = el('table');
    (p.rows || []).forEach(function (r) {
      var tr = el('tr'); tr.appendChild(el('td', null, (r.flagged ? '⚠ ' : '') + r.label));
      tr.appendChild(el('td', 'num', r.value)); table.appendChild(tr);
    });
    box.appendChild(table);
    if (p.note) box.appendChild(el('div', 'muted', p.note));
  },
  barChart: function (p, box) {
    titleRow(box, p);
    var values = (p.bars || []).map(function (b) { return b.value; }).filter(function (v) { return v !== null; });
    var max = Math.max.apply(null, values.concat([1]));
    (p.bars || []).forEach(function (b) {
      var row = el('div', 'bar-row');
      var label = el('div', null, (b.flagged ? '⚠ ' : '') + b.label);
      if (b.emphasis) label.style.fontWeight = '600';
      row.appendChild(label);
      var track = el('div', 'bar-track'); var fill = el('div', 'bar-fill');
      fill.style.width = b.value === null ? '0%' : Math.max(2, (b.value / max) * 100) + '%';
      if (b.emphasis) fill.style.background = '#4f46e5';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', 'num', b.formatted));
      box.appendChild(row);
    });
    if (p.note) box.appendChild(el('div', 'muted', p.note));
    var f = flagsRow(p.flags); if (f) box.appendChild(f);
  },
  rankingTable: function (p, box) {
    titleRow(box, p);
    var table = el('table');
    var head = el('tr');
    ['#', '駅', '都道府県', p.unit ? '値（' + p.unit + '）' : '値'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    (p.rows || []).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num', r.rank));
      tr.appendChild(el('td', null, (r.flagged ? '⚠ ' : '') + r.name));
      tr.appendChild(el('td', null, r.prefecture));
      tr.appendChild(el('td', 'num', r.formatted));
      table.appendChild(tr);
    });
    box.appendChild(table);
  },
  scatter: function (p, box) {
    titleRow(box, p, p.xLabel + ' × ' + p.yLabel);
    box.appendChild(scatterSvg(p));
    box.appendChild(el('div', 'muted', 'x: ' + p.xLabel + (p.xUnit ? '（' + p.xUnit + '）' : '') +
      ' ／ y: ' + p.yLabel + (p.yUnit ? '（' + p.yUnit + '）' : '') + ' ／ 色＝クラスタ（' + p.clusterCount + '）'));
  },
  hazardCard: function (p, box) {
    var head = el('div');
    var lv = el('span', 'level', p.headlineJa ? levelLabel(p.level) : levelLabel(p.level));
    lv.style.background = LEVEL_COLORS[p.level] || '#94a3b8';
    head.appendChild(lv); head.appendChild(el('span', 'muted', ' ' + p.placeJa));
    box.appendChild(head);
    box.appendChild(el('div', 'title', p.headlineJa));
    if (p.evacuation) box.appendChild(el('div', null, '避難の目安: ' + evacLabel(p.evacuation)));
    var list = el('ul');
    (p.items || []).forEach(function (item) {
      var li = el('li', null, item.labelJa + '：' + item.valueJa);
      li.style.borderLeft = '3px solid ' + (LEVEL_COLORS[item.level] || '#94a3b8');
      li.style.paddingLeft = '6px'; li.style.listStyle = 'none';
      list.appendChild(li);
    });
    box.appendChild(list);
    appendNotes(box, (p.reasonsJa || []).concat(p.coverageNotesJa || []));
    appendSources(box, p.sources);
    box.appendChild(el('div', 'muted', p.disclaimerJa));
  },
  evacuationList: function (p, box) {
    box.appendChild(el('div', 'title', p.headlineJa));
    box.appendChild(el('div', 'muted', p.siteKindJa + '（' + p.forDisasterJa + '・' + p.placeJa + '）'));
    var table = el('table');
    (p.items || []).forEach(function (item, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'num', i + 1));
      var td = el('td');
      td.appendChild(el('div', null, item.nameJa + '（' + item.distanceJa + '・' + item.bearingJa + '）'));
      td.appendChild(el('div', 'muted', item.hazardAreaJa + (item.remarksJa ? '／' + item.remarksJa : '')));
      tr.appendChild(td); table.appendChild(tr);
    });
    box.appendChild(table);
    appendNotes(box, (p.limitationsJa || []).concat(p.notesJa || []));
    appendSources(box, p.sources);
    box.appendChild(el('div', 'muted', p.disclaimerJa));
  },
  escapeDirection: function (p, box) {
    box.appendChild(el('div', 'title', p.headlineJa));
    box.appendChild(el('div', 'muted', p.forDisasterJa + '・' + p.placeJa));
    if (p.direction) box.appendChild(el('div', null, p.direction.bearingJa + ' へ ' + p.direction.distanceJa));
    appendNotes(box, (p.limitationsJa || []).concat(p.notesJa || []));
    appendSources(box, p.sources);
    box.appendChild(el('div', 'muted', p.disclaimerJa));
  },
  markdown: function (p, box) {
    String(p.body || '').split(/\\n{2,}/).forEach(function (para) {
      box.appendChild(el('p', null, para));
    });
  }
};
function levelLabel(level) {
  return { none: '該当なし', caution: '注意', warning: '警戒', danger: '危険', critical: '極めて危険' }[level] || level;
}
function evacLabel(action) {
  return { takeaway: '立退き避難', vertical: '垂直避難', stay: 'その場に留まる' }[action] || action;
}
function appendNotes(box, notes) {
  if (!notes || !notes.length) return;
  var wrap = el('div', 'notes');
  notes.forEach(function (n) { wrap.appendChild(el('div', null, '・' + n)); });
  box.appendChild(wrap);
}
function appendSources(box, sources) {
  if (!sources || !sources.length) return;
  var wrap = el('div', 'muted');
  wrap.appendChild(el('span', null, '出典: ' + sources.map(function (s) { return s.labelJa; })
    .filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(' / ')));
  box.appendChild(wrap);
}

// --- ルート描画 ----------------------------------------------------------
function render(result) {
  var root = document.getElementById('root');
  root.textContent = '';
  var sc = result.structuredContent || {};
  var panels = Array.isArray(sc.panels) ? sc.panels : [];
  if (!panels.length) {
    // フォールバック：パネルなし → テキストをそのまま（§4.6・Claude Code と同じ内容）
    var text = ((result.content || []).find(function (c) { return c.type === 'text'; }) || {}).text;
    root.appendChild(el('pre', null, text || '表示できる結果がありません'));
    return;
  }
  panels.forEach(function (panel) {
    var box = el('div', 'panel');
    var renderer = RENDERERS[panel.type];
    if (renderer) {
      try { renderer(panel, box); }
      catch (e) { box.appendChild(el('div', 'muted', 'このパネルを描画できませんでした（' + panel.type + '）')); }
    } else {
      box.appendChild(el('div', 'muted', '未対応のパネル型: ' + panel.type));
    }
    root.appendChild(box);
  });
}
</script>
</body>
</html>`
