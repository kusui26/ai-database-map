# Supabase を東京リージョンで作り直す（移行プラン）

**2026-08-16 に本番 DB（Southeast Asia / Singapore・Free）がディスク枯渇で起動しなくなった**ため、
**Northeast Asia (Tokyo) `ap-northeast-1` に新しいプロジェクトを作って移行する**ための実行プラン。

- **データ損失はゼロ**。この DB の中身は 100% 派生物で、`data/derived/station_dataset.csv` と
  `supabase/migrations/` から完全に再現できる（§1）。
- **利用者から見た URL は変わらない**（`ai-database-map.vercel.app` のまま）。変わるのは
  サーバだけが使う接続情報 2 つ（§6 Phase 6）。
- あわせて **`station_values.value` を `float8` → `float4`** にして容量を 456MB → **約 410MB** に下げる
  （承認済み・影響は実測で **表示が変わるセル 1,542／686 万＝0.022%**・§7）。

関連：事故の経緯と容量設計は [`260816_sales.md`](./260816_sales.md) §12.4、DB の格納規約は
[`sales.md`](./sales.md) §10、スキーマは [`../supabase/README.md`](../supabase/README.md)。

---

## 0. 何が起きたか（1 分で読む）

| | |
|---|---|
| きっかけ | 売上 126 列を足すため `load_to_supabase.py`（フルロード）を実行した |
| 起きたこと | `truncate` → `COPY` が**単一トランザクション**なので、コミットまで旧 406MB と新 428MB が**同時に存在**。無料枠のディスクを使い切り、**Postgres が起動できなくなった** |
| データ | 単一トランザクションなので**ロールバック済み**。失われていない |
| 復旧の試み | ①再起動 ②Pause → Restore ③2 時間の待機 → **いずれも `FATAL: the database system is not accepting connections` のまま** |
| 判断 | 復旧の見込みが立たず、**どのみち作り直すなら東京に**（日本からの RTT 実測 80.6ms → 13.5ms）|

**恒久対策はすでに実装済み**（PR #67）：列を足すだけのときは `load_to_supabase.py --append`
（`truncate` しない・ピークは「増える分＋WAL」）。**フルロードは空の DB にだけ使う。**

---

## 1. 失われるもの・失われないもの

### 1.1 この DB に「元データ」は 1 件も無い

| テーブル | 中身 | 再現方法 |
|---|---|---|
| `stations`（9,273）| 駅グループの識別・座標・属性 | CSV の識別 10 列 |
| `metric_columns`（784）| メトリクス・カタログのミラー | `src/shared/catalog/catalog.json`（コミット済み）|
| `station_values`（6,020,472）| 指標の値 | CSV の値 784 列 |
| `station_routes`（10,424）| 駅×社×路線 | `data/derived/station_routes.csv` |

- **認証ユーザー・Storage・Edge Functions・Realtime は未使用**（`src/db/client.ts` は
  `SUPABASE_URL` ＋ `SUPABASE_ANON_KEY` で PostgREST/RPC を読むだけ）。移行対象が無い。
- したがって**バックアップからの復元は不要**。CSV から入れ直すのが最短かつ確実。

### 1.2 変わるもの・変わらないもの

| | 変わる | 変わらない |
|---|---|---|
| 利用者 | — | **公開 URL `ai-database-map.vercel.app`**（ブラウザは Supabase を直接見ない）|
| Vercel | 環境変数 2 つ（`SUPABASE_URL` / `SUPABASE_ANON_KEY`）| プロジェクト・ドメイン・Cron・デプロイ設定 |
| Supabase | プロジェクト ref（API URL・DB ホスト・プーラー）／ API キー ／ JWT シークレット ／ DB パスワード | スキーマ・RPC・RLS・GRANT（migrations を再適用）|
| リポジトリ | `.env`（gitignore）4 行 ／ 新規マイグレーション 1 本 ／ 検証スクリプトの期待値 | **アプリのコードは変更なし** |
| データ | `value` の型が `float8` → `float4`（§7）| 値そのもの（表示上の差は 0.022% のセル）|

> 新規プロジェクトのキーは**新形式（`sb_publishable_...` / `sb_secret_...`）**で発行される場合がある。
> supabase-js はどちらでも動くので、`SUPABASE_ANON_KEY` に publishable キーを入れればよい
> （レガシーキーは 2026 年後半に廃止予定）。

---

## 2. 全体像（誰が・何を・どの順で）

```
[Phase 0] 私   : 事前準備（float4 ＋ 検証スクリプト対応 ＋ 本プラン）を PR #68 で出す   … 20 分
      │
[Phase 1] あなた: 東京リージョンで新規プロジェクト作成                                 … 5 分
      │           （Project URL / anon キー / service_role キー / DB パスワード を控える）
[Phase 2] あなた: `.env` の 4 行を書き換え → 私が接続確認                              … 5 分
      │
[Phase 3] 私   : `supabase db push` でスキーマ適用（migrations 19 本）                 … 3 分
      │
[Phase 4] 私   : `load_to_supabase.py` でフルロード（空 DB なので安全）                … 10〜20 分
      │
[Phase 5] 私   : validate_load / golden_rpc_test / ANALYZE / サイズ記録                … 10 分
      │
[Phase 6] あなた: Vercel の環境変数 2 つを更新 → 再デプロイ                            … 5 分
      │      私   : /api/health とヘッドレスで主要画面を確認                            … 10 分
      │
[Phase 7] 私   : docs 更新・PR 更新 ／ あなた: 旧プロジェクトを Pause（後日 Delete）   … 10 分
```

**合計およそ 1 時間**（うち、あなたの作業は 15 分ほど）。

> **原則**：Phase 6 まで**本番は今のまま**（＝すでに落ちているので、これ以上悪くならない）。
> 新プロジェクトの検証が全部 PASS してから切り替える。

---

## 3. Phase 0 — 事前準備（私・PR で出す）

### 3.1 `value` を `float4` にするマイグレーション

新しいマイグレーションを 1 本足す（既存の `init_schema.sql` は書き換えない＝履歴を偽らない）。

```sql
-- supabase/migrations/20260816191709_station_values_float4.sql
alter table public.station_values alter column value type real;
```

- **空の DB に適用するので一瞬**（テーブル書き換えのコストが無い）。
- 既存の RPC は戻り値を `double precision` と宣言しているが、`real` は自動で拡張されるため**変更不要**。
- 効果：1 行あたり 44.3 → **36.3 バイト**（本体）。索引 30.2 バイトは不変。
  6,020,472 行で **station_values 428MB → 約 382MB**、**DB 合計 約 456MB → 約 410MB**（無料枠の 82%）。

### 3.2 検証スクリプトを float4 対応にする（**許容誤差は緩めない**）

`float4` にすると DB から返る値は `1902.3` ではなく `1902.3000488...` になる。ここで
「許容誤差を緩める」のは検証を弱めるだけなので採らない。**期待値の側を float4 に丸めて、
厳密に比較する**（＝「保存が float4 の丸めどおりに行われたこと」まで検証できる）。

実装は**共有ヘルパ 2 つ**（`pipeline/load_to_supabase.py`）で、両方の検証スクリプトが使う。

| 関数 | 役割 |
|---|---|
| `value_column_type(cur)` | `station_values.value` の型（`real` / `double precision`）を DB に問い合わせる |
| `round_to_stored(df, keys, type)` | 型が `real` なら **CSV 側（期待値）の値列を float4 に丸める**（1 回だけ・以降の比較はそのまま厳密）|

| ファイル | 変更 |
|---|---|
| `pipeline/validate_load.py` | 接続直後に型を判定して CSV を丸める → (a)〜(d) は既存ロジックのまま。(d) 全国計は **SQL を `sum(value::double precision)` に**（PostgreSQL の `sum(real)` は `real` を返し、9,273 行の加算で誤差が積もるため）。レポートに型を出力 |
| `pipeline/golden_rpc_test.py` | 同様に判定・丸め。**行を取り出す前に丸める**（`df.iloc[0]` で取り出した Series は後から df を書き換えても追従しないため）|

> この方式なら、**float8 の DB でも float4 の DB でも同じスクリプトが正しく動く**
> （型を見て自動で切り替わる）。許容誤差は 1e-9 のまま緩めない。

### 3.3 投入後の `ANALYZE`

投入直後はプランナ統計が空で、最初のランキング/散布が遅くなる。`load_to_supabase.py` の
**フルロード・追記モードの両方**で、コミット後に `analyze`（`station_values` / `stations` /
`station_routes`）を打つようにした（autocommit で実行）。

### 3.4 PR #67 の扱い（**open のまま・マージは Phase 7**）

| PR | 内容 | ベース | いつマージするか |
|---|---|---|---|
| **#67** `feat/sales-catalog` | 売上のカタログ・DB（658→**784 エントリ** / 668→**794 列**）、容量対策A（フラグの 0 を格納しない）、追記モード `--append`、`salesPanels`、`stacked` チャート | `main` | **Phase 7**（新 DB への投入と切替が終わってから）|
| **#68** `chore/supabase-tokyo-float4` | float4 マイグレーション、検証スクリプトの float4 対応、投入後 ANALYZE、本プラン、docs 更新 | **`feat/sales-catalog`** | #67 の直後 |

**なぜ今マージしないのか。** #67 をマージすると main のカタログが 784 エントリになり、
**ランキング・散布図の指標ピッカと AI のカタログに売上が並ぶ**。その指標を実際に引けるのは
「新 DB に 794 列を投入したあと」なので、投入前にマージすると *指標はあるのに空が返る* 状態が
main に入る。

**今マージしても実害はない**（本番はすでに 502 で、旧 DB はもう使わない）。それでも待つのは、
**アプリが復活する瞬間を「既知の正しい状態＝現在の main」で迎えたい**から。こうすると

1. Phase 6 で復活を確認 → **「移行そのものが成功したか」**が分かる
2. Phase 7 で #67 をマージ → **「売上が正しく載ったか」**が分かる

と、**2 つの変化を切り分けて検証できる**。同時に動かすと、何かおかしいときに原因の切り分けができない。

**#67 に対してこれからやること**

| | 内容 |
|---|---|
| コード | **変更しない。** typecheck / eslint / vitest 300 passed まで通っており、残っていたのは DB 投入だけ（それを本移行が満たす）|
| PR 本文 | 「DB 投入がまだ完了していません」の警告を、**本プランへのリンクと「Phase 7 でマージ」**に更新する |
| `docs/sales.md` §10.2 の容量見積り（456MB）| float4 で **約 410MB** に変わるので、**#68 側で**更新する（#67 は触らない）|

**#68 のベースを `feat/sales-catalog` にする理由**：`pipeline/validate_load.py` を #67 と #68 の
両方が触るため、main から切ると衝突する。`feat/sales-catalog` から切っておけば、
**#67 がマージされた時点で GitHub が #68 を自動的に `main` へ向け直す**
（`rebase` も `squash` も不要＝`.claude/CLAUDE.md` §4 の禁止事項に触れない）。

> **マージ順序は必ず #67 → #68。** 逆順にはできない（#68 のベースが #67 のブランチのため）。

---

## 4. Phase 1 — 新規プロジェクト作成（**あなた**）

Supabase ダッシュボード → **New project**

| 項目 | 値 |
|---|---|
| Organization | 既存のもの |
| Name | `ai-database-map`（旧と区別するなら `ai-database-map-tokyo`）|
| **Region** | **Northeast Asia (Tokyo)** ⚠ ここが今回の目的 |
| Plan | **Free** |
| Database Password | 強いものを生成し、**手元に控える**（`.env` に入れます）|

作成後、次の 4 つを控えてください（**Settings → API** と **Connect**）。

1. **Project URL**（`https://<ref>.supabase.co`）
2. **anon key**（新形式なら `sb_publishable_...`）
3. **service_role key**（新形式なら `sb_secret_...`）※アプリは未使用だが `.env` の互換のため
4. **Connection string**（`Connect` → **Direct connection** の URI。`postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres`）

> **Free プランはアクティブ 2 プロジェクトまで。** 壊れた旧プロジェクトを残したまま新規作成できます
> （これで 2 つ目）。旧の削除は Phase 7 で。

---

## 5. Phase 2 — 接続設定（**あなた** → 私）

### 5.1 あなた：`.env` の 4 行を書き換え

`.env` は gitignore 済みです。**キーをチャットに貼る必要はありません**（私はファイルを読むだけで、
値は出力しません）。次の 4 行を新しい値にしてください。

```dotenv
SUPABASE_URL=https://<新しい ref>.supabase.co
SUPABASE_ANON_KEY=<anon / publishable キー>
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret キー>
SUPABASE_DB_URL=postgresql://postgres:<DBパスワード>@db.<新しい ref>.supabase.co:5432/postgres
```

> ⚠ `SUPABASE_DB_URL` のパスワードは**生値のまま**書いてください（`load_to_supabase.py` は生値を
> 使います）。`supabase db push` に渡すときだけ、私がパスワード部を percent-encode します。

### 5.2 私：接続確認（読み取りだけ）

- `select version()`（Postgres のメジャーバージョン）
- `extensions` スキーマに **PostGIS** が入れられるか
- **テーブルが空であること**（＝間違って旧プロジェクトに繋いでいないことの確認）

**中止条件**：ここで旧プロジェクトに繋がってしまう場合は、`.env` の書き換え漏れなので先に直します。

---

## 6. Phase 3〜7 — 実行

### Phase 3 — スキーマ適用（**私**・約 3 分）

```bash
export PATH="$HOME/.local/share/supabase:$PATH"     # CLI v2.109.1（導入済み）
DBURL_ENC=$(python3 - <<'PY'
import re, urllib.parse
url = re.search(r'^SUPABASE_DB_URL=(.*)$', open('.env').read(), re.M).group(1).strip()
scheme, after = url.split('://', 1); creds, host = after.rsplit('@', 1); user, pw = creds.split(':', 1)
print(f'{scheme}://{user}:{urllib.parse.quote(pw, safe="")}@{host}')
PY
)
supabase db push --db-url "$DBURL_ENC" --yes
```

**適用されるもの**：既存 **18 本**（`20260707125114_init_schema` 〜 `20260804011925_drop_values_for_columns`）＋ float4 の 1 本 ＝ **19 本**。

**適用後の確認（私）**

| 確認 | 期待 |
|---|---|
| テーブル | `stations` / `metric_columns` / `station_values` / `station_routes` |
| `station_values.value` の型 | **`real`** |
| RPC | `search_stations` / `nearest_stations` / `stations_in_bbox` / `rank_by_column` / `scatter_points` / `station_bundle` / `stations_geojson` ほか |
| RLS | 全テーブルで有効・anon は SELECT のみ |
| 拡張 | `postgis` / `pg_trgm`（`extensions` スキーマ）|

### Phase 4 — データ投入（**私**・10〜20 分）

```bash
python3 pipeline/load_to_supabase.py        # ← フルロード。空 DB なのでピーク 2 倍問題は起きない
```

**期待値**

| | 件数 |
|---|---:|
| `stations` | 9,273 |
| `metric_columns` | **784** |
| `station_values` | **6,020,472**（非NaN 6,886,613 − フラグの 0 が 866,141）|
| `station_routes` | 10,424 |
| DB サイズ | **約 410MB**（無料枠 500MB の 82%）|

**失敗したら**：空の DB へのフルロードは冪等（`truncate` → `COPY`）なので、**そのまま再実行**でよい。

### Phase 5 — 検証（**私**・約 10 分）

```bash
python3 pipeline/validate_load.py     # (a)件数 (b)列ごと (c)無作為300セル (d)全国計 (e)DBサイズ (f)フラグ0が無い
python3 pipeline/golden_rpc_test.py   # 検索・最寄・bbox・ランキング・散布・駅詳細・売上・注入耐性
```

| 検証 | 合格条件 |
|---|---|
| `validate_load.py` | **全 PASS**（`docs/p2b_load_report.md` を自動生成）|
| `golden_rpc_test.py` | **全 PASS**（売上 4 本を含む）|
| DB サイズ | < 475MB（無料枠の 95%）|
| `ANALYZE` | 実行済み（ランキングの初回応答が遅くならないように）|

### Phase 6 — 本番切替（**あなた** → 私・約 15 分）

**あなた**：Vercel ダッシュボード → プロジェクト → **Settings → Environment Variables**

| 変数 | 値 |
|---|---|
| `SUPABASE_URL` | 新しい Project URL |
| `SUPABASE_ANON_KEY` | 新しい anon / publishable キー |

更新したら **Deployments → 最新 → Redeploy**（環境変数はビルド時ではなく実行時に読むが、
確実に反映させるため再デプロイする）。

> `NEXT_PUBLIC_SITE_URL` / `GEMINI_API_KEY` は**そのまま**。`SUPABASE_SERVICE_ROLE_KEY` は
> アプリ実行時には使いません（設定済みなら新しい値に更新しておくと混乱がありません）。

**私**：切替後の確認

| 確認 | 合格条件 |
|---|---|
| `GET /api/health` | **200**（現在は 502）|
| `GET /api/stations/geojson` | 9,273 駅 |
| `GET /api/stations/東京#0` | 値が返る（人口・地価・事業所・所得…）|
| `GET /api/ranking?...` | 既知の上位と一致 |
| ヘッドレス（Playwright）| 地図描画・駅詳細の 7 タブ・ランキング・散布図・チャットが動く |
| 体感速度 | 駅詳細の API が Singapore 時代より速い（DB 往復 2 回ぶん ≒ −140ms の見込み）|

### Phase 7 — 後片付け（**私** ＋ **あなた**・約 10 分）

**私**

1. `docs/sales.md` §10.2 に**実測のサイズ・行数**を記録（推計値を実測値に置き換える）
2. `README.md` / `docs/architecture.md` / `supabase/README.md` にリージョン（東京）を明記
3. 本プランに**実行結果**（所要時間・実測値・つまずいた点）を追記
4. PR **#67**（本文の警告を更新）と **#68**（実測値の反映）を更新 → **マージ可能**になったことをお知らせ

**あなた**

5. **#67 → #68 の順**にマージ（#67 のマージで main が本番にデプロイされ、売上がランキング・散布図・AI に載る。§3.4）
6. **旧プロジェクトを Pause**。1 週間ほど様子を見てから **Delete**（Free の 2 プロジェクト枠を空ける）

---

## 7. `float4` 化の影響（実測・2026-08-16）

`data/derived/station_dataset.csv` の**全 6,886,613 セル**を float32 に丸めて、**表示（カタログの
`format` で丸めた後）が変わるか**を全数で調べた。

| 指標 | 実測 |
|---|---:|
| 数値セル合計 | 6,886,613 |
| `\|値\| > 2^24`（＝整数として厳密に表せない）| 2,842（0.041%）|
| **表示が変わるセル** | **1,542（0.022%）** |
| 絶対誤差の最大 | **2**（百万円）|
| 相対誤差の最大 | **6.0 × 10⁻⁸** |

**表示が変わる列（全数）**

| 列 | 件数 | 例 |
|---|---:|---|
| `inc_total_2025_20km` | 578 | 36,230,734 → 36,230,736 百万円 |
| `inc_total_2020_20km` | 461 | 34,004,686 → 34,004,688 百万円 |
| `inc_total_2015_20km` | 342 | 26,135,345 → 26,135,344 百万円 |
| `inc_total_2025_10km` | 125 | 19,173,003 → 19,173,004 百万円 |
| `inc_total_2020_10km` | 1 | 16,837,935 → 16,837,936 百万円 |
| `pop_{2015,2020}_500m_hidden_ratio` | 35 | **ちょうど 0.05 / 0.35** など 1 桁丸めの境界にある値が隣に転ぶ（0.4% → 0.3%）|

> **読み方**：影響は**課税対象所得の総額（10km・20km 圏）の末尾 1〜2 百万円**と、秘匿割合の 0.1 ポイントに限られる。
> 3.6 兆円の表示で末尾 2 百万円（相対 6×10⁻⁸）なので、**指標としての意味は変わらない**。
> 売上（億円・小数 1 桁）・人口・地価・乗降客数・増減率は**1 件も変わらない**。

**それでも避けたい場合**：`inc_total_*` の 18 列だけ `numeric` にする案もあるが、列ごとに型を分けると
`station_values` の単一テーブル設計（列レジストリ方式）が崩れるため採らない。

---

## 8. リスクと対策

| # | リスク | 兆候 | 対策 |
|---|---|---|---|
| 1 | 直結（`db.<ref>.supabase.co:5432`）が**IPv6 のみ**で繋がらない | `Network is unreachable` | ダッシュボードの **Session pooler**（5432）の接続文字列に切り替える。COPY も `db push` も通る（**Transaction pooler 6543 はマイグレーションに使えない**）|
| 2 | `supabase db push` が途中で失敗 | エラー出力 | 失敗した 1 本を特定して psql 相当で個別適用 → `supabase_migrations.schema_migrations` に記録。空 DB なので**全部消してやり直しも安全** |
| 3 | COPY 中に切断 | `connection socket closed` | 空 DB へのフルロードは冪等。**そのまま再実行**（今回の事故と違い、旧データと同居しないのでディスクは膨らまない）|
| 4 | 新プロジェクトの PG バージョン差 | 適用時の構文エラー | migrations は標準機能のみ（generated column・RLS・security invoker）。PG 15〜17 で動作 |
| 5 | 投入後も無料枠が厳しい | 410MB / 500MB（82%）| **次にデータを足す前に**、`260816_sales.md` §12.4 の E（増減率を RPC 計算）か F（`float8[]` 化）を検討。列追加は必ず `--append` |
| 6 | 旧プロジェクトが後から復活する | 接続できるようになる | **使わない**。env はすでに新を向いている。旧は Pause → Delete |
| 7 | キーの取り違え（旧のまま） | Phase 2 の確認でテーブルが埋まっている | Phase 2 の「空であること」チェックで検出する |
| 8 | Vercel の env 更新漏れ | `/api/health` が 502 のまま | 再デプロイして再確認。**戻す操作は不要**（旧 DB は壊れているため、前進のみ）|

### ロールバック方針

- **Phase 5 まで**：本番は一切変わらない（新プロジェクトを消してやり直せる）。
- **Phase 6 以降**：切り戻し先の旧 DB が壊れているため、**実質的に前進のみ**。
  ただし新 DB は CSV から何度でも作り直せるので、詰みは無い。
- **最悪ケース**（新プロジェクトも壊した）：もう一度 Phase 1 からやり直す。所要 1 時間・費用ゼロ。

---

## 9. チェックリスト（実行時にそのまま使う）

**あなた**

- [ ] Supabase で **Tokyo / Free** の新規プロジェクトを作成した
- [ ] Project URL・anon キー・service_role キー・DB パスワードを控えた
- [ ] `.env` の 4 行を書き換えた
- [ ] （Phase 6）Vercel の `SUPABASE_URL` / `SUPABASE_ANON_KEY` を更新し、再デプロイした
- [ ] （Phase 7）**#67 → #68 の順**にマージした
- [ ] （Phase 7）旧プロジェクトを Pause した／1 週間後に Delete する

**私**

- [x] **Phase 0 完了**：float4 マイグレーション・検証スクリプトの float4 対応・投入後 ANALYZE・本プランを PR #68 で出した
- [ ] 接続確認（バージョン・PostGIS・**空であること**）
- [ ] `supabase db push`（19 本）→ 型・RPC・RLS を確認
- [ ] `load_to_supabase.py`（9,273 / 784 / 6,020,472 / 10,424）
- [ ] `validate_load.py` 全 PASS ／ `golden_rpc_test.py` 全 PASS
- [ ] `ANALYZE` ／ DB サイズを記録（期待 約 410MB）
- [ ] 切替後：`/api/health` 200 ／ ヘッドレスで主要画面
- [ ] docs 更新（`sales.md` §10.2・README・architecture・本プランの実行記録）

---

## 10. 決定事項

| # | 論点 | 決定 |
|---|---|---|
| 1 | リージョン | **Northeast Asia (Tokyo)**（日本からの RTT 実測 80.6ms → 13.5ms。DB 往復 1 回あたり −67ms）|
| 2 | 移行方法 | **新規プロジェクト＋CSV から再投入**（バックアップ復元は使わない。中身が 100% 派生物なので、そのほうが速く確実）|
| 3 | `value` の型 | **`float4`**（456MB → 約 410MB。表示が変わるのは 0.022% のセル・所得総額の末尾のみ）|
| 4 | 検証の厳しさ | 許容誤差は緩めず、**期待値を float4 に丸めて厳密比較**する |
| 5 | 切替タイミング | **新 DB の検証が全部 PASS してから** Vercel の env を更新する |
| 6 | 旧プロジェクト | 切替後に Pause、1 週間後に Delete |
| 7 | PR | float4・検証対応・本プランは**別 PR #68**（ベースは `feat/sales-catalog`）。**#67 は open のまま Phase 7 でマージ**（§3.4）|

## 11. 今回の事故から得た運用ルール（恒久）

1. **フルロード（`truncate` → `COPY`）は「空の DB」にだけ使う。** 既存 DB に列を足すときは
   必ず **`load_to_supabase.py --append`**（ピークは「増える分＋WAL」）。
2. **投入の前後で `pg_database_size` を記録する。** 記録は `docs/sales.md` §10.2 のように残す。
3. **無料枠の残りが 20% を切ったら、次のデータを足す前に削減策を打つ。**
4. **フラグ列の 0 は格納しない**（行が無い＝0）。新しいフラグ列は実質ゼロコストで足せる。

---

## 12. 実行記録（Phase 7 で追記する）

| Phase | 所要 | 実測値・備考 |
|---|---|---|
| **0 事前準備** | 約 20 分 | PR #68（float4 migration・検証 2 本の float4 対応・loader に ANALYZE・docs 4 本）。ruff / typecheck / eslint / vitest 300 passed |
| **1 新規作成** | — | あなたが東京リージョンで作成し `.env` を更新 |
| **2 接続確認** | 1 分 | **RTT 13.0ms**（旧シンガポール 80.6ms → −68ms）／PostgreSQL **17.6**／PostGIS 3.3.7・pg_trgm 1.6 が利用可能／`public` は空 |
| **3 スキーマ適用** | 3 分 | migrations **20 本**（18 ＋ float4 ＋ 権限）。スキーマ検証 **10/10 PASS** |
| **4 投入** | **48 秒** | stations 9,273／metric_columns 784／**station_values 6,020,472**（フラグの 0 を 866,141 行 省略）／routes 10,424。COPY 39.4s ＋ FK 3.3s ＋ ANALYZE 4.0s |
| **5 検証** | 6 分 | `validate_load.py` **10/10 PASS**／`golden_rpc_test.py` **21/21 PASS** |
| 6 切替 | | `/api/health`・体感速度 |

### 12.1 容量の実測（float4 の効果）

| | 実測 |
|---|---:|
| **DB 全体** | **417 MB**（無料枠 500MB の **83%**）|
| `station_values` | 389 MB（本体 208 ＋ 索引 180）|
| 1 行あたり | **67.7 バイト**（本体 **36.2** ＋ 索引 31.4）|
| 旧 DB（float8）| 74.5 バイト/行 → **6.8 バイト/行の削減** |
| float8 のままだった場合 | **456 MB**（＝事前の見積りと一致）|

事前の見積り「本体 44.3 → 36.3 バイト・DB 約 410MB」に対し、実測は **36.2 バイト・417MB**。
差の 7MB は索引が 30.2 → 31.4 バイト/行に増えたぶん（行数が 5.72M → 6.02M に増えて
B-tree のページ充填率が変わったため）。**無料枠に対する余裕は 83MB。**

### 12.2 実行中に見つけたこと（4 件）

| # | 見つかったこと | 対処 |
|---|---|---|
| 1 | **anon / authenticated に INSERT・UPDATE・DELETE が残っていた**。既存の `tighten_anon_grants` は TRUNCATE/REFERENCES/TRIGGER しか剥がしておらず、Supabase の既定（public の新規テーブルに ALL）が効いたまま。RLS が SELECT のみなので実害は無かったが、README の記述と食い違う | マイグレーション **`20260816234947_anon_select_only.sql`** を追加（全テーブルから書き込み権限を剥奪＋既定権限も変更）。再検証で 4 テーブルとも SELECT のみを確認 |
| 2 | **`extra_float_digits = 0`（Supabase の既定）だと `real` のテキスト表現が 6 桁に丸まる**（3683268 → `3.68327e+06` → 3683270.0）。**格納値は正しく、PostgREST は完全精度で返す**（実測：`3683268` / `164.199996948242`）ので**アプリは無影響**。影響を受けるのは psycopg でテキスト受信する検証スクリプトだけ | `db_params()` に `options: -c extra_float_digits=3` を追加。さらに (c) の照合は **SQL 側で `value::double precision`** に拡張してから比較（`real` の最短表現 "397.1" を float64 で読むと float32 の厳密値と一致しないため）|
| 3 | `golden_rpc_test` の 2 件が FAIL：「rank が信頼性フラグ値を同梱」。**対策A（フラグの 0 を格納しない）の当然の帰結**で、フラグ 0 の駅は行が無く `flag_value=NULL` になる | 期待を**より強い全数照合**に置き換えた：1 県ぶんの全駅で「CSV のフラグ 1 → `flag_value=1`／0 → NULL」が完全一致することを検証（212 駅中 6 件／185 駅中 111 件で PASS）|
| 4 | シードの `metric_columns` は 488 ではなく **489**（`reliability_flag_semantics` が `flag_covid_lown` を追加していた）| 私の期待値が古かっただけ。投入で 784 に置き換わる |
