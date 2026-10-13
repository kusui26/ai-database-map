/**
 * MCP に送られてきた**広告していない引数**を見つけ、黙って外さずに断る（純関数・2026-10-13・
 * `docs/261001_fix_user_feedback_ui.md` §6.18）。
 *
 * MCP の SDK は、広告した入力の型（Zod）で引数を検め、知らない引数を**黙って外して**から道具を呼ぶ。たとえば
 * `rank_stations` に `inMapView: true`（アプリのチャットだけの「このあたり」）が送られてくると、外れて**全国で**
 * 集計し、呼び手は地図の範囲で絞ったつもりのまま答える。そこで広告する型を「知らない引数も通す」（loose）形にし、
 * 道具を呼ぶ前にここで見つけて、その条件では集計せずに「知らない引数・その場所で使える引数」を返す。
 *
 * - 値が無い・null・false の引数は、何も頼んでいないので見逃す（`inMapView: false` など）
 * - 一番上の `present`（表示用・図を返せない道具にも送られることがある）は、答えを変えないので見逃す
 * - 入れ子（`get_area_summary` の `areas[0].inMapView`）は、広告する型の入れ子も loose のところだけ見える
 */

import { z } from 'zod'

/** 広告していない引数 1 つ（場所つきの名前と、その場所で使える引数）。 */
export type UnknownArg = { readonly arg: string; readonly usable: readonly string[] }

/** 答えを変えないので、知らなくても見逃す引数（一番上だけ）。 */
const IGNORED_TOP_LEVEL_ARGS: readonly string[] = ['present']

/** 知っている名前の断り方（呼び直し方を添える）。 */
const UNKNOWN_ARG_NOTES_JA: Readonly<Record<string, string>> = {
  inMapView:
    'inMapView（地図の表示範囲）はアプリのチャットだけの引数で、MCP の呼び出しには地図が無い。' +
    '範囲で絞るなら、道具にある bbox（[west, south, east, north]）か near（起点の駅から N m）を使う',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 何かを頼んでいる値か（値が無い・null・false は頼んでいない）。 */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false
}

/** 型の木の 1 つ（入れ子の shape・要素・包みの中身は core の型で返る）。 */
type SchemaNode = z.core.$ZodType

/** 任意・null 可・既定値の包みを外す。 */
function unwrap(schema: SchemaNode): SchemaNode {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrap(schema.unwrap())
  }
  return schema instanceof z.ZodDefault ? unwrap(schema.unwrap()) : schema
}

function childPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

/** オブジェクト 1 つの中の、広告していない引数（入れ子は下へたどる）。 */
function unknownInObject(
  schema: z.ZodObject,
  value: Record<string, unknown>,
  path: string,
): UnknownArg[] {
  const usable = Object.keys(schema.shape)
  return Object.entries(value).flatMap(([key, item]) => {
    const child = Object.hasOwn(schema.shape, key) ? schema.shape[key] : undefined
    const arg = childPath(path, key)
    if (child === undefined) return isSet(item) ? [{ arg, usable }] : []
    return unknownArgsOf(child, item, arg)
  })
}

/** 広告した型に無い引数を、場所つきで並べる（`areas[0].inMapView`）。型どおりなら空。 */
export function unknownArgsOf(schema: SchemaNode, value: unknown, path = ''): UnknownArg[] {
  const inner = unwrap(schema)
  if (inner instanceof z.ZodArray && Array.isArray(value)) {
    return value.flatMap((item, index) => unknownArgsOf(inner.element, item, `${path}[${index}]`))
  }
  if (inner instanceof z.ZodObject && isRecord(value)) return unknownInObject(inner, value, path)
  return []
}

/** 断る理由になる引数だけ（一番上の `present` は答えを変えないので除く）。 */
export function blockingUnknownArgs(unknown: readonly UnknownArg[]): UnknownArg[] {
  return unknown.filter((each) => !IGNORED_TOP_LEVEL_ARGS.includes(each.arg))
}

/** 場所つきの名前の、最後の名前（`areas[0].inMapView` → inMapView）。 */
function leafName(arg: string): string {
  return (
    arg
      .split('.')
      .at(-1)
      ?.replace(/\[\d+\]$/, '') ?? arg
  )
}

/** LLM に返す断り（どれも集計していない・呼び直し方つき）。 */
export function unknownArgsForLlm(unknown: readonly UnknownArg[]) {
  const names = unknown.map((each) => each.arg)
  return {
    error: `広告していない引数があります（${names.join('・')}）。黙って外すと条件の違う答えになるので、集計していません。`,
    hint: '引数の名前を確かめて呼び直してください。unknownArgs の usable が、その場所で使える引数です。',
    unknownArgs: unknown.map((each) => {
      const note = UNKNOWN_ARG_NOTES_JA[leafName(each.arg)]
      return { arg: each.arg, usable: each.usable, ...(note === undefined ? {} : { note }) }
    }),
  }
}
