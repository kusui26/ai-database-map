/**
 * ビューアの中間表現（VNode）——**DOM を持たない**小さな木と、その HTML 直列化。
 *
 * `docs/260912_gui_chat_protocol.md` 決定 11：MCP Apps（iframe）は撤収するが、
 * パネルの描き方は **T1（地図レポート HTML をサーバで組む）と T2（GUI Chat Protocol の
 * ビューア・プラグイン）の共通部品**として残す。そのために、旧ビューア（文字列に埋めた JS）が
 * `document.createElement` で組み立てていた木を、**純粋なデータ**に置き換える。
 *
 * 設計判断：
 * - **DOM 非依存**：`Document` を引数にも取らない。サーバ（HTML 文字列）でもブラウザ
 *   （DOM への mount）でも同じ木を使えるようにし、テストは jsdom なしで木を検査する
 * - **XSS 安全は直列化側の責務**：本文・属性は必ずエスケープして書き出す（旧ビューアの
 *   「createElement / textContent しか使わない」という**作法**を、型と関数で強制する形に移した）
 * - **属性名は呼び出し側のコード由来**（利用者入力を属性名にしない）。値だけを検査する
 * - SVG も同じ木で表す。HTML への直列化は外来要素（`<svg>` 配下）でもそのまま妥当で、
 *   DOM へ mount する側だけが名前空間を切り替えればよい（`<svg>` から下は SVG 名前空間）
 */

/** 属性値。数値はそのまま文字列化する（座標・サイズを書きやすくするため）。 */
export type AttrValue = string | number

/**
 * 描画する木の 1 ノード。**省略可能なフィールドを持たない**——消費側（直列化・mount・
 * テスト）が毎回 undefined を分岐しなくて済むように、`el()` が既定値を埋める。
 */
export type VNode = {
  readonly tag: string
  /** `class` 属性（空白区切りで複数可）。無ければ null。 */
  readonly cls: string | null
  /** 直下のテキスト（子より前に置かれる）。無ければ null。 */
  readonly text: string | null
  readonly attrs: Readonly<Record<string, AttrValue>>
  /** インラインスタイル。キーは **CSS のプロパティ名**（`border-color` のようなケバブ）。 */
  readonly style: Readonly<Record<string, string>>
  readonly children: readonly VNode[]
}

/** `el()` の入力。`children` に null を混ぜてよい（条件つきの子を書きやすくするため）。 */
export type NodeProps = {
  readonly cls?: string
  readonly text?: string | number | null
  readonly attrs?: Readonly<Record<string, AttrValue>>
  readonly style?: Readonly<Record<string, string>>
  readonly children?: readonly (VNode | null)[]
}

/** ノードを 1 つ作る（既定値を埋め、null の子を落とす）。 */
export function el(tag: string, props: NodeProps = {}): VNode {
  const { cls, text, attrs, style, children } = props
  return {
    tag,
    cls: cls ?? null,
    text: text === undefined || text === null ? null : String(text),
    attrs: attrs ?? {},
    style: style ?? {},
    children: (children ?? []).filter((child): child is VNode => child !== null),
  }
}

/** 本文用のエスケープ（テキストノードに入る 3 文字）。 */
const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

/** 属性値用のエスケープ（引用符も閉じられないようにする）。 */
const ATTR_ESCAPES: Readonly<Record<string, string>> = {
  ...TEXT_ESCAPES,
  '"': '&quot;',
  "'": '&#39;',
}

const escapeWith = (table: Readonly<Record<string, string>>, value: string): string =>
  value.replace(/[&<>"']/g, (char) => table[char] ?? char)

/** テキストノードとして安全な形にする。 */
export const escapeText = (value: string): string => escapeWith(TEXT_ESCAPES, value)

/** 属性値として安全な形にする。 */
export const escapeAttr = (value: string): string => escapeWith(ATTR_ESCAPES, value)

/** インラインスタイルを `a: b; c: d` に畳む（空なら空文字＝属性を出さない）。 */
function styleAttr(style: Readonly<Record<string, string>>): string {
  return Object.entries(style)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
}

/**
 * 木を HTML 文字列にする（**サーバで組み立てる経路の出口**）。
 *
 * 空要素（`<br>` 等）は使わない前提で、常に開始タグ＋本文＋終了タグを書く。
 * `<svg>` 配下の `<line>` なども HTML の外来要素として妥当に解釈される。
 */
export function vnodeToHtml(node: VNode): string {
  const style = styleAttr(node.style)
  const attrs = [
    ...(node.cls === null ? [] : [`class="${escapeAttr(node.cls)}"`]),
    ...Object.entries(node.attrs).map(([name, value]) => `${name}="${escapeAttr(String(value))}"`),
    ...(style === '' ? [] : [`style="${escapeAttr(style)}"`]),
  ]
  const open = [node.tag, ...attrs].join(' ')
  const body = [
    ...(node.text === null ? [] : [escapeText(node.text)]),
    ...node.children.map(vnodeToHtml),
  ].join('')
  return `<${open}>${body}</${node.tag}>`
}

/** 木に現れる CSS クラス名をすべて集める（スタイル漏れ検査用・重複なし）。 */
export function classNamesOf(node: VNode): readonly string[] {
  const own = node.cls === null ? [] : node.cls.split(/\s+/).filter((name) => name !== '')
  return [...new Set([...own, ...node.children.flatMap(classNamesOf)])]
}
