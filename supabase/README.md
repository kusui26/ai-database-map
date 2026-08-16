# supabase — DB スキーマ / migrations（P2a）

クラウド経路（Docker 不要）でクラウドの Supabase プロジェクト（東京）へ migrations を適用する。
物理設計は plan_fable §2.2-②（列レジストリ方式）、セキュリティは .claude/CLAUDE.md §8（RLS・最小権限）。

## 前提

- `.env`（gitignore）に `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`
- Supabase CLI。brew が使えない環境では GitHub Releases のバイナリを使う（**shim `supabase` と `supabase-go` を同一ディレクトリに展開**して PATH に追加）:
  ```bash
  mkdir -p ~/.local/share/supabase
  curl -sL https://github.com/supabase/cli/releases/download/v2.109.1/supabase_2.109.1_darwin_arm64.tar.gz | tar -xzf - -C ~/.local/share/supabase
  export PATH="$HOME/.local/share/supabase:$PATH"
  ```
- `psql`（検証用）

## migrations

| ファイル                    | 内容                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `*_init_schema.sql`         | postgis/pg_trgm、`stations`（geom generated）・`metric_columns`・`station_values`、GiST/trgm index、RLS ＋ anon SELECT ポリシー ＋ GRANT |
| `*_seed_metric_columns.sql` | `catalog.json` → `metric_columns` 488行（`pipeline/build_seed.py` が生成）                                                               |
| `*_tighten_anon_grants.sql` | anon/authenticated を SELECT のみに厳格化（TRUNCATE/REFERENCES/TRIGGER を剥奪）                                                          |
| `*_station_values_float4.sql` | `station_values.value` を `double precision` → `real`（容量 −46MB・260816）。⚠ **空の DB に適用すること**（データが入っているとテーブルを書き換え、ディスクのピークが 2 倍になる）|
| `*_anon_select_only.sql` ／ `*_revoke_maintain_from_anon.sql` | anon/authenticated を**文字どおり SELECT のみ**に（Supabase の既定は `public` の新規テーブルに `arwdDxtm` を付与するため・260816）|

上表は代表的なものだけ。実際に適用されるのは `supabase/migrations/` の全ファイル（タイムスタンプ順）。

## 適用（クラウド）

`SUPABASE_DB_URL` はパスワードに特殊文字が含まれると URL パースに失敗するため、**パスワード部だけを
percent-encode** して渡す（値はログに出さない）。

```bash
DBURL_ENC=$(python3 - <<'PY'
import re, urllib.parse
url = re.search(r'^SUPABASE_DB_URL=(.*)$', open('.env').read(), re.M).group(1).strip()
scheme, after = url.split('://', 1); creds, host = after.rsplit('@', 1); user, pw = creds.split(':', 1)
print(f'{scheme}://{user}:{urllib.parse.quote(pw, safe="")}@{host}')
PY
)
supabase db push --db-url "$DBURL_ENC" --yes
```

> 別解：Supabase ダッシュボードで DB パスワードを英数字のみに再設定すれば encode 不要。

## seed 再生成

`catalog.json`（P1）が変わったら再生成する（列名から機械生成＝指標追加が自動追従）:

```bash
python3 pipeline/build_seed.py supabase/migrations/<ts>_seed_metric_columns.sql
```

## 受け入れ確認（P2a）

```bash
# metric_columns 件数 = catalog 488
psql "$DBURL_ENC" -c "select count(*) from public.metric_columns;"
# anon は SELECT 可・書込不可（REST を anon/publishable キーで検証）
curl -s "$SUPABASE_URL/rest/v1/metric_columns?select=count" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"   # 200 / 488
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SUPABASE_URL/rest/v1/metric_columns" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}'   # 401
```
