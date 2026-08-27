import { describe, expect, it } from 'vitest'
import {
  ALERT_LIMITATION_JA,
  alertHeadlineJa,
  alertReasonsJa,
  hazardLevelOfAlert,
  heaviestAlertLevel,
  toAlertWarning,
  alertLevelOfFloodName,
  type AlertWarning,
} from '@/domain/hazard/level'
import {
  alertLevelOfLocalCode,
  JMA_WARNING_KINDS,
  jmaAreaTable,
  jmaMunicipality,
  jmaWarningKind,
} from '@/shared/jma'
import { ALERT_LEVELS, ALERT_LEVEL_LABELS_JA } from '@/shared/constants'
import { hazardAlertCardPanel, reportedAtJa } from '@/domain/hazard/panels'
import { hazardAlertsResponseSchema } from '@/shared/api'
import { panelSchema } from '@/shared/protocol'

/**
 * 「いま、警戒レベル◯相当か」の判定（Phase 3・`docs/260824_flood.md` §3.3(d)・§8.4）。
 *
 * ここで固定するのは**言い方の規律**である。
 * - 出せるのは「◯◯**相当**」まで。**「避難指示が出ています」とは絶対に書かない**（市町村が出すもの）
 * - 発表が無くても**「安全」とは言わない**
 * - **判定に含まれていないもの**（土砂災害警戒情報・指定河川洪水予報）を必ず添える
 */

function warning(overrides: Partial<AlertWarning> = {}): AlertWarning {
  return {
    code: '03',
    nameJa: '大雨警報',
    kindJa: '警報',
    alertLevel: 3,
    areaJa: '葛飾区',
    statusJa: '発表',
    detailJa: null,
    ...overrides,
  }
}

describe('level: 発表中のものだけを数える', () => {
  it('解除・「発表警報・注意報はなし」は数えない', () => {
    expect(toAlertWarning({ code: '03', status: '解除' }, '葛飾区')).toBeNull()
    expect(toAlertWarning({ status: '発表警報・注意報はなし' }, '葛飾区')).toBeNull()
    expect(toAlertWarning({}, '葛飾区')).toBeNull()
  })

  it('発表・継続は数える', () => {
    expect(toAlertWarning({ code: '03', status: '発表' }, '葛飾区')?.nameJa).toBe('大雨警報')
    expect(toAlertWarning({ code: '03', status: '継続' }, '葛飾区')?.statusJa).toBe('継続')
  })

  /** 表に無いコードを黙って落とすと、**発表されている警報が画面から消える**。 */
  it('未知のコードも捨てずに「未知の発表」として残す', () => {
    const unknown = toAlertWarning({ code: '99', status: '発表' }, '葛飾区')
    expect(unknown?.nameJa).toBe('未知の発表（コード 99）')
    expect(unknown?.kindJa).toBeNull()
    expect(unknown?.alertLevel).toBe(0)
  })
})

describe('level: §3.3(d) の表と 1 対 1', () => {
  const expected: readonly (readonly [string, number])[] = [
    ['33', 5], // 大雨特別警報
    ['38', 4], // 高潮特別警報
    ['08', 4], // 高潮警報
    ['03', 3], // 大雨警報
    ['04', 3], // 洪水警報
    ['10', 2], // 大雨注意報
    ['18', 2], // 洪水注意報
    ['19', 2], // 高潮注意報
  ]

  for (const [code, level] of expected) {
    it(`${jmaWarningKind(code)?.nameJa} は 警戒レベル${level}相当`, () => {
      expect(jmaWarningKind(code)?.alertLevel).toBe(level)
    })
  }

  /** 暴風・波浪・雷などは危険だが、**水害・土砂災害の警戒レベルとは別の物差し**。 */
  it('警戒レベルの体系外は 0（軽いという意味ではない）', () => {
    for (const code of ['05', '07', '14', '15', '20', '32', '35']) {
      expect(jmaWarningKind(code)?.alertLevel, code).toBe(0)
    }
  })

  it('最も重いものを採る', () => {
    expect(heaviestAlertLevel([])).toBe(0)
    expect(heaviestAlertLevel([warning({ alertLevel: 2 }), warning({ alertLevel: 4 })])).toBe(4)
  })

  it('警戒レベル相当 → 色の語彙', () => {
    expect(hazardLevelOfAlert(0)).toBe('none')
    expect(hazardLevelOfAlert(3)).toBe('warning')
    expect(hazardLevelOfAlert(4)).toBe('danger')
    expect(hazardLevelOfAlert(5)).toBe('critical')
  })

  it('表の alertLevel はすべて有効なレベル', () => {
    for (const [code, definition] of Object.entries(JMA_WARNING_KINDS)) {
      expect(ALERT_LEVELS, code).toContain(definition.alertLevel)
    }
  })
})

describe('level: 言い方の規律（§7.4・§7.5）', () => {
  it('必ず「相当」を付ける', () => {
    const headline = alertHeadlineJa('葛飾区', [warning({ alertLevel: 4, nameJa: '高潮警報' })])
    expect(headline).toContain('警戒レベル4相当')
    expect(headline).toContain('高潮警報')
  })

  it('「避難指示」とは決して書かない（それは市町村が出すもの）', () => {
    for (const level of ALERT_LEVELS) {
      const headline = alertHeadlineJa(
        '葛飾区',
        level === 0 ? [] : [warning({ alertLevel: level })],
      )
      expect(headline, String(level)).not.toContain('避難指示')
      expect(headline, String(level)).not.toContain('避難してください')
    }
  })

  it('発表が無くても「安全」とは言わない', () => {
    const headline = alertHeadlineJa('葛飾区', [])
    expect(headline).toBe('葛飾区に、いま発表されている警報・注意報はありません。')
    expect(headline).not.toContain('安全')
  })

  it('警戒レベルの体系外だけのときは、そう明示する', () => {
    const headline = alertHeadlineJa('札幌市', [
      warning({ code: '14', nameJa: '雷注意報', kindJa: '注意報', alertLevel: 0 }),
    ])
    expect(headline).toContain('雷注意報')
    expect(headline).toContain('警戒レベルに対応する発表はありません')
  })

  it('同じレベルなら 特別警報 → 警報 → 注意報 の順で代表を選ぶ', () => {
    const headline = alertHeadlineJa('葛飾区', [
      warning({ code: '08', nameJa: '高潮警報', kindJa: '警報', alertLevel: 4 }),
      warning({ code: '38', nameJa: '高潮特別警報', kindJa: '特別警報', alertLevel: 4 }),
    ])
    expect(headline).toContain('高潮特別警報')
  })

  it('根拠は重い順に、区域名つきで並ぶ', () => {
    const reasons = alertReasonsJa([
      warning({ code: '14', nameJa: '雷注意報', alertLevel: 0, areaJa: '横浜市' }),
      warning({ code: '03', nameJa: '大雨警報', alertLevel: 3, areaJa: '横浜市' }),
    ])
    expect(reasons[0]).toBe('横浜市：大雨警報（警戒レベル3相当・発表）')
    expect(reasons[1]).toBe('横浜市：雷注意報（発表）')
  })

  it('分からないこと（市町村の避難情報）を明示する文がある', () => {
    expect(ALERT_LIMITATION_JA).toContain('避難情報')
    expect(ALERT_LIMITATION_JA).toContain('市町村')
  })

  /** 「危険度」は発表される“もの”ではなく状態。日本語として通る言い方に変える。 */
  it('危険度は「◯◯が警戒レベル4相当です」と言う', () => {
    const headline = alertHeadlineJa('小矢部市', [
      warning({ code: '49', nameJa: '土砂災害の危険度', kindJa: null, alertLevel: 4 }),
    ])
    expect(headline).toBe('小矢部市は土砂災害の危険度が警戒レベル4相当です。')
  })

  /** 名指しの河川がいちばん具体的なので、同じレベルなら河川を見出しにする。 */
  it('指定河川洪水予報が同じか重ければ、河川を見出しにする', () => {
    const headline = alertHeadlineJa(
      '小矢部市',
      [warning({ alertLevel: 3 })],
      [
        {
          riverNameJa: '小矢部川',
          nameJa: 'レベル４氾濫危険情報',
          alertLevel: 4,
          reportedAt: null,
        },
      ],
    )
    expect(headline).toBe('小矢部川にレベル４氾濫危険情報（警戒レベル4相当）が発表されています。')
  })

  it('ラベルはすべて「相当」（0 を除く）', () => {
    for (const level of ALERT_LEVELS) {
      if (level === 0) continue
      expect(ALERT_LEVEL_LABELS_JA[level]).toContain('相当')
    }
  })
})

describe('jma: 市区町村 → 発表区域の対応表', () => {
  it('普通の市区町村は 1 対 1', () => {
    expect(jmaMunicipality('13122')?.areas.map((area) => area.code)).toEqual(['1312200'])
    expect(jmaMunicipality('13122')?.nameJa).toBe('葛飾区')
  })

  /** 政令市の区コードは発表区域に前方一致しない。**市へ畳んでから引く**（§8.4）。 */
  it('政令市の区は市へ畳まれる', () => {
    expect(jmaMunicipality('14101')?.areas.map((area) => area.nameJa)).toEqual(['横浜市'])
    expect(jmaMunicipality('27127')?.areas.map((area) => area.nameJa)).toEqual(['大阪市'])
    expect(jmaMunicipality('23106')?.areas.map((area) => area.nameJa)).toEqual(['名古屋市'])
  })

  /** 区ごとに発表される政令市（神戸市・広島市）は、市で聞かれたら区を全部束ねる。 */
  it('区ごとに発表される市は、区の全部を束ねる', () => {
    const kobe = jmaMunicipality('28100')
    expect((kobe?.areas.length ?? 0) > 5).toBe(true)
    expect(kobe?.areas[0]?.nameJa).toContain('神戸市')
  })

  it('北方領土は収録しない（気象庁が発表しないため）', () => {
    expect(jmaMunicipality('01695')).toBeUndefined()
  })

  it('全国ぶんが入っている', () => {
    expect(jmaAreaTable.municipalityCount).toBeGreaterThan(1900)
    expect(Object.keys(jmaAreaTable.municipalities).length).toBe(jmaAreaTable.municipalityCount)
  })
})

describe('panels: いまの警戒状況 → hazardCard', () => {
  function alerts(warnings: readonly AlertWarning[], reportedAt: string | null = null) {
    return hazardAlertsResponseSchema.parse({
      point: { lon: 139.847, lat: 35.7645, placeJa: '亀有駅' },
      area: {
        municipalityCode: '13122',
        municipalityJa: '葛飾区',
        prefectureJa: '東京都',
        areas: [{ code: '1312200', nameJa: '葛飾区' }],
      },
      alertLevel: heaviestAlertLevel(warnings),
      level: hazardLevelOfAlert(heaviestAlertLevel(warnings)),
      headlineJa: alertHeadlineJa('葛飾区', warnings),
      warnings: [...warnings],
      floodForecasts: [],
      reasonsJa: [...alertReasonsJa(warnings)],
      reportedAt,
      limitationsJa: [ALERT_LIMITATION_JA],
      sources: [{ labelJa: '出典：気象庁', url: null, license: '公共データ利用規約' }],
      notesJa: [],
      disclaimerJa: '実際の避難は市町村の情報に従ってください。',
    })
  }

  it('プロトコルの Panel としてそのまま通る', () => {
    const panel = hazardAlertCardPanel(alerts([warning({ alertLevel: 3 })]), 'compact')
    expect(() => panelSchema.parse(panel)).not.toThrow()
    expect(panel.items[0]?.source).toBe('jma')
    expect(panel.items[0]?.valueJa).toContain('警戒レベル3相当')
  })

  /** 避難の要否を出すのは市町村。**アラートのカードでは必ず判定しない**（§7.4）。 */
  it('evacuation は必ず null', () => {
    for (const level of ALERT_LEVELS) {
      const panel = hazardAlertCardPanel(
        alerts(level === 0 ? [] : [warning({ alertLevel: level })]),
      )
      expect(panel.evacuation, String(level)).toBeNull()
    }
  })

  it('発表時刻と限界を注記に必ず入れる（10 分前を「今」と言わない）', () => {
    const panel = hazardAlertCardPanel(alerts([], '2026-05-28T10:16:00+09:00'))
    expect(panel.coverageNotesJa[0]).toContain('気象庁の発表時刻')
    expect(panel.coverageNotesJa.some((note) => note.includes('避難情報'))).toBe(true)
  })

  it('同じ種別が複数区域で出ても行のキーが衝突しない', () => {
    const panel = hazardAlertCardPanel(
      alerts([warning({ areaJa: '横浜市北部' }), warning({ areaJa: '横浜市南部' })]),
    )
    expect(new Set(panel.items.map((item) => item.layerKey)).size).toBe(2)
  })

  it('壊れた発表時刻は落ちずに省かれる', () => {
    expect(reportedAtJa(null)).toBeNull()
    expect(reportedAtJa('こわれた日時')).toBeNull()
  })
})

describe('level: 危険度から警戒レベル相当を読む（r8 の properties）', () => {
  /**
   * 実測（2026-08-27）：レベルを運ぶ危険度の local は **`X1`**（21/31/41/51）で、
   * 雷・風・波・濃霧・乾燥の危険度は**すべて `20`**。だから `X1` かどうかで見分ける。
   */
  it('local が X1 のものだけがレベルを持つ', () => {
    for (const [local, level] of [
      ['21', 2],
      ['31', 3],
      ['41', 4],
      ['51', 5],
    ] as const) {
      expect(alertLevelOfLocalCode(local), local).toBe(level)
    }
    // 雷危険度などは 20。レベル 2 に化けさせない。
    expect(alertLevelOfLocalCode('20')).toBeNull()
    expect(alertLevelOfLocalCode(undefined)).toBeNull()
    expect(alertLevelOfLocalCode('61')).toBeNull()
  })

  it('危険度からレベルを拾い、名前も危険度から作る（表に無いコードでも拾える）', () => {
    const landslide = toAlertWarning(
      {
        code: '49',
        status: '継続',
        properties: [
          {
            type: '土砂災害危険度',
            significancyPart: { locals: [{ code: '41' }] },
            criteriaPeriod: {
              locals: [{ sentence: '２７日８時から１３時まで、警戒レベル４相当' }],
            },
          },
        ],
      },
      '小矢部市',
    )
    expect(landslide?.alertLevel).toBe(4)
    expect(landslide?.nameJa).toBe('土砂災害の危険度')
    expect(landslide?.detailJa).toContain('警戒レベル４相当')
  })

  it('種別コードと危険度の重い方を採る', () => {
    // 大雨警報（表では 3 相当）に、浸水害の危険度 4 相当が付いている場合。
    const heavy = toAlertWarning(
      {
        code: '03',
        status: '発表',
        properties: [{ type: '大雨浸水危険度', significancyPart: { locals: [{ code: '41' }] } }],
      },
      '小矢部市',
    )
    expect(heavy?.nameJa).toBe('大雨警報') // 名前は表が優先
    expect(heavy?.alertLevel).toBe(4) // レベルは重い方
  })

  it('雷注意報の危険度（local 20）はレベル 0 のまま', () => {
    const thunder = toAlertWarning(
      {
        code: '14',
        status: '発表',
        properties: [{ type: '雷危険度', significancyPart: { locals: [{ code: '20' }] } }],
      },
      '小矢部市',
    )
    expect(thunder?.alertLevel).toBe(0)
    expect(thunder?.nameJa).toBe('雷注意報')
  })

  it('指定河川洪水予報のレベルは名前から読む（全角も半角も）', () => {
    expect(alertLevelOfFloodName('レベル３氾濫警報')).toBe(3)
    expect(alertLevelOfFloodName('レベル４氾濫危険情報')).toBe(4)
    expect(alertLevelOfFloodName('レベル5氾濫発生情報')).toBe(5)
    expect(alertLevelOfFloodName('氾濫注意情報')).toBe(0)
  })
})
