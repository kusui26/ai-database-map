/**
 * src/components/chat/answerHistory：**1 回の回答で積む履歴は 1 つ**（2026-10-02）。
 *
 * 回答は URL を何度も書く（焦点のタブ・駅の選択・半径・ハザード・キャンバスの図）。サーバはツールが
 * 成功するたびに図と操作を送り直すので、書くたびに積むと 1 回の回答で履歴が 2〜3 個積まれ、
 * 「戻る」を押しても何も変わらないことが起きる（`docs/261001_fix_user_feedback_ui.md` §5.4）。
 */

import { describe, expect, it } from 'vitest'
import { type MapAction, type MapResponse } from '@/shared/protocol'
import { createAnswerHistory } from '@/components/chat/answerHistory'
import { writesUrl } from '@/components/chat/useApplyMapActions'

describe('createAnswerHistory（回答ごとの履歴の約束）', () => {
  it('最初に URL を書くときだけ push、2 回目からは replace', () => {
    const history = createAnswerHistory()
    expect(history.take()).toBe('push')
    expect(history.take()).toBe('replace')
    expect(history.take()).toBe('replace')
  })

  it('質問を送るたびに、次の回答の最初を push に戻す', () => {
    const history = createAnswerHistory()
    history.take()
    history.reset()
    expect(history.take()).toBe('push')
  })

  it('回答の途中で戻る／進むを押されたら、その回答はもう書かない', () => {
    const history = createAnswerHistory()
    expect(history.take()).toBe('push')
    history.suspend()
    expect(history.isActive()).toBe(false)
    expect(history.take()).toBeNull()
  })

  it('まだ何も書いていない回答でも、止めたら書かない（戻った先の履歴を上書きしない）', () => {
    const history = createAnswerHistory()
    history.suspend()
    expect(history.take()).toBeNull()
  })

  it('次の質問を送れば、止めた状態から戻る', () => {
    const history = createAnswerHistory()
    history.suspend()
    history.reset()
    expect(history.isActive()).toBe(true)
    expect(history.take()).toBe('push')
  })

  it('約束は回答の入れ物ごとに独立している', () => {
    const first = createAnswerHistory()
    const second = createAnswerHistory()
    first.take()
    expect(second.take()).toBe('push')
  })
})

function response(actions: MapAction[]): MapResponse {
  return { messages: [], mapActions: actions, panels: [] }
}

const SELECT_TOKYO: MapAction = { type: 'selectStation', grp: '東京#0', radiusM: 1000 }
const MAP_ONLY: MapAction[] = [
  { type: 'highlightStations', grps: ['東京#0'] },
  { type: 'flyTo', lon: 139.7, lat: 35.6, zoom: 12 },
  { type: 'showPoint', lon: 139.7, lat: 35.6, labelJa: '亀有駅' },
  { type: 'highlightPoints', points: [{ lon: 139.8, lat: 35.7, labelJa: '避難場所' }] },
]

describe('writesUrl（この応答が URL を書くか）', () => {
  it('駅の選択・ハザードのレイヤ・リセットは URL を書く', () => {
    const hazard: MapAction = { type: 'setHazardLayers', layers: ['flood_l2_depth'] }
    const clear: MapAction = { type: 'clearOverlays' }
    expect(writesUrl(response([SELECT_TOKYO]))).toBe(true)
    expect(writesUrl(response([hazard]))).toBe(true)
    expect(writesUrl(response([clear]))).toBe(true)
  })

  it('ハイライト・地図の移動・地点の印だけなら URL を書かない（履歴の 1 回分を使わない）', () => {
    expect(writesUrl(response(MAP_ONLY))).toBe(false)
  })

  it('地図だけの操作に駅の選択が 1 つ混ざれば書く（並びの位置によらない）', () => {
    expect(writesUrl(response([...MAP_ONLY, SELECT_TOKYO]))).toBe(true)
    expect(writesUrl(response([SELECT_TOKYO, ...MAP_ONLY]))).toBe(true)
  })

  it('操作が無ければ書かない', () => {
    expect(writesUrl(response([]))).toBe(false)
  })
})
