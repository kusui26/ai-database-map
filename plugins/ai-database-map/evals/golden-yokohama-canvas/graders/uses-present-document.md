---
type: tool_used
tool: mcp__canvas__presentDocument
input_match: '"filenamePrefix"\s*:'
min: 1
---

結論・表・限界・出典は文書に出すこと——**図だけで終わらせない**（§4.5 の禁じ手）。
母艦の `presentDocument` は `title` が必須で、`filenamePrefix` が無いと保存名が
`document` に落ちて後から探せない（実機のスキーマ＝`@mulmoclaude/markdown-plugin`）。
