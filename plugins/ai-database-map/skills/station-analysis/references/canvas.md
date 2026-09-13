# Canvas（図を出せる環境）での見せ方

MulmoTerminal / MulmoClaude のように **`presentChart` / `presentForm` / `presentHtml` /
`presentDocument` を持つホスト**では、表と文章だけでなく図を出せる。ここはその作法。
**無い環境では何も変わらない**（従来どおり Markdown で答える。劣化しない）。

## この環境かどうか

使えるツールの中に `presentChart`・`presentForm`・`presentHtml`・`presentDocument` の
**どれかがあれば Canvas がある**と判断する。**接頭辞は環境で変わる**
（`mcp__mt__presentChart`・`mcp__mulmoterminal-render__presentChart`・
`mcp__mulmoclaude__presentChart`、Codex なら区切りがハイフンで `mcp-mt-presentChart` …）ので、
**末尾の名前で見分ける**。

## 何をどれで見せるか

| 見せたいもの         | 使うもの                          | 作り方                                                                                                     |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 要件の聞き取り       | `presentForm`                     | 型①の質問リストを**フォーム 1 枚**に。回答は次のターンに JSON のテキストで届く                             |
| 数値の図             | `presentChart`                    | **サーバに作らせる**（下記）。返ってきた `document` を**そのまま**渡す                                     |
| 地図                 | `render_map` → `presentHtml`      | 直前の結果の `mapActions` をそのまま `render_map` に渡し、返った URL を保存して `presentHtml` にパスで渡す |
| 結論・表・限界・出典 | `presentDocument`                 | Markdown。**図だけで終わらせない**                                                                         |
| 少数の表             | `presentDocument`（または表計算） | 30 行くらいまでは Markdown の表で足りる                                                                    |

### 引数の形（母艦が受け取る形）

| ツール            | 渡すもの                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `presentForm`     | `fields: [{ id, type, label, choices?, required? }]`（`type` は text / textarea / radio / dropdown / checkbox / date / time / number）      |
| `presentChart`    | `document: { title?, charts: [{ title?, type?, option }] }`——`present: "echarts"` の返り値**そのもの**                                     |
| `presentHtml`     | `path`（保存したファイルのパス）。`html` に本文を貼り直さない——**同じページが複製される**                                                 |
| `presentDocument` | `title`（**必須**）＋ `markdown` ＋ `filenamePrefix`（英小文字・ハイフン、例 `yokohama-stations`）。prefix が無いと `document` という名前で保存されて後から探せない |

### チャートは自分で書かない

`get_station_detail` / `rank_stations` / `compare_growth` に **`present: "echarts"`** を足すと、
`structuredContent.presenters.echarts` に `{ title, charts: [{ title, type, option }] }` が入る。
これは `presentChart` の `document` の形**そのもの**なので、**転記せずにそのまま**渡す。

- 単位は軸名、年次はタイトル、⚠（信頼性フラグ）は副題、整形済みの数値はラベルに**もう入っている**
- 返ってきた option を**書き直すのは禁じ手**——それらが落ちる
- **自分で計算した値**（重み付き合成スコア・自分で作った分類など）を図にするときは、
  option を自分で書いてよい。ただし**単位・年次・正規化の脚注・⚠ を自分で添える**
  （サーバの図と同じ情報量にする）。サーバから取れる図は、必ずサーバの option を使う
- Canvas が無い環境では `present` を**付けない**（応答が重くなるだけ）
- 散布は点の数だけ大きくなる（1,400 点で 56KB）。**広い範囲に付けない**——対象を絞ってから

### 地図は 3 手

```
1) 直前のツール結果の structuredContent.mapActions を、そのまま render_map に渡す
2) 返った url を保存する   curl -sL '<url>' -o artifacts/html/map.html
   （リポジトリを持っているなら python3 scripts/fetch_map.py '<url>' --out … でも同じ）
3) presentHtml にそのパスを渡す
```

- `render_map` は**ランキングの上位駅**（`highlightStations`＝grp だけ）も座標に直して描ける
- **自分で選んだ駅**を地図にするときは `[{ "type": "highlightStations", "grps": [...] }]` を
  組んで渡してよい（サーバが座標に直す）。地点・避難先・半径円は、**返ってきた `mapActions` を
  そのまま**渡す（意味を組み替えない）
- 凡例・出典・注意は**ページ本文に入っている**。文章側でも同じことを言う（図は切り出されて共有される）
- URL は約 24 時間で失効する。失効したら `render_map` を呼び直す

## 順番（型に重ねる）

1. `presentForm` で要件を聞く（型①・**データツールより先**。フォームは分析ではないので
   先に出してよい。無ければ文章で聞く）
2. 対象集合（型②）→ `build_dataset` は 1 回（型③）
3. ローカルで前処理・合成・敏感度（型④〜⑥）
4. `presentChart`（`present: "echarts"` の document をそのまま）
5. `render_map` → 保存 → `presentHtml`
6. `presentDocument` に**結論・表・スコアの作り方（正規化の方法・重み）・効いた要因/弱点・
   限界・出典**（型⑤⑦⑧）。**図の副題に書いたからといって、文章から省かない**

## 禁じ手

- **サーバが返した option を書き直す**（単位・年次・⚠ が落ちる）
- 自分で書いた図に、単位・年次・正規化の脚注を**付けない**
- **ハザードをチャートにする**——危険度は順序尺度で、色・免責・時制が落ちる。
  災害は `render_map` の面と、文章＋パネルの言葉で伝える
- チャートのタイトル・凡例に「安全」「危険度スコア」と書く
- **保存した HTML を `presentHtml` の `html` に貼り直す**（`path` で渡す——貼り直すと複製になる）
- **図だけ出して限界・出典を言わない**（図は本文から切り離して共有される）
- 図を出したことを理由に、文章の表や数値を省く
- **正規化の方法・重みを図の副題にだけ書く**（文章にも 1 行必ず書く——図は切り出される）

## 成果物の置き場所

| 環境                                | 置き場所                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| 母艦（MulmoTerminal / MulmoClaude） | `artifacts/`（`artifacts/html/` に地図・レポート、`artifacts/data/` に CSV とスクリプト） |
| Claude Code 単体                    | `./data/`                                                                                 |

**同じ CSV と同じスクリプトで同じ表が出る**状態にして残す（`build_dataset` の URL は失効するが、
保存した CSV は残る）。何を保存したかは最後に 1 行で伝える。
