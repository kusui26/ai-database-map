#!/usr/bin/env node
// 母艦（MulmoTerminal / MulmoClaude）の**プレゼンタだけ**を模した stdio MCP サーバ。
//
// 受け入れテスト（`pipeline/eval_recommend.py --scenario canvas`）で使う。母艦そのものは
// ヘッドレスで動かせないが、Canvas の作法——フォームで要件を聞く／サーバが作った option を
// そのまま渡す／地図を保存して開く／結論を文書にする——が守られているかは、
// **同じ名前・同じ引数のツールを置けば実走で測れる**。
//
// 何も描かない（受け取った引数は claude 側の stream-json に残るので、採点はそこから行う）。
// 依存ゼロ・JSON-RPC を手書きする（ビルドを挟まずどこでも動く）。
//
// **スキーマは実機の定義を写したもの**（2026-09-14 に npm から取得して逐語確認）：
//   @mulmoclaude/chart-plugin@3.0.1    dist/core/definition → presentChart
//   @mulmoclaude/form-plugin@2.0.0     dist/core/definition → presentForm
//   @mulmoclaude/html-plugin@4.0.1     dist/core/definition → presentHtml
//   @mulmoclaude/markdown-plugin@4.1.1 dist/plugins/markdown/definition → presentDocument
// `required` を緩めると、母艦で弾かれる呼び方（例：title の無い presentDocument）を
// 受け入れテストが見逃す。実機が変わったら**ここを合わせてから**スキルを直す。

import { createInterface } from 'node:readline'

const TOOLS = [
  {
    name: 'presentForm',
    description:
      'Create a structured form to collect information from the user. Supports various field types including text input, textarea, multiple choice (radio), dropdown menus, checkboxes, date/time pickers, and number inputs. Each field can have validation rules and help text.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Optional title for the form (e.g., 'User Registration')" },
        description: { type: 'string', description: 'Optional description explaining the purpose of the form' },
        fields: {
          type: 'array',
          description: 'Array of form fields with various types and configurations',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  "Unique identifier for the field (e.g., 'email', 'birthdate'). This will be the key in the JSON response. Use descriptive camelCase or snake_case names.",
              },
              type: {
                type: 'string',
                enum: ['text', 'textarea', 'radio', 'dropdown', 'checkbox', 'date', 'time', 'number'],
                description:
                  "Field type: 'text' for short text, 'textarea' for long text, 'radio' for 2-6 choices, 'dropdown' for many choices, 'checkbox' for multiple selections, 'date' for date picker, 'time' for time picker, 'number' for numeric input",
              },
              label: { type: 'string', description: 'Field label shown to the user' },
              description: { type: 'string', description: 'Optional help text explaining the field' },
              required: { type: 'boolean', description: 'Whether the field is required (default: false)' },
              choices: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Array of choices for radio/dropdown/checkbox fields. Radio should have 2-6 choices, dropdown for 7+ choices.',
              },
            },
            required: ['id', 'type', 'label'],
          },
        },
      },
      required: ['fields'],
    },
    ack: (args) =>
      `フォームを表示しました（${(args?.fields ?? []).length} 項目）。ユーザーが記入して送信するまで待ってください。回答は次のメッセージに JSON で届きます。`,
  },
  {
    name: 'presentChart',
    description:
      "Save and present one or more Apache ECharts visualizations as a single document. Use this for line, bar, area, scatter, pie, candlestick, heatmap, sankey, or graph/network charts — anything ECharts supports. Pass ECharts option object(s) directly; the plugin calls setOption on each one. Use `charts: []` array form even for a single chart so multi-chart dashboards share the same slug.",
    inputSchema: {
      type: 'object',
      properties: {
        document: {
          type: 'object',
          description:
            'Chart document. Contains an optional title and an array of chart entries. Each entry has its own ECharts option object that the UI renders independently.',
          properties: {
            title: {
              type: 'string',
              description:
                'Optional human-friendly title for the whole document. Used to derive the file slug and as the preview label.',
            },
            charts: {
              type: 'array',
              description: "List of charts to render, in order. Each charts[i].option is passed as-is to ECharts' setOption().",
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Optional short label for this specific chart (shown above it in the UI).' },
                  type: {
                    type: 'string',
                    description:
                      "Informational tag shown in the UI (e.g. 'line', 'bar', 'candlestick', 'sankey'). The actual chart type is determined by option.series[].type.",
                  },
                  option: {
                    type: 'object',
                    description:
                      'Full ECharts option object. Include all series, axes, tooltip, legend, dataset — anything ECharts accepts. Keep data inline; large datasets are fine.',
                  },
                },
                required: ['option'],
              },
            },
          },
          required: ['charts'],
        },
        title: {
          type: 'string',
          description: "Short label shown in the canvas preview sidebar. Defaults to document.title, or 'Chart' when both are blank.",
        },
      },
      required: ['document'],
    },
    ack: (args) =>
      `チャートを表示しました（${(args?.document?.charts ?? []).length} 枚）。図は作成済みなので、本文では結論と注意を述べてください。`,
  },
  {
    name: 'presentHtml',
    description:
      'Present a complete, self-contained HTML page in the canvas — either new HTML (saved) or an existing page on disk (by path). Provide EITHER `html` OR `path`, not both. `path` presents a page that already exists without re-saving a copy. Do NOT read a page and re-send its markup as `html`, which would fork it into a copy.',
    inputSchema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'Complete, self-contained HTML document to save and present. Provide this OR `path`.',
        },
        path: {
          type: 'string',
          description:
            "Path to an existing HTML file to present without re-saving — workspace-relative (`docs/report.html`, `artifacts/html/map.html`) or absolute. The user's edits in the view overwrite this file. Provide this OR `html`.",
        },
        title: { type: 'string', description: 'Short label shown in the preview sidebar.' },
      },
      required: [],
    },
    ack: (args) =>
      `HTML を表示しました（${args?.path ? `path=${args.path}` : 'html'}）。ページの凡例・出典・注意は本文でも述べてください。`,
  },
  {
    name: 'presentDocument',
    description:
      'Display a document in markdown format — either new markdown (saved) or an existing saved document (by path). Provide EITHER `markdown` + `filenamePrefix` (new content) OR `path` (an existing markdown file), not both.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title for the document' },
        markdown: {
          type: 'string',
          description: 'The markdown content to display. Provide this (with `filenamePrefix`) OR `path`.',
        },
        // 本物は filenamePrefix が無いと 'document' に落ちて見つけられなくなる。
        filenamePrefix: {
          type: 'string',
          description:
            "Short English filename prefix (without extension). Always send it with `markdown` — it is what makes the saved file findable; omitting it falls back to 'document'. Ignored with `path`. Use lowercase with hyphens, e.g. 'project-summary'.",
        },
        path: {
          type: 'string',
          description:
            "Path to an existing `.md` file to present without re-saving — workspace-relative (`README.md`, `docs/design.md`) or absolute. Provide this OR `markdown`.",
        },
      },
      // 本物の必須は title（markdown ではない）。ここを緩めると実機で落ちる形を見逃す。
      required: ['title'],
    },
    ack: (args) => `文書を表示しました（${(args?.markdown ?? '').length} 文字）。`,
  },
]

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32602, message } })

createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let request
  try {
    request = JSON.parse(trimmed)
  } catch {
    return
  }
  const { id, method, params } = request
  // 通知（id なし）は黙って受ける。
  if (id === undefined || id === null) return

  if (method === 'initialize') {
    return reply(id, {
      // クライアントが名乗った版をそのまま返す（世代差で弾かれないように）。
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'canvas-stub', version: '1.0.0' },
    })
  }
  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
        annotations: { readOnlyHint: true },
      })),
    })
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((each) => each.name === params?.name)
    if (tool === undefined) return fail(id, `Tool ${params?.name} not found`)
    return reply(id, { content: [{ type: 'text', text: tool.ack(params?.arguments ?? {}) }] })
  }
  return fail(id, `Method ${method} not supported`)
})
