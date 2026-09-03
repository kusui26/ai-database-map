/**
 * MapLibre 可否プローブ（MCP Apps・PR-9 スパイク）。
 *
 * `docs/260828_research_claude_auth.md` §4.6 の未検証項目——**MCP Apps の iframe で
 * MapLibre が動く条件が揃うか**——を、対応ホスト上で**実測**して表に出す小さな app。
 * MapLibre 本体（~800KB）を同梱せず、必要条件だけを個別に検査する：
 *
 * 1. blob: URL の Web Worker（MapLibre のタイル処理が要る）
 * 2. WebGL コンテキスト（描画本体）
 * 3. OffscreenCanvas（あれば高速化パス）
 * 4. 宣言済みホスト（地理院タイル）への fetch（CSP connectDomains の実効確認）
 *
 * 結果は画面の表に出る（ユーザーがそのまま読める）。全部 OK なら MapLibre 同梱の
 * 本実装（PR-9 本体の次段）に進める。
 */

import { MAP_TILE_ORIGIN } from './meta'

export const MAP_PROBE_HTML = /* html */ `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>MapLibre 可否プローブ</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.6 system-ui, -apple-system, "Hiragino Sans", sans-serif;
         color: #0f172a; background: #fff; padding: 14px; }
  h1 { font-size: 15px; margin-bottom: 4px; }
  p { color: #64748b; font-size: 12px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .ok { color: #047857; font-weight: 600; }
  .ng { color: #b91c1c; font-weight: 600; }
  .pending { color: #64748b; }
</style>
</head>
<body>
<h1>MapLibre 可否プローブ</h1>
<p>MCP Apps の iframe で地図描画（MapLibre）に必要な条件を実測します。</p>
<table>
  <tr><th>検査</th><th>結果</th><th>詳細</th></tr>
  <tbody id="rows"></tbody>
</table>
<script>
'use strict';
// ハンドシェイク（ui/initialize → initialized）。検査自体はホスト応答を待たず開始する。
function post(msg) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); }
window.addEventListener('message', function (event) {
  var data = event.data;
  if (data && data.jsonrpc === '2.0' && data.id === 1) post({ method: 'ui/notifications/initialized' });
});
post({ id: 1, method: 'ui/initialize',
       params: { appCapabilities: { availableDisplayModes: ['inline'] } } });

var rows = document.getElementById('rows');
function report(name, ok, detail) {
  var tr = document.createElement('tr');
  [name, ok === null ? '検査中…' : ok ? 'OK' : 'NG', detail || ''].forEach(function (text, i) {
    var td = document.createElement('td');
    td.textContent = text;
    if (i === 1) td.className = ok === null ? 'pending' : ok ? 'ok' : 'ng';
    tr.appendChild(td);
  });
  rows.appendChild(tr);
  return function update(ok2, detail2) {
    tr.children[1].textContent = ok2 ? 'OK' : 'NG';
    tr.children[1].className = ok2 ? 'ok' : 'ng';
    tr.children[2].textContent = detail2 || '';
  };
}

// 1) blob: Web Worker（MapLibre の必須条件・§4.6 の未検証項目そのもの）
(function () {
  try {
    var src = 'self.onmessage=function(){self.postMessage(42)}';
    var worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    var update = report('blob: Web Worker', null, '');
    var timer = setTimeout(function () { update(false, '応答なし（3 秒）'); worker.terminate(); }, 3000);
    worker.onmessage = function (e) {
      clearTimeout(timer); update(e.data === 42, 'worker 往復に成功'); worker.terminate();
    };
    worker.onerror = function (e) { clearTimeout(timer); update(false, e.message || 'worker エラー'); };
    worker.postMessage(1);
  } catch (e) { report('blob: Web Worker', false, e.message); }
})();

// 2) WebGL（描画本体）
(function () {
  try {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    report('WebGL コンテキスト', !!gl, gl ? (gl.getParameter(gl.VERSION) || 'context 取得') : 'context 取得不可');
  } catch (e) { report('WebGL コンテキスト', false, e.message); }
})();

// 3) OffscreenCanvas（任意・高速化パス）
report('OffscreenCanvas', typeof OffscreenCanvas !== 'undefined',
       typeof OffscreenCanvas !== 'undefined' ? 'あり' : 'なし（必須ではない）');

// 4) 宣言済みホストへの fetch（CSP connectDomains の実効確認）
(function () {
  var update = report('タイルホストへの接続（${MAP_TILE_ORIGIN}）', null, '');
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 6000);
  fetch('${MAP_TILE_ORIGIN}/xyz/std/0/0/0.png', { signal: controller.signal })
    .then(function (res) { clearTimeout(timer); update(res.ok, 'HTTP ' + res.status); })
    .catch(function (e) { clearTimeout(timer); update(false, String(e && e.message || e) + '（CSP で遮断の可能性）'); });
})();
</script>
</body>
</html>`
