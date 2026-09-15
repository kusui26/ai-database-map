/**
 * ドメイン：**候補駅を集める**（`app/api ──→ domain ──→ db` の結線・architecture.md §3.3）。
 *
 * このファイルだけが非純粋（DB を読む）。スコアリング（`index.ts`）は純関数のままにしてある——
 * 分けておくと、順位の検査に DB が要らない。
 *
 * ## 3 回の往復で足りる
 *
 * 1. `listStations`：対象集合（市区町村の前方一致・路線・bbox…）。**まとめて 1 回**
 * 2. `datasetRows`：駅 × 列（指標＋信頼性フラグ）を 1 回で
 * 3. `stationHazardSummaries`：事前計算の災害サマリ（500 駅ずつ・内部で分割）
 *
 * 駅ごとにループして問い合わせない。`get_station_detail` を駅数ぶん繰り返さない、という
 * スキル側の作法と同じ理由——往復の回数がそのまま待ち時間になる。
 *
 * ## 取れなかったものを 0 で埋めない
 *
 * `datasetRows` は**値が無い列をキーごと返さない**。ここでもそのまま渡す（`CandidateStation.values`
 * にキーが無い＝欠損）。0 で埋めると「値が 0」と区別が付かなくなり、スコアが静かに歪む。
 * 災害サマリが取れない駅は `hazard: null`＝**不明**（安全ではない）。
 */

import { datasetRows, listStations, stationHazardSummaries } from '@/db/queries'
import type { ListStationsFilter } from '@/db/queries'
import type { StationListItem } from '@/shared/api'
import type { StationHazardSummary } from '@/shared/hazard-summary'
import { columnsFor } from './metrics'
import type { CandidateStation, ScoredMetric } from './types'

export type GatherOptions = {
  /** 災害サマリも引くか（足切り／段階減点を使うときだけ true）。 */
  readonly includeHazard: boolean
  /**
   * 候補集合の上限。**超えたら切り詰めずに引き返す**（`overLimit`）——
   * `list_stations` は乗降客数の降順なので、黙って頭を切ると「上位 N 駅の中での順位」という
   * 言っていない判断が混ざる。上限判定のために 1 件だけ多く引く。
   *
   * ⚠ `maxStations + 1` が **1,000 を超えないこと**（PostgREST の行上限。`listStations` 参照）。
   */
  readonly maxStations: number
}

export type GatheredCandidates = {
  readonly candidates: readonly CandidateStation[]
  /** 駅の素性（座標・ラベル・市区町村）。表と地図はここから描く。 */
  readonly stations: readonly StationListItem[]
  /** 対象集合の件数（欠損で落ちる前の数）。`overLimit` のときは上限 +1 で打ち切った数。 */
  readonly stationCount: number
  /** 値を引いた列（指標＋フラグ）。 */
  readonly columns: readonly string[]
  /** 上限を超えたので何も計算していない。 */
  readonly overLimit: boolean
}

/** grp → 災害サマリ。引かないときは空。 */
async function hazardByGrp(
  grps: readonly string[],
  includeHazard: boolean,
): Promise<ReadonlyMap<string, StationHazardSummary>> {
  if (!includeHazard || grps.length === 0) return new Map()
  const rows = await stationHazardSummaries(grps)
  return new Map(rows.map((row) => [row.grp, row.summary]))
}

/** 駅 1 件 → 候補。値が無い列はキーごと無いまま、災害サマリが無ければ `null`（＝不明）。 */
function toCandidate(
  station: StationListItem,
  values: Readonly<Record<string, Record<string, number>>>,
  hazards: ReadonlyMap<string, StationHazardSummary>,
): CandidateStation {
  return {
    grp: station.grp,
    name: station.stationName,
    values: values[station.grp] ?? {},
    hazard: hazards.get(station.grp) ?? null,
  }
}

/**
 * 対象集合を作り、指標の値と災害サマリを付けて候補駅を返す。
 * 値が無い列はキーごと落とす（欠損のまま渡す）。上限を超えたら**重いクエリを投げずに**引き返す。
 */
export async function gatherCandidates(
  filter: ListStationsFilter,
  metrics: readonly ScoredMetric[],
  options: GatherOptions,
): Promise<GatheredCandidates> {
  const stations = await listStations({ ...filter, limit: options.maxStations + 1 })
  const columns = columnsFor(metrics)
  const base = { stationCount: stations.length, columns }
  if (stations.length > options.maxStations) {
    return { ...base, candidates: [], stations: [], overLimit: true }
  }
  const grps = stations.map((station) => station.grp)
  const [values, hazards] = await Promise.all([
    datasetRows(grps, columns),
    hazardByGrp(grps, options.includeHazard),
  ])
  const candidates = stations.map((station) => toCandidate(station, values, hazards))
  return { ...base, candidates, stations, overLimit: false }
}
