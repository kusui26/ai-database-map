/**
 * 路線（運行系統）と、都道府県・運営会社の連動（純関数・2026-10-08 L4）。
 *
 * 都道府県⇄会社（`operatorLink.ts`）・会社⇄法令上の路線（`routeLink.ts`）と同じ考え方：
 * **選べない組合せは最初から出さない**。都道府県を選べばその都道府県に駅のある路線だけ、会社を選べば
 * その会社の路線だけが選べる。逆に路線を選べば、都道府県・会社の候補もその路線に合うものだけになる。
 *
 * 路線の会社は `/api/lines` の `operator`（S12 の会社名＝会社の条件と同じ語彙）。どの路線にも、その会社の
 * 駅が 1 つ以上ある（2026-10-08 に全 599 路線で確かめた）ので、この連動で 0 件の組合せは出ない。
 * 他社の駅を通る路線（北陸新幹線の上越妙高より西は JR西日本の駅）は、他社と組み合わせても駅があるが
 * 候補には出さない——狭いほうに倒しても、会社を外せば選べる。
 */

import { type Line } from '@/shared/api'

/** 連動に要る路線の列。 */
export type LinkLine = Pick<Line, 'lineCd' | 'operator' | 'prefectures'>

/** 選んだ都道府県のどれかに駅のある路線（都道府県を選んでいなければ `undefined`＝絞らない）。 */
export function linesInPrefectures(
  prefectures: readonly string[],
  lines: readonly LinkLine[],
): number[] | undefined {
  if (prefectures.length === 0) return undefined
  const wanted = new Set(prefectures)
  return lines
    .filter((line) => line.prefectures.some((prefecture) => wanted.has(prefecture)))
    .map((line) => line.lineCd)
}

/** 選んだ会社の路線（会社を選んでいなければ `undefined`）。会社の無い路線（神戸高速）は選べなくなる。 */
export function linesOfOperators(
  operators: readonly string[],
  lines: readonly LinkLine[],
): number[] | undefined {
  if (operators.length === 0) return undefined
  const wanted = new Set(operators)
  return lines
    .filter((line) => line.operator !== null && wanted.has(line.operator))
    .map((line) => line.lineCd)
}

/** 選んだ路線のうち、一覧で引けるもの（一覧の読み込み前は空）。 */
function chosenLines(selected: readonly number[], lines: readonly LinkLine[]): LinkLine[] {
  const wanted = new Set(selected)
  return lines.filter((line) => wanted.has(line.lineCd))
}

/**
 * 選んだ路線の駅のある都道府県（路線を選んでいない・一覧がまだ無いときは `undefined`）。
 * 一覧の読み込み前に絞ると、全都道府県が選べなくなって見えるため。
 */
export function prefecturesOfLines(
  selected: readonly number[],
  lines: readonly LinkLine[],
): string[] | undefined {
  const chosen = chosenLines(selected, lines)
  if (chosen.length === 0) return undefined
  return [...new Set(chosen.flatMap((line) => line.prefectures))]
}

/**
 * 選んだ路線の会社（絞れないときは `undefined`）。会社の無い路線（神戸高速＝線路の持ち主。駅は阪急・阪神・
 * 神戸電鉄）を選んでいるときも絞らない——どの会社の駅を通るかが一覧からは分からないので。
 */
export function operatorsOfLines(
  selected: readonly number[],
  lines: readonly LinkLine[],
): string[] | undefined {
  const chosen = chosenLines(selected, lines)
  if (chosen.length === 0 || chosen.some((line) => line.operator === null)) return undefined
  return [...new Set(chosen.flatMap((line) => (line.operator === null ? [] : [line.operator])))]
}
