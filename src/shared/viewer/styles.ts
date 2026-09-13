/**
 * ビューアのスタイル（単一の CSS 文字列）。
 *
 * `panels.ts` が付けるクラス名と 1 対 1 で対応する。**どちらを直しても片方が置き去りに
 * ならない**よう、テスト（`tests/viewer-panels.test.ts`）が「描画に現れるクラスはすべて
 * この CSS にある」ことを固定する。
 *
 * 消費側は 2 つ（`docs/260912_gui_chat_protocol.md` §4.2）：T1 のサーバ生成 HTML は
 * `<style>` に入れ、T2 のビューア・プラグインは Shadow DOM に注入する。だから
 * **`:root` や `body` に依存しない**——外側の見た目は消費側が決める。
 */

export const VIEWER_CSS = /* css */ `
.panel { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 10px;
         font: 13px/1.6 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #0f172a;
         background: #fff; }
.panel * { box-sizing: border-box; margin: 0; }
.title { font-weight: 600; margin-bottom: 6px; }
.muted { color: #64748b; font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { border: 1px solid #e2e8f0; border-radius: 999px; padding: 1px 8px; font-size: 11px;
        background: #f8fafc; }
.warn { color: #b45309; }
.panel table { border-collapse: collapse; width: 100%; font-size: 12px; }
.panel th, .panel td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
.panel td.num, .panel th.num { text-align: right; font-variant-numeric: tabular-nums;
                               white-space: nowrap; }
.panel svg { display: block; width: 100%; height: auto; }
.bar-row { display: grid; grid-template-columns: 7em 1fr 6.5em; gap: 8px; align-items: center;
           font-size: 12px; margin: 3px 0; }
.bar-track { background: #f1f5f9; border-radius: 4px; height: 12px; }
.bar-fill { background: #6366f1; border-radius: 4px; height: 12px; }
.level { display: inline-block; border-radius: 999px; padding: 1px 10px; color: #fff;
         font-size: 12px; font-weight: 600; }
.items { padding-left: 0; margin: 6px 0; }
.items li { margin: 2px 0; list-style: none; border-left: 3px solid #94a3b8; padding-left: 6px; }
.notes { background: #f8fafc; border-radius: 8px; padding: 8px 10px; margin-top: 8px;
         font-size: 11px; color: #475569; }
.panel p { white-space: pre-wrap; margin-bottom: 6px; }
`
