/**
 * 幼兒園的四個階段，id 就是班級順序。
 * 台灣的分班看「9 月 1 日那天滿幾歲」：滿 2 歲上幼幼班，滿 3 歲小班，4 歲中班，5 歲大班，6 歲上小學。
 */
export const STAGES = [
  { id: 0, name: '幼幼班', age: '2～3歲', emoji: '🍼' },
  { id: 1, name: '小班', age: '3～4歲', emoji: '🧸' },
  { id: 2, name: '中班', age: '4～5歲', emoji: '🎨' },
  { id: 3, name: '大班', age: '5～6歲', emoji: '🎒' },
] as const

export type StageId = (typeof STAGES)[number]['id']

const NAMES = '幼幼班|小班|中班|大班'
const RE_NAME = new RegExp(NAMES, 'g')
const RE_RANGE = new RegExp(`(${NAMES})\\s*[～~\\-到至]\\s*(${NAMES})`)

const idOf = (name: string): StageId => STAGES.find((s) => s.name === name)!.id

/**
 * 片單裡「階段:」後面寫的字 → 適合哪幾班；看不懂回 undefined。
 *   小班            → [1]
 *   幼幼班、小班    → [0, 1]（頓號、逗號、空白都可以）
 *   小班～大班      → [1, 2, 3]（～ ~ - 到 至 都可以）
 *   全部            → [0, 1, 2, 3]
 *   小班 3～4歲     → [1]（後面的年紀字會略過，所以分區名稱直接貼上也行）
 */
export function parseStages(text: string): StageId[] | undefined {
  const s = text.trim()
  if (/^全部$|^不分年齡$/.test(s)) return STAGES.map((x) => x.id)

  const range = s.match(RE_RANGE)
  if (range) {
    const [from, to] = [idOf(range[1]!), idOf(range[2]!)]
    if (from > to) return undefined
    return STAGES.map((x) => x.id).filter((id) => id >= from && id <= to)
  }

  const names = s.match(RE_NAME)
  if (!names) return undefined
  return [...new Set(names.map(idOf))].sort()
}

export interface StageResult {
  /** 這一學年的班級 */
  stage: StageId
  /** 9 月 1 日那天幾歲 */
  age: number
  /** 學年度（民國），例如 115 */
  schoolYear: number
  /** 比幼幼班還小、或已經超過大班：照最近的那一班算 */
  clamped: 'early' | 'late' | null
}

/**
 * 用出生年月推算現在是哪一班。
 * 學年從 8 月開始（8 月到隔年 7 月算同一學年），年齡看那一年的 9 月 1 日：
 * 出生月份 1～8 月，9 月 1 日那天已經過了生日；9～12 月出生的，還差一歲。
 */
export function stageOf(birthYear: number, birthMonth: number, now = new Date()): StageResult {
  const schoolStartYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1
  const age = schoolStartYear - birthYear - (birthMonth >= 9 ? 1 : 0)
  const raw = age - 2
  const stage = Math.min(3, Math.max(0, raw)) as StageId
  return {
    stage,
    age,
    schoolYear: schoolStartYear - 1911,
    clamped: raw < 0 ? 'early' : raw > 3 ? 'late' : null,
  }
}
