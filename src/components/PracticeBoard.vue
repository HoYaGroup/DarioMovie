<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { enNumber, zhNumber } from '~/utils/cards'
import { canSpeak, speak, chimeRight, chimeWrong, chimeTap, type SpeechPart, type SpeechText } from '~/utils/speech'
import { cheerParts, PROMPTS as P, type CheerKind } from '~/utils/cheers'
import {
  makePracticeRound, type PracticeQuestion, type PracticeSource, type GlyphKind, type HuntQ, type TraceQ,
} from '~/utils/practice'
import { useCardStars } from '~/composables/useCardStars'
import { useChildName } from '~/composables/useChildName'

/**
 * 練習：一個畫面一個題目，題型混著出（utils/practice.ts 出題）——
 *   數一數   點著數（每點一個唸一個數字），再選有幾個
 *   哪一堆   三堆不同的東西，點出有 3 個的那一堆
 *   給我幾個  把 3 個東西拿到籃子裡，按「好了」
 *   找出所有  九格裡找出全部的 6（旁邊混著 9）或 b（旁邊混著 d），每找到一個唸一個數字
 *   描一描   用手指照著淡淡的字描
 * 規矩跟其他模式一樣：不說 No、點錯說「這是…」再問一次、一次就對拿一顆星。
 */
const props = defineProps<{
  source: PracticeSource
  deckUid: string
  lang: 'zh' | 'mix' | 'en'
}>()
const emit = defineEmits<{ back: [] }>()

const { addStar } = useCardStars()
const { name: childName } = useChildName()

const englishOnly = computed(() => props.lang === 'en')
const mixed = computed(() => props.lang === 'mix')
/** 畫面上的字：全英文用英文，中文、中英都用中文（爸媽看得懂） */
const t = (zhText: string, enText: string) => (englishOnly.value ? enText : zhText)
const en = (text: string): SpeechText => ({ text, lang: 'en-US' })
const zh = (text: string): SpeechText => ({ text, lang: 'zh-TW' })
/** 指令、回饋：全英文用英文說，中文、中英都用中文說 */
const line = (zhText: string, enText: string): SpeechText => (englishOnly.value ? en(enText) : zh(zhText))
const cheer = (kind: CheerKind): SpeechText[] => cheerParts(kind, englishOnly.value, childName.value)

/** 這個數字怎麼說：中文、英文（中英都唸） */
function numberSpeech(n: number): SpeechText[] {
  if (englishOnly.value) return [en(enNumber(n))]
  if (mixed.value) return [zh(zhNumber(n)), en(enNumber(n))]
  return [zh(zhNumber(n))]
}

/** 「給我三個！」「哪一堆有兩個？」：量詞前面的 2 要說「兩」 */
function withNumber(lead: string, tail: string, enText: (word: string) => string, n: number): SpeechPart[] {
  if (englishOnly.value) return [en(enText(enNumber(n)))]
  const base = zh(`${lead}${n === 2 ? '兩' : zhNumber(n)}${tail}`)
  return mixed.value ? [base, { pause: 250 }, en(enNumber(n))] : [base]
}

/** 字母、數字、注音怎麼唸 */
function glyphName(kind: GlyphKind, say: string): SpeechText[] {
  if (kind === 'digit') return numberSpeech(Number(say))
  if (kind === 'letter') return [en(say.toUpperCase())]
  return [zh(say)]
}

function huntParts(q: HuntQ): SpeechPart[] {
  if (q.glyphKind === 'digit') {
    const n = Number(q.target)
    return englishOnly.value
      ? [en(`Find all the number ${enNumber(n)}!`)]
      : [zh('找出所有的數字'), { pause: 200 }, ...numberSpeech(n)]
  }
  return englishOnly.value
    ? [en(`Find all the letter ${q.target}!`)]
    : [zh('找出所有的字母'), { pause: 250 }, en(q.target)]
}

function promptParts(q: PracticeQuestion): SpeechPart[] {
  switch (q.kind) {
    case 'count': return [line(P.countHow.zh, P.countHow.en)]
    case 'groups': return withNumber('哪一堆有', '個？', (w) => `Which one has ${w}?`, q.n)
    case 'take': return withNumber('給我', '個！', (w) => `Give me ${w}!`, q.n)
    case 'hunt': return huntParts(q)
    case 'trace': return [line(P.traceIt.zh, P.traceIt.en)]
  }
}

const plainText = (parts: SpeechPart[]) => parts.map((p) => ('text' in p ? p.text : '')).join(' ').trim()

/* ---------- 一輪的狀態 ---------- */

const qs = ref<PracticeQuestion[]>([])
const idx = ref(0)
const q = computed(() => qs.value[idx.value])
const stars = ref(0)
const roundMissed = ref(false)
const done = ref(false)
const perfect = computed(() => !roundMissed.value && stars.value >= qs.value.length)

/** 這一題 */
const solved = ref(false)
/** 這一題點錯過，答對也不給星星 */
const missed = ref(false)
const earned = ref(false)
/** 答對的小星星每次換一個編號，動畫才會重播 */
const burst = ref(0)
/** 數一數、給我幾個：點過的東西（第幾個）依點的順序 */
const counted = ref<number[]>([])
const taken = ref<number[]>([])
/** 找出所有：找到的格子（依找到的順序） */
const found = ref<number[]>([])
/** 點錯的選項（數一數是那個數字，哪一堆是第幾堆，找出所有是第幾格） */
const wrongPicks = ref<number[]>([])
const rightPick = ref<number | null>(null)

let token = 0
let askTimer: ReturnType<typeof setTimeout> | null = null

function clearAsk() {
  if (askTimer) clearTimeout(askTimer)
  askTimer = null
}

function ask(intro = false) {
  const cur = q.value
  if (!cur) return
  speak([...(intro ? [line(P.practiceIntro.zh, P.practiceIntro.en), { pause: 400 }] : []), ...promptParts(cur)])
}

function askLater(ms = 450, intro = false) {
  clearAsk()
  askTimer = setTimeout(() => ask(intro), ms)
}

/** 回饋唸完才換下一題；沒有語音的裝置至少停一下，讓小朋友看到星星 */
function speakThen(parts: SpeechPart[], then: () => void, minMs = 1300) {
  const mine = ++token
  Promise.all([speak(parts), new Promise((r) => setTimeout(r, minMs))]).then(() => {
    if (mine === token) then()
  })
}

function resetQuestion() {
  solved.value = false
  missed.value = false
  earned.value = false
  counted.value = []
  taken.value = []
  found.value = []
  wrongPicks.value = []
  rightPick.value = null
  strokes = []
  traceTried.value = false
}

function begin() {
  token++
  qs.value = makePracticeRound(props.source)
  idx.value = 0
  stars.value = 0
  roundMissed.value = false
  done.value = false
  resetQuestion()
  askLater(450, true)
}

onMounted(begin)
onBeforeUnmount(() => {
  token++
  clearAsk()
  observer?.disconnect()
})

/** 答對：音效、星星、讚美（kind 是讚美的種類，null 就不讚美）加上答案說一遍，唸完換下一題 */
function win(extra: SpeechPart[], kind: CheerKind | null = 'right') {
  clearAsk()
  solved.value = true
  earned.value = !missed.value
  burst.value++
  chimeRight()
  if (!missed.value) {
    stars.value++
    addStar(props.deckUid)
  }
  speakThen([{ pause: 250 }, ...(kind ? [...cheer(kind), { pause: 400 }] : []), ...extra], next)
}

/** 點錯：不說 No，說一聲再告訴他點的是什麼，再把題目問一次 */
function lose(thisIs: SpeechPart[]) {
  clearAsk()
  missed.value = true
  roundMissed.value = true
  chimeWrong()
  const cur = q.value
  speak([
    { pause: 250 },
    ...cheer('wrong'),
    { pause: 300 },
    ...thisIs,
    { pause: 600 },
    line(P.tryAgain.zh, P.tryAgain.en),
    { pause: 800 },
    ...(cur ? promptParts(cur) : []),
  ])
}

function next() {
  if (idx.value + 1 >= qs.value.length) {
    done.value = true
    chimeRight()
    speak(doneParts())
    return
  }
  idx.value++
  resetQuestion()
  askLater()
}

function doneParts(): SpeechPart[] {
  const s = stars.value
  if (!englishOnly.value) {
    const text = perfect.value ? P.perfect.zh : s === 0 ? P.goodTry.zh : `好棒！你拿到${s === 2 ? '兩' : zhNumber(s)}顆星！`
    return [{ pause: 500 }, zh(text)]
  }
  const text = perfect.value ? P.perfect.en : s === 0 ? P.goodTry.en : `Great job! You got ${enNumber(s)} ${s === 1 ? 'star' : 'stars'}!`
  return [{ pause: 500 }, en(text)]
}

/** 「This is five.」 */
const thisIsNumber = (n: number): SpeechPart[] => [line(P.cmpThisIs.zh, P.cmpThisIs.en), { pause: 200 }, ...numberSpeech(n)]

/* ---------- 數一數 ---------- */

function countTap(i: number) {
  if (solved.value) return
  clearAsk()
  const at = counted.value.indexOf(i)
  if (at >= 0) {
    speak(numberSpeech(at + 1))
    return
  }
  counted.value = [...counted.value, i]
  chimeTap()
  speak(numberSpeech(counted.value.length))
}

function pickCount(n: number) {
  const cur = q.value
  if (cur?.kind !== 'count' || solved.value) return
  if (wrongPicks.value.includes(n)) {
    clearAsk()
    speak(numberSpeech(n))
    return
  }
  if (n === cur.n) {
    rightPick.value = n
    win(numberSpeech(n))
    return
  }
  wrongPicks.value = [...wrongPicks.value, n]
  lose(thisIsNumber(n))
}

/* ---------- 哪一堆有幾個 ---------- */

function pickPanel(i: number) {
  const cur = q.value
  if (cur?.kind !== 'groups' || solved.value) return
  const panel = cur.panels[i]!
  if (wrongPicks.value.includes(i)) {
    clearAsk()
    speak(numberSpeech(panel.n))
    return
  }
  if (i === cur.answer) {
    rightPick.value = i
    win(numberSpeech(cur.n))
    return
  }
  wrongPicks.value = [...wrongPicks.value, i]
  lose(thisIsNumber(panel.n))
}

/* ---------- 給我幾個 ---------- */

function takeItem(i: number) {
  if (solved.value || taken.value.includes(i)) return
  clearAsk()
  taken.value = [...taken.value, i]
  chimeTap()
  speak(numberSpeech(taken.value.length))
}

function putBack(i: number) {
  if (solved.value) return
  clearAsk()
  taken.value = taken.value.filter((x) => x !== i)
  chimeTap()
}

function takeDone() {
  const cur = q.value
  if (cur?.kind !== 'take' || solved.value || !taken.value.length) return
  const k = taken.value.length
  if (k === cur.n) {
    win(numberSpeech(k))
    return
  }
  // 拿多了、拿少了：說他拿了幾個，東西留在籃子裡，自己加或拿出來
  lose(withNumber('你拿了', '個。', (w) => `You took ${w}.`, k))
}

/* ---------- 找出所有的 ---------- */

function huntTap(i: number) {
  const cur = q.value
  if (cur?.kind !== 'hunt' || solved.value || found.value.includes(i)) return
  clearAsk()
  const cell = cur.cells[i]!
  if (cell === cur.target) {
    found.value = [...found.value, i]
    const total = cur.cells.filter((c) => c === cur.target).length
    chimeTap()
    // 每找到一個唸一個數字：找完的時候，最後那個數字就是「一共有幾個」
    if (found.value.length === total) win(numberSpeech(total))
    else speak(numberSpeech(found.value.length))
    return
  }
  const say = cur.glyphKind === 'digit' ? cell : cell.toUpperCase()
  if (wrongPicks.value.includes(i)) {
    speak(glyphName(cur.glyphKind, say))
    return
  }
  wrongPicks.value = [...wrongPicks.value, i]
  lose([line(P.cmpThisIs.zh, P.cmpThisIs.en), { pause: 200 }, ...glyphName(cur.glyphKind, say)])
}

const huntTotal = computed(() => {
  const cur = q.value
  return cur?.kind === 'hunt' ? cur.cells.filter((c) => c === cur.target).length : 0
})

/* ---------- 描一描 ---------- */

const FONT_ROUND = '"Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Avenir Next Rounded", "Nunito", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif'
const FONT_ZH = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", system-ui, sans-serif'

const traceBox = ref<HTMLElement | null>(null)
const traceCanvas = ref<HTMLCanvasElement | null>(null)
const traceTried = ref(false)

interface TraceGeom {
  w: number
  h: number
  dpr: number
  font: string
  x: number
  y: number
  /** 筆畫粗細（CSS 像素）：跟字的筆畫差不多粗，沿著中間描一次就蓋得住 */
  brush: number
  mw: number
  mh: number
  /** 低解析度的字（1＝在字裡）、字加上一圈容許誤差的範圍，和字的面積 */
  mask: Uint8Array
  near: Uint8Array
  area: number
  /** 淡淡的字加點點外框（先畫好的） */
  layer: HTMLCanvasElement
}
let geom: TraceGeom | null = null
/** 手指畫過的線，座標存 0～1，轉了方向、重新量過大小也畫得回來 */
let strokes: { x: number; y: number }[][] = []
let pen = -1
let observer: ResizeObserver | null = null

const MASK_W = 128
/**
 * 描完的條件（三個都要）：
 *   整個字的面積描到 7 成以上；
 *   字分成 6×6 區，字佔了一點面積的每一區都要描到一半以上——只描了「5」的豎線和彎（約 6 成面積），上面那一橫沒描，就不算；
 *   落在字外面的筆畫不超過 4.5 成（亂塗、整個畫布塗滿不算）。
 */
const NEED_COVER = 0.72
const MAX_SPILL = 0.45
const PART_GRID = 6
/** 一區裡字至少有這麼多個（128 像素寬的小圖）才算「這一區有字」，太小的邊角不計 */
const PART_MIN = 20
const PART_COVER = 0.5

function inkColor(): string {
  const v = traceBox.value ? getComputedStyle(traceBox.value).getPropertyValue('--deck').trim() : ''
  return v || '#ff9f43'
}

/** 字畫在畫布正中間、大小剛好：用字的實際外框置中，b、g、注音這種上下不一樣高的字才不會偏 */
function layoutGlyph(ctx: CanvasRenderingContext2D, glyph: string, kind: GlyphKind, w: number, h: number) {
  const family = kind === 'zh' ? FONT_ZH : FONT_ROUND
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let size = h * 0.8
  ctx.font = `700 ${size}px ${family}`
  let m = ctx.measureText(glyph)
  const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  const scale = Math.min(1, bw > 0 ? (w * 0.84) / bw : 1, bh > 0 ? (h * 0.8) / bh : 1)
  size *= scale
  ctx.font = `700 ${size}px ${family}`
  m = ctx.measureText(glyph)
  return {
    font: ctx.font,
    x: w / 2 + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2,
    y: h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
  }
}

function strokePath(ctx: CanvasRenderingContext2D, w: number, h: number, brush: number, color: string) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = brush
  ctx.strokeStyle = color
  ctx.fillStyle = color
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath()
      ctx.arc(s[0]!.x * w, s[0]!.y * h, brush / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(s[0]!.x * w, s[0]!.y * h)
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i]!.x * w, s[i]!.y * h)
    ctx.stroke()
  }
}

/** 量一次畫布大小：畫字、算出描完的判斷用的字形和筆畫粗細 */
function setupTrace() {
  const canvas = traceCanvas.value
  const box = traceBox.value
  const cur = q.value
  if (!canvas || !box || cur?.kind !== 'trace') return
  const w = Math.round(box.clientWidth)
  const h = Math.round(box.clientHeight)
  if (w < 40 || h < 40) return
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pos = layoutGlyph(ctx, cur.glyph, cur.glyphKind, w, h)

  // 低解析度的字：算面積和周長，面積÷周長×2＝筆畫大約多粗
  const mw = MASK_W
  const mh = Math.max(32, Math.round((MASK_W * h) / w))
  const s = mw / w
  const off = document.createElement('canvas')
  off.width = mw
  off.height = mh
  const octx = off.getContext('2d', { willReadFrequently: true })
  if (!octx) return
  octx.scale(s, s)
  octx.font = pos.font
  octx.fillStyle = '#000'
  octx.fillText(cur.glyph, pos.x, pos.y)
  const fill = octx.getImageData(0, 0, mw, mh).data
  const mask = new Uint8Array(mw * mh)
  let area = 0
  let edge = 0
  for (let i = 0; i < mask.length; i++) mask[i] = fill[i * 4 + 3]! > 100 ? 1 : 0
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x
      if (!mask[i]) continue
      area++
      if (x === 0 || y === 0 || x === mw - 1 || y === mh - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - mw] || !mask[i + mw]) edge++
    }
  }
  const thickness = edge ? ((2 * area) / edge) / s : w * 0.1
  const brush = Math.max(18, Math.min(thickness * 1.2, w * 0.18))

  // 字加上一圈（筆畫粗細的一半）：落在這範圍外的筆畫才算亂畫
  octx.clearRect(0, 0, w, h)
  octx.lineWidth = brush * 0.9
  octx.lineJoin = 'round'
  octx.strokeStyle = '#000'
  octx.strokeText(cur.glyph, pos.x, pos.y)
  octx.fillText(cur.glyph, pos.x, pos.y)
  const grown = octx.getImageData(0, 0, mw, mh).data
  const near = new Uint8Array(mw * mh)
  for (let i = 0; i < near.length; i++) near[i] = grown[i * 4 + 3]! > 100 ? 1 : 0

  geom = { w, h, dpr, font: pos.font, x: pos.x, y: pos.y, brush, mw, mh, mask, near, area, layer: guideLayer(cur.glyph, pos, w, h, dpr) }
  redrawTrace()
}

/**
 * 淡淡的字加點點外框，先畫好存起來（每次重畫直接貼上）。
 * 有些字型的筆畫是疊起來的（山、ㄅ），描邊會在字裡面多出幾條點點線：
 * 把字往內縮 7 像素的範圍擦掉，只留貼著邊緣的點點。
 */
function guideLayer(glyph: string, pos: { font: string; x: number; y: number }, w: number, h: number, dpr: number) {
  const layer = document.createElement('canvas')
  layer.width = Math.round(w * dpr)
  layer.height = Math.round(h * dpr)
  const lctx = layer.getContext('2d')!
  const setup = (c: CanvasRenderingContext2D) => {
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.font = pos.font
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
  }
  setup(lctx)
  lctx.setLineDash([1, 10])
  lctx.lineCap = 'round'
  lctx.lineWidth = 4
  lctx.strokeStyle = 'rgba(34, 29, 69, .6)'
  lctx.strokeText(glyph, pos.x, pos.y)

  const inner = document.createElement('canvas')
  inner.width = layer.width
  inner.height = layer.height
  const ictx = inner.getContext('2d')!
  setup(ictx)
  ictx.fillStyle = '#000'
  ictx.fillText(glyph, pos.x, pos.y)
  ictx.globalCompositeOperation = 'destination-out'
  ictx.lineWidth = 14
  ictx.lineJoin = 'round'
  ictx.strokeText(glyph, pos.x, pos.y)

  lctx.save()
  lctx.setTransform(1, 0, 0, 1, 0, 0)
  lctx.globalCompositeOperation = 'destination-out'
  lctx.drawImage(inner, 0, 0)
  lctx.restore()
  lctx.globalCompositeOperation = 'destination-over'
  lctx.fillStyle = 'rgba(34, 29, 69, .12)'
  lctx.fillText(glyph, pos.x, pos.y)
  return layer
}

/** 整張重畫：淡淡的字加點點外框，再蓋上畫過的線；描完了就整個字填上顏色 */
function redrawTrace() {
  const canvas = traceCanvas.value
  const g = geom
  const cur = q.value
  if (!canvas || !g || cur?.kind !== 'trace') return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0)
  ctx.font = g.font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const color = inkColor()
  if (solved.value) {
    ctx.fillStyle = color
    ctx.fillText(cur.glyph, g.x, g.y)
    return
  }
  ctx.drawImage(g.layer, 0, 0, g.w, g.h)
  strokePath(ctx, g.w, g.h, g.brush, color)
}

/** 畫過的線蓋住字的幾成、有幾成落在字外面、還有幾區（字的一部分）沒描到 */
function traceScore(): { cover: number; spill: number; gaps: number } {
  const g = geom
  const none = { cover: 0, spill: 0, gaps: 0 }
  if (!g || !strokes.length) return none
  const off = document.createElement('canvas')
  off.width = g.mw
  off.height = g.mh
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return none
  const s = g.mw / g.w
  ctx.scale(s, s)
  strokePath(ctx, g.w, g.h, g.brush, '#000')
  const d = ctx.getImageData(0, 0, g.mw, g.mh).data
  let covered = 0
  let ink = 0
  let outside = 0
  const partTotal = new Array<number>(PART_GRID * PART_GRID).fill(0)
  const partDone = new Array<number>(PART_GRID * PART_GRID).fill(0)
  for (let i = 0; i < g.mask.length; i++) {
    const inked = d[i * 4 + 3]! > 60
    if (g.mask[i]) {
      const part = Math.floor(((i / g.mw) | 0) * PART_GRID / g.mh) * PART_GRID + Math.floor((i % g.mw) * PART_GRID / g.mw)
      partTotal[part]!++
      if (inked) partDone[part]!++
    }
    if (!inked) continue
    ink++
    if (g.mask[i]) covered++
    if (!g.near[i]) outside++
  }
  let gaps = 0
  for (let p = 0; p < partTotal.length; p++) {
    if (partTotal[p]! >= PART_MIN && partDone[p]! / partTotal[p]! < PART_COVER) gaps++
  }
  return { cover: g.area ? covered / g.area : 0, spill: ink ? outside / ink : 0, gaps }
}

function tracePoint(e: PointerEvent) {
  const r = traceCanvas.value!.getBoundingClientRect()
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
}

function traceDown(e: PointerEvent) {
  const canvas = traceCanvas.value
  if (!canvas || !geom || solved.value || pen !== -1) return
  e.preventDefault()
  clearAsk()
  canvas.setPointerCapture(e.pointerId)
  pen = e.pointerId
  strokes.push([tracePoint(e)])
  redrawTrace()
}

function traceMove(e: PointerEvent) {
  const canvas = traceCanvas.value
  const g = geom
  const cur = strokes[strokes.length - 1]
  if (!canvas || !g || e.pointerId !== pen || !cur) return
  e.preventDefault()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const events = e.getCoalescedEvents?.() ?? []
  for (const ev of events.length ? events : [e]) {
    const p = tracePoint(ev)
    const last = cur[cur.length - 1]!
    cur.push(p)
    // 只畫新的那一小段，不要每次都整張重畫
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineWidth = g.brush
    ctx.strokeStyle = inkColor()
    ctx.beginPath()
    ctx.moveTo(last.x * g.w, last.y * g.h)
    ctx.lineTo(p.x * g.w, p.y * g.h)
    ctx.stroke()
  }
}

function traceUp(e: PointerEvent) {
  if (e.pointerId !== pen) return
  pen = -1
  const cur = q.value
  if (cur?.kind !== 'trace' || solved.value) return
  traceTried.value = true
  const { cover, spill, gaps } = traceScore()
  if (cover >= NEED_COVER && spill <= MAX_SPILL && gaps === 0) {
    solved.value = true
    redrawTrace()
    win(glyphName(cur.glyphKind, cur.say))
  }
}

function traceClear() {
  if (solved.value) return
  strokes = []
  redrawTrace()
}

/**
 * 「確定」：小朋友說他描好了（描不出來也不要卡住）。直接結束這一題，說「你做到了！」再唸一遍這個字；
 * 還沒描完整的話沒有星星（描完整會自己過，不用按）。
 */
function traceOk() {
  const cur = q.value
  if (cur?.kind !== 'trace' || solved.value) return
  missed.value = true
  roundMissed.value = true
  solved.value = true
  redrawTrace()
  win(glyphName(cur.glyphKind, cur.say), 'did')
}

/** 換了題（描的字不一樣）就重畫；畫布還沒建好的話交給下面等畫布出現再畫 */
watch(q, () => nextTick(setupTrace))

watch(traceCanvas, (el) => {
  observer?.disconnect()
  if (!el) return
  nextTick(setupTrace)
  if (typeof ResizeObserver !== 'undefined' && traceBox.value) {
    observer = new ResizeObserver(() => setupTrace())
    observer.observe(traceBox.value)
  }
})

/* ---------- 畫面 ---------- */

/** 一排一排放：東西少放一排，多了放兩、三、四排（寬寬的板子） */
const rowsFor = (n: number) => (n <= 4 ? 1 : n <= 10 ? 2 : n <= 18 ? 3 : 4)
const colsFor = (n: number) => Math.ceil(n / rowsFor(n))
/** 方形的一堆（哪一堆有幾個）：兩個以內一排，六個以內兩排，再多三排 */
const panelRows = (n: number) => (n <= 2 ? 1 : n <= 6 ? 2 : 3)
const panelCols = (n: number) => Math.ceil(n / panelRows(n))

function gridStyle(n: number, panel = false) {
  return panel
    ? { '--cols': panelCols(n), '--rows': panelRows(n) }
    : { '--cols': colsFor(n), '--rows': rowsFor(n) }
}

/** 每個東西稍微歪一點、挪一點，看起來像撒在桌上，不是排得整整齊齊（同一題每次一樣，換題才換） */
function jit(i: number, salt = 0) {
  const r = (k: number) => {
    const x = Math.sin((idx.value + 1) * 12.9898 + salt * 78.233 + i * 37.719 + k * 4.581) * 43758.5453
    return x - Math.floor(x)
  }
  return { '--dx': `${(r(1) - 0.5) * 14}%`, '--dy': `${(r(2) - 0.5) * 14}%`, '--rot': `${(r(3) - 0.5) * 36}deg` }
}

/** 題目旁邊大大的字：哪一堆、給我幾個寫出數字，找出所有寫出要找的字（數字和數量要對起來） */
const chip = computed(() => {
  const cur = q.value
  if (!cur) return ''
  if (cur.kind === 'groups' || cur.kind === 'take') return String(cur.n)
  if (cur.kind === 'hunt') return cur.target
  return ''
})

/** 題目按鈕上的字：有語音就只寫要做什麼（不把答案寫出來），沒有語音的裝置才把整句寫出來 */
const askLabel = computed(() => {
  const cur = q.value
  if (!cur) return ''
  if (!canSpeak) return plainText(promptParts(cur))
  switch (cur.kind) {
    case 'count': return t('數一數，有幾個？', 'Count them!')
    case 'groups': return t('哪一堆？', 'Which one?')
    case 'take': return t('拿給我', 'Give me!')
    case 'hunt': return t('全部找出來', 'Find them all!')
    case 'trace': return t('用手指描一描', 'Trace it!')
  }
  return ''
})

const huntFound = (i: number) => found.value.indexOf(i) + 1
</script>

<template>
  <main class="practice" :class="q && !done ? `is-${q.kind}` : ''">
    <template v-if="!done && q">
      <div class="head">
        <p class="quiz-progress">
          {{ t(`第 ${idx + 1} 題／共 ${qs.length} 題`, `Question ${idx + 1} of ${qs.length}`) }}
        </p>
        <div class="prompt-row">
          <button class="ask-btn" @click="ask()">
            <span class="ask-icon" aria-hidden="true">🔊</span>
            <span class="ask-label">{{ askLabel }}</span>
          </button>
          <span v-if="chip" class="chip" :style="{ '--len': chip.length }" aria-hidden="true">{{ chip }}</span>
        </div>
      </div>

      <div :key="idx" class="body">
        <!-- ===== 數一數：點著數，再選有幾個 ===== -->
        <template v-if="q.kind === 'count'">
          <div class="board-wrap">
            <div class="board stock" :style="gridStyle(q.n)">
              <button
                v-for="i in q.n"
                :key="i"
                class="thing"
                :class="{ 'is-counted': counted.includes(i - 1) }"
                :style="jit(i)"
                :aria-label="t(`第 ${i} 個`, `Number ${i}`)"
                @click="countTap(i - 1)"
              >
                <span aria-hidden="true">{{ q.emoji }}</span>
                <b v-if="counted.includes(i - 1)" class="thing-num" aria-hidden="true">{{ counted.indexOf(i - 1) + 1 }}</b>
              </button>
            </div>
            <span v-if="solved" :key="burst" class="burst" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
          </div>
          <div class="num-options">
            <button
              v-for="o in q.options"
              :key="o"
              class="num-opt"
              :class="{ 'is-right': rightPick === o, 'is-wrong': wrongPicks.includes(o) }"
              :style="{ '--len': String(o).length }"
              :aria-label="String(o)"
              @click="pickCount(o)"
            >
              <span class="num-face">{{ o }}</span>
            </button>
          </div>
        </template>

        <!-- ===== 哪一堆有幾個 ===== -->
        <template v-else-if="q.kind === 'groups'">
          <div class="board-wrap">
            <div class="groups-board">
              <button
                v-for="(p, pi) in q.panels"
                :key="pi"
                class="panel"
                :class="{ 'is-right': rightPick === pi, 'is-wrong': wrongPicks.includes(pi) }"
                :aria-label="t('一堆東西', 'A pile')"
                @click="pickPanel(pi)"
              >
                <span class="panel-grid" :style="gridStyle(p.n, true)">
                  <i v-for="k in p.n" :key="k" :style="jit(k, pi + 1)" aria-hidden="true">{{ p.emoji }}</i>
                </span>
                <!-- 答完、點錯才亮出這一堆有幾個 -->
                <span v-if="solved || wrongPicks.includes(pi)" class="panel-n" aria-hidden="true">{{ p.n }}</span>
              </button>
            </div>
            <span v-if="solved" :key="burst" class="burst" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
          </div>
        </template>

        <!-- ===== 給我幾個：拿到籃子裡 ===== -->
        <template v-else-if="q.kind === 'take'">
          <div class="board-wrap">
            <div class="board stock" :style="gridStyle(q.total)">
              <button
                v-for="i in q.total"
                :key="i"
                class="thing"
                :class="{ 'is-gone': taken.includes(i - 1) }"
                :style="jit(i)"
                :disabled="taken.includes(i - 1) || solved"
                :aria-label="t(`拿第 ${i} 個`, `Take number ${i}`)"
                @click="takeItem(i - 1)"
              >
                <span aria-hidden="true">{{ q.emoji }}</span>
              </button>
            </div>
            <span v-if="solved" :key="burst" class="burst" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
          </div>
          <div class="tray-row">
            <div class="tray" :aria-label="t('籃子', 'Basket')">
              <span class="tray-icon" aria-hidden="true">🧺</span>
              <button
                v-for="(it, k) in taken"
                :key="it"
                class="tray-thing"
                :disabled="solved"
                :aria-label="t(`放回去第 ${k + 1} 個`, `Put back number ${k + 1}`)"
                @click="putBack(it)"
              >
                <span aria-hidden="true">{{ q.emoji }}</span>
                <b class="thing-num" aria-hidden="true">{{ k + 1 }}</b>
              </button>
            </div>
            <button class="ok-btn" :disabled="!taken.length || solved" @click="takeDone">
              <span aria-hidden="true">✅</span>{{ t('好了', 'Done') }}
            </button>
          </div>
        </template>

        <!-- ===== 找出所有的：九格 ===== -->
        <template v-else-if="q.kind === 'hunt'">
          <div class="board-wrap">
            <div class="hunt-board" :style="{ '--len': q.target.length }">
              <button
                v-for="(c, i) in q.cells"
                :key="i"
                class="cell"
                :class="{ 'is-found': found.includes(i), 'is-wrong': wrongPicks.includes(i) }"
                :aria-label="c"
                @click="huntTap(i)"
              >
                <span class="glyph">{{ c }}</span>
                <b v-if="found.includes(i)" class="cell-num" aria-hidden="true">{{ huntFound(i) }}</b>
              </button>
            </div>
            <span v-if="solved" :key="burst" class="burst" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
          </div>
          <!-- 找到幾個、一共幾個：找對的時候小朋友自己數過了，這裡只給家長看 -->
          <p class="hunt-hint" aria-hidden="true">{{ found.length }} / {{ huntTotal }}</p>
        </template>

        <!-- ===== 描一描 ===== -->
        <template v-else>
          <div class="board-wrap">
            <div ref="traceBox" class="trace-board">
              <canvas
                ref="traceCanvas"
                class="trace-canvas"
                :aria-label="t('用手指描一描', 'Trace with your finger')"
                @pointerdown="traceDown"
                @pointermove="traceMove"
                @pointerup="traceUp"
                @pointercancel="traceUp"
              />
              <button v-if="!solved" class="trace-tool" :aria-label="t('重畫', 'Clear')" @click="traceClear">↺</button>
              <button v-if="traceTried && !solved" class="trace-tool is-ok" @click="traceOk">
                {{ t('確定', 'OK') }}
              </button>
            </div>
            <span v-if="solved" :key="burst" class="burst" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
          </div>
        </template>
      </div>
    </template>

    <div v-else class="quiz-done">
      <span class="done-emoji" aria-hidden="true">{{ perfect ? '🏆' : '🎉' }}</span>
      <p class="done-title">
        <template v-if="perfect">{{ t('全部做對了！', 'All correct!') }}</template>
        <template v-else>{{ t('練習完了！', 'Great job!') }}</template>
      </p>
      <p class="done-stars">
        <template v-if="englishOnly">You got <strong>{{ stars }}</strong> {{ stars === 1 ? 'star' : 'stars' }}</template>
        <template v-else>拿到 <strong>{{ stars }}</strong> 顆星</template>
      </p>
      <div class="done-row" aria-hidden="true">
        <span v-for="i in qs.length" :key="i" class="done-star" :class="{ 'is-on': i <= stars }">⭐</span>
      </div>
      <div class="done-actions">
        <button class="ctl ctl-wide ctl-quiz" @click="begin">{{ t('再玩一次', 'Play again') }}</button>
        <button class="ctl ctl-wide" @click="emit('back')">{{ t('回去看卡片', 'Back to cards') }}</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.practice {
  --glyph-font: "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Avenir Next Rounded", "Nunito", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  --board-w: min(92vw, 640px);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 6px calc(var(--safe-r) + 20px) calc(var(--safe-b) + 16px) calc(var(--safe-l) + 20px);
  overflow-y: auto;
}

.head, .body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.quiz-progress {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-dim);
}

.prompt-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
}

.ask-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px 14px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--deck);
  color: var(--ink);
  font-family: inherit;
  font-size: 21px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 24px var(--shadow);
}
.ask-btn:active { transform: scale(.96); }

.ask-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .3);
  font-size: 28px;
}

/* 題目旁邊的大字：要數的數字、要找的字 */
.chip {
  min-width: 80px;
  height: 80px;
  padding: 0 16px;
  display: grid;
  place-items: center;
  border-radius: 24px;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--glyph-font);
  font-size: calc(58px / max(var(--len, 1) * .6 + .4, 1));
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 10px 24px var(--shadow);
}

/* 答對的星星在板子正中間跳一下 */
.board-wrap { position: relative; display: flex; justify-content: center; }
.burst {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  font-size: min(26vh, 150px);
  line-height: 1;
  pointer-events: none;
  animation: burst 1.1s ease-out forwards;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, .3));
}
@keyframes burst {
  0% { scale: 0; rotate: -60deg; opacity: 1; }
  35% { scale: 1.15; rotate: 0deg; opacity: 1; }
  70% { scale: 1; opacity: 1; }
  100% { scale: 1.1; opacity: 0; }
}

/* ---------- 一堆東西：數一數、給我幾個 ---------- */
.board {
  width: var(--board-w);
  height: min(34vh, 320px);
  container-type: size;
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  grid-template-rows: repeat(var(--rows), 1fr);
  padding: 8px;
  border-radius: 28px;
  background: var(--paper);
  box-shadow: 0 12px 28px var(--shadow);
}
.is-take .board { height: min(27vh, 250px); }

.thing {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: calc(min(100cqw / var(--cols), 100cqh / var(--rows)) * .66);
  line-height: 1;
  cursor: pointer;
  translate: var(--dx, 0) var(--dy, 0);
  rotate: var(--rot, 0deg);
  transition: transform .15s ease, opacity .2s ease;
}
.thing:active { transform: scale(.88); }
/* 數過的東西淡一點（只淡東西，編號要維持清楚） */
.thing.is-counted > span[aria-hidden] { opacity: .5; }
.thing.is-gone { visibility: hidden; }
.thing:disabled { cursor: default; }

/* 點過的東西標上第幾個（跟著唸的那個數字） */
.thing-num {
  position: absolute;
  right: 2%;
  top: 2%;
  min-width: 1.4em;
  height: 1.4em;
  padding: 0 .3em;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--ink);
  color: #fff;
  font-size: .32em;
  font-weight: 900;
  animation: pop .2s ease-out;
}

/* ---------- 選數字 ---------- */
.num-options {
  display: flex;
  justify-content: center;
  gap: clamp(12px, 3vw, 28px);
}
.num-opt {
  --size: min(26vw, 17vh, 150px);
  position: relative;
  width: var(--size);
  height: var(--size);
  container-type: size;
  padding: 0;
  border: 5px solid transparent;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--glyph-font);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 12px 28px var(--shadow);
  transition: transform .15s ease, opacity .2s ease, border-color .2s ease;
}
.num-opt:active { transform: scale(.94); }
.num-face {
  font-size: min(60cqh, calc(130cqw / max(var(--len), 1.6)));
  font-weight: 900;
  line-height: 1;
}
.num-opt.is-right { border-color: var(--ok); animation: bounce .5s ease; }
.num-opt.is-wrong { animation: shake .4s ease; }
.num-opt.is-wrong .num-face { opacity: .3; }

/* ---------- 哪一堆有幾個 ---------- */
.groups-board {
  display: flex;
  justify-content: center;
  gap: clamp(10px, 2.5vw, 26px);
}
.panel {
  --pw: min(29vw, 30vh, 230px);
  position: relative;
  width: var(--pw);
  height: var(--pw);
  container-type: size;
  padding: 6px;
  border: 5px solid transparent;
  border-radius: 26px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 12px 28px var(--shadow);
  transition: transform .15s ease, border-color .2s ease;
}
.panel:active { transform: scale(.95); }
.panel.is-right { border-color: var(--ok); animation: bounce .5s ease; }
.panel.is-wrong { animation: shake .4s ease; }
.panel.is-wrong .panel-grid { opacity: .35; }
.panel-grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  grid-template-rows: repeat(var(--rows), 1fr);
  place-items: center;
}
.panel-grid i {
  font-style: normal;
  line-height: 1;
  font-size: calc(min(100cqw / var(--cols), 100cqh / var(--rows)) * .6);
  translate: var(--dx, 0) var(--dy, 0);
  rotate: var(--rot, 0deg);
}
.panel-n {
  position: absolute;
  left: 50%;
  bottom: -16px;
  translate: -50% 0;
  min-width: 42px;
  height: 42px;
  padding: 0 12px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--ink);
  color: #fff;
  font-size: 24px;
  font-weight: 900;
  animation: pop .25s ease-out;
}

/* ---------- 給我幾個：籃子 ---------- */
.tray-row {
  width: var(--board-w);
  display: flex;
  align-items: stretch;
  gap: 12px;
}
.tray {
  flex: 1;
  min-width: 0;
  min-height: min(11vh, 92px);
  padding: 6px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  border: 4px dashed var(--deck);
  border-radius: 24px;
}
.tray-icon { font-size: 34px; opacity: .65; margin-right: 6px; }
.tray-thing {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.3em;
  height: 1.3em;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: clamp(26px, 5.4vh, 46px);
  line-height: 1;
  cursor: pointer;
  animation: pop .2s ease-out;
}
.ok-btn {
  flex: none;
  min-width: 112px;
  padding: 0 20px;
  border: 0;
  border-radius: 24px;
  background: var(--accent);
  color: var(--ink);
  box-shadow: inset 0 0 0 2px var(--accent-edge);
  font-family: inherit;
  font-size: 22px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.ok-btn:active { transform: scale(.94); }
.ok-btn:disabled { opacity: .4; cursor: default; }

/* ---------- 找出所有的：九格 ---------- */
.hunt-board {
  --cell: min(26vw, 17vh, 190px);
  display: grid;
  grid-template-columns: repeat(3, var(--cell));
  gap: clamp(8px, 1.6vw, 16px);
}
.cell {
  position: relative;
  width: var(--cell);
  height: var(--cell);
  container-type: size;
  padding: 0;
  border: 5px solid transparent;
  border-radius: 24px;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--glyph-font);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 10px 22px var(--shadow);
  transition: transform .15s ease, border-color .2s ease;
}
.cell:active { transform: scale(.93); }
.glyph {
  font-size: min(64cqh, calc(150cqw / max(var(--len), 1.5)));
  font-weight: 900;
  line-height: 1;
}
.cell.is-found { border-color: var(--ok); animation: bounce .45s ease; }
.cell.is-wrong { animation: shake .4s ease; }
.cell.is-wrong .glyph { opacity: .3; }
.cell-num {
  position: absolute;
  left: 6%;
  top: 6%;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--ok);
  color: var(--ink);
  font-family: inherit;
  font-size: 18px;
  font-weight: 900;
  animation: pop .2s ease-out;
}
.hunt-hint {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-dim);
}

/* ---------- 描一描 ---------- */
/* 手指描字要大：題目以外的空間全部給板子，外框量出放得下多大，板子取裡面最大的正方形 */
.is-trace .body,
.is-trace .board-wrap {
  flex: 1;
  min-height: 0;
  align-self: stretch;
}
.is-trace .board-wrap { container-type: size; align-items: center; }
.trace-board {
  position: relative;
  width: min(100cqw, 100cqh);
  height: min(100cqw, 100cqh);
  border-radius: 28px;
  background: var(--paper);
  box-shadow: 0 12px 28px var(--shadow);
  overflow: hidden;
}
.trace-canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* 手指在畫布上拖是在畫畫，不是捲動頁面 */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: crosshair;
}
.trace-tool {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 54px;
  height: 54px;
  border: 0;
  border-radius: 50%;
  background: var(--ink);
  color: #fff;
  font-family: inherit;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
  opacity: .85;
}
.trace-tool:active { transform: scale(.9); }
.trace-tool.is-ok {
  right: auto;
  left: 10px;
  width: auto;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 17px;
  font-weight: 800;
}

/* ---------- 做完 ---------- */
.quiz-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.done-emoji { font-size: 92px; line-height: 1.2; animation: star-pop .7s cubic-bezier(.3, 1.6, .5, 1); }
.done-title { margin: 0; font-size: 30px; font-weight: 900; }
.done-stars { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-dim); }
.done-stars strong { color: var(--accent); font-size: 28px; }
.done-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin: 8px 0 18px; }
.done-star { font-size: 34px; filter: grayscale(1); opacity: .3; }
.done-star.is-on { filter: none; opacity: 1; }
.done-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }

.ctl {
  flex: none;
  height: 64px;
  min-width: 64px;
  padding: 0 22px;
  border: 0;
  border-radius: 20px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 19px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: transform .15s ease;
}
.ctl:active { transform: scale(.93); }
.ctl-quiz {
  background: var(--accent);
  color: var(--ink);
  box-shadow: inset 0 0 0 2px var(--accent-edge);
}

@keyframes bounce {
  40% { transform: scale(1.1); }
  70% { transform: scale(.97); }
}
@keyframes shake {
  20%, 60% { transform: translateX(-10px); }
  40%, 80% { transform: translateX(10px); }
}
@keyframes star-pop {
  from { scale: 0; rotate: -60deg; }
  to { scale: 1; rotate: 0deg; }
}
@keyframes pop {
  from { scale: .3; opacity: 0; }
  to { scale: 1; opacity: 1; }
}

/* iPad 直放、大螢幕：板子再大一點 */
@media (min-width: 700px) and (min-height: 900px) {
  .practice { --board-w: min(86vw, 760px); gap: 22px; }
  .head, .body { gap: 22px; }
  .board { height: min(34vh, 380px); }
  .is-take .board { height: min(26vh, 300px); }
}

/* 橫放（iPad、電腦）描一描：題目放左邊，板子吃滿整個高度 */
@media (min-aspect-ratio: 4 / 3) {
  .practice.is-trace { flex-direction: row; gap: 24px; }
  .is-trace .head { flex: none; }
  .is-trace .prompt-row { flex-direction: column; }
}

@media (max-width: 560px) {
  .ask-btn { font-size: 18px; }
  .chip { min-width: 68px; height: 68px; }
}

/* 手機橫放：高度只剩一點點，題目放左邊、板子放右邊 */
@media (max-height: 520px) and (min-aspect-ratio: 4 / 3) {
  .practice { flex-direction: row; gap: 24px; --board-w: min(58vw, 560px); }
  .head { flex: 0 1 auto; }
  .prompt-row { flex-direction: column; }
  .board { height: min(42vh, 200px); }
  .is-take .board { height: min(32vh, 150px); }
  .num-opt { --size: min(14vw, 17vh, 90px); }
  .panel { --pw: min(18vw, 40vh, 150px); }
  .hunt-board { --cell: min(15vw, 20vh, 100px); gap: 8px; }
  .hunt-hint { display: none; }
  .tray { min-height: 56px; }
  .tray-thing { font-size: 28px; }
  .ask-btn { padding: 8px 20px 8px 10px; font-size: 17px; }
  .ask-icon { width: 40px; height: 40px; font-size: 22px; }
  .chip { min-width: 56px; height: 56px; font-size: 38px; }
}
</style>
