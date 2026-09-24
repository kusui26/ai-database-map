/**
 * 導入ページ（PR-8・`docs/260828_research_claude_auth.md` §6）。
 *
 * ユーザー自身の Claude（Claude Code / Claude.ai / Cowork）や他の MCP クライアントから、
 * このアプリの共通 API（リモート MCP・13 ツール）を**本人のサブスクリプションで**使うための
 * 入口。コマンド・導入リンク・プラン別の注意（枠の消費）をここに集約する。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { CopyButton } from '@/components/CopyButton'

export const metadata: Metadata = {
  title: 'Claude で使う（MCP・プラグイン導入）',
  description:
    '全国 9,273 駅の駅×半径オープンデータ（乗降客数・人口・地価・売上・災害リスク）を、あなたの Claude から日本語で聞けます。API キー不要・読み取り専用のリモート MCP サーバ。Claude Code なら 2 行で導入。',
  alternates: { canonical: '/ai' },
  openGraph: {
    type: 'article',
    locale: 'ja_JP',
    url: '/ai',
    title: 'あなたの Claude で、駅×半径のオープンデータを使う',
    description:
      '全国 9,273 駅の乗降客数・人口・地価・売上・災害リスクを、日本語で聞くだけで分析できます。API キー不要。',
  },
}

const MCP_URL = 'https://ai-database-map.vercel.app/api/mcp'
const CONNECTOR_LINK = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent('AI Database Map')}&connectorUrl=${encodeURIComponent(MCP_URL)}`
const MARKETPLACE_ADD = '/plugin marketplace add kusui26/AI-Database-Map'
const PLUGIN_INSTALL = '/plugin install ai-database-map@ai-database-map'
const CODEX_ADD = 'codex plugin marketplace add kusui26/AI-Database-Map'

// 母艦（MulmoTerminal / MulmoClaude）の設定。MulmoClaude 1.18.0 より前は、既定の Docker
// サンドボックスの中で Claude Code がプラグインを解決できず（台帳がホストの絶対パスを持つ・
// receptron/mulmoclaude#3186）、スキルを手で置く回避策が要った。1.18.0 で台帳が読み替えられる
// ようになったので、**設定は MCP の登録と地図タイルの CSP の 2 つだけ**になった。
const MULMO_MCP_ENTRY = `{ "id": "station-data", "url": "${MCP_URL}" }`
const MIN_MULMOCLAUDE_VERSION = '1.18.0'
const MAP_TILE_HOSTS = [
  'https://cyberjapandata.gsi.go.jp',
  'https://disaportaldata.gsi.go.jp',
  'https://www.jma.go.jp',
]
const MULMO_CSP = `mkdir -p ~/mulmoclaude/config && printf '%s' '${JSON.stringify({ 'img-src': MAP_TILE_HOSTS })}' > ~/mulmoclaude/config/csp.json`

/** コマンド 1 行＋コピー（横スクロール可・折返さない）。 */
function Command({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5">
      <code className="min-w-0 flex-1 overflow-x-auto text-sm whitespace-nowrap text-slate-100">
        {text}
      </code>
      <CopyButton text={text} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

const TOOLS: readonly { name: string; desc: string }[] = [
  {
    name: 'search_stations / list_stations',
    desc: '駅の特定・対象集合（市区町村/会社/路線/範囲）',
  },
  { name: 'build_dataset', desc: '駅×指標の CSV を 1 回で生成（短命 URL・ハザード結合可）' },
  { name: 'render_map', desc: '結果を地図にした HTML ページを生成（短命 URL・保存して開く）' },
  { name: 'get_hazard_summary', desc: '全駅事前計算の災害サマリを最大 500 駅一括' },
  { name: 'get_station_detail / rank_stations / compare_growth', desc: '駅詳細・ランキング・散布' },
  { name: 'get_hazard_at_point / get_hazard_alerts', desc: '地点の想定リスク・いまの警報' },
  {
    name: 'find_evacuation_sites / find_escape_direction',
    desc: '指定緊急避難場所・区域外への向き',
  },
  { name: 'get_metrics_catalog', desc: '自己記述カタログ（806 列の正確なキー・単位・年次）' },
]

/** 冒頭に置く実例。**実際の受け入れテストの応答から抜粋**した値で、作文ではない
 *  （`plugins/ai-database-map/evals/` の golden を 2026-09 に実走した結果）。 */
const EXAMPLE_QUESTION = '横浜市で中古マンションを買おうと思っています。おすすめの駅はどこですか？'

const EXAMPLE_STEPS: readonly string[] = [
  '予算重視か資産価値重視か・通勤先・災害リスクの許容度を先に聞く（データはまだ取らない）',
  '東京駅へ直通する路線の 17 駅を候補にし、駅×指標の CSV を 1 回だけ作る',
  '想定最大規模の洪水で danger 以上の 3 駅を足切りし、残り 14 駅を min-max 正規化して重み付き合成',
  '重みを ±20% 振って、順位が頑健か僅差かを確かめる',
  '上位駅の表・効いた要因と弱点・限界・出典を出す',
]

interface ExampleRow {
  readonly station: string
  readonly pax: string
  readonly future: string
  readonly landPrice: string
  readonly flood: string
}

const EXAMPLE_ROWS: readonly ExampleRow[] = [
  { station: '戸塚', pax: '241,674', future: '+6.4%', landPrice: '454,000', flood: 'warning' },
  { station: '東神奈川', pax: '69,094', future: '+4.9%', landPrice: '457,000', flood: 'none' },
  { station: '山手', pax: '33,896', future: '+8.4%', landPrice: '355,500', flood: 'none' },
]

interface UseCase {
  readonly who: string
  readonly question: string
}

const USE_CASES: readonly UseCase[] = [
  { who: '住まい探し', question: '横浜市で中古マンション、おすすめの駅は？' },
  { who: '鉄道の輸送計画', question: '東急東横線の駅ごとの需要トレンドを分析して' },
  { who: '出店・商圏', question: '武蔵小杉駅 500m 圏でカフェの商圏分析をして' },
]

/** 利用者が打つ文そのもの。ページの主役なので引用として見せる。 */
function Ask({ children }: { children: string }) {
  return (
    <p className="rounded-xl border-l-4 border-indigo-300 bg-indigo-50/60 px-4 py-3 text-sm text-slate-800">
      「{children}」
    </p>
  )
}

function ExampleTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-1.5 pr-3 font-medium">駅</th>
            <th className="border-b border-slate-200 py-1.5 pr-3 font-medium">
              乗降客数 2024（人/日）
            </th>
            <th className="border-b border-slate-200 py-1.5 pr-3 font-medium">
              将来人口 2020→2040
            </th>
            <th className="border-b border-slate-200 py-1.5 pr-3 font-medium">
              地価中央値 2026（円/㎡）
            </th>
            <th className="border-b border-slate-200 py-1.5 font-medium">想定洪水区域</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {EXAMPLE_ROWS.map((row) => (
            <tr key={row.station}>
              <td className="border-b border-slate-100 py-1.5 pr-3 font-medium">{row.station}</td>
              <td className="border-b border-slate-100 py-1.5 pr-3 tabular-nums">{row.pax}</td>
              <td className="border-b border-slate-100 py-1.5 pr-3 tabular-nums">{row.future}</td>
              <td className="border-b border-slate-100 py-1.5 pr-3 tabular-nums">
                {row.landPrice}
              </td>
              <td className="border-b border-slate-100 py-1.5">{row.flood}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AiIntroPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      <header className="space-y-3">
        <p>
          <Link
            href="/"
            className="text-sm text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
          >
            ← 地図アプリへ戻る
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-slate-900">あなたの Claude で、このデータを使う</h1>
        <p className="text-slate-600">
          全国 9,273 駅について、
          <span className="font-medium">半径を指定して集めたオープンデータ</span>
          （乗降客数・人口・地価・売上・災害リスク）を、あなたの Claude から日本語で聞けます。
          <span className="font-medium">API キーは要りません。</span>
          追加費用もかかりません（推論はあなた自身の Claude の利用枠を使います）。
        </p>
        <p className="text-sm text-slate-500">
          実体は読み取り専用のリモート MCP サーバ（13 ツール）です。Claude Code・Claude.ai・Cowork・
          MulmoTerminal / MulmoClaude・その他の MCP 対応クライアントから使えます。
        </p>
      </header>

      <Section title="こう聞くと、こう返ってきます">
        <Ask>{EXAMPLE_QUESTION}</Ask>
        <p className="text-sm text-slate-600">
          言われたとおりに検索するのではなく、
          <span className="font-medium">先に条件を聞いてから</span>
          データを取りに行きます。この質問だと、次の順に進みます。
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          {EXAMPLE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <ExampleTable />
        <div className="space-y-1.5 text-sm text-slate-600">
          <p>
            表には<span className="font-medium">単位と年次</span>が必ず付きます。各駅には
            「効いた要因」と<span className="font-medium">弱点</span>が 1 行ずつ添えられます——
            たとえば東神奈川は「災害面が最も無難。ただし乗降客数・事業所数は横浜駅周辺に比べ小さく、繁華性は限定的」。
          </p>
          <p>
            最後に必ず限界が並びます。 「地価は
            <span className="font-medium">地価公示（土地の価格）</span>
            であり、中古マンション価格そのものの代理指標です」「通勤条件は
            <span className="font-medium">所要時間データを持たないため直通路線で近似</span>
            しました」のように、答えの弱いところを自分から言います。
          </p>
        </div>
        <p className="text-xs text-slate-500">
          上の数値と文言は、リポジトリに入っている受け入れテスト（golden）を 2026-09 に実走した
          <span className="font-medium">実際の応答からの抜粋</span>
          です。重みは質問者の条件に合わせて
          その都度決まるので、順位が固定されているわけではありません。
        </p>
      </Section>

      <Section title="3 つの使い方">
        <p className="text-sm text-slate-600">
          コマンドを覚える必要はありません。<span className="font-medium">日本語で聞くだけ</span>
          です。
        </p>
        <ul className="space-y-2 text-sm">
          {USE_CASES.map((useCase) => (
            <li
              key={useCase.who}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {useCase.who}
              </span>
              <span className="text-slate-600">「{useCase.question}」</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          長い調査は <code>data-analyst</code>{' '}
          サブエージェントに任せられます（結果だけが本体の文脈に返ります）。
        </p>
      </Section>

      <Section title="Claude Code（おすすめ・分析スキル込み）">
        <p className="text-sm text-slate-600">
          ターミナルの Claude Code に 2 行で導入できます（Pro / Max /
          Team）。ツールに加えて、分析の作法・用途別レシピ（住宅 <code>/recommend</code>・輸送計画{' '}
          <code>/demand</code>・出店 <code>/market</code>）と golden 受け入れテストが入ります。
        </p>
        <div className="space-y-2">
          <Command text={MARKETPLACE_ADD} />
          <Command text={PLUGIN_INSTALL} />
        </div>
        <p className="text-xs text-slate-500">
          例：「横浜市で中古マンションを買おうと思う。おすすめの駅は？」——好みを聞いたうえで 137
          駅×指標の CSV を 1 回で取得し、ローカルの pandas で正規化・重み付き合成・±20%
          敏感度まで実行します。更新は <code>/plugin</code> › Marketplaces
          から（第三者マーケットプレイスの自動更新は既定 OFF）。
        </p>
      </Section>

      <Section title="MulmoTerminal / MulmoClaude（図も出す）">
        <p className="text-sm text-slate-600">
          <code>presentChart</code> / <code>presentForm</code> / <code>presentHtml</code>{' '}
          を持つホストでは、要件をフォームで聞き、チャートと
          <span className="font-medium">地図</span>を Canvas
          に出します。図が無い環境でも答えは変わりません。
        </p>

        <h3 className="text-sm font-semibold text-slate-900">MulmoTerminal</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Settings の <code>userMcpServers</code> に <code>{MULMO_MCP_ENTRY}</code>{' '}
            を足します（反映は次のセッションから）。
          </li>
          <li>
            セルは候補チップの <span className="font-medium">WORKSPACE</span>{' '}
            を選びます。図のツールが付くのはこのセルだけです。
          </li>
          <li>
            Canvas
            のスイッチは要りません（ワークスペースでは表示されません）。スキルはプラグインのまま効きます。
          </li>
        </ul>

        <h3 className="text-sm font-semibold text-slate-900">MulmoClaude</h3>
        <p className="text-sm text-slate-600">
          <span className="font-medium">{MIN_MULMOCLAUDE_VERSION} 以上</span>
          を使ってください。設定は 2 つです。Settings › MCP servers に同じ URL
          を足し（許可リストがここから作られます）、地図のタイルを許可する次の 1
          行を実行します（再起動は不要）。
          <span className="font-medium">スキルはプラグインのまま効きます。</span>
        </p>
        <Command text={MULMO_CSP} />
        <p className="text-xs text-slate-500">
          以前ここで案内していたスキルのリンク（
          <code>~/mulmoclaude/.claude/skills</code> への
          symlink）は不要になりました。張ってある場合は消してください——同じスキルが 2
          回出ます。消し方は
          <a
            href="https://github.com/kusui26/AI-Database-Map/blob/main/plugins/ai-database-map/README.md#mulmoclaude-で使う"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            プラグインの README
          </a>
          にあります。
        </p>
      </Section>

      <Section title="Claude.ai（web / デスクトップ / モバイル）">
        <p className="text-sm text-slate-600">
          カスタムコネクタとして追加します（
          <span className="font-medium">Free プランでも 1 個</span>
          まで追加可）。下のリンクで名前と URL が入力済みの追加画面が開きます。
        </p>
        <p>
          <a
            href={CONNECTOR_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-indigo-700"
          >
            Claude.ai にコネクタを追加
          </a>
        </p>
        <div className="space-y-1 text-xs text-slate-500">
          <p>
            手動の場合：設定 › コネクタ › カスタムコネクタを追加 → 名前「AI Database Map」・URL
            に下記を入力（認証は「なし」）。
          </p>
          <Command text={MCP_URL} />
        </div>
      </Section>

      <Section title="Claude Cowork">
        <p className="text-sm text-slate-600">
          Customize › Connectors に同じ URL を追加。プラグインは「Add from a repository」に{' '}
          <code className="rounded bg-slate-100 px-1">kusui26/AI-Database-Map</code>{' '}
          を指定すると、スキル（分析の作法・用途別レシピ）も入ります。成果物は Excel
          などのファイルで受け取れます。
        </p>
      </Section>

      <Section title="その他の MCP クライアント（ChatGPT / Cursor / Codex など）">
        <p className="text-sm text-slate-600">
          MCP（streamable HTTP・認証なし）対応のクライアントなら同じ URL で使えます。Codex CLI
          はプラグインとしても導入できます：
        </p>
        <Command text={CODEX_ADD} />
        <p className="text-xs text-slate-500">
          追加後、Codex 内で <code>/plugins</code> → ai-database-map を Install。
        </p>
      </Section>

      <Section title="扱えるデータ（13 ツール）">
        {/* 名前の札は**横に並べたいが、狭い画面では並べられない**。いちばん長い
            `get_station_detail / rank_stations / compare_growth` は 380px あり、説明の最小幅を足すと
            1 行に 448px 要る——430px の端末でも溢れていた（実測：320px で 112px・390px で 42px）。
            そこで sm 未満は**縦に積む**。札は `max-w-full` で折り返せるようにし（`/` の前後で切れる）、
            sm 以上は `shrink-0` を戻して従来どおり 1 行に並べる。 */}
        <ul className="space-y-1.5 text-sm">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
              <code className="max-w-full self-start rounded bg-slate-100 px-1.5 py-0.5 text-xs break-words text-slate-700 sm:shrink-0">
                {tool.name}
              </code>
              <span className="text-slate-600">{tool.desc}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="プラン別・利用枠の注意">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            推論は<span className="font-medium">あなたの Claude サブスクリプションの枠</span>
            を消費します（Pro / Max は 5 時間枠＋週次枠を Claude・Claude Code・Cowork
            で共有。寄与率は Claude Code の <code>/usage</code> で確認できます）
          </li>
          <li>
            当サーバは枠にやさしい設計です：応答は要約中心・多数駅の行データは
            <span className="font-medium">CSV の URL で渡し</span>
            、分析はローカルで行います（150 駅×20 指標でもツール呼び出しは数回）
          </li>
          <li>
            Claude.ai の Free プランはカスタムコネクタ 1 個まで・Claude Code は有料プランが必要です
          </li>
          <li>
            サーバ側にはレート制限があります（IP あたり 60 回/分・生成系はより厳しめ）。
            オープンデータの読み取り専用で、書き込みツールはありません
          </li>
        </ul>
      </Section>

      <footer className="space-y-2 border-t border-slate-200 pt-6 text-xs text-slate-500">
        <p>
          数値は公的統計の二次加工です。出典・ライセンスは地図アプリ内の「このアプリ・データ出典」を、
          災害情報の限界（想定であり現況ではない・「安全」を保証しない）は各ツール応答の limitations
          をご確認ください。実際の避難は市町村の避難情報に従ってください。
        </p>
        <p>
          <Link href="/" className="text-indigo-600 underline underline-offset-2">
            地図アプリを開く
          </Link>
          {' ・ '}
          <a
            href="https://github.com/kusui26/AI-Database-Map"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline underline-offset-2"
          >
            GitHub
          </a>
        </p>
      </footer>
    </main>
  )
}
