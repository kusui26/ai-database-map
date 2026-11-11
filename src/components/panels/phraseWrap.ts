/**
 * 日本語を**文節で**折り返す（`word-break: auto-phrase`＋`text-wrap: pretty`）。対応していないブラウザは今までどおり。
 *
 * 災害のカードでいちばん読ませたい 1 文が「…安全という意味ではありませ／ん。」と割れ、平時の「いま」の 1 行も
 * 「市町村が出しま／す。」と割れていた（2026-11-11・実測）。行の数は変わらない（折り返す場所だけが文節に寄る）。
 * 文節の切り方は `lang="ja"`（`src/app/layout.tsx`）に依る。
 */
export const PHRASE_WRAP_CLASS = 'text-pretty [word-break:auto-phrase]'
