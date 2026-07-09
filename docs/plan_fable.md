# AI Database Map 実装プラン（plan_fable）

Step1（アプリ公開）→ Step2（AIネイティブ化）を **Claude Code に1ブロックずつ依頼して進める**ための実行プラン。設計の正は [`architecture.md`](./architecture.md)・[`dataset.md`](./dataset.md)・[`.claude/CLAUDE.md`](../.claude/CLAUDE.md)。本書はそれらを**実装可能な順序・粒度・受け入れ基準**に落とし、あわせて実装観点で再検討した**設計の最終判断**（§2）を記録する。

> **ブロックの粒度**：1ブロック ≒ Claude Code への1依頼（1セッション）。各ブロックは「目的 / 前提 / 作業内容 / 成果物 / 受け入れ基準 / ユーザー側作業 / 依頼プロンプト例」を持ち、**単体で検証可能**（typecheck・test・目視・curl）に設計してある。

---

## 0. 全体マップ

### 0.1 フェーズ一覧（Step1 = P0〜P7、Step2 = P8）

| # | ブロック | 中身 | 依存 | 目安 |
|---|---|---|---|---|
| **P0** | プロジェクト足場 | Next.js 15 + TS + Tailwind + 品質ゲート + Vercel 疎通 | — | 1回 |
| **P1** | メトリクス・カタログ生成 | CSV 499列 → `catalog.json`（単一の真実） | P0 | 1回 |
| **P2a** | Supabase スキーマ | migrations（PostGIS・3テーブル・RLS・index） | P1 | 1回 |
| **P2b** | データ投入＋検証 | melt → COPY 4.2M行 → 全数検証レポート | P2a | 1回 |
| **P2c** | RPC / クエリ層 | 検索・bbox・ランキング・散布の SQL 関数＋ゴールデンテスト | P2b | 1回 |
| **P3a** | shared 契約 + domain | Zod スキーマ・カタログ層・駅詳細プレゼンタ・単体テスト | P1 | 1回 |
| **P3b** | 共通API | Route Handlers 5本（検証・エラー封筒・キャッシュ） | P2c, P3a | 1回 |
| **P4a** | 地図基盤 | MapLibre・全駅レイヤ・選択・半径サークル・URL 同期 | P3b | 1回 |
| **P4b** | 検索＋アプリシェル | 駅検索(cmdk)・半径切替・ヘッダ・レスポンシブ枠 | P4a | 1回 |
| **P5a** | 駅詳細パネル（骨格＋乗降客） | ドロワー/ボトムシート・駅カード・pax チャート・フラグ | P4b | 1回 |
| **P5b** | 駅詳細（人口・将来推計） | 実績＋2推計の重ねチャート・増減率・lowbase 表示 | P5a | 1回 |
| **P5c** | 駅詳細（地価・バス・事業所） | 3カテゴリのタブ完成 | P5a | 1回 |
| **P5d** | 追加データ投入（地価年次・事業者名） | 年次地価パネル＋事業者名を DB 投入（catalog/loader/schema/API 拡張・再ロード） | P5c | 1回 |
| **P5e** | 駅詳細UI改善 | 地価/バス 時系列化・従業者タブ独立・事業者名表示・地図ズーム移動 | P5d | 1回 |
| **P5f** | 検索結果の駅名表記 | `search_label`（label＋都道府県・一意）で同名駅を区別 | P4b | 1回 |
| **P6a** | ランキング | 都道府県×指標（カタログ駆動）→ 上位/下位20 → flyTo | P3b, P4b | 1回 |
| **P6b** | 散布図＋クラスタ | k-means(決定的)・散布チャート・lown 除外トグル | P3b, P4b | 1回 |
| **P7a** | 品質・仕上げ | 出典/About・OGP・エラー/ロード・a11y・Lighthouse | P5, P6 | 1回 |
| **P7b** | 公開 | 本番 env・cron keep-alive・README・docs 反映 | P7a | 1回 |
| **P8a** | AI ツール表面 | catalog→tool 自動生成・AI SDK+Gemini・`/api/chat` | Step1 | 1回 |
| **P8b** | チャット UI | **左併設チャット＋インラインカード**・Protocol レンダラ（P5/P6 部品を再利用） | P8a | 1回 |
| **P8c** | 評価・強化 | ゴールデン20問 eval・プロンプト調整・(任意)GraphAI PoC | P8b | 1回 |

**合計目安**：Step1 = 19ブロック（P5d/P5e は 2026-07-08・P5f は 2026-07-09 のユーザー要望で追加）、Step2 = 3ブロック。

### 0.2 依存関係（クリティカルパス）

```
P0 ─ P1 ─┬─ P2a ─ P2b ─ P2c ─┐
          └─ P3a ─────────────┴─ P3b ─ P4a ─ P4b ─┬─ P5a ─ P5b/P5c ─┐
                                                   ├─ P6a / P6b ─────┼─ P7a ─ P7b ═ Step1公開
                                                   └──────────────────┘
Step1公開 ─ P8a ─ P8b ─ P8c ═ Step2
```

- **最短公開ルート**（機能を絞る場合）：P0→P1→P2→P3→P4→P5a→P7a→P7b（地図＋検索＋駅詳細のみで先に公開し、P5b/c・P6 を追撃）も可。既定は全ブロック順走。
- P3a は P2 と**並行可能**（DB がなくても純関数は書ける）。
- **P5d/P5e（UI改善・2026-07-08 追加）**：`P5c ─ P5d ─ P5e`。P5d は追加データ投入（DB 再ロード）、P5e はその UI 化。クリティカルパス外で P6/P7 と並行可（公開を急ぐなら後回しでも可）。

### 0.3 各ブロック共通の進め方（毎回この型）

1. `git status` 確認 → **ユーザー承認のうえ**フィーチャーブランチ作成（`feat/p4a-map` 等）。
2. 実装 → **`pnpm typecheck && pnpm lint && pnpm test` を必ず通す**。UI は dev サーバで目視確認ポイントを提示。
3. 受け入れ基準をセルフチェックし、結果（コマンド出力・スクショ観点）を報告。
4. 必要に応じ `docs/`（architecture.md の現況表・本プラン進捗）を更新。
5. コミット・PR は**ユーザーの明示的な指示があったときのみ**（CLAUDE.md §4）。

---

## 1. 到達目標（Definition of Done）

### Step1 DoD — 「意味を持つ共通APIの上に建つ地図アプリ」を公開
- 公開URL（Vercel）で：**全国 9,273 駅の地図**／**駅名検索**／**駅クリック → 詳細パネル**（乗降客・人口(実績+将来2系統)・地価・バス・事業所/従業者のチャート＋**信頼性フラグ表示**）／**半径切替（6段）**／**都道府県ランキング**／**増減率散布図（クラスタ付き）**／**出典・ライセンス表示**／**モバイル対応**。
- **共通API 5本**が稼働：自己記述カタログ・Zod 検証・エラー封筒・キャッシュヘッダ付き。**UI はこの API（＝domain）以外からデータを得ない**。
- Supabase：migrations 管理・RLS 有効・約4.2M行投入済み・**CSV との全数照合レポート**あり。
- 品質：domain 純関数の単体テスト green・typecheck/lint green・Lighthouse（モバイル）Performance ≥ 80。
- ドキュメント：architecture.md 現況表・README 更新。

### Step2 DoD — 「クリックと会話が同じ経路を通る」
- チャットで「東京駅の人口推移を見せて」「千葉県で地価が一番上がった駅は？」等 → **LLM が共通API ツールを呼び、GUI Chat Protocol 応答**が構造化UIと**同じ描画パス**で地図・パネルに反映。
- ゴールデン20問の eval スクリプトで合格率を計測・記録。レート制限・タイムアウト・コスト上限あり。
- `domain`・既存 API・protocol は**無改変**（純加算の証明）。

---

## 2. 設計の最終判断（実装観点での再検討）

architecture.md を土台に、実装量・運用コスト・UX の観点で**あらためて全選択を検証**した。維持／洗練を明示する（洗練分は該当ブロック完了時に architecture.md へ反映する）。

### 2.1 維持する決定（再検証済み）
| 決定 | 再検証の結論 |
|---|---|
| Next.js App Router + Vercel + TypeScript + Zod | UI/API/AI を1基盤に統合でき、型付き契約（`z.infer`）が UI と LLM で共有できる。代替（Remix/SvelteKit）に移る理由なし |
| Supabase + PostGIS | マネージド・migrations・RLS・無料枠。9,273駅の空間検索と Step2 拡張の土台。**ただし無料枠の2制約（500MB・7日無活動で pause）に §2.2-③⑦で対処** |
| MapLibre GL JS | WebGL で 9,273 点は余裕。クラスタ・スタイル制御・ベンダーロックなし |
| Chart.js（+ react-chartjs-2）| canvas 描画で散布 9k 点も軽い。Recharts(SVG) は点数で不利、ECharts は過剰 |
| ドメイン中心の依存方向（`UI/api/ai → domain → db`）| Step2 純加算の生命線。ESLint の import 制約で機械的に強制する（P0） |
| LLM = Gemini 2.5 Flash 主 + Vercel AI SDK 既定、GraphAI は PoC（architecture.md §10）| 変更なし。ツール表面＝共通API なので後から差し替え可能 |

### 2.2 洗練する決定（理由付き・architecture.md へ反映予定）

**① 駅レイヤの配信：bbox 都度取得 → 「全駅 GeoJSON 1回配信＋CDNキャッシュ」**
- 9,273 点 × 最小属性 ≈ 700KB（gzip ~200KB）。**初回1回のロードで以後のパン/ズームが0リクエスト**になり、MapLibre のクラスタ/シンボルは 1万点を余裕で描画する。過去プロジェクトの問題は「Leaflet の DOM マーカー」であって全件取得ではない。
- `GET /api/stations/geojson` を `Cache-Control: public, s-maxage=86400, stale-while-revalidate` で配信（Vercel CDN が吸収 → Supabase 負荷ほぼゼロ）。
- **bbox / 最寄 API は AI・プログラム消費用に維持**（§5.2 の空間クエリは残す）。地図の描画用と API の意味論を分けるのが最適解。

**② 物理スキーマ：`station_values`（列レジストリ方式）に精密化**
- 論理モデル（metric × radius × year）は architecture.md §5.1 のまま。物理は **「CSV列＝原子単位」** に寄せる：
  - `metric_columns(id smallint PK, key text unique, meta jsonb)` — カタログの DB ミラー（499列 ≒ 488 値列）
  - `station_values(column_id smallint, station_id smallint, value float8, PK(column_id, station_id))` — **NaN は行を作らない**
- 理由：(a) **Supabase 無料枠 500MB に収まる**（試算：ヒープ ~170MB＋PK ~110MB ≈ 300MB。text キーの正規形だと index 込みで 500MB 超のリスク）。(b) PK が column_id 先頭なので**ランキング＝1列の連続スキャン**で高速。(c) melt が自明で、**指標追加＝行追加**（スキーマ変更ゼロ）という §5.1 の狙いを完全に満たす。
- 増減率の `year_base` 等の次元は `metric_columns.meta`（＝catalog.json のミラー）が持つ。

**③ カタログの置き場：「コードが正、DB はミラー」**
- `pipeline` が CSV ヘッダ＋規則から `src/shared/catalog/catalog.json` を**生成してコミット**（data/ は gitignore だがカタログは契約＝コード）。Zod でロード時検証。
- ランタイムは JSON を直接参照（DB 往復ゼロ・型安全）。DB の `metric_columns` は投入整合と SQL 側検証用のミラー。**UI 選択肢・API 検証・AI ツール記述の全てがこの1ファイルから派生**する。

**④ DB アクセス：supabase-js（anon・RLS read-only）＋ SQL 関数（RPC）**
- 複雑クエリ（trgm 検索・bbox・ランキング・散布）は **`create function` を migrations で管理し `.rpc()` で呼ぶ**。PostgREST の口だけで完結し、サーバレスの接続プール問題を回避。ORM（Drizzle 等）は現段階では層が増えるだけ → 不採用（`src/db` に隔離してあるので将来差し替え可）。

**⑤ UI 実装キット（新規決定）**
| 領域 | 採用 | 理由 |
|---|---|---|
| スタイリング | **Tailwind CSS v4** | ユーティリティ一貫・Claude Code との相性（差分が読める） |
| UI プリミティブ | **shadcn/ui**（Radix ベース・コピーイン） | Dialog/Drawer/Tabs/Command を審美性込みで最短導入。依存でなくコード所有 |
| 検索 UI | **Command（cmdk）** | 駅名オートコンプリートの定番 UX |
| モバイル | **vaul**（ボトムシート） | 地図アプリの標準文法（下から引き出す詳細） |
| 状態 | **Zustand**（地図・選択・パネル）＋ **nuqs**（URL 同期） | 最小・ボイラープレートなし。**選択駅と半径は URL クエリに同期**（共有リンク＝地図アプリの必須機能） |
| フォント | **Noto Sans JP**（next/font）＋ `font-feature: tnum` | 日本語＋数表の桁揃え |

**⑥ ベースマップ：地理院 最適化ベクトルタイルを既定（キー不要・実装はこれのみ）**
- **既定＝国土地理院 最適化ベクトルタイル**（無料・キー不要・実質クォータなし・出典明記で商用可・日本の正確さ最高。「オープンデータのアプリがベースマップまでオープンデータ」という物語整合）。公式スタイルを起点に**淡色トーン**へ調整して使う（データ可視化の背景として最適）。
- 「**試験公開**」（正式提供化を検討中の暫定提供）への三重の保険：① `NEXT_PUBLIC_MAP_STYLE_URL` によるスタイル差し替え、②公式配布の **PMTiles を自前ストレージ（Cloudflare R2 等）へコピー**すれば仕様/URL変更の影響を遮断、③正式提供で枯れている**淡色ラスタ**へ退避。
- **候補（ドキュメント記録のみ・実装には入れない）**：OpenFreeMap（キー不要・既製の淡色スタイル・寄付運営）／MapTiler Flex $30/月（美観オプション。**無料枠は非商用限定**のため既定にしない）。

**⑦ 運用（無料枠の現実対応）**
- **Supabase 無料枠は7日間無活動で pause** → Vercel Cron（Hobby は日次可）で `GET /api/health`（1クエリ）を毎日実行。
- DB サイズを P2b で実測し、400MB 超なら将来データ追加時に H30 推計系の DB 非搭載（CSV 保持）等で調整。

### 2.3 採用ライブラリ一覧（Step1）

各項目の詳説（概要・役割・採用理由・代替候補）は **§10** を参照。

| パッケージ | 用途 | 検討した代替（不採用理由） |
|---|---|---|
| next@16 / react@19 | 基盤（16 系が現行安定・Turbopack 既定・Node 20+） | — |
| zod@4 | 契約（API/Protocol/カタログ） | valibot（AI SDK・エコシステム互換で zod） |
| @supabase/supabase-js@2 | DB クライアント | drizzle+postgres.js（プール管理が増える）・PostgREST 直（型がない） |
| maplibre-gl@5 | 地図 | Leaflet（WebGL でない・過去の教訓）・deck.gl（過剰） |
| chart.js@4 + react-chartjs-2@5 | チャート | Recharts（SVG で散布9kが重い）・ECharts（バンドル大） |
| tailwindcss@4, shadcn/ui, cmdk, vaul | UI | MUI/Chakra（デザイン自由度・バンドル） |
| zustand@5, nuqs@2 | 状態・URL | Redux（過剰）・Context のみ（地図の高頻度更新に不向き） |
| vitest@4 | テスト | jest（ESM/速度） |
| pnpm | パッケージ管理 | npm/yarn（速度・厳密さ） |
| （Step2）ai@6 + @ai-sdk/google | LLM オーケストレーション（v6 が現行。`@ai-sdk/react@6` とセット固定） | architecture.md §10 のとおり。GraphAI は P8c で PoC |

### 2.4 UI / デザイン設計（具体）

**デザイン言語：「地図が主役・パネルは浮かせる・数字は正直に」**
- ライトな地図の上に、白 90%＋blur の浮遊パネル（`rounded-2xl shadow-lg backdrop-blur`）。
- **信頼性フラグ（lowbase/lown）を ⚠ バッジ＋ツールチップで常に可視化** — 監査済みデータセットの誠実さを UX に反映する本アプリの個性。
- 欠損（NaN）は「—」＋理由ツールチップ（例「2012年の基準値が0のため増減率なし」）。

**デザイントークン**
| トークン | 値 |
|---|---|
| アクセント | indigo-600（選択駅・半径サークル・主ボタン） |
| ニュートラル | slate（bg: slate-50 / text: slate-900・600） |
| カテゴリ色 | 乗降客 slate-800／人口 blue-600（推計は blue-300 破線）／地価 amber-600／バス emerald-600／事業所 violet-600／従業者 pink-600 |
| 警告（フラグ） | amber-500 |
| 数字 | tabular-nums・3桁区切り・単位はカタログ駆動 |

**画面構成（デスクトップ）**
```
┌────────────────────────────────────────────────────────────────┐
│ ◉ AI Database Map   [🔍 駅名で検索…        ]      [500m|1|2|5|10|20km] │ ← ヘッダ(浮遊)
│                                                                │
│                （MapLibre 全面地図・全駅レイヤ）                  │
│     ・駅=円マーカー（乗降客数でサイズ/ソート・ズームでラベル）      │
│     ・選択駅=アクセント色＋半径サークル（選択半径）               │
│                                        ┌─────────────────────┐ │
│  [🏆 ランキング] [📈 散布図]  ← 左下FAB   │ ◉ 東京（JR東日本ほか）    │ │
│                                        │ 千代田区 / 乗降 XXX万/日 │ │
│                                    │ [乗降|人口|地価|バス|事業所|従業者]│ │
│                                        │  📊 チャート             │ │
│                                        │  ⚠ 低分母注意 (該当時)   │ │
│                                        └─────────────────────┘ │
│  出典: 国土数値情報 / e-Stat ほか                ← フッタ(小)      │
└────────────────────────────────────────────────────────────────┘
```
- **モバイル**：検索は上部全幅、駅詳細は vaul ボトムシート（スナップ 45%/90%）、FAB は下部中央。
- **インタラクション**：駅クリック→ flyTo＋サークル＋パネル。ランキング/散布の行・点クリック→ 該当駅へ flyTo＋選択。半径切替→ サークルとパネル内チャートが即時更新（詳細 API は全半径分を1回で返すため再フェッチなし）。URL `?grp=…&r=1000` で状態共有。

**AIインタラクション UI（Step2・確定設計）＝「左併設チャット＋インラインカード＋拡大で昇格＋地図即時操作」**

チャットは**モーダルにしない**（地図を隠すと「AIが地図を操作する」体験が死ぬ）。会話は左に併設し、地図は常に見せる。ヘッダには Step2 で「✦AI」ボタンが加わる。

```
┌────────────────────────────────────────────────────────────┐
│ ◉ AI Database Map   [🔍 検索]     [500m|1|2|5|10|20km] [✦AI]  │
├───────────────┬────────────────────────────────────────────┤
│ ✦ チャット      │   （地図は常に可視。チャット幅ぶん padding      │
│               │     して flyTo を可視領域中心に補正。          │
│ AI: 東京駅の   │     返答と同時に flyTo/ハイライト/半径円）      │
│ 人口推移です。  │                                            │
│ ┌───────────┐ │                         ┌───────────────┐ │
│ │📈 チャート   │ │                         │ 駅詳細ドロワー    │ │
│ │ (compact)  │ │                         │ （クリックUIと    │ │
│ │   [⤢ 拡大]  │ │                         │  共用＝昇格先）   │ │
│ └───────────┘ │                         └───────────────┘ │
│ [新宿と比較]    │                                            │
│ [半径5kmで]    │  ← サジェストチップ                           │
│ ───────────── │                                            │
│ [質問を入力… ⏎]│                                            │
└───────────────┴────────────────────────────────────────────┘
```

| ルール | 内容 |
|---|---|
| **① 配置＝併設** | デスクトップ＝**左サイドパネル（約400px・開閉式**。ヘッダ「✦AI」/ `⌘K`）。モバイル＝vaul ボトムシート（**半分⇔全画面の2スナップ**。半分なら地図の動きが見える）。モーダルチャットは不採用 |
| **② インラインカード** | グラフ・表は**チャットスレッド内にコンパクト描画**（P5/P6 と同一の Panel コンポーネント・`size:'compact'`）。会話の文脈にグラフが残り「それを5kmで」の連鎖に強い |
| **③ 拡大で昇格** | カードの ⤢ で**クリックUIと同じ場所**へ（駅詳細系→右ドロワー／ランキング・散布→モーダル）。「クリックでも会話でも、最終的に同じ場所に同じ物が出る」 |
| **④ 地図即時操作** | `mapActions` は**返答ストリーミング中に即時実行**（flyTo→ハイライト→半径円）。本文中の**駅名はクリック可能チップ**（タップで flyTo）。パネル開時は **flyTo に padding** を渡し可視領域の中心へ |
| **⑤ 共存と復帰** | 左チャット＋右ドロワー同時表示可（1440px で地図 ~640px）。両方開閉可・「地図をリセット」チップ＝ `clearOverlays` |

**チャート仕様（駅詳細タブ）** ※ P5c は棒中心で実装。P5d/P5e で地価・バスを時系列化し従業者を独立タブに（下表は P5e 後の最終形）。
| タブ | 内容 |
|---|---|
| 乗降客 | pax_2011–2024 折れ線＋ rate_yoy/rate_covid バッジ（flag_* で注意表示） |
| 人口 | 実績 1995–2020 実線 ＋ R6 推計 2025–2070 破線 ＋ H30 推計 併記（凡例トグル）。pop_err を注記 |
| 地価 | lp_med の**年次折れ線**（`station_landprice_yearly` を P5d で投入）＋最寄公示カード＋増減率表。半径別バーは補助として残置可 |
| バス | bus_n2010→bus_n の**2点折れ線**（2010→現在）＋内訳（local/hw）・対2010年増減率 |
| 事業所 | estab_n の 3時点（2012/16/21）折れ線＋9年/5年増減率 |
| 従業者 | emp_n の 3時点折れ線＋9年/5年増減率（`employee` カテゴリ・**独立タブ**） |

---

## 3. 契約仕様（全ブロックが従う3つの契約）

### 3.1 メトリクス・カタログ（`src/shared/catalog/catalog.json`）
1エントリ＝CSV の1値列。Zod スキーマ（P3a で確定）：
```ts
type CatalogEntry = {
  key: string                    // 'pop_2020_1km' = CSV列名 = 全レイヤ共通の安定ID
  baseMetric: string             // 'pop' | 'pop_pred' | 'lp_med' | 'bus_n' | 'estab_n' | …
  kind: 'level' | 'growth' | 'flag' | 'error' | 'ratio'
  category: 'passenger'|'population'|'population_forecast'|'land_price'|'bus'|'establishment'|'employee'
  labelJa: string                // '人口（2020年・1km圏）' ← 規則から自動生成
  unit: '人'|'人/日'|'円/㎡'|'%'|'箇所'|'事業所'|null
  format: 'int'|'decimal1'|'percent1'|'yen'|null
  radiusM: number|null           // 500|1000|2000|5000|10000|20000
  year: number|null              // 対象年（増減率は新年）
  yearBase: number|null          // 増減率の分母年
  vintage: number|null           // 将来推計の推計時点（2024=R6 / 2018=H30）
  reliabilityFlagKey: string|null// 対応する lowbase/lown 列の key
  rankable: boolean              // ランキング/散布の候補にするか（flag等は false）
  higherIsBetter: boolean|null
  source: string                 // '国勢調査（e-Stat）' 等 ＋ license
}
```

### 3.2 GUI Chat Protocol v1（`src/shared/protocol.ts`）
P3a で Zod 確定。**P5/P6 の UI パネルはこの Panel 型を props に取る**（＝Step2 でそのままレンダラになる）：
```ts
MapAction = { type:'flyTo', lon, lat, zoom? }
          | { type:'selectStation', grp, radiusM? }
          | { type:'highlightStations', grps: string[] }
          | { type:'clearOverlays' }
Panel = ({ type:'stationCard', … } | { type:'trendChart', title, unit, flags[], series[] }
      | { type:'rankingTable', … } | { type:'scatter', … } | { type:'markdown', body })
      & { placement?: 'inline'|'drawer'|'modal' }   // 表示先ヒント（チャット=inline 既定・⤢で昇格）
MapResponse = { messages: {role,text}[], mapActions: MapAction[], panels: Panel[] }
```
- パネル部品は `size:'compact'|'full'` の表示バリアントを持つ（チャット内=compact／ドロワー・モーダル=full。§2.4「AIインタラクション UI」参照）。

### 3.3 共通API 契約（P3b で確定・全て Zod 検証＋エラー封筒 `{error:{code,message}}`）
| エンドポイント | パラメータ | 返却 | キャッシュ |
|---|---|---|---|
| `GET /api/metrics` | `category?` | カタログ（自己記述） | 1日 |
| `GET /api/stations` | `q?`（検索）/ `bbox?` / `near?` | 駅サマリ配列（≤50） | 短 |
| `GET /api/stations/geojson` | — | 全駅 FeatureCollection | 1日 |
| `GET /api/stations/[grp]` | — | 駅詳細（**全半径分の系列を組立済み**＋フラグ） | 1時間 |
| `GET /api/ranking` | `metric`(catalog検証), `prefecture?`, `order`, `limit≤50` | 順位表（値＋整形＋フラグ） | 1時間 |
| `GET /api/growth` | `x`, `y`(catalog検証), `prefecture?`, `excludeLowN?` | 散布点＋クラスタ | 1時間 |
| `GET /api/health` | — | `{ok:true}`（cron 用・DB 1クエリ） | なし |

---

## 4. 実装ブロック詳細（Step1）

### P0 — プロジェクト足場
- **目的**：品質ゲートの効いた Next.js 基盤を作り、Vercel 疎通まで確認する。
- **前提**：なし（現リポジトリ直下に追加）。
- **作業**：
  1. リポジトリ直下に手動スキャフォールド（既存ディレクトリと共存のため create-next-app は使わない）：`package.json`（pnpm）・`next.config.ts`・`tsconfig.json`（strict・paths `@/*`）・`src/app/layout.tsx`・`src/app/page.tsx`（仮）。
  2. Tailwind v4・ESLint（flat config：`no-explicit-any`／`consistent-type-assertions: never`／**import 境界ルール**＝`domain` から `components|app|ai` への import 禁止）・Prettier・Vitest。
  3. `src/shared/constants.ts`（半径6値・都道府県47・カテゴリ色トークン）＋サンプルテスト1本。
  4. `.env.example`・`.vercelignore`（`data/ slide/ script/ pipeline/ condminium/ docs/`）・`.gitignore` 追記（`node_modules/ .next/`）・GitHub Actions（typecheck+lint+test）。
  5. Vercel プロジェクト接続 → プレビューデプロイで仮ページ表示。
- **成果物**：ビルド可能な骨格＋CI＋デプロイ URL。
- **受け入れ基準**：`pnpm typecheck && pnpm lint && pnpm test` green／Vercel プレビューで仮ページ表示／ESLint の import 境界ルールが violation を検出できる（故意違反のテストで確認）。
- **ユーザー側作業**：GitHub リポジトリの用意（既存 push）、Vercel アカウント接続の承認。
- **依頼例**：「plan_fable P0 を実施してください」

### P1 — メトリクス・カタログ生成（本プロジェクトの要）
- **目的**：CSV 499列を機械可読の**単一の真実**に変換する。
- **前提**：P0。`data/derived/station_dataset.csv` 存在。
- **作業**：
  1. `pipeline/build_catalog.py`：CSV ヘッダ＋接頭辞規則（dataset.md §2）から全 488 値列の CatalogEntry を生成 → `src/shared/catalog/catalog.json` に出力（コミット対象）。識別11列は `stations` 属性として別リスト化。
  2. ラベル生成規則（例 `pop_gr_2020_2015_1km` → 「人口増減率（2015→2020年・1km圏）」）、`reliabilityFlagKey` の紐付け（pop↔lowbase / lp_gr↔lp_gr_lown / bus_gr↔bus_gr_lown / estab・emp↔estab_gr_lown）、`rankable`（flag・hidden_ratio 等は false）。
  3. 検証スクリプト：エントリ数=CSV列数と完全一致・全 key 重複なし・全フラグ参照が実在・カテゴリ別件数が dataset.md §2 の表と一致 → レポート出力。
  4. 全ラベルの一覧 Markdown を吐き、目視レビュー用に提示。
- **成果物**：`catalog.json`（≈488 entries）・生成/検証スクリプト・ラベル一覧。
- **受け入れ基準**：検証スクリプト all pass／ラベル抜き取り20件が日本語として自然（ユーザー確認）／dataset.md §2 の 11 カテゴリ合計と一致。
- **依頼例**：「P1 カタログ生成を実施。ラベル規則は提案ベースで、一覧を見せて」

### P2a — Supabase スキーマ（migrations）
- **目的**：バージョン管理された DB 基盤（§2.2-②の物理設計）。
- **前提**：P1。Supabase プロジェクト（東京リージョン）作成済み。
- **作業**：
  1. `supabase init`・`config.toml`。migration 1本目：`postgis`・`pg_trgm` 拡張／`stations`（id smallint PK・grp unique・名称・県・lon/lat・**geom generated column**・pax_latest・フラグ類）／`metric_columns`／`station_values`（PK(column_id, station_id)）／GiST・trgm インデックス。
  2. **RLS**：3テーブル有効化＋ anon `SELECT` ポリシーのみ（書込はサービスロール直結のみ）。
  3. `seed.sql`：catalog.json → `metric_columns` 投入（生成スクリプトで SQL 化）。
  4. ローカル検証は Docker があれば `supabase start`、なければクラウドに `supabase db push`（どちらで進めるかユーザーに確認）。
- **成果物**：`supabase/migrations/*.sql`・seed・接続手順（README 断片）。
- **受け入れ基準**：migration がクリーン適用／anon キーで SELECT 可・INSERT 不可／`metric_columns` 件数 = catalog 件数。
- **ユーザー側作業**：Supabase プロジェクト作成、`SUPABASE_URL`・`ANON_KEY`・`SUPABASE_DB_URL`（直結・投入用）を `.env` へ。Docker 有無の申告。
- **依頼例**：「P2a を実施。Supabase は作成済み、.env に鍵を入れた」

### P2b — データ投入＋全数検証
- **目的**：CSV → DB を**監査可能に**移す（dataset.md の品質文化を DB 投入にも適用）。
- **前提**：P2a。
- **作業**：
  1. `pipeline/load_to_supabase.py`：stations 9,273行（pax_latest 算出込み）→ COPY／CSV を melt（NaN スキップ）→ `station_values` へ COPY（psycopg・数分想定）。**冪等**（TRUNCATE→再投入方式）。
  2. 検証スクリプト：(a) 値行数 = CSV 非NaN セル数と一致、(b) 列ごとの件数一致、(c) **無作為300セルの値一致**、(d) 全国計スポット（人口2020・事業所2021 等が dataset.md の監査値と一致）、(e) DB サイズ実測（`pg_database_size`）→ レポート Markdown。
- **成果物**：ローダ・検証レポート（`docs/` か PR 説明に添付）。
- **受け入れ基準**：検証 (a)〜(d) all pass／DB サイズ < 400MB（超過時は対応案を提示）。
- **依頼例**：「P2b 投入と検証を実施。検証レポートを見せて」

### P2c — RPC / クエリ層（SQL 関数）
- **目的**：検索・空間・ランキング・散布を **migrations 管理の SQL 関数**として実装。
- **前提**：P2b。
- **作業**：
  1. migration 2本目：`search_stations(q)`（trgm＋ILIKE、pax_latest 降順、≤10）／`stations_in_bbox(w,s,e,n, limit)`／`nearest_stations(lon,lat,k)`／`rank_by_column(column_key, pref, dir, lim)`（key を `metric_columns` で検証）／`values_for_columns(column_keys[], pref)`（散布・詳細用の一括取得）。
  2. ゴールデンテスト（SQL/スクリプト）：「東京 5km 人口2020 = CSV 値」「“しんじゅく”→ 新宿がヒット」「千葉県 pop_gr_2020_2015_1km 降順 Top1 が CSV 手計算と一致」等 10 ケース。
- **成果物**：RPC migration・ゴールデンテストスクリプト。
- **受け入れ基準**：全ゴールデン一致／anon 実行可・危険な動的 SQL なし（column_key はホワイトリスト照合）。
- **依頼例**：「P2c RPC を実装。ゴールデン10ケースの結果を見せて」

### P3a — shared 契約 + domain 層（純関数・テスト厚め）
- **目的**：アプリの「プロダクト＝ドメイン」を framework 非依存で確立。**P2 と並行可**。
- **前提**：P1（catalog.json）。
- **作業**：
  1. `src/shared/`：`catalog.ts`（JSON を Zod 検証してロード・key→entry Map・カテゴリ別リスト）／`protocol.ts`（§3.2 v1）／`api.ts`（各 API の入出力 Zod）／`format.ts`（format 指定→表示文字列。tnum前提）／`geo.ts`（半径円ポリゴン生成・純関数）。
  2. `src/domain/`：`metrics/`（カタログ問い合わせ・rankable 一覧）／`stations/presenter.ts`（**値の束 → StationDetail：カテゴリ×半径の系列組立・フラグ解決**。純関数）／`ranking/presenter.ts`／`growth/kmeans.ts`（**決定的 k-means**：z-score 標準化・シード付き k-means++・k=4）＋ `growth/presenter.ts`。
  3. 単体テスト：カタログ整合・presenter の境界（NaN 系列・フラグ付与・半径6本の単調系列）・k-means の決定性/既知データ・format の丸め。
- **成果物**：shared＋domain＋テスト（DB 非依存）。
- **受け入れ基準**：`pnpm test` green（目安 40+ ケース）／domain から UI/DB への import ゼロ（ESLint ルールで機械確認）。
- **依頼例**：「P3a を実施。protocol と catalog の Zod を確定し、presenter と k-means をテスト込みで」

### P3b — 共通API（Route Handlers）
- **目的**：§3.3 の契約を稼働させる（AI が将来叩く表面）。
- **前提**：P2c・P3a。
- **作業**：
  1. `src/db/`：supabase-js クライアント（サーバ用・タイムアウト付き fetch）＋ RPC の型付きラッパ。
  2. `src/app/api/`：§3.3 の 7 ルート。Zod 検証 → domain → 整形済み応答。エラー封筒・`Cache-Control`・`export const runtime='nodejs'`。
  3. 統合スモーク：ローカル dev で curl 8本（正常系＋400系）→ 期待 JSON 形状（スクリプト化 `tests/api.smoke.ts` 相当）。
- **成果物**：稼働する共通API・スモークスクリプト。
- **受け入れ基準**：スモーク all pass／不正 metric key が 400（catalog 検証が効く）／geojson が ~9,273 features・gzip 転送。
- **依頼例**：「P3b 共通APIを実装。curl スモーク結果を見せて」

### P4a — 地図基盤
- **目的**：地図アプリとしての骨格体験（表示・選択・半径・URL）。
- **前提**：P3b。
- **作業**：
  1. `MapView`（client・dynamic import・SSR 無効）：ベースマップは**地理院 最適化ベクトルタイル**（キー不要。`NEXT_PUBLIC_MAP_STYLE_URL` の既定値）。公式スタイルを起点に**淡色トーンへ調整**した style JSON をリポジトリ内に持ち、attribution に**出典（国土地理院最適化ベクトルタイル）**を表示。全駅 GeoJSON ソース（cluster: z<10、以降 circle＋z≥12 でラベル。circle 半径は pax_latest の平方根スケール）。
  2. クリック/ホバー：カーソル・選択ハイライト（アクセント色）・`flyTo`（**開いているパネル幅を padding で補正して可視領域中心へ**＝ドロワー/Step2チャットで共用する仕組み）。選択駅＋半径のサークル描画（`shared/geo.ts`）。
  3. Zustand ストア（selectedGrp / radiusM / panels）＋ nuqs で `?grp&r` を双方向同期（リロード・共有で復元）。
- **成果物**：全国の駅が見え、選び、半径が描ける地図。
- **受け入れ基準**：初期表示（東京 z9）1.5s 以内（ローカル）／9,273 点でパン・ズームが 60fps 近辺／URL 直叩きで状態復元／地図に**地理院の出典表示**が出る／`pnpm build` 成功。
- **ユーザー側作業**：なし（地理院タイルはキー不要）。
- **依頼例**：「P4a 地図基盤を実装。確認ポイントを列挙して」

### P4b — 検索＋アプリシェル
- **目的**：ヘッダ・検索・半径切替・モバイル枠＝アプリの操作系完成。
- **前提**：P4a。
- **作業**：shadcn 導入（Command/Dialog/Tabs/Tooltip 等）／ヘッダ（ロゴ・検索・半径セグメント）／cmdk 検索（`/api/stations?q=` debounce 250ms・複数候補→選択→flyTo）／左下 FAB（ランキング・散布図のプレースホルダ）／モバイルレイアウト（ヘッダ簡略・FAB 配置）／デザイントークン適用（§2.4）。
- **受け入れ基準**：「東京」「しんじゅく」「二月田」で検索→選択→移動が動く／半径切替がサークルに即反映／375px 幅で崩れない。
- **依頼例**：「P4b 検索とシェルを実装」

### P5a — 駅詳細パネル（骨格＋乗降客）
- **目的**：詳細パネルの器と最初のタブ。**Panel 型 props＝Protocol 準拠**をここで確立。
- **前提**：P4b。
- **作業**：デスクトップ右ドロワー／モバイル vaul シート。`/api/stations/[grp]` を SWR 的に取得 → `stationCard`（駅名・事業者・県・最新乗降客・バッジ）＋ `trendChart`（pax 2011–2024、rate_yoy/rate_covid、flag_* 注意表示）。**各パネルコンポーネントは `z.infer<typeof panelSchema>` を props に取り、`size:'compact'|'full'` バリアントを持つ**（Step2 のチャット内インライン描画に備える。受け入れ基準に含む）。Chart.js セットアップ（カテゴリ色・tnum・ツールチップ書式は `shared/format`）。
- **受け入れ基準**：東京・二月田で表示確認／パネル props が Protocol 型（型テストで担保）／radius 切替でチャートが再フェッチなしで更新（全半径同梱データを使用）。
- **依頼例**：「P5a 駅詳細の骨格と乗降客タブを実装」

### P5b — 駅詳細（人口・将来推計タブ）
- **前提**：P5a。
- **作業**：実績 1995–2020（実線）＋ R6 2025–2070（破線）＋ H30（トグル別系列）の重ねチャート／増減率ミニ表（9ペア×選択半径）／`pop_lowbase` ⚠ バッジ／`pop_err_2020` 注記／凡例トグル。
- **受け入れ基準**：東京（増）・二月田（減）・つくば（推計上振れ確認）で妥当表示／lowbase 駅（小半径の山間駅）で ⚠ が出る／NaN 期間が「—」表示。
- **依頼例**：「P5b 人口タブを実装」

### P5c — 駅詳細（地価・バス・事業所タブ）
- **前提**：P5a。
- **作業**：地価（lp_med×5半径の現在値・lp_near カード・増減率5期間バー・lp_lown ⚠）／バス（bus_n vs bus_n2010 の対比バー・local/hw 内訳・bus_gr＋lown ⚠）／事業所・従業者（3時点折れ線×2系列・9年/5年増減率・estab_gr_lown ⚠）。
- **受け入れ基準**：地価は 20km 非対応・増減率 500m 非対応が UI 上正しく畳まれる（カタログ駆動で自動）／三厩（バス全廃）・竜田（事業所急増）が正しく表示され ⚠/注記の文言が妥当。
- **依頼例**：「P5c 残り3タブを実装」

### P5d — 追加データ投入（地価年次パネル・事業者名）
> **由来**：2026-07-08 ユーザー UI 改善要望（①地価・バスを時系列化 ②従業者を独立タブ ③事業者名を表示 ④ズーム移動）のうち、**データ追加を要する②③のデータ層**。データは notebook が生成済（`station_landprice_yearly.csv`・`station_operator_detail.csv`）だが DB 未投入のため取り込む。
- **前提**：P5c。
- **方針（2026-07-09 決定）**：`station_dataset.csv` を「すべてを含む単一ベース」に統一（別CSVの特殊ロードは列レジストリ設計に反するため不採用）。誤差ゼロ・将来汎用性のため **notebook を修正して再実行**（データは同一実行で既に計算済＝Geo 再計算不要の畳み込み）。
- **作業（実施済）**：
  - **notebook**：cell 45 で地価中央値を `lp_med_{年}_{R}`（2007–2026・単年を置換）に年次系列化、cell 18 で運営会社を pax 規模降順 `・` 連結して `operators` 列に畳み込み → **再実行**（全 494 共有列が backup と bit 一致＝決定的・ドリフト 0 を実測）。
  - **catalog**：`catalog_rules.py` の lp_med を年付きに・`operators` を駅属性に追加 → `build_catalog`（**583 エントリ / 595 列 / 属性 12**）。`validate_catalog`（27 チェック）緑。
  - **DB**：`add_operators` migration（stations.operators text）＋ loader を拡張（**metric_columns を catalog.json に同期＝id 再採番／operators ロード**）し単一トランザクションで再ロード（**station_values 5,030,433 行**）。RPC は key 解決のため id 再採番は安全。
  - **API**：`stationRowSchema` に `operators` 追加・`queries` の SELECT に追加。`landPricePanels` は lp_med 最新年を現在値に（非破壊の最小修正・折れ線化は P5e）。
- **受け入れ基準（達成）**：東京 API に `operators`＝「東日本旅客鉄道・東京地下鉄・東海旅客鉄道」／`lp_med` 1km が 20 点（2007–2026）／golden RPC・catalog 検証・frontend test(86) 緑／DB 389MB（<400MB ゲート内・要監視）。
- **依頼例**：「P5d 地価年次と事業者名を投入」

### P5e — 駅詳細UI改善（時系列化・従業者タブ・事業者名・ズーム）
> **由来**：同 UI 改善要望の UI 層。P5d のデータが API に載った前提で描画を更新。
- **前提**：P5d。
- **作業**：
  - **地図ズーム移動**：MapLibre `NavigationControl` を `top-left`（ロゴと重複）→ **`bottom-left`（FAB の上に縦並び）** へ。`MapView` の `addControl` 位置＋余白で重なり解消（ユーザー選択：左下）。
  - **地価タブ＝時系列**：`lp_med` の年次系列で**中央値の推移（折れ線・選択半径）**を主表示に（乗降/人口と同形式の `trendChart`）。最寄公示カード・増減率表は維持。半径別バーは空間比較の補助として残置可。20km/500m の非対応は従来どおり自動フォールド。
  - **バスタブ＝時系列**：`bus_n2010`→`bus_n` の **2点折れ線**（2010→現在）に統一。一般/高速の内訳・対2010年増減率は `statTable` で併記（データは2時点のみ＝ユーザー了承済）。
  - **従業者タブ独立**：タブを `[乗降|人口|地価|バス|事業所|従業者]` の **6枚**に。`establishmentPanels` を分割し **事業所タブ**＝`estab_n` 折れ線＋事業所増減率、**従業者タブ**（`employee` カテゴリ）＝`emp_n` 折れ線＋従業者増減率。`DETAIL_TABS` に `employee` を追加（6タブはモバイルで横スクロール）。
  - **事業者名カード**：駅カードの「延べ N社」を **具体的社名（`・` 連結、例「JR東日本・東京地下鉄・都営地下鉄」）** に。多数事業者は折返し。`operators` 欠損時は従来の「延べ N社」にフォールバック。
- **受け入れ基準**：東京で地価・バスが折れ線表示／従業者が独立タブ／カードに社名が出る／ズームがロゴと重ならず FAB の上／375px で 6タブが崩れず横スクロール・overflow 0／console error 0・build 緑。ヘッドレスで実測。
- **依頼例**：「P5e 駅詳細のUI改善を実装」

### P5f — 検索結果の駅名表記（search_label 使用）
> **由来**：2026-07-09 ユーザー要望。検索ドロップダウンが素の駅名＋都道府県のため、同名・同一都道府県で運営会社違いの駅を区別できない。
- **前提**：P4b（検索）。
- **背景**：現在の `StationSearch` は `station_name`（素の駅名）＋都道府県を別枠表示。**尼崎型**（JR尼崎 と 阪神尼崎 が両方「尼崎 兵庫県」）が同一表記になる。`docs/passenger_aggregation.md §8.1.1` の **`search_label`**（`label`＋都道府県の単一括弧・全 9,273 群で**一意**を実測確認）を表示に使う。例：尼崎（阪神電気鉄道・兵庫県）／二月田（鹿児島県）／上道（鳥取県）・上道（岡山県）。
- **作業**：
  - **RPC**：`search_stations`（＋共有 summary スキーマの `stations_in_bbox`/`nearest_stations`）の返り値に `search_label` を追加（新 migration）。`stations` テーブルには既に `search_label` 列あり（RPC が返していないだけ）。
  - **API 契約**：`stationSummarySchema` に `searchLabel` 追加・`queries` の `summaryRowSchema`＋`toSummary` で写す。
  - **UI**：`StationSearch` のドロップダウンを **`search_label` 表示**に（素の駅名＋別枠都道府県を置換）。選択後の詳細取得・flyTo は `grp` ベースのまま不変。
- **受け入れ基準**：尼崎（JR/阪神）・上道（鳥取/岡山）等の同名駅が検索結果で区別できる／単独駅は「駅名（都道府県）」で冗長でない／選択→flyTo→詳細は従来どおり／かな検索の既知制約（読み仮名列なし・P2c 記録済）は据え置き。
- **依頼例**：「P5f 検索の駅名表記を search_label に」

### P6a — ランキング
- **前提**：P3b・P4b。
- **作業**：FAB→ Dialog。都道府県（47＋全国）× 指標ピッカ（**catalog の rankable をカテゴリ→指標→半径/年の3段で選択**・既定=人口増減率 2015→2020・1km）→ `/api/ranking` → 上位/下位20テーブル（値は format 済・⚠ 列付き）→ 行クリックで flyTo＋選択。`rankingTable` Panel 型で描画。
- **受け入れ基準**：「千葉県×地価増減率(2016→2026,2km)」等 3 ケースで妥当な顔ぶれ／lown フラグ行に ⚠／全国モードも 1s 未満。
- **依頼例**：「P6a ランキングを実装」

### P6b — 散布図＋クラスタ
- **前提**：P3b・P4b。
- **作業**：Dialog。x/y 指標ピッカ（rankable の growth 系を既定：x=人口増減率, y=乗降客 rate_covid など）→ `/api/growth`（domain の決定的 k-means 済み）→ Chart.js scatter（クラスタ4色・ツールチップに駅名/値・`excludeLowN` トグル）→ 点クリックで flyTo。`scatter` Panel 型。
- **受け入れ基準**：9k 点（全国）でも操作可能／同一入力で毎回同じクラスタ（決定性）／lown 除外トグルで件数が変わり注記表示。
- **依頼例**：「P6b 散布図を実装」

### P7a — 品質・仕上げ
- **前提**：P5・P6。
- **作業**：About/データ出典 Dialog（**catalog の source/license から自動生成する出典表**＋各 docs への説明文）／OGP・favicon・タイトル／エラーバウンダリ・ローディングスケルトン・オフライン注意／a11y（フォーカスリング・aria・コントラスト）／Lighthouse 計測と改善（画像・フォント・コード分割）／404。
- **受け入れ基準**：Lighthouse Mobile Perf ≥ 80・A11y ≥ 90／出典表に S12/国勢調査/L01/P11/P36/経済センサスが網羅（ライセンス文言付き）／主要フロー（検索→詳細→ランキング→散布）にエラー画面なし。
- **依頼例**：「P7a 仕上げを実施。Lighthouse 結果を見せて」

### P7b — 公開
- **前提**：P7a。
- **作業**：本番 env 設定確認（鍵はダッシュボード側）／Vercel 本番デプロイ／**Vercel Cron `0 3 * * *` → `/api/health`**（Supabase pause 対策）／README（概要・アーキ図・セットアップ・出典）／architecture.md「7.5 現状」更新＋§2.2 の洗練を反映／本プランの進捗表更新。
- **受け入れ基準**：本番 URL で Step1 DoD の全項目をチェックリスト消化／cron 実行ログ確認／docs 反映済み。
- **ユーザー側作業**：（任意）カスタムドメイン、公開告知。
- **依頼例**：「P7b 公開作業を実施。DoD チェックリストで報告して」

---

## 5. 実装ブロック詳細（Step2 = AIネイティブ化）

### P8a — AI ツール表面＋チャット API
- **目的**：LLM が共通APIを叩く経路を最小構成で稼働。
- **前提**：Step1 公開。Gemini API キー。
- **作業**：
  1. `src/ai/tools.ts`：**catalog から自動生成**するツール定義（searchStations / getStationDetail / rankStations / compareGrowth / getMetricsCatalog）。実体は domain 呼び出し（HTTP を挟まない）。
  2. `src/ai/client.ts`：AI SDK provider 抽象（`@ai-sdk/google` 既定・env でモデル切替）。`system-prompt.ts`（役割・カタログ要約・Protocol 指示・「データにない事は言わない」）。
  3. `POST /api/chat`：**AI SDK v6** のツールループ（`ToolLoopAgent`・ステップ上限6）でストリーミング → 最終 `assemble.ts` が **MapResponse（Zod）** を組み立てて data part で送出。IP レート制限（Upstash 無料 or 簡易）・30s タイムアウト・入力 500 文字上限。`ai@^6` と `@ai-sdk/react@^6` は**セットでバージョン固定**（v5/v6 混在はストリーム解析エラーの原因）。
  4. スクリプトで 5 問の疎通（curl/SSE）確認。
- **受け入れ基準**：「東京駅の人口推移」「神奈川県で乗降客の回復が大きい駅 Top5」で正しいツール列が呼ばれ、Zod parse に 100% 通る MapResponse が返る／`domain`・既存 API に diff がない（純加算の証明）。
- **ユーザー側作業**：Gemini API キー取得・`.env` 設定（無料枠の学習利用に留意＝本番判断は P8c）。
- **依頼例**：「P8a チャットAPIを実装。5問の疎通ログを見せて」

### P8b — チャット UI（左併設＋インラインカード＋Protocol レンダラ）
- **前提**：P8a。UI は **§2.4「AIインタラクション UI」の確定設計（ルール①〜⑤）**に従う。
- **作業**：
  1. **左サイドチャットパネル**（約400px・開閉式。ヘッダ「✦AI」ボタン＋`⌘K`）／モバイルは vaul ボトムシート（半分⇔全画面の2スナップ）。開閉を地図の padding に伝搬（P4a の仕組みを利用）。
  2. `useChat` でストリーミング表示。**ProtocolRenderer**：mapActions → 地図ストアへ**即時**ディスパッチ（返答中に flyTo・ハイライト・半径円）、panels → **P5/P6 の既存パネル部品を `size:'compact'` でスレッド内にインライン描画**。
  3. **⤢ 拡大＝昇格**：`placement` に従い、駅詳細系は右ドロワー・ランキング/散布はモーダルへ（**クリックUIと同じ場所・同じ部品**）。
  4. 本文中の**駅名チップ**（タップで flyTo＋選択）／サジェストチップ（初回3つ＋文脈追従）／「地図をリセット」チップ（`clearOverlays`）／エラー・中断 UI。
- **受け入れ基準**：チャットから駅選択・flyTo・チャート・ランキング表がすべて**構造化UIと同一コンポーネント**で描画（新規描画コードなし）／compact カードの ⤢ でドロワー/モーダルに同内容が出る／チャット開状態の flyTo が可視領域中心に収まる／モバイル半分スナップで地図の動きが見える／連投時にレート制限が発火。
- **依頼例**：「P8b チャットUIを実装」

### P8c — 評価・強化（＋GraphAI PoC 判断）
- **前提**：P8b。
- **作業**：ゴールデン20問（駅指定・比較・ランキング・曖昧駅名・データ外質問の拒否 等）の eval スクリプト（期待ツール列・Protocol 妥当性・要点文字列で自動判定）→ 合格率記録／システムプロンプト・ツール記述の改善イテレーション／モデル比較（Gemini vs Haiku 等・切替は env のみ）／**（任意）GraphAI PoC**：「2駅比較」を宣言的グラフ（並列 fan-out→合成）で実装し AI SDK 版と比較 → architecture.md §10.7 の未決を確定／本番モデル・課金/Vertex 判断を記録。
- **受け入れ基準**：eval 合格 ≥ 16/20／拒否すべき質問（例「来年の地価を予言して」）を正しく拒否／判断結果を architecture.md §10 に追記。
- **依頼例**：「P8c 評価を実施。eval 結果と改善案を見せて」

---

## 6. 並行トラック（クリティカルパス外）

| トラック | 内容 | いつでも可 |
|---|---|---|
| **データ拡張** | dataset.md §4 の候補（昼間人口 2000–2020 → 災害リスク → 生活利便施設…）を **dataset.md §3 の定石**で追加。カタログ再生成 → P2b 再投入 → **UI/API/AI は自動追従**（カタログ駆動の効果検証にもなる） | Step1 公開後推奨 |
| **`script/` → `pipeline/` 整理** | notebook 移設・純関数抽出（P1/P2b で `pipeline/` を新設するため、残りは任意） | 任意 |
| ~~地価パネル（年次系列）~~ | → **P5d に昇格**（`station_landprice_yearly.csv` を `lp_med_{year}_{R}` として投入・地価タブを年次折れ線化）。事業者名投入も同 P5d | **P5d で実施** |
| **MCP 公開** | 共通APIを MCP ツール化（architecture.md §10.5-5） | Step2 後 |

---

## 7. 運用・コスト・リスク

| リスク | 影響 | 対策（プラン内の位置） |
|---|---|---|
| Supabase 無料枠 500MB | 投入不能・性能劣化 | §2.2-② の省サイズ設計＋P2b で実測ゲート（<400MB） |
| Supabase 7日 pause | 本番停止 | P7b の日次 cron `/api/health` |
| 地理院ベクトルが「試験公開」（仕様/URL変更があり得る） | 地図表示不可 | env でスタイル差し替え＋公式 PMTiles の自前コピー（R2）＋淡色ラスタ退避。候補として OpenFreeMap / MapTiler Flex を記録（§2.2-⑥） |
| Gemini 無料枠＝入力が学習利用 | プライバシー | P8c で本番は従量 or Vertex に切替判断。鍵はサーバのみ |
| チャットの濫用（コスト） | 課金増 | P8a のレート制限・文字数上限・stepCountIs 上限 |
| 検索の日本語ゆらぎ（かな/漢字） | UX | search_label＋pg_trgm（P2c ゴールデンで検証、不足時は読み仮名列を pipeline 追加） |
| ノートブック再実行の重さ | データ更新が億劫 | アプリ実装中は再実行不要（CSV 固定）。更新はデータ拡張トラックで計画的に |

**ランニングコスト（Step1）**：Vercel Hobby ¥0＋Supabase Free ¥0＋地理院タイル ¥0（キー不要）＝**完全無料**。**Step2**：Gemini 無料枠 → 従量でも Flash なら月数百円規模から。

---

## 8. 未決事項（該当ブロックの冒頭でユーザーに確認）

| 事項 | 決めるタイミング | 選択肢 |
|---|---|---|
| Docker 有無（Supabase ローカル） | P2a | local 開発 vs クラウド直 |
| アプリ表示名・ロゴ | P4b | 「AI Database Map」表記の最終確認 |
| ランキング/散布の既定指標 | P6a/b | 提案ベースで確認 |
| カスタムドメイン | P7b | 任意 |
| 本番 LLM（無料枠可否・Vertex） | P8c | eval 結果とコストで判断 |
| 駅詳細UI改善（地価/バス時系列・従業者タブ・事業者名・ズーム） | P5d/P5e | **決定済（2026-07-08）**：地価=年次パネル投入／バス=2点折れ線＋内訳／事業者名=全社名 `・` 連結（DB追加）／ズーム=左下（FABの上） |

---

## 9. 進捗管理

各ブロック完了時に本表を更新する（Claude Code が実施）。

| ブロック | 状態 | 完了日 | メモ |
|---|---|---|---|
| **P0** | ✅ 完了 | 2026-07-06 | Next 16 / React 19 / TS 6 / Tailwind v4 / ESLint 10（境界ルール）/ Prettier / Vitest 4。`typecheck`・`lint`・`test`（12）・`build` すべて green。境界ルールは自動テストで担保。Vercel 接続・プレビュー確認済み |
| **P1** | ✅ 完了 | 2026-07-07 | CSV 499列 → `src/shared/catalog/catalog.json`（488エントリ＋駅属性11）を `pipeline/build_catalog.py` で生成。独立検証 27/27 PASS（列数・カテゴリ別件数が dataset.md §2 と一致・フラグ参照実在）。ラベル一覧 `docs/catalog_labels.md`。CI 用スモークテスト追加。ラベル自然さユーザー確認済み |
| **P2a** | ✅ 完了 | 2026-07-07 | Supabase（東京・クラウド経路）に migrations 3本適用：postgis/pg_trgm・`stations`(geom generated)/`metric_columns`/`station_values`・GiST/trgm index・RLS＋anon SELECT のみ。`metric_columns`=488（=catalog）。anon は SELECT 可・INSERT/DELETE 不可を REST で検証。Data API 設定は auto-expose OFF＋auto-RLS ON。CLI は brew 不可のためバイナリ導入 |
| **P2b** | ✅ 完了 | 2026-07-07 | `pipeline/load_to_supabase.py` で投入（冪等・COPY・FK一時解除で高速化）：stations 9,273行（pax_latest算出・lp_near_use は stations に）＋ station_values **4,390,790行**。`pipeline/validate_load.py` の全数検証 **9/9 PASS**（件数=CSV非NaN・列別件数・無作為300値・全国計sum・pax_latest）。**DBサイズ 348MB < 400MB**。レポート `docs/p2b_load_report.md` |
| **P2c** | ✅ 完了 | 2026-07-07 | RPC 6本を migration で実装（`search_stations`/`stations_in_bbox`/`nearest_stations`/`rank_by_column`/`values_for_columns`/`station_bundle`）。security invoker・`search_path=''`・完全 schema 修飾・**動的 SQL なし**（key は metric_columns で照合＝ホワイトリスト）。anon EXECUTE 付与＋REST で実行確認。ゴールデン **12/12 PASS**（検索#1・最寄・bbox・ランキング±・全国 argmax・千葉県増減率・駅詳細=CSV値・注入不能）。検索は駅名一致を優先。かな検索は読み仮名列（将来）待ち |
| **P3a** | ✅ 完了 | 2026-07-07 | shared 契約＋domain 層（framework 非依存・DB 不要）。`src/shared`：catalog（Zod ロード検証）・protocol（GUI Chat Protocol v1）・api（入出力 Zod）・format・geo。`src/domain`：metrics・stations/presenter（値束→StationDetail：カテゴリ×半径×vintage 系列組立・フラグ解決）・ranking/presenter・**決定的 k-means**（z-score＋seeded k-means++）・growth/presenter。zod 4 追加。`typecheck`/`lint`/**test 61**/`format` すべて green。domain→UI/DB import ゼロ（ESLint 境界ルール確認） |
| **P3b** | ✅ 完了 | 2026-07-08 | 共通API 7ルート（Route Handlers）稼働。`src/db`：supabase-js（anon・RLS・timeout fetch）＋RPC 型付きラッパ（Zod 検証）。`src/app/api`：metrics/stations(q/bbox/near)/geojson/stations/[grp]/ranking/growth/health。Zod 検証→domain→整形済み応答・エラー封筒・Cache-Control・runtime=nodejs。統合スモーク **13/13 PASS**（不正 metric→400・rankable外→400・未存在→404）。geojson は max-rows 回避のため単一 jsonb を返す RPC（**9,273 features**）。@supabase/supabase-js 追加 |
| **P4a** | ✅ 完了 | 2026-07-08 | 地図基盤（MapLibre）。地理院 最適化ベクトルタイル（淡色 style JSON・出典表示）＋全駅 GeoJSON 1回配信（クラスタ z<10→circle 平方根スケール→ラベル z≥12）。クリック選択＝flyTo＋アクセント色ハイライト＋半径サークル（shared/geo）。Zustand（hover）＋nuqs（?grp&r 双方向同期）。ヘッドレスブラウザで検証（z9クラスタ・z12個別＋選択＋2km円・URL復元・地理院出典・**console error 0**）。engines を 22.x にピン留め（Vercel 警告解消）。maplibre-gl/zustand/nuqs/@types/geojson 追加 |
| **P4b** | ✅ 完了 | 2026-07-08 | 検索＋アプリシェル。shadcn 基盤（cn util・Command=cmdk）導入。ヘッダ（ロゴ・**cmdk 駅名検索** debounce250ms→`/api/stations?q=`→選択で ?grp→flyTo・半径セグメント）。左下 FAB（ランキング/散布のプレースホルダ）。**モバイル対応**（375px 縦積み・overflow 0）。ヘッドレス検証：「東京」→#1東京→選択・「二月田」ヒット・375px 崩れなし・**console error 0**。かな検索（しんじゅく）は読み仮名列（将来）待ち。cmdk/clsx/tailwind-merge 追加 |
| **P5a** | ✅ 完了 | 2026-07-08 | 駅詳細パネル（骨格＋乗降タブ）。デスクトップ＝右ドロワー／モバイル＝vaul ボトムシート（`useIsDesktop`）。SWR で `/api/stations/[grp]` を grp キーのみ取得（**半径切替は再フェッチ不要**＝全半径同梱を client 絞り）。**Protocol 準拠パネル**：`stationCardPanel`/`paxTrendPanel`（domain・純関数）→ 汎用 `PanelRenderer`/`PanelStack`（type 分岐＝Step2 のチャット描画をそのまま再利用）。駅カード（延べ事業者数・最新乗降客・時系列欠損バッジ）＋乗降推移チャート（Chart.js 折れ線・`formatCompact` 万軸・前年比/コロナ比 KPI チップ・フラグ⚠）。タブ5枚の器（乗降のみ実装・他は P5b/P5c プレースホルダ）。Protocol 拡張：detailPoint に `key`（addressable）・trendChart に `stats`/`format`・`PanelOf<T>` 派生型。ヘッドレス検証：東京/二月田で表示・タブ切替・KPI（+7.3%/-5.7%）・閉じるで ?grp クリア・375px sheet overflow 0・**console error 0**。build green。swr/chart.js/react-chartjs-2/vaul 追加 |
| **P5b** | ✅ 完了 | 2026-07-08 | 駅詳細・人口タブ（**半径依存の初タブ**）。`populationPanels(detail, radiusM)`（domain・純関数）→ 重ねチャート（実績実線＋R6/H30 推計破線・Chart.js 凡例トグル）＋人口増減率ミニ表（`statTable` Panel 新設・9ペア×選択半径・2列）。信頼性：`pop_lowbase`⚠・`pop_err`（H30推計の2020乖離 例:東京+47.1%/二月田-21.9%）注記・500m 秘匿メッシュ割合注記・NaN 期間は「—」。**ドロワー内 集計半径セレクタ**（?r 同期・デスクトップ/モバイル両対応）。**半径切替はチャート再計算のみ＝再フェッチ 0**（grp キー取得＋全半径同梱を client 絞り・ヘッドレスで detailReqs=1 を実測）。Protocol 拡張：`statTable`/`StatTablePanel`・`radiusLabel`・`isRadiusDependentCategory`（カタログ駆動）。ヘッドレス検証：東京（増）・二月田（減・500m 秘匿注記）・半径トグル無再取得・375px overflow 0・**console error 0**。build green |
| **P5c** | ✅ 完了 | 2026-07-08 | 駅詳細・残り3タブ（地価・バス・事業所）＝**5タブ全実装**。`barChart` Panel 新設（横棒・CSS 描画・emphasis で選択半径を強調）。地価：最寄公示カード（価格 円/㎡・用途・距離）＋半径別中央値バー（500m〜10km・選択半径強調）＋増減率5期間表。バス：2010→現在の対比バー＋一般/高速内訳・対2010年増減率（lown ⚠）。事業所：事業所数（violet）・従業者数（pink）の推移2枚＋9年/5年増減率（estab_gr_lown ⚠）。**カタログ駆動の自動フォールド**：地価 20km 非対応（バーに20km出ず）・増減率 500m 非対応（注記表示）をヘッドレスで実測。`landPricePanels`/`busPanels`/`establishmentPanels`（domain・純関数）→ 汎用 PanelRenderer。ヘッドレス検証：東京で3タブ・20km/500m フォールド注記・375px overflow 0・**console error 0**。build green |
| **P5d** | ✅ 完了 | 2026-07-09 | 追加データ投入（地価年次・事業者名）。**notebook 再実行**で `station_dataset.csv` を単一ベースに統一（cell45 地価を `lp_med_{年}_{R}` 年次化・cell18 運営会社を `・`連結 `operators` に畳込み）。**全 494 共有列が backup と bit 一致＝決定的・ドリフト 0** を実測。catalog：lp_med 年付き・operators 駅属性（**583 エントリ/595 列/属性12**・validate 27 緑）。DB：`add_operators` migration＋loader 拡張（**metric_columns を catalog.json に同期＝id 再採番**・operators ロード）で単一トランザクション再ロード（**station_values 503万行**）。API：`stationRow.operators`＋queries SELECT。`landPricePanels` は lp_med 最新年を現在値に（非破壊）。検証：東京 API に operators＝「東日本旅客鉄道・東京地下鉄・東海旅客鉄道」・lp_med 1km 20点(2007–2026)・**golden RPC/ catalog/ test(86) 緑**・DB 389MB。docs（dataset/land_price/passenger_aggregation）反映 |
| **P5e** | ✅ 完了 | 2026-07-09 | 駅詳細UI改善（P5d データを消費）。**地価・バスを折れ線化**（地価＝lp_med 年次系列 2007–2026 の推移＋最寄カード＋半径別バー補助＋増減率／バス＝2010→現在の2点線＋一般/高速内訳）。**従業者を独立タブに**（`employeePanels` 新設・全**6タブ**＝乗降/人口/地価/バス/事業所/従業者）。**駅カードに具体的社名**（`operators`・欠損時は延べ社数フォールバック）。**地図ズームを左下**へ（`NavigationControl` bottom-left＋CSS で FAB 上・ロゴと非重複）。ヘッドレス検証：東京で6タブ・地価/バス折れ線・従業者分離・社名表示（東日本旅客鉄道・東京地下鉄・東海旅客鉄道）・ズーム左下・375px overflow 0・**console error 0**・test(87)・build 緑 |
| **P5f** | ✅ 完了 | 2026-07-09 | 検索結果の駅名表記を **`search_label`**（label＋都道府県・全群一意・`docs/passenger_aggregation.md §8.1.1`）に。同名・同一都道府県で運営会社違いの駅（**尼崎型**）が区別可能に。`search_stations` RPC の返り値に search_label 追加（新 migration・drop→create→grant／bbox・nearest は共有スキーマのため searchLabel を optional に）。`stationSummary` に searchLabel・UI は駅名太字＋淡色サフィックス（例「尼崎（阪神電気鉄道・兵庫県）」）。選択→flyTo は grp ベースで不変。ヘッドレス検証：尼崎の JR/阪神 が区別・二月田（鹿児島県）は冗長でない・選択で grp・375px overflow 0・console error 0・test(87)・build 緑。DB は RPC 差し替えのみ（再ロード不要） |
| P6a〜P8c | 未着手 | — | — |

---

## 10. ライブラリ・サービス解説（概要・役割・採用理由・代替候補）

§2.2/§2.3 で決定した全ライブラリ・サービスのリファレンス。各項目を**「それは何か（概要）／このプランのどこで働くか（役割）／なぜそれか（採用理由）／弱点をどの代替が補うか（代替候補）」**で記す。バージョンは **2026-07 時点の最新安定を確認済み**。P0・P8 着手時に再確認し、本章と §2.3 を更新する。

| 区分 | 採用（版の目安・2026-07） |
|---|---|
| ホスティング/インフラ | Vercel Hobby／Supabase（Postgres+PostGIS）／国土地理院 最適化ベクトルタイル／GitHub Actions／（保険）Cloudflare R2／（Step2 任意）Upstash Redis |
| アプリ基盤 | Next.js 16＋React 19／TypeScript 5／Zod 4.4／pnpm／ESLint+Prettier／Vitest 4 |
| データアクセス | supabase-js 2／SWR／（pipeline）Python+psycopg |
| 地図・可視化 | MapLibre GL JS 5.2x／Chart.js 4＋react-chartjs-2 |
| UI | Tailwind CSS 4／shadcn/ui（Radix）／cmdk／vaul／Zustand 5／nuqs 2／Noto Sans JP |
| AI（Step2） | Gemini Flash 系／Vercel AI SDK 6（@ai-sdk/google）／（PoC）GraphAI 2 |

### 10.1 ホスティング / インフラ

#### Vercel（Hobby）
- **概要**：Next.js 開発元のホスティング PaaS。`git push` → ビルド → 世界CDN配信。PR ごとのプレビューURL・Cron・Web Analytics。
- **役割**：アプリ本体（UI＋共通API）の配信（P0 接続・P7b 公開）。日次 Cron で `/api/health`（Supabase pause 対策）。
- **採用理由**：Next.js と一体で設定ほぼゼロ。`Cache-Control` を付けた API 応答（geojson・カタログ等）を**エッジCDNが吸収**するため、無料枠でも実質スケールする。
- **代替候補**：**Vercel Pro**（$20/月）＝Hobby の**非商用限定**を解除する正規ルート。**Cloudflare Pages/Workers**＝無料で商用可（Next.js 完全互換には調整要）。Netlify＝同等だが Next.js への追随が一歩遅い。

#### Supabase（PostgreSQL + PostGIS + PostgREST）
- **概要**：マネージド Postgres。HTTP API（PostgREST）・RLS・CLI migrations・Auth/Storage/pgvector を同梱。
- **役割**：`stations` / `station_values` / `metric_columns` の永続化と RPC（検索・bbox・ランキング・散布）＝P2a〜P2c。
- **採用理由**：**PostGIS**（空間クエリ）／**RPC=HTTP なのでサーバレスの接続プール問題が発生しない**／migrations 運用／将来の pgvector（意味検索）・Auth（ユーザー機能）への拡張路。
- **代替候補**：**Neon**＝スリープ後も**接続だけで自動復帰**（Supabase の「7日無活動→手動再開」が嫌な場合の正攻法。PostGIS 対応）。**Turso**（SQLite 系・無料枠広い。PostGIS 不要になれば）。**静的ファースト（DBなし）**＝ビルド時に全 JSON を事前生成する最軽量構成（運用ゼロ。任意半径など将来拡張を捨てる場合の縮退先）。

#### 国土地理院 最適化ベクトルタイル
- **概要**：国土地理院が**試験公開**する日本全国のベクトルタイル（PMTiles 形式でも公式配布）。
- **役割**：ベースマップ（P4a。公式スタイルを淡色調整＋出典表示）。
- **採用理由**：無料・**キー不要・実質クォータなし**・出典明記で商用可・測量成果ベースの正確さ・「オープンデータのアプリがベースマップまでオープンデータ」という物語整合。
- **代替候補**（§2.2-⑥・記録のみ実装しない）：**OpenFreeMap**＝既製の淡色スタイルが即使える（寄付運営が弱点）／**MapTiler Flex**（$30/月）＝美観最優先（無料枠は非商用限定）／**PMTiles 自前ホスト（R2）**＝試験公開の仕様変更・停止リスクを完全遮断する終着点。退避先＝正式提供の**淡色ラスタ**。

#### GitHub Actions
- **概要**：GitHub 組み込みの CI/CD。
- **役割**：PR ごとに `typecheck / lint / test` を強制（P0）。
- **採用理由**：リポジトリ一体・YAML 1枚・無料枠で十分。規約を「注意」でなく**落ちるゲート**にする。
- **代替候補**：Vercel ビルドのみ（テストがゲートにならない）／CircleCI 等（個人開発には過剰）。

#### Cloudflare R2（保険・実装しない）
- **概要**：S3 互換オブジェクトストレージ。**下り転送（egress）無料**・無料枠 10GB。
- **役割**：地理院 PMTiles の**自前コピー置き場**（試験公開リスクの最終保険。§2.2-⑥）。
- **採用理由**：タイル配信は読み出しが支配的＝egress 無料と相性最良。
- **代替候補**：S3 / GCS（egress 課金がありタイル用途では不利）。

#### Upstash Redis（Step2・任意）
- **概要**：HTTP で叩けるサーバレス Redis。無料枠あり。
- **役割**：`/api/chat` の IP レート制限（P8a）＝LLM コストの防波堤。
- **採用理由**：サーバレス関数から**接続保持なし**で使え、`@upstash/ratelimit` が定番。
- **代替候補**：プロセス内の簡易カウンタ（インスタンス毎で不完全だが初期は十分）／Vercel WAF。

### 10.2 アプリ基盤

#### Next.js 16（App Router）＋ React 19
- **概要**：React のフルスタックフレームワーク。**16 系が現行安定（16.2）**：Turbopack が既定バンドラ・React 19.2・最低 Node 20。
- **役割**：UI（RSC＋Client Components）・共通API（Route Handlers）・（Step2）チャットAPI を**単一アプリ**に統合（P0〜）。
- **採用理由**：「API こそがプロダクト」を1リポジトリで実現できる唯一級の統合度。Server Components がドメインを直呼びして高速。Vercel と一体。
- **代替候補**：Remix / React Router 7（ローダ中心の別哲学）／SvelteKit（軽量・別エコシステム）／Vite+React SPA（API を別に建てる必要）。いずれも「UI/API/AI 一体」の利点を失うため不採用。

#### TypeScript 5
- **概要**：型付き JavaScript。
- **役割**：全コード。**UI と LLM が同じ型（`z.infer`）を共有**する本プロジェクトの根幹。
- **採用理由**：型付き契約が AIネイティブ設計の前提。CLAUDE.md 規約（`any`/`as` 禁止→型ガード）を lint で機械化できる。
- **代替候補**：JS+JSDoc（契約中心の本設計では非現実）。

#### Zod 4
- **概要**：TypeScript ファーストのスキーマ検証。**4 系が現行（4.4）**。v3 比で大幅高速化（文字列パース約14倍）。
- **役割**：カタログ検証（P1/P3a）・API 入出力（P3b）・GUI Chat Protocol（§3.2）・（Step2）ツール引数（P8a）。
- **採用理由**：**スキーマ＝単一の真実**から型を導出（重複型を作らない）。AI SDK のツール定義が Zod を直接受ける。
- **代替候補**：Valibot（バンドル極小が売り。ただし AI SDK・エコシステムの本流は Zod）。

#### pnpm
- **概要**：高速・厳密なパッケージマネージャ（content-addressable store 方式）。
- **役割**：依存管理（P0）。
- **採用理由**：速い・ディスク効率・**幽霊依存**（宣言なし依存の混入）を構造的に防ぐ。
- **代替候補**：npm（標準・遅め）／Bun（高速だがランタイム一体の成熟を見極め中）。

#### ESLint ＋ Prettier
- **概要**：静的検査と整形。
- **役割**：CLAUDE.md 規約の機械化＝`no-explicit-any`・`as` 禁止・**import 境界ルール（domain→UI/DB 依存の禁止）**（P0）。
- **採用理由**：アーキテクチャの依存方向（§2.1）を**CI で落ちる仕組み**として守護する。
- **代替候補**：Biome（1バイナリで lint+format・高速。import 境界等の要件を満たせば将来移行可）。

#### Vitest 4
- **概要**：Vite 系テストランナー。**4 系が現行（4.1・Browser Mode 安定）**。
- **役割**：domain 純関数・カタログ整合・presenter・k-means の単体テスト（P3a ほか）。
- **採用理由**：ESM/TS ゼロ設定・高速 watch・Jest 互換 API。
- **代替候補**：Jest（既存資産がある場合のみ。ESM 対応と速度で見劣り）。

### 10.3 データアクセス

#### @supabase/supabase-js 2
- **概要**：Supabase 公式クライアント。PostgREST / RPC を **HTTP** で呼ぶ。
- **役割**：`src/db` からの SELECT / `.rpc()`（P3b）。
- **採用理由**：HTTP ベースなので**サーバレスで接続プール管理が不要**。RLS と自然に整合。
- **代替候補**：**Drizzle ORM + postgres.js**（型安全な生 SQL。複雑な JOIN が増えたら。Supavisor pooler 経由で接続）／PostgREST 直叩き（型がない）。

#### SWR（P5a で導入）
- **概要**：Vercel 製の軽量データ取得フック（stale-while-revalidate）。
- **役割**：駅詳細などクライアント側 GET のキャッシュ・再検証・ローディング状態（P5a）。
- **採用理由**：GET 中心・小規模の本アプリには最小で十分。Next.js と同じ開発元。
- **代替候補**：TanStack Query（ミューテーション・無限リストが増えたら）／素の fetch+useEffect（状態管理を自作するだけ損）。

#### Python（pandas / psycopg）— pipeline
- **概要**：データ整形の標準スタック。
- **役割**：カタログ生成（P1）・CSV melt → **COPY 一括投入**（P2b）・投入検証。
- **採用理由**：既存ノートブック資産と同じ言語。COPY が最速で、検証スクリプトも書きやすい。
- **代替候補**：TS で書く（依存が二重になるだけで利点なし）。

### 10.4 地図・可視化

#### MapLibre GL JS 5
- **概要**：WebGL ベクトル地図ライブラリ。Mapbox GL JS v1 の OSS フォークで AWS/Meta 等が支える業界標準（**5.2x 系が現行**・当面 v5 を継続する方針が公表済み）。
- **役割**：地図描画・全駅レイヤ（クラスタ→circle→ラベル）・半径円・padding つき flyTo（P4a）。
- **採用理由**：**9,273 点を GPU 描画**（過去の Leaflet+DOM マーカーの性能問題を根本解決）／乗降客数でサイズを変える**データ駆動スタイル**がネイティブ／地理院・OpenFreeMap・MapTiler すべて MapLibre 前提でスタイル配布／ロックインなし。半径円は自前の純関数（`shared/geo.ts`）で描き turf 依存も持たない。
- **代替候補**：Leaflet（小規模ラスタ地図なら今も最も簡単。本規模では不適＝過去の教訓）／deck.gl（数十万点級の重可視化用・過剰）／react-map-gl（React ラッパ。薄い自前ラッパで十分）。

#### Chart.js 4 ＋ react-chartjs-2
- **概要**：Canvas 描画チャートの定番。
- **役割**：年次トレンド（乗降客・人口・地価ほか）・対比バー・**散布 9k 点**（P5/P6）。
- **採用理由**：Canvas なので大量点でも軽い・必要なグラフ種が揃う・過去プロジェクトの知見を継承できる。
- **代替候補**：Recharts（宣言的で書き味は良いが SVG＝散布 9k 点で重い）／ECharts（超多機能・バンドル大）／visx・d3（自由度最高・工数大）。

### 10.5 UI

#### Tailwind CSS 4
- **概要**：ユーティリティクラスを JSX に直接書く CSS フレームワーク（**4 系が現行**・設定の CSS 化で高速）。
- **役割**：全スタイリングとデザイントークン（§2.4）。
- **採用理由**：命名・CSS 設計の管理コストゼロ／スタイルがコンポーネントに同居し **Claude Code の差分がレビューしやすい**／shadcn/ui の前提技術。
- **代替候補**：CSS Modules（スタイル分離派向け）／vanilla-extract（型付き CSS）。

#### shadcn/ui（Radix UI）
- **概要**：**コードをコピーして所有する**方式の UI 部品集（Dialog / Tabs / Tooltip / Command / Drawer…）。中身は Radix（a11y 済み headless）＋ Tailwind。
- **役割**：モーダル・タブ・ツールチップなど UI の器（P4b〜P6）。
- **採用理由**：依存ではなく**自分のコード**（改造自由・バージョン更新地獄なし）／キーボード操作・スクリーンリーダー対応が最初から正しい／審美性が高くデザイン工数を大幅節約。
- **代替候補**：MUI / Chakra（フル UI フレームワーク。デザイン自由度とバンドルで不利）／Radix 素使い（スタイル全自作）。

#### cmdk
- **概要**：コマンドパレット型検索の定番部品（shadcn の Command の中身）。
- **役割**：駅名検索＝入力→即時絞り込み→キーボード選択→flyTo（P4b）。
- **採用理由**：検索 UX（フォーカス管理・キーボード操作・候補ハイライト）は自作が割に合わない。この型の事実上の標準。
- **代替候補**：Downshift（より低レベル）／自作（不要）。

#### vaul
- **概要**：モバイルの**ボトムシート**（下から引き出すパネル。ドラッグ・スナップ・慣性対応）。
- **役割**：スマホの駅詳細（P5a）と Step2 チャット（P8b・半分⇔全画面の2スナップ）。
- **採用理由**：地図アプリのモバイル標準文法。ドラッグ／スナップ／シート内スクロール共存という実装難所を解決済み（shadcn Drawer の内部採用実績）。
- **代替候補**：react-modal-sheet／自作（難所が多く非推奨）。

#### Zustand 5
- **概要**：最小の状態管理。ストアを作り、**必要な部品だけが必要な値を購読**する。
- **役割**：選択駅・半径・パネル開閉・（Step2）mapActions の受け口（P4a〜P8b）。
- **採用理由**：ボイラープレートなし。地図のような高頻度更新でも購読粒度で再レンダリングを最小化。
- **代替候補**：Jotai（アトム指向が好みなら等価）／Redux Toolkit（大規模チーム向け・過剰）／Context のみ（高頻度更新に不向き）。

#### nuqs 2
- **概要**：URL クエリと React 状態の**型付き双方向同期**。
- **役割**：`?grp&r` の同期＝**共有リンク**・リロード復元・戻る/進む（P4a）。
- **採用理由**：「URL＝状態の置き場」という地図アプリの必須機能を `useState` と同じ書き味で実現。手書き同期の罠（更新タイミング・型変換・履歴）を回避。
- **代替候補**：手書き `useSearchParams`＋`router.replace`（可能だが煩雑でバグりやすい）。

#### Noto Sans JP（next/font）
- **概要**：Google の日本語フォント。`next/font` でセルフホスト・サブセット配信。
- **役割**：全文字。数値は `tabular-nums` で桁揃え（§2.4）。
- **採用理由**：日本語の可読性・ウェイト充実・next/font で CLS（レイアウトずれ）なし。
- **代替候補**：IBM Plex Sans JP／システムフォント（配信ゼロだが統一感が落ちる）。

### 10.6 AI（Step2）

#### Google Gemini（Flash 系）
- **概要**：Google の LLM API。**2026-07 時点の系列**＝2.5 Flash（$0.30/$2.50 per 1M tok・廉価安定）／3 Flash Preview（2025-12・$0.50/$3.00）／3.5 Flash（2026-05・$1.50/$9・エージェント実行を強化）。いずれも function calling・構造化出力対応。
- **役割**：自然言語 → 共通API ツール呼び出し → Protocol 応答（P8a）。
- **採用理由**：無料枠で開発でき、日本語・価格・function calling のバランスが良い。**採用モデルは P8a/P8c 時点の Flash 系最新安定から、eval（コスト×tool-use 精度）で確定**する。
- **代替候補**（provider 抽象で env 差し替え）：Claude Haiku 4.5＝tool-use 精度最優先時／GPT-4.1-mini＝汎用安価／Groq＝無料・超高速（日本語ツール精度は要検証）。⚠️ Gemini 無料枠は入出力が学習利用され得るため**本番は従量 or Vertex**（architecture.md §10）。

#### Vercel AI SDK 6（ai@6 ＋ @ai-sdk/google）
- **概要**：TypeScript の LLM オーケストレーション標準。**v6 が現行**＝`ToolLoopAgent`（ツール実行ループ内蔵・既定最大20ステップ）・human-in-the-loop ツール承認・**structured outputs × tool calling の安定化**・DevTools。
- **役割**：`/api/chat` のストリーミング＋ツールループ、`useChat` によるチャットUI、Protocol（Zod）への組立（P8a/P8b）。
- **採用理由**：Next.js/Vercel 一体・provider 非依存・Zod 直結・チャットUIフック込みで **Step2 MVP 最短**。
- **注意**：v5→v6 は破壊的変更が大きい（メッセージパーツ・ストリーム形式）。本プロジェクトは**最初から v6 で実装**し、`ai@^6` と `@ai-sdk/react@^6` を**セットで固定**する（混在はストリーム解析エラーの原因）。
- **代替候補**：GraphAI（下記・宣言的多段フロー）／素の provider SDK（ツールループ・ストリーム・差し替えを自作＝車輪の再発明）／LangChain.js・Mastra（重い・TS 慣用から外れる）。

#### GraphAI 2（PoC 候補・既定にはしない）
- **概要**：エージェントのワークフローを **YAML/JSON の宣言的グラフ**で記述する非同期データフロー実行エンジン（詳細評価は architecture.md §10.4）。
- **役割**：「2駅を並列取得→合成→描画」のような**宣言的多段フロー**の PoC（P8c）。
- **採用理由（候補として）**：エージェント論理がコードでなく**データ（DSL）**になる＝memo の思想と一致。`fetchAgent` で共通APIをそのままノード化でき、本アーキテクチャと同じ思想系譜。
- **代替候補**：AI SDK v6 の `ToolLoopAgent` で足りるならそれで良い（PoC の結果で判断＝§8 未決事項）。

---

*本プランは実行により学んだことを反映して更新する（プラン自体も監査対象）。設計判断の詳細根拠は [`architecture.md`](./architecture.md)、データ仕様は [`dataset.md`](./dataset.md)、過去の教訓は [`Station_Area_Database_Map.md`](./Station_Area_Database_Map.md) を参照。*
