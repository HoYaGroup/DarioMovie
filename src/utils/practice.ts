import type { Card } from './youtube'
import { initialOf, isCounting, isNumberCard, isZhCard, countOf, zhReading } from './cards'

/**
 * 「練習」：一個畫面一個題目，題型混著出，小朋友動手數、找、拿、描，不只是點對錯。
 * 靈感來自幼兒園的學習單（數數、找出所有的 b、圈出有 1 個的圖案、跟著線條畫一畫），
 * 全部由字卡本自己的內容算出來，不用在試算表多寫任何東西：
 *   數一數的字卡（emoji 加數字）  → count 數一數、groups 哪一堆有幾個、take 給我幾個
 *   數字卡、ABC 字母卡           → hunt 找出所有的 6（或 b），旁邊混著長得像的
 *   數字、字母、注音、國字         → trace 用手指描一描
 *
 * 容易搞混的先放進選項：6 和 9、b 和 d、p 和 q、31 和 13。
 */
export type PracticeKind = 'count' | 'groups' | 'take' | 'hunt' | 'trace'

/** 描的是數字、字母、還是注音／國字 */
export type GlyphKind = 'digit' | 'letter' | 'zh'

/** 數一數：畫出 n 個東西，從三個數字裡選有幾個 */
export interface CountQ { kind: 'count'; n: number; emoji: string; options: number[] }
/** 哪一堆有 n 個：三堆不同東西、不同數量，點出有 n 個的那一堆 */
export interface GroupsQ { kind: 'groups'; n: number; panels: { n: number; emoji: string }[]; answer: number }
/** 給我 n 個：total 個東西裡，拿剛好 n 個到籃子裡 */
export interface TakeQ { kind: 'take'; n: number; total: number; emoji: string }
/** 找出所有的 target：九格裡混著長得像的，點出全部的 target */
export interface HuntQ { kind: 'hunt'; glyphKind: 'digit' | 'letter'; target: string; cells: string[] }
/** 描一描：字淡淡地印在畫布上，用手指照著描 */
export interface TraceQ { kind: 'trace'; glyphKind: GlyphKind; glyph: string; say: string }

export type PracticeQuestion = CountQ | GroupsQ | TakeQ | HuntQ | TraceQ

/** 這一本字卡拿得出什麼題材 */
export interface PracticeSource {
  /** 數一數的卡：幾個、畫什麼 */
  counts: { n: number; emoji: string }[]
  /** 數字卡上的數字（'6'、'13'），不重複 */
  numbers: string[]
  /** ABC 字母卡的字母（大寫），不重複 */
  letters: string[]
  /** 識字卡的字（注音、國字，最多兩個字）和怎麼唸 */
  chars: { glyph: string; say: string }[]
}

export type Rand = () => number

/** 一輪幾題；只能描一描的字卡本（注音、國字）描太多會累，只出四題 */
export const PRACTICE_LEN = 6
const TRACE_ONLY_LEN = 4
/** 「哪一堆有幾個」每一堆最多幾個，三堆並排放得下 */
export const GROUP_MAX = 10
/** 「給我幾個」最多拿幾個，再多就數不清楚了 */
export const TAKE_MAX = 12
/** 找出所有的…：3×3 九格，裡面有 2～4 個答案 */
const HUNT_CELLS = 9
const ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
const DIGITS = '0123456789'.split('')
/** 描的數字最多兩位，三位數的字在畫布上太擠 */
const TRACE_DIGITS = 2

/** 小朋友的字卡本沒有足夠的 emoji 可以換的時候，用這些 */
const FALLBACK_EMOJI = ['🍎', '⭐', '🐟', '🚗', '🎈', '🍪', '🐱', '🌸']

/* ---------- 長得像的 ---------- */

/** 數字長得像誰：第一個最容易搞混（6 和 9 上下顛倒，最優先） */
const DIGIT_LOOK: Record<string, string> = {
  '0': '68', '1': '74', '2': '57', '3': '85', '4': '91',
  '5': '26', '6': '985', '7': '12', '8': '306', '9': '684',
}

/** 小寫字母長得像誰：b、d、p、q 是幼兒最常搞混的四個 */
const LOOK_LOWER: Record<string, string> = {
  a: 'o', b: 'dpq', c: 'oe', d: 'bqp', e: 'c', f: 't', g: 'qy', h: 'nb', i: 'lj', j: 'i', k: 'h', l: 'ij', m: 'nw',
  n: 'mhu', o: 'ac', p: 'qbd', q: 'pdg', r: 'n', s: 'z', t: 'f', u: 'nv', v: 'uy', w: 'mv', x: 'k', y: 'vg', z: 's',
}

/** 大寫字母長得像誰 */
const LOOK_UPPER: Record<string, string> = {
  A: 'HV', B: 'PRD', C: 'GO', D: 'BO', E: 'FL', F: 'EP', G: 'CQ', H: 'NA', I: 'LJ', J: 'IU', K: 'XH', L: 'IE', M: 'NW',
  N: 'MH', O: 'QCD', P: 'BRF', Q: 'OG', R: 'PB', S: 'Z', T: 'IL', U: 'VJ', V: 'UY', W: 'MV', X: 'KY', Y: 'VX', Z: 'SN',
}

const unique = <T>(list: T[]): T[] => [...new Set(list)]

/**
 * 跟這個數字長得像、容易看錯的數字（字串）：
 * 一位數查表（6 → 9、8、5）；兩位以上：左右顛倒（31 → 13）、其中一位換成長得像的（16 → 19）、差一點點（30、32）。
 */
export function lookalikeDigits(word: string): string[] {
  if (word.length === 1) return [...(DIGIT_LOOK[word] ?? '')]
  const out: string[] = []
  const flipped = [...word].reverse().join('')
  if (flipped !== word) out.push(flipped)
  ;[...word].forEach((d, i) => {
    const l = DIGIT_LOOK[d]?.[0]
    if (l) out.push(word.slice(0, i) + l + word.slice(i + 1))
  })
  const n = Number(word)
  for (const m of [n - 1, n + 1, n - 10, n + 10]) if (m >= 0) out.push(String(m))
  return unique(out).filter((x) => x !== word && !/^0\d/.test(x))
}

/* ---------- 亂數 ---------- */

function shuffle<T>(list: T[], rand: Rand): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** 一袋東西：抽完了才重新洗牌，同一輪裡不會一直抽到同一個 */
function bagOf<T>(items: T[], rand: Rand): () => T {
  let queue: T[] = []
  return () => {
    if (!queue.length) queue = shuffle(items, rand)
    return queue.pop()!
  }
}

/* ---------- 題材 ---------- */

/** 從字卡本的卡片算出題材。maxLetter：學校教到哪個字母（空字串是不限），只用 A～這個字母 */
export function practiceSourceOf(cards: Card[], opts: { abc: boolean; maxLetter?: string }): PracticeSource {
  const counts: PracticeSource['counts'] = []
  const numbers: string[] = []
  const letters: string[] = []
  const chars: PracticeSource['chars'] = []
  for (const c of cards) {
    const word = c.word.trim()
    if (isCounting(c) && !counts.some((x) => x.n === countOf(c))) counts.push({ n: countOf(c)!, emoji: c.image })
    if (isNumberCard(c) && word.length <= 3) numbers.push(word)
    if (opts.abc) {
      const l = initialOf(c.word)
      if (l) letters.push(l)
    }
    if (isZhCard(c) && [...word].length <= 2) chars.push({ glyph: word, say: zhReading(c) })
  }
  let taught = unique(letters).sort()
  // 學校只教到某個字母：只練教過的；限制後一個都不剩就不限制，不會整本沒題目
  if (opts.maxLetter) {
    const limited = taught.filter((l) => l <= opts.maxLetter!)
    if (limited.length) taught = limited
  }
  return {
    counts: counts.sort((a, b) => a.n - b.n),
    numbers: unique(numbers),
    letters: taught,
    chars: chars.filter((x, i) => chars.findIndex((y) => y.glyph === x.glyph) === i),
  }
}

/** 能描的字：兩位以內的數字、字母、注音／國字 */
function traceGlyphs(src: PracticeSource) {
  return {
    digit: src.numbers.filter((w) => w.length <= TRACE_DIGITS),
    letter: src.letters,
    zh: src.chars,
  }
}

/** 這本字卡出得了哪幾種題；沒有題材就是空的（沒有「練習」分頁） */
export function practiceKinds(src: PracticeSource): PracticeKind[] {
  const kinds: PracticeKind[] = []
  if (src.counts.length) {
    kinds.push('count')
    if (src.counts.some((c) => c.n <= TAKE_MAX)) kinds.push('take')
    if (src.counts.some((c) => c.n <= GROUP_MAX)) kinds.push('groups')
  }
  if (src.numbers.length || src.letters.length) kinds.push('hunt')
  const g = traceGlyphs(src)
  if (g.digit.length || g.letter.length || g.zh.length) kinds.push('trace')
  // 題材太少（只有一張卡）玩不出變化
  // （數一數的卡同時也是數字卡，同一個數只算一個）
  const items = new Set([...src.counts.map((c) => String(c.n)), ...src.numbers, ...src.letters, ...src.chars.map((c) => c.glyph)])
  return items.size >= 2 ? kinds : []
}

export const canPractice = (src: PracticeSource) => practiceKinds(src).length > 0

/* ---------- 出題 ---------- */

/**
 * 三個數字選項：答案、一個長得像的（6 配 9）或差一個的、另一個差一點點的。
 * 最大值不能超過這一本教到的數，也不能放不進畫面。
 */
function numberOptions(n: number, max: number, rand: Rand): number[] {
  const look = lookalikeDigits(String(n)).map(Number)
  const near = shuffle([n - 1, n + 1, n - 2, n + 2], rand)
  const all = Array.from({ length: max }, (_, i) => i + 1)
  const others = unique([...look.slice(0, 1), ...near, ...look.slice(1), ...shuffle(all, rand)]).filter(
    (x) => x >= 1 && x <= max && x !== n,
  )
  return shuffle([n, ...others.slice(0, 2)], rand)
}

/** 三堆各畫不同的東西（不然只剩數量不一樣，太容易） */
function panelEmojis(src: PracticeSource, rand: Rand): string[] {
  const pool = unique(src.counts.map((c) => c.emoji))
  return unique([...shuffle(pool, rand), ...shuffle(FALLBACK_EMOJI, rand)]).slice(0, 3)
}

/** 長得像的字（依序）：先放長得像的，再放這一本教過的，最後才是別的 */
function digitDistractors(target: string, numbers: string[], rand: Rand): string[] {
  return unique([...lookalikeDigits(target), ...shuffle(numbers, rand), ...shuffle(DIGITS, rand)]).filter((d) => d !== target)
}

function letterDistractors(letter: string, lower: boolean, taught: string[], rand: Rand): string[] {
  const look = [...((lower ? LOOK_LOWER[letter.toLowerCase()] : LOOK_UPPER[letter]) ?? '')].map((c) => c.toUpperCase())
  const known = taught.filter((l) => l !== letter)
  return unique([
    ...look.filter((l) => known.includes(l)),
    ...shuffle(known.filter((l) => !look.includes(l)), rand),
    ...look,
    ...shuffle(ALPHABET, rand),
  ]).filter((l) => l !== letter)
}

/** 九格：2～4 個答案，其他是三種長得像的輪流放，每種至少一個 */
function fillCells(target: string, distractors: string[], rand: Rand): string[] {
  const hits = 2 + Math.floor(rand() * 3)
  const kinds = distractors.slice(0, 3)
  const rest = Array.from({ length: HUNT_CELLS - hits }, (_, i) => kinds[i % kinds.length]!)
  return shuffle([...Array<string>(hits).fill(target), ...rest], rand)
}

/**
 * 一輪的題型順序：每種至少出一次、相鄰不重複、描一描不放第一題（先暖身）而且最多兩題
 * （只有「找出所有」和「描一描」兩種的字卡本最多三題，不然找出所有會連著好幾題）。
 */
function planKinds(kinds: PracticeKind[], rand: Rand): PracticeKind[] {
  const traceOnly = kinds.every((k) => k === 'trace')
  const len = traceOnly ? TRACE_ONLY_LEN : PRACTICE_LEN
  const maxTrace = kinds.length <= 2 ? 3 : 2
  const order: PracticeKind[] = []
  // 一題一題挑：還沒出過的優先，不跟上一題一樣，描一描不放第一題、不超過上限；挑不出來才放寬（只有一種題型時）
  for (let i = 0; i < len; i++) {
    const traces = order.filter((k) => k === 'trace').length
    const allowed = (k: PracticeKind, sameOk: boolean) =>
      (sameOk || k !== order[i - 1]) && (traceOnly || k !== 'trace' || (i > 0 && traces < maxTrace))
    const fresh = kinds.filter((k) => !order.includes(k) && allowed(k, false))
    const open = kinds.filter((k) => allowed(k, false))
    const any = kinds.filter((k) => allowed(k, true))
    const pool = fresh.length ? fresh : open.length ? open : any.length ? any : kinds
    order.push(pool[Math.floor(rand() * pool.length)]!)
  }
  return order
}

/** 這一輪的題目；rand 可以換成固定的亂數方便測試 */
export function makePracticeRound(src: PracticeSource, rand: Rand = Math.random): PracticeQuestion[] {
  const kinds = practiceKinds(src)
  if (!kinds.length) return []

  const countMax = Math.max(5, ...src.counts.map((c) => c.n))
  const countBag = bagOf(src.counts, rand)
  const groupBag = bagOf(src.counts.filter((c) => c.n <= GROUP_MAX), rand)
  const takeBag = bagOf(src.counts.filter((c) => c.n <= TAKE_MAX), rand)
  const numberBag = bagOf(src.numbers, rand)
  const letterBag = bagOf(src.letters, rand)
  const glyphs = traceGlyphs(src)
  const traceKinds = (['digit', 'letter', 'zh'] as const).filter((k) => glyphs[k].length)
  const traceBags = {
    digit: bagOf(glyphs.digit, rand),
    letter: bagOf(glyphs.letter, rand),
    zh: bagOf(glyphs.zh, rand),
  }

  return planKinds(kinds, rand).map((kind): PracticeQuestion => {
    if (kind === 'count') {
      const c = countBag()
      return { kind, n: c.n, emoji: c.emoji, options: numberOptions(c.n, countMax, rand) }
    }
    if (kind === 'groups') {
      const c = groupBag()
      const counts = numberOptions(c.n, GROUP_MAX, rand)
      const emojis = panelEmojis(src, rand)
      return { kind, n: c.n, panels: counts.map((n, i) => ({ n, emoji: emojis[i]! })), answer: counts.indexOf(c.n) }
    }
    if (kind === 'take') {
      const c = takeBag()
      return { kind, n: c.n, total: Math.min(c.n + 2 + Math.floor(rand() * 3), TAKE_MAX + 4), emoji: c.emoji }
    }
    if (kind === 'hunt') {
      // 字母卡找字母（大小寫輪流）；數字卡找數字
      if (src.letters.length && (!src.numbers.length || rand() < 0.5)) {
        const letter = letterBag()
        const lower = rand() < 0.5
        const show = (l: string) => (lower ? l.toLowerCase() : l)
        const cells = fillCells(letter, letterDistractors(letter, lower, src.letters, rand), rand)
        return { kind, glyphKind: 'letter', target: show(letter), cells: cells.map(show) }
      }
      const target = numberBag()
      return { kind, glyphKind: 'digit', target, cells: fillCells(target, digitDistractors(target, src.numbers, rand), rand) }
    }
    // trace
    const which = traceKinds[Math.floor(rand() * traceKinds.length)]!
    if (which === 'zh') {
      const ch = traceBags.zh()
      return { kind, glyphKind: 'zh', glyph: ch.glyph, say: ch.say }
    }
    if (which === 'letter') {
      const l = traceBags.letter()
      return { kind, glyphKind: 'letter', glyph: rand() < 0.5 ? l.toLowerCase() : l, say: l }
    }
    const d = traceBags.digit()
    return { kind, glyphKind: 'digit', glyph: d, say: d }
  })
}
