/**
 * 導入ページ（PR-8・`docs/260828_research_claude_auth.md` §6）。
 *
 * ユーザー自身の Claude（Claude Code / Claude.ai / Cowork）や他の MCP クライアントから、
 * このアプリの共通 API（リモート MCP・12 ツール）を**本人のサブスクリプションで**使うための
 * 入口。コマンド・導入リンク・プラン別の注意（枠の消費）をここに集約する。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { CopyButton } from '@/components/CopyButton'

export const metadata: Metadata = {
  title: 'Claude で使う（MCP・プラグイン導入）',
  description:
    'AI Database Map をあなたの Claude（Claude Code / Claude.ai / Cowork）や MCP 対応クライアントから使うための導入ページ。駅×半径のオープンデータ 12 ツールと分析スキルを、コマンド 2 行で導入できます。',
}

const MCP_URL = 'https://ai-database-map.vercel.app/api/mcp'
const CONNECTOR_LINK = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent('AI Database Map')}&connectorUrl=${encodeURIComponent(MCP_URL)}`
const MARKETPLACE_ADD = '/plugin marketplace add kusui26/AI-Database-Map'
const PLUGIN_INSTALL = '/plugin install ai-database-map@ai-database-map'
const CODEX_ADD = 'codex plugin marketplace add kusui26/AI-Database-Map'

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
  { name: 'get_hazard_summary', desc: '全駅事前計算の災害サマリを最大 500 駅一括' },
  { name: 'get_station_detail / rank_stations / compare_growth', desc: '駅詳細・ランキング・散布' },
  { name: 'get_hazard_at_point / get_hazard_alerts', desc: '地点の想定リスク・いまの警報' },
  {
    name: 'find_evacuation_sites / find_escape_direction',
    desc: '指定緊急避難場所・区域外への向き',
  },
  { name: 'get_metrics_catalog', desc: '自己記述カタログ（806 列の正確なキー・単位・年次）' },
]

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
          AI Database Map は、全国 9,273 駅 ×
          半径のオープンデータ（乗降客数・人口・地価・売上・災害リスク…）を
          <span className="font-medium">リモート MCP サーバ（12 ツール）</span>
          として公開しています。あなた自身の Claude
          サブスクリプションから、住宅購入・輸送計画・出店の商圏分析といった
          <span className="font-medium">高度なデータ分析</span>
          ができます。API キーは不要・追加費用はかかりません（あなたの Claude の利用枠を使います）。
        </p>
      </header>

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

      <Section title="できること（12 ツール）">
        <ul className="space-y-1.5 text-sm">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="flex gap-2">
              <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
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
