<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { categoryColor, type Card, type CardClip, type VideoItem } from '~/utils/youtube'
import {
  countOf, countNounOf, isPicture, imageSrc, speechOf, isAbcDeck, initialOf, cardsOf, thisIs, isNumberCard,
  numberLabels, sentencesOf, enNumber, zhNumber, englishOf, askOf, ASK_STYLES, isBareDeck,
} from '~/utils/cards'
import { canSpeak, speak, stopSpeaking, chimeRight, chimeWrong, type SpeechPart, type SpeechText } from '~/utils/speech'
import { useLibrary } from '~/composables/useLibrary'
import { useTheme } from '~/composables/useTheme'
import { useWatchTime } from '~/composables/useWatchTime'
import { useCardStars } from '~/composables/useCardStars'
import { useTvMode } from '~/composables/useTvMode'
import { useYouTubePlayer } from '~/composables/useYouTubePlayer'
import { useOnline } from '~/composables/useOffline'
import { useState } from '~/composables/useState'

const props = defineProps<{ deck: VideoItem }>()
const emit = defineEmits<{ close: [] }>()

const { categories } = useLibrary()
const { resolved: themeResolved } = useTheme()
const { isTv } = useTvMode()
const { addSeconds, flush, isLimitReached } = useWatchTime()
const { starsOf, addStar } = useCardStars()
const { online } = useOnline()

const cards = computed<Card[]>(() => cardsOf(props.deck))
/** 這本是 ABC 字母卡（單元名稱裡有 ABC）：照 A～Z 排、卡片上標出開頭字母 */
const isAbc = computed(() => isAbcDeck(props.deck.title))
/** 動作、心情這類字卡本：問的時候不加 the（Where is happy?） */
const bareDeck = computed(() => isBareDeck(props.deck.title))
/** 整本都是數字卡：上面放一排數字，今天教到哪裡就直接跳過去 */
const isNumberDeck = computed(() => cards.value.length > 0 && cards.value.every(isNumberCard))
const stars = computed(() => starsOf(props.deck.uid))

/** 跟片單上這一區同一個顏色，小朋友知道自己還在同一個地方 */
const color = computed(() => {
  const idx = categories.value.findIndex((c) => c.id === props.deck.categoryId)
  return categoryColor(Math.max(0, idx), themeResolved.value)
})

type Mode = 'learn' | 'quiz'
const mode = ref<Mode>('learn')

const en = (text: string): SpeechText => ({ text, lang: 'en-US' })
const zh = (text: string): SpeechText => ({ text, lang: 'zh-TW' })

/**
 * 翻面看答案時唸的，不分英文版、中文版，一張卡兩種都學：
 *   單字卡：中文、英文，再接一句簡單的英文 —— 蘋果。Apple. Yum, delicious apple!
 *   數字卡：先說數字，再說中文、英文 —— One. 一支鉛筆. One pencil.／Eleven. 十一顆蘋果. Eleven apples.
 */
function answerParts(c: Card, withSentence = true): SpeechText[] {
  const sentence = withSentence ? sentenceFor(c) : ''
  if (isNumberCard(c)) {
    const word = enNumber(Number(c.word))
    const label = numberLabels(c)
    return [en(word), zh(label.zh), ...(label.en !== word ? [en(label.en)] : []), en(sentence)]
  }
  const name = speechOf(c)
  return [zh(name.zh), en(name.en), en(sentence)]
}

/**
 * 一張卡寫了好幾句的話，每次翻到這張卡就輪到下一句（第一次從隨便一句開始），
 * 同一本卡今天聽、明天聽，句子都不太一樣。關掉字卡再打開也接著輪，不會又從同一句開始。
 */
const sentenceTurns = useState<Record<string, number>>('cards.sentenceTurns', () => ({}))
const sentenceTurn = ref(0)

function nextSentence() {
  const key = `${props.deck.uid}:${index.value}`
  const prev = sentenceTurns.value[key]
  sentenceTurn.value = prev === undefined ? Math.floor(Math.random() * 12) : prev + 1
  sentenceTurns.value[key] = sentenceTurn.value
}

/** 這張卡這一次要唸、要寫在背面的那一句 */
function sentenceFor(c: Card): string {
  const list = sentencesOf(c, bareDeck.value)
  return list.length ? list[sentenceTurn.value % list.length]! : ''
}

function say(c: Card) {
  clearPrompt()
  speak(answerParts(c))
}

/** 這張卡叫什麼，考考我答對時說：Cat. 貓。／Seven. 七。數字形狀卡連形狀一起說（Seven. 一根拐杖. A cane.） */
function nameParts(c: Card): SpeechText[] {
  if (isNumberCard(c)) {
    const n = Number(c.word)
    return isPicture(c) ? answerParts(c, false) : [en(enNumber(n)), zh(zhNumber(n))]
  }
  const name = speechOf(c)
  return [en(name.en), zh(name.zh)]
}

/** 「這是…」：This is a horse. ／ This is four. 點錯時說一次；小朋友再點那張點錯的，也是唸這句 */
function thisIsParts(c: Card): SpeechText[] {
  return englishOf(c) ? [en(thisIs(c, bareDeck.value))] : [en('This is'), zh(speechOf(c).zh || c.word)]
}

/** 點錯的選項下面貼的小標籤：hippo 河馬、four 四 */
function captionOf(c: Card): string {
  if (isNumberCard(c)) {
    const n = Number(c.word)
    return `${enNumber(n)} ${zhNumber(n)}`
  }
  return [c.word, c.meaning].filter(Boolean).join(' ')
}

/** 字串看起來有多寬（中文字算 1、英文數字算 0.55），標籤用它決定字要縮多小才放得進一行 */
function visualLength(text: string): number {
  return [...text].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 1 : 0.55), 0)
}

/** 字母卡角落的「Pp」 */
function badgeOf(c: Card): string {
  const l = initialOf(c.word)
  return `${l}${l.toLowerCase()}`
}

/* ---------- 看卡片 ---------- */

const index = ref(0)
const flipped = ref(false)
const card = computed(() => cards.value[index.value])
const count = computed(() => (card.value ? countOf(card.value) : null))

/** 數東西的卡：放了 emoji 的 1～20，正面畫出那麼多個讓小朋友點著數；有自己的圖的（數字形狀卡）就直接看圖 */
function isCounting(c: Card): boolean {
  return countOf(c) !== null && !!c.image && !isPicture(c)
}
const showCount = computed(() => !!card.value && isCounting(card.value))

/** 背面的圖：有指定背面圖就用它，否則跟正面同一張 */
const backPicture = computed(() => {
  const c = card.value
  if (!c) return ''
  return c.backImage || (isPicture(c) ? c.image : '')
})
const isLast = computed(() => index.value === cards.value.length - 1)

/**
 * 正面要小朋友做什麼：唸出來，也寫在卡片下面（中文那行是給爸媽看的）。
 *   數東西的卡：Let's count! Touch the apples.
 *   數字卡：What number is this?
 *   單字卡：What is this?
 */
function frontAsk(c: Card): { say: string; en: string; zh: string } {
  if (isCounting(c)) {
    const noun = countNounOf(c)
    const touch = `Touch ${noun ? `the ${countOf(c) === 1 ? noun.en : noun.plural}` : 'them'}.`
    return { say: `Let's count! ${touch}`, en: touch, zh: '點點看，一個一個數' }
  }
  if (isNumberCard(c)) return { say: 'What number is this?', en: 'What number is this?', zh: '這是數字幾？點一下翻面' }
  return { say: 'What is this?', en: 'What is this?', zh: '這是什麼？點一下翻面' }
}

/** 數完之後的題目：How many apples are there? */
function countQuestion(c: Card): string {
  const noun = countNounOf(c)
  return `How many ${noun ? `${noun.plural} ` : ''}are there?`
}

/** 數字卡上已經點過的東西，依點的順序排，數字徽章就是它的位置 */
const counted = ref<number[]>([])
/** 數完了問 How many：三個數字給小朋友選，空的表示還沒數完 */
const countOptions = ref<number[]>([])
const countWrong = ref<number[]>([])
/** How many 答對了沒：數東西的卡要先數完、答對，才翻得過去看答案 */
const countSolved = ref(false)
const mustCountFirst = computed(() => showCount.value && !countSolved.value)
/** 還沒答對就點卡片：題目跳一下，提醒小朋友現在要做什麼 */
const nudging = ref(false)

/* 字母卡上方的 A～Z：有卡的字母可以點，點了跳到那個字母的第一張 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const letterIndex = computed(() => {
  const map = new Map<string, number>()
  cards.value.forEach((c, i) => {
    const l = initialOf(c.word)
    if (l && !map.has(l)) map.set(l, i)
  })
  return map
})
const currentLetter = computed(() => (isAbc.value && card.value ? initialOf(card.value.word) : ''))

/**
 * 數字卡上方的一排數字：數字是一天教一點，要能直接跳到今天教的那個。
 * 卡不多就一張一個；像 0～100 那麼多張，改成每十個一格（0、10、20…），點了跳到那一段的第一張。
 */
const numberChips = computed(() => {
  if (!isNumberDeck.value) return []
  const list = cards.value
  if (list.length <= 24) return list.map((c, i) => ({ label: c.word, index: i }))
  const chips: { label: string; index: number }[] = []
  const seen = new Set<number>()
  list.forEach((c, i) => {
    const tens = Math.floor(Number(c.word) / 10) * 10
    if (seen.has(tens)) return
    seen.add(tens)
    chips.push({ label: String(tens), index: i })
  })
  return chips
})
/** 現在這張卡落在哪一格：最後一個起點不超過現在這張的 */
const currentChip = computed(() => {
  let at = -1
  for (const chip of numberChips.value) if (chip.index <= index.value) at = chip.index
  return at
})

/** 數字卡的排法：讓東西排得像骰子、蛋盒那樣好數，不要一長串 */
const countCols = computed(() => {
  const n = count.value ?? 0
  if (n <= 3) return n
  if (n === 4) return 2
  if (n <= 6) return 3
  if (n <= 8) return 4
  if (n === 9) return 3
  return 5
})
const countRows = computed(() => Math.ceil((count.value ?? 0) / Math.max(1, countCols.value)))

let flipTimer: ReturnType<typeof setTimeout> | null = null
let promptTimer: ReturnType<typeof setTimeout> | null = null

function clearPrompt() {
  if (promptTimer) clearTimeout(promptTimer)
  promptTimer = null
}

/** 換到一張新卡：停一下再問「What is this?」，小朋友知道要開始猜（或開始數）了 */
function askCardLater() {
  clearPrompt()
  if (!canSpeak) return
  const at = index.value
  promptTimer = setTimeout(() => {
    const c = card.value
    if (!c || index.value !== at || flipped.value || mode.value !== 'learn' || clip.value) return
    speak([en(frontAsk(c).say)])
  }, 450)
}

function flip() {
  clearPrompt()
  flipped.value = !flipped.value
  if (flipped.value && card.value) speak(answerParts(card.value))
  else stopSpeaking()
}

let nudgeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 數東西的卡還沒答對：不翻面，把現在要做的事再說一次——
 * 還在數就說「Let's count! Touch the apples.」，數完了就再問「How many apples are there?」
 */
function nudge() {
  const c = card.value
  if (!c) return
  clearPrompt()
  speak([en(countOptions.value.length ? countQuestion(c) : frontAsk(c).say)])
  // 先拿掉再加回去，連點好幾下動畫也會重新跳
  nudging.value = false
  if (nudgeTimer) clearTimeout(nudgeTimer)
  requestAnimationFrame(() => {
    nudging.value = true
    nudgeTimer = setTimeout(() => { nudging.value = false }, 600)
  })
}

/** 點卡片（或電視遙控器按確定）：數東西的卡要先回答 How many，其他的卡直接翻面 */
function tapCard() {
  if (mustCountFirst.value) nudge()
  else flip()
}

/** 「聽」按鈕：數東西的卡還沒答對前，只把題目再說一次，不先把答案說出來 */
function listen() {
  if (mustCountFirst.value) nudge()
  else if (card.value) say(card.value)
}

function resetCard() {
  if (flipTimer) clearTimeout(flipTimer)
  flipped.value = false
  counted.value = []
  countOptions.value = []
  countWrong.value = []
  countSolved.value = false
  nextSentence()
}

function go(step: number) {
  const n = cards.value.length
  if (!n) return
  index.value = (index.value + step + n) % n
  resetCard()
  stopSpeaking()
  askCardLater()
}

function jumpTo(letter: string) {
  const i = letterIndex.value.get(letter)
  if (i !== undefined) go(i - index.value)
}

/** 點一個東西就用英文數一個，數到最後一個就問 How many …? */
function countTap(i: number) {
  if (swiped) {
    swiped = false
    return
  }
  if (counted.value.includes(i) || countOptions.value.length) return
  clearPrompt()
  counted.value = [...counted.value, i]
  const n = counted.value.length
  speak([en(enNumber(n))], 0.9)

  if (n === count.value) {
    const at = index.value
    flipTimer = setTimeout(() => {
      if (index.value !== at || flipped.value || mode.value !== 'learn' || !card.value) return
      countOptions.value = countChoices(n)
      speak([en(countQuestion(card.value))])
    }, 700)
  }
}

/** How many 的三個選項：答案和差一兩個的數字，照大小排，像數線一樣好找 */
function countChoices(n: number): number[] {
  const near = shuffle([n - 2, n - 1, n + 1, n + 2].filter((x) => x >= 1)).slice(0, 2)
  return [n, ...near].sort((a, b) => a - b)
}

/** 選對了翻面揭曉：Yes! Eleven. 十一顆蘋果. Eleven apples. 選錯告訴他選的是幾，再試一次 */
function pickCount(opt: number) {
  const c = card.value
  if (!c || flipped.value) return
  if (opt === count.value) {
    chimeRight()
    countSolved.value = true
    flipped.value = true
    speak([{ pause: 250 }, en('Yes!'), { pause: 300 }, ...answerParts(c)])
    return
  }
  if (countWrong.value.includes(opt)) return
  countWrong.value = [...countWrong.value, opt]
  chimeWrong()
  speak([{ pause: 250 }, en('No!'), { pause: 300 }, en(`This is ${enNumber(opt)}.`), { pause: 500 }, en('Try again!')])
}

/* 左右滑換卡；滑過之後瀏覽器還是會送一次 click，要把它吃掉，不然會順便翻面 */
let swipeX: number | null = null
let swiped = false

function onPointerDown(e: PointerEvent) {
  swipeX = e.clientX
  swiped = false
}

function onPointerUp(e: PointerEvent) {
  if (swipeX === null) return
  const dx = e.clientX - swipeX
  swipeX = null
  if (Math.abs(dx) > 60) {
    swiped = true
    go(dx < 0 ? 1 : -1)
  }
}

function onCardClick() {
  if (swiped) {
    swiped = false
    return
  }
  tapCard()
}

const cardRef = ref<HTMLElement | null>(null)

function toLearn() {
  clearQuizTimers()
  stopSpeaking()
  mode.value = 'learn'
  resetCard()
  askCardLater()
  if (isTv) nextTick(() => cardRef.value?.focus())
}

/* ---------- 考考我：聽題目，從幾張圖裡點出對的 ---------- */

/** 一輪最多幾題：小朋友專注的時間很短，寧可多玩幾輪 */
const QUIZ_LEN = 8

const canQuiz = computed(() => cards.value.length >= 2)

/**
 * 題目的種類：
 *   listen  聽題目（Where is the cat? / Can you find number seven?），點出是哪張圖；數字卡沒有自己的圖時，點的是數字
 *   picture 看形狀圖，點出是數字幾（What number is this?，數字卡有自己的圖時）
 */
type QuizKind = 'listen' | 'picture'

interface Question {
  kind: QuizKind
  /** 正確答案是第幾張卡 */
  answer: number
  options: number[]
  /** 用哪一種問法（Where is／Can you find／Can you touch）；點錯再問一次時用同一句 */
  style: number
  /** 這題點錯過，答對也不給星星 */
  missed: boolean
  /** 點錯之後補考的那一題，不會再補第二次 */
  retry: boolean
}

const questions = ref<Question[]>([])
const qIndex = ref(0)
const question = computed(() => questions.value[qIndex.value])
const wrongPicks = ref<number[]>([])
const rightPick = ref<number | null>(null)
/** 這題有沒有拿到星星：一次就答對才有，點錯過再答對給個讚 */
const earned = ref(false)
const roundStars = ref(0)
const roundSize = ref(0)
const quizDone = ref(false)

let askTimer: ReturnType<typeof setTimeout> | null = null
/** 每次答對換一個編號；換了模式、離開畫面就作廢，舊的「唸完換下一題」不會亂跳 */
let feedbackToken = 0

function clearQuizTimers() {
  if (askTimer) clearTimeout(askTimer)
  askTimer = null
  feedbackToken++
}

/** 回饋唸完才做下一步；沒有語音的裝置至少停 1.2 秒，讓小朋友看到星星 */
function speakThen(parts: SpeechPart[], then: () => void) {
  const token = ++feedbackToken
  const minWait = new Promise((r) => setTimeout(r, 1200))
  Promise.all([speak(parts), minWait]).then(() => {
    if (token === feedbackToken && mode.value === 'quiz') then()
  })
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * 這張卡可以出哪幾種題目。
 * 數字形狀卡兩種混著出：看圖選數字，以及聽數字（Can you find number seven?）從形狀圖裡找出拐杖。
 */
function kindsFor(c: Card): QuizKind[] {
  return countOf(c) !== null && isPicture(c) ? ['picture', 'listen'] : ['listen']
}

/** 數字容易搞混的數字：31 → 13（左右顛倒，最優先）、30、32、21、41（差一點點） */
function confusablesOf(n: number): number[] {
  const s = String(n)
  const flipped = s.length === 2 ? [Number(s[1]! + s[0]!)] : []
  return [...flipped, ...shuffle([n - 1, n + 1, n - 10, n + 10])].filter((x) => x !== n && x >= 0)
}

function makeQuestion(answer: number, retry = false): Question {
  const card = cards.value[answer]!
  const kinds = kindsFor(card)
  const kind = kinds[Math.floor(Math.random() * kinds.length)]!
  // 數字題先放一個容易搞混的數字（31 配 13 或 30），另一個隨機——兩個都相近的話，
  // 答案老是夾在中間（6、7、8），小朋友很快就會用猜的
  const tricky = isNumberCard(card)
    ? confusablesOf(Number(card.word))
      .map((n) => cards.value.findIndex((c) => c.word === String(n)))
      .filter((i) => i >= 0)
      .slice(0, 1)
    : []
  const rest = shuffle(cards.value.map((_, i) => i).filter((i) => i !== answer))
  // 選項的圖不能重複，不然兩張一樣的圖小朋友根本分不出哪個才對
  const seen = new Set([optionFace(card, kind)])
  const others = [...new Set([...tricky, ...rest])]
    .filter((i) => {
      const face = optionFace(cards.value[i]!, kind)
      if (seen.has(face)) return false
      seen.add(face)
      return true
    })
    .slice(0, 2)
  return {
    kind,
    answer,
    options: shuffle([answer, ...others]),
    style: Math.floor(Math.random() * ASK_STYLES),
    missed: false,
    retry,
  }
}

const optionsRef = ref<HTMLElement | null>(null)

function focusFirstOption() {
  if (!isTv) return
  nextTick(() => optionsRef.value?.querySelector<HTMLElement>('.option:not(:disabled)')?.focus())
}

function startQuiz() {
  clearQuizTimers()
  clearPrompt()
  stopSpeaking()
  const order = shuffle(cards.value.map((_, i) => i)).slice(0, QUIZ_LEN)
  questions.value = order.map((i) => makeQuestion(i))
  roundSize.value = order.length
  qIndex.value = 0
  roundStars.value = 0
  wrongPicks.value = []
  rightPick.value = null
  quizDone.value = false
  mode.value = 'quiz'
  askLater(450, true)
  focusFirstOption()
}

/** 數字卡有自己的圖（例如數字形狀卡）：改成看圖選數字 */
const pictureQuiz = computed(() => question.value?.kind === 'picture')

/**
 * 題目怎麼問：Where is the cat? / Can you find number seven? / Can you touch the glasses?
 * 看圖選數字問 What number is this? 卡片沒有英文的話，只好用中文問。
 */
function promptParts(q: Question): SpeechText[] {
  if (q.kind === 'picture') return [en('What number is this?')]
  const c = cards.value[q.answer]!
  const ask = askOf(c, q.style, bareDeck.value)
  return ask ? [en(ask)] : [zh(`${speechOf(c).zh || c.word}在哪裡？`)]
}

/** 第一題前面先說一聲，小朋友知道要開始玩了 */
function ask(intro = false) {
  const q = question.value
  if (!q) return
  speak([...(intro ? [en("Let's play a game!"), { pause: 400 }] : []), ...promptParts(q)])
}

function askLater(ms = 450, intro = false) {
  if (askTimer) clearTimeout(askTimer)
  askTimer = setTimeout(() => ask(intro), ms)
}

/**
 * 點錯了要說的話：先說 No!，告訴他點的是什麼，再把題目問一次。
 *   No! This is a horse. Listen again. …… Where is the frog?
 *   No! This is four. Try again. …… What number is this?
 * 「Listen again.」後面停將近一秒，小朋友才聽得出接下來那句是題目，不會跟前一句黏在一起。
 */
function remindParts(wrong: Card, q: Question): SpeechPart[] {
  return [
    { pause: 250 },
    en('No!'),
    { pause: 300 },
    ...thisIsParts(wrong),
    { pause: 500 },
    en(q.kind === 'listen' ? 'Listen again.' : 'Try again.'),
    { pause: 900 },
    ...promptParts(q),
  ]
}

function pick(opt: number) {
  const q = question.value
  if (!q || rightPick.value !== null) return

  // 點過的錯誤選項再點一次：只把它的名字唸給他聽，不再說 No、不再扣分，讓他自己比較
  if (wrongPicks.value.includes(opt)) {
    if (askTimer) clearTimeout(askTimer)
    speak(thisIsParts(cards.value[opt]!))
    return
  }

  if (opt === q.answer) {
    rightPick.value = opt
    earned.value = !q.missed
    chimeRight()
    if (!q.missed) {
      roundStars.value++
      addStar(props.deck.uid)
    }
    // 先說 Yes!，再把答案說一遍當複習；整串唸完才換下一題，不會被下一題的題目切掉
    speakThen([
      { pause: 250 },
      en('Yes!'),
      { pause: 400 },
      ...nameParts(cards.value[q.answer]!),
    ], nextQuestion)
    return
  }

  wrongPicks.value = [...wrongPicks.value, opt]
  chimeWrong()
  // 點錯的那個字，這一輪最後再考一次 —— 不會的字多碰一次，比答對的字更值得
  if (!q.missed && !q.retry) questions.value.push(makeQuestion(q.answer, true))
  q.missed = true

  // 點錯正好是教的時候：No!，告訴他點的是什麼，再把題目問一次（開頭停一下，讓答錯的音效先響完）
  if (askTimer) clearTimeout(askTimer)
  speak(remindParts(cards.value[opt]!, q))
}

/** 玩完一輪的鼓勵：Great job! You got five stars! */
function doneParts(): SpeechPart[] {
  const s = roundStars.value
  const cheer = s >= roundSize.value
    ? 'Wow! You got them all! Great job!'
    : s === 0
      ? "Good try! Let's play again!"
      : `Great job! You got ${enNumber(s)} ${s === 1 ? 'star' : 'stars'}!`
  return [{ pause: 500 }, en(cheer)]
}

function nextQuestion() {
  wrongPicks.value = []
  rightPick.value = null
  if (qIndex.value + 1 >= questions.value.length) {
    quizDone.value = true
    chimeRight()
    speak(doneParts())
    return
  }
  qIndex.value++
  askLater()
  focusFirstOption()
}

/**
 * 選項上畫什麼：看圖選數字畫數字；其他題目畫圖——
 * 數字卡沒有自己的圖（🍎 只是拿來數的），就畫數字；沒有圖的卡寫字。
 */
function optionFace(c: Card, kind: QuizKind): string {
  if (kind === 'picture' || (isNumberCard(c) && !isPicture(c))) return c.word
  return c.image || c.word
}

/** 選項要不要用 <img> 畫 */
function optionIsImage(c: Card, kind: QuizKind): boolean {
  return kind !== 'picture' && isPicture(c)
}

/** 沒有語音的裝置（例如部分電視）只好把題目寫出來 */
const promptText = computed(() => {
  const q = question.value
  return q ? promptParts(q).map((p) => p.text).join(' ') : ''
})

/* ---------- 影片片段：只播老師教這個字的那幾秒 ---------- */

const clip = ref<CardClip | null>(null)
const clipCloseRef = ref<HTMLButtonElement | null>(null)

const {
  hostRef, status: clipStatus, load: loadClip, toggle: toggleClip, teardown: teardownClip,
} = useYouTubePlayer({ onFinish: closeClip })

async function openClip(c: CardClip) {
  clearPrompt()
  stopSpeaking()
  clip.value = c
  await nextTick()
  loadClip(c.id, { start: c.start, end: c.end })
  if (isTv) clipCloseRef.value?.focus()
}

function closeClip() {
  teardownClip()
  clip.value = null
}

/* ---------- 觀看時間：字卡也是看螢幕，一樣要算進每日額度 ---------- */

let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && clip.value) {
    closeClip()
    return
  }
  // 電視上方向鍵要留給遙控器移動焦點；電腦鍵盤才用左右鍵換卡
  if (isTv || clip.value || mode.value !== 'learn') return
  if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
}

onMounted(() => {
  lastTick = Date.now()
  ticker = setInterval(() => {
    const now = Date.now()
    const delta = (now - lastTick) / 1000
    lastTick = now
    // 間隔太久表示 App 被切到背景，那段不計
    if (delta > 0 && delta < 3) addSeconds(delta)
    if (isLimitReached.value) emit('close')
  }, 1000)

  window.addEventListener('keydown', onKey)
  nextSentence()
  askCardLater()
  if (isTv) nextTick(() => cardRef.value?.focus())
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (flipTimer) clearTimeout(flipTimer)
  clearPrompt()
  clearQuizTimers()
  stopSpeaking()
  window.removeEventListener('keydown', onKey)
  flush()
})
</script>

<template>
  <section class="deck-view" :style="{ '--deck': color }">
    <header class="deck-bar">
      <button class="bar-back" aria-label="回到清單" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        <span>返回</span>
      </button>

      <h2 class="deck-title">{{ deck.title }}</h2>

      <span class="star-pill" :aria-label="`已經拿到 ${stars} 顆星`">
        <span aria-hidden="true">⭐</span>{{ stars }}
      </span>

      <nav class="mode-tabs" aria-label="模式">
        <button
          class="mode-tab"
          :class="{ 'is-active': mode === 'learn' }"
          :aria-current="mode === 'learn' ? 'true' : undefined"
          @click="toLearn"
        >
          <span aria-hidden="true">📖</span>看卡片
        </button>
        <button
          v-if="canQuiz"
          class="mode-tab"
          :class="{ 'is-active': mode === 'quiz' }"
          :aria-current="mode === 'quiz' ? 'true' : undefined"
          @click="startQuiz"
        >
          <span aria-hidden="true">🎯</span>考考我
        </button>
      </nav>
    </header>

    <!-- ===== 看卡片 ===== -->
    <main v-if="mode === 'learn' && card" class="learn">
      <!-- 字母卡：A～Z 一排，點字母直接跳過去，沒有卡的字母淡掉 -->
      <nav v-if="isAbc" class="jump-strip" aria-label="字母">
        <button
          v-for="l in ALPHABET"
          :key="l"
          class="jump-chip"
          :class="{ 'is-current': l === currentLetter }"
          :disabled="!letterIndex.has(l)"
          :aria-current="l === currentLetter ? 'true' : undefined"
          @click="jumpTo(l)"
        >
          {{ l }}
        </button>
      </nav>
      <!-- 數字卡：一排數字，今天教到哪個就直接點過去 -->
      <nav v-else-if="numberChips.length" class="jump-strip" aria-label="數字">
        <button
          v-for="chip in numberChips"
          :key="chip.index"
          class="jump-chip is-number"
          :class="{ 'is-current': chip.index === currentChip }"
          :aria-current="chip.index === currentChip ? 'true' : undefined"
          @click="go(chip.index - index)"
        >
          {{ chip.label }}
        </button>
      </nav>

      <div class="stage">
        <div
          ref="cardRef"
          class="flip"
          :class="{ 'is-flipped': flipped }"
          role="button"
          tabindex="0"
          :aria-label="flipped ? '翻回正面' : mustCountFirst ? '先數一數' : '翻面看答案'"
          @click="onCardClick"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="swipeX = null"
          @keydown.enter.prevent="tapCard"
          @keydown.space.prevent="tapCard"
        >
          <div class="flip-inner">
            <!-- 正面只有圖：先讓小朋友自己猜、自己數 -->
            <div class="face face-front" :class="{ 'is-asking': countOptions.length, 'is-nudging': nudging }" :aria-hidden="flipped">
              <span v-if="currentLetter" class="abc-badge">{{ badgeOf(card) }}</span>
              <div
                v-if="showCount"
                class="count-grid"
                :style="{ '--cols': countCols, '--rows': countRows }"
              >
                <button
                  v-for="i in count"
                  :key="`${index}-${i}`"
                  type="button"
                  class="count-item"
                  :class="{ 'is-counted': counted.includes(i), 'is-past-ten': (count ?? 0) > 10 && i > 10 && i <= 15 }"
                  :aria-label="`數第 ${i} 個`"
                  @click.stop="countTap(i)"
                >
                  <span class="count-emoji">{{ card.image || '⭐' }}</span>
                  <span v-if="counted.includes(i)" class="count-badge">{{ counted.indexOf(i) + 1 }}</span>
                </button>
              </div>
              <img v-else-if="isPicture(card)" class="face-img" :src="imageSrc(card.image)" alt="" draggable="false">
              <span v-else-if="card.image" class="face-emoji">{{ card.image }}</span>
              <span v-else class="face-word" :style="{ '--len': card.word.length }">{{ card.word }}</span>

              <!-- 數完了：How many apples are there? 三個數字選一個 -->
              <div v-if="countOptions.length" class="count-ask" @click.stop>
                <p class="count-question">{{ countQuestion(card) }}</p>
                <div class="count-options">
                  <button
                    v-for="opt in countOptions"
                    :key="opt"
                    type="button"
                    class="count-option"
                    :class="{ 'is-wrong': countWrong.includes(opt) }"
                    @click.stop="pickCount(opt)"
                  >
                    {{ opt }}
                  </button>
                </div>
              </div>
              <!-- 現在要做什麼：英文那行是說給小朋友聽的，中文那行給爸媽看 -->
              <span v-else class="face-hint">
                <span class="hint-en">{{ frontAsk(card).en }}</span>
                <span class="hint-zh">{{ frontAsk(card).zh }}</span>
              </span>
            </div>

            <!-- 背面是答案：大字＋說明，翻過來的同時唸出來 -->
            <div
              class="face face-back"
              :class="{ 'has-back-image': card.backImage, 'has-number-sentence': isNumberCard(card) && sentenceFor(card) }"
              :aria-hidden="!flipped"
            >
              <!-- 背面放了原卡的話，原卡上本來就印著字母，不再疊一個標籤 -->
              <span v-if="currentLetter && !card.backImage" class="abc-badge">{{ badgeOf(card) }}</span>
              <img v-if="backPicture" class="back-img" :src="imageSrc(backPicture)" alt="" draggable="false">
              <span v-else-if="card.image && count === null" class="back-emoji">{{ card.image }}</span>
              <!-- 數字卡背面也排一排小小的實物，數量跟數字放在一起看 -->
              <span v-if="showCount" class="back-count">{{ (card.image || '⭐').repeat(count ?? 0) }}</span>
              <span class="back-word" :class="{ 'is-number': isNumberCard(card) }" :style="{ '--len': card.word.length }">
                <!-- 字母卡把開頭字母上色：A is for ant 的那個 a -->
                <template v-if="currentLetter"><span class="back-initial">{{ card.word.charAt(0) }}</span>{{ card.word.slice(1) }}</template>
                <template v-else>{{ card.word }}</template>
              </span>
              <!-- 數字卡：one pencil／一支鉛筆；單字卡：說明，再加上翻面時唸的那句英文 -->
              <template v-if="isNumberCard(card)">
                <span class="back-meaning">{{ numberLabels(card).en }}</span>
                <span class="back-sub">{{ numberLabels(card).zh }}</span>
                <span v-if="sentenceFor(card)" class="back-sub back-sentence">{{ sentenceFor(card) }}</span>
              </template>
              <template v-else>
                <span v-if="card.meaning" class="back-meaning">{{ card.meaning }}</span>
                <span v-if="sentenceFor(card)" class="back-sub">{{ sentenceFor(card) }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="progress" :aria-label="`第 ${index + 1} 張，共 ${cards.length} 張`">
        <!-- 上面已經有一排字母、數字的話，不用再排一排點點 -->
        <template v-if="cards.length <= 15 && !isAbc && !numberChips.length">
          <span
            v-for="(_, i) in cards"
            :key="i"
            class="dot"
            :class="{ 'is-current': i === index, 'is-seen': i < index }"
          />
        </template>
        <span class="progress-text">{{ index + 1 }} / {{ cards.length }}</span>
      </div>

      <div class="learn-controls">
        <button class="ctl ctl-nav" aria-label="上一張" @click="go(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        </button>

        <button v-if="canSpeak" class="ctl ctl-wide" @click="listen">
          <span aria-hidden="true">🔊</span>聽
        </button>

        <!-- 影片片段要有網路才放得出來，沒網路時先藏起來，字卡本身照常玩 -->
        <button v-if="card.clip && online" class="ctl ctl-wide ctl-video" @click="openClip(card.clip)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>看影片
        </button>

        <!-- 看到最後一張，下一步順勢接到考考我 -->
        <button v-if="isLast && canQuiz" class="ctl ctl-wide ctl-quiz" @click="startQuiz">
          <span aria-hidden="true">🎯</span>考考我
        </button>
        <button v-else class="ctl ctl-nav" aria-label="下一張" @click="go(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
        </button>
      </div>
    </main>

    <!-- ===== 考考我 ===== -->
    <main v-else-if="mode === 'quiz'" class="quiz" :class="{ 'is-picture': pictureQuiz && !quizDone }">
      <template v-if="!quizDone && question">
        <p class="quiz-progress">第 {{ qIndex + 1 }} 題／共 {{ questions.length }} 題</p>

        <!-- 看圖選數字：題目就是那張形狀圖 -->
        <template v-if="pictureQuiz">
          <img class="prompt-img" :src="imageSrc(cards[question.answer]!.image)" alt="" draggable="false">
          <p class="prompt-text">
            What number is this?
            <span class="prompt-zh">這是數字幾？</span>
          </p>
        </template>
        <!-- 題目不寫出來（寫了就等於把答案給他看），用聽的；沒有語音的裝置才把題目寫出來 -->
        <button v-else class="ask-btn" @click="ask()">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span v-if="canSpeak" class="ask-label">
            Listen and touch!
            <span class="ask-zh">聽聽看，點出對的那一張</span>
          </span>
          <span v-else>{{ promptText }}</span>
        </button>

        <div ref="optionsRef" class="options" :class="{ 'is-compact': pictureQuiz }">
          <button
            v-for="opt in question.options"
            :key="`${qIndex}-${opt}`"
            class="option"
            :class="{ 'is-right': rightPick === opt, 'is-wrong': wrongPicks.includes(opt) }"
            :aria-label="wrongPicks.includes(opt) ? `再聽一次 ${cards[opt]!.word}` : `選項 ${cards[opt]!.word}`"
            @click="pick(opt)"
          >
            <img
              v-if="optionIsImage(cards[opt]!, question.kind)"
              class="option-img"
              :src="imageSrc(cards[opt]!.image)"
              alt=""
              draggable="false"
            >
            <span v-else class="option-face" :style="{ '--len': optionFace(cards[opt]!, question.kind).length }">
              {{ optionFace(cards[opt]!, question.kind) }}
            </span>
            <span v-if="rightPick === opt" class="option-star" aria-hidden="true">{{ earned ? '⭐' : '👍' }}</span>
            <!-- 點錯的那張貼上名字，不會唸的時候也看得到它是什麼；前面的 🔊 表示可以再點一次聽它唸 -->
            <span v-if="wrongPicks.includes(opt)" class="option-caption" :style="{ '--len': visualLength(captionOf(cards[opt]!)) + 1.4 }">
              <span aria-hidden="true">🔊 </span>{{ captionOf(cards[opt]!) }}
            </span>
          </button>
        </div>
      </template>

      <div v-else class="quiz-done">
        <span class="done-emoji" aria-hidden="true">{{ roundStars >= roundSize ? '🏆' : '🎉' }}</span>
        <p class="done-title">
          {{ roundStars >= roundSize ? '全部答對！' : '玩完一輪了！' }}
        </p>
        <p class="done-stars">
          拿到 <strong>{{ roundStars }}</strong> 顆星
        </p>
        <div class="done-row" aria-hidden="true">
          <span v-for="i in roundSize" :key="i" class="done-star" :class="{ 'is-on': i <= roundStars }">⭐</span>
        </div>
        <div class="done-actions">
          <button class="ctl ctl-wide ctl-quiz" @click="startQuiz">再玩一次</button>
          <button class="ctl ctl-wide" @click="toLearn">回去看卡片</button>
        </div>
      </div>
    </main>

    <!-- ===== 影片片段 ===== -->
    <div v-if="clip" class="clip-veil" role="dialog" aria-label="影片片段" @click.self="closeClip">
      <div class="clip-box">
        <div ref="hostRef" class="clip-player" />
        <!-- 蓋一層在影片上：點畫面就是暫停／播放，不會點到 YouTube 自己的東西 -->
        <button class="clip-shield" :aria-label="clipStatus === 'playing' ? '暫停' : '播放'" @click="toggleClip">
          <span v-if="clipStatus === 'error'" class="clip-msg">😅 這段影片沒辦法播放</span>
          <span v-else-if="clipStatus !== 'playing'" class="clip-play" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      </div>
      <button ref="clipCloseRef" class="ctl ctl-wide" @click="closeClip">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z" /></svg>關掉影片
      </button>
    </div>
  </section>
</template>

<style scoped>
.deck-view {
  /* 卡片本身固定是「紙」的顏色，亮暗主題都一樣，比較像真的字卡 */
  --paper: #fffdf7;
  --ink: #221d45;
  --ink-dim: #6a6490;

  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  overflow: hidden;
}

/* ---------- 頂部列 ---------- */
.deck-bar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: calc(var(--safe-t) + 14px) calc(var(--safe-r) + 20px) 10px calc(var(--safe-l) + 20px);
}

.bar-back {
  flex: none;
  height: 52px;
  padding: 0 16px 0 10px;
  border: 0;
  border-radius: 16px;
  background: var(--accent-2);
  color: var(--on-accent-2);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.bar-back:active { transform: scale(.94); }
.bar-back svg { width: 26px; height: 26px; fill: currentColor; }

.deck-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: clamp(19px, 2.4vw, 26px);
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.star-pill {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.mode-tabs {
  flex: none;
  display: flex;
  gap: 6px;
  padding: 5px;
  border-radius: 999px;
  background: var(--bg-card);
}

.mode-tab {
  height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.mode-tab.is-active {
  background: var(--deck);
  color: var(--ink);
}

/* ---------- 看卡片 ---------- */
.learn,
.quiz {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px calc(var(--safe-r) + 20px) calc(var(--safe-b) + 16px) calc(var(--safe-l) + 20px);
}

.stage {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  perspective: 1400px;
}

.flip {
  position: relative;
  height: 100%;
  max-height: 540px;
  aspect-ratio: 4 / 5;
  max-width: 100%;
  cursor: pointer;
  /* 只接管左右滑，上下還是交給瀏覽器 */
  touch-action: pan-y;
}

.flip-inner {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transition: transform .55s cubic-bezier(.3, 1.4, .5, 1);
}
.flip.is-flipped .flip-inner { transform: rotateY(180deg); }

.face {
  position: absolute;
  inset: 0;
  container-type: size;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  /* 這裡不能用 cq 單位：容器自己的 padding 會去參照外層（沒有外層就變成整個視窗） */
  padding: 40px 22px 30px;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 18px 40px var(--shadow), 0 2px 0 rgba(0, 0, 0, .06);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  overflow: hidden;
}

/* 字母卡左上角的「Aa」 */
.abc-badge {
  position: absolute;
  top: 24px;
  left: 18px;
  z-index: 1;
  padding: 2px 12px 4px;
  border-radius: 14px;
  background: var(--deck);
  color: var(--ink);
  font-size: max(20px, min(9cqh, 12cqw));
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 1px;
}

/* 分區色在淺色卡片上有些太淡，混一點深色墨水讓它清楚 */
.back-initial {
  color: var(--deck);
  color: color-mix(in srgb, var(--deck) 70%, var(--ink));
}

/* 卡片頂端一條分區色，跟片單上的顏色呼應 */
.face::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 12px;
  background: var(--deck);
}

.face-back {
  transform: rotateY(180deg);
  background: var(--paper);
  background: color-mix(in srgb, var(--deck) 14%, var(--paper));
}

.face-emoji { font-size: min(52cqw, 44cqh); line-height: 1.1; }
.back-emoji { font-size: min(30cqw, 26cqh); line-height: 1.1; }

.face-img,
.back-img {
  /* 用 width/height 而不是 max-*：小張的圖也要放大到填滿，不然會縮在卡片正中間一小塊 */
  width: 92%;
  min-height: 0;
  object-fit: contain;
  border-radius: 18px;
  pointer-events: none;
}
.face-img { height: 64%; }

/* 正面的圖、字往上挪一點，底下留位子給「What is this?」那兩行 */
.face-front > .face-img,
.face-front > .face-emoji,
.face-front > .face-word { margin-bottom: 10cqh; }
.back-img { flex: none; height: 42%; }


/* 長的字自動縮小，elephant 跟 3 都要剛好塞得下 */
.face-word,
.back-word.is-number {
  font-size: min(38cqh, calc(150cqw / max(var(--len), 2.4)));
}
/* 單字卡背面還要放說明和一句英文，字小一點 */
.back-word { font-size: min(28cqh, calc(130cqw / max(var(--len), 2.4))); }
.face-word,
.back-word {
  font-weight: 900;
  line-height: 1;
  letter-spacing: .5px;
}
.back-word { color: var(--ink); }

.back-count {
  max-width: 92%;
  font-size: min(7cqh, 8cqw);
  line-height: 1.25;
  text-align: center;
  letter-spacing: 2px;
}

.back-meaning {
  font-size: min(9cqh, 10cqw);
  font-weight: 800;
  color: var(--ink-dim);
  text-align: center;
}

/* 數字卡還有一句英文（I have two eyes.）：大數字縮小一點，句子才放得下 */
.has-number-sentence .back-word.is-number { font-size: min(26cqh, calc(120cqw / max(var(--len), 2.4))); }
.back-sub.back-sentence { color: var(--ink); }

/* 翻面時唸的那句英文，或是數字卡的中文說法 */
.back-sub {
  max-width: 92%;
  font-size: max(13px, min(5.6cqh, 6.4cqw));
  font-weight: 700;
  line-height: 1.25;
  color: var(--ink-dim);
  text-align: center;
}

/* 背面另外放了一張完整的卡（上面已經有數字和名稱），圖放大、下面的字縮小；要寫在一般大小的後面才蓋得過 */
.has-back-image { gap: 6px; padding-top: 28px; }
.has-back-image .back-img { height: 58%; }
.has-back-image .back-word { font-size: min(14cqh, calc(80cqw / max(var(--len), 2.4))); }
.has-back-image .back-meaning { font-size: min(7cqh, 8cqw); }
.has-back-image .back-sub { font-size: max(12px, min(4.6cqh, 5.4cqw)); }

.face-hint {
  position: absolute;
  left: 4%;
  right: 4%;
  bottom: 3.5cqh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .6cqh;
  text-align: center;
  line-height: 1.2;
}
.hint-en {
  font-size: max(16px, min(6cqh, 7cqw));
  font-weight: 900;
  color: var(--ink);
}
.hint-zh {
  font-size: max(12px, min(3.8cqh, 4.4cqw));
  font-weight: 700;
  color: var(--ink-dim);
}

/* 數字卡：一個一個點著數 */
.count-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), auto);
  gap: 2.5cqh 3cqw;
  justify-content: center;
  align-content: center;
  margin-bottom: 12cqh;
}

.count-item {
  position: relative;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition: transform .15s ease, opacity .15s ease;
}
.count-item:active { transform: scale(.9); }

/* 超過 10：前 10 個是兩排 5 個（一個「十」），第 11 個起隔開一點，一眼看出 13 = 10 + 3 */
.count-item.is-past-ten { margin-top: 4cqh; }

.count-emoji {
  display: block;
  font-size: min(calc(76cqw / var(--cols)), calc(60cqh / var(--rows)), 34cqh);
}

/* 數完要回答 How many：東西縮小一點，底下讓給題目和選項 */
.is-asking .count-grid { margin-bottom: 30cqh; }
.is-asking .count-emoji { font-size: min(calc(70cqw / var(--cols)), calc(40cqh / var(--rows)), 22cqh); }
.is-asking .count-badge { font-size: max(10px, min(calc(14cqw / var(--cols)), 5cqh)); }

.count-ask {
  position: absolute;
  left: 4%;
  right: 4%;
  bottom: 3.5cqh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2cqh;
  cursor: default;
}
.count-question {
  margin: 0;
  font-size: max(16px, min(6cqh, 7cqw));
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
}
.count-options { display: flex; gap: 5cqw; }
.count-option {
  width: min(17cqh, 22cqw);
  height: min(17cqh, 22cqw);
  padding: 0;
  border: 4px solid var(--deck);
  border-radius: 18px;
  background: #fff;
  color: var(--ink);
  font-family: inherit;
  font-size: min(10cqh, 12cqw);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  animation: pop .25s ease-out;
}
.count-option:active { transform: scale(.92); }
.count-option.is-wrong { opacity: .35; animation: shake .4s ease; }

/* 數過的：稍微淡一點，掛上「第幾個」的號碼牌 */
.count-item.is-counted .count-emoji { opacity: .45; }

.count-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  min-width: 1.6em;
  padding: .2em .35em;
  border-radius: 999px;
  background: var(--deck);
  color: #fff;
  font-size: max(15px, min(calc(18cqw / var(--cols)), 8cqh));
  font-weight: 900;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .3);
  animation: pop .25s ease-out;
}

/* 還沒答對就點卡片：題目跳一下，還沒數到的東西也晃一下 */
.is-nudging .face-hint,
.is-nudging .count-question { animation: nudge .5s ease; }
.is-nudging .count-item:not(.is-counted) .count-emoji { animation: wiggle .5s ease; }

@keyframes nudge {
  40% { scale: 1.15; }
}

@keyframes wiggle {
  25% { rotate: -12deg; }
  75% { rotate: 12deg; }
}

@keyframes pop {
  from { scale: .3; opacity: 0; }
  to { scale: 1; opacity: 1; }
}

/* ---------- 字母卡的 A～Z、數字卡的一排數字 ---------- */
.jump-strip {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin: 0 0 14px;
}

.jump-chip {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
}
.jump-chip:active { transform: scale(.9); }
.jump-chip:disabled { opacity: .28; cursor: default; }
.jump-chip.is-current { background: var(--deck); color: var(--ink); }
/* 數字有到三位數（100），寬度跟著字走 */
.jump-chip.is-number {
  width: auto;
  min-width: 36px;
  height: 36px;
  padding: 0 9px;
  font-variant-numeric: tabular-nums;
}

/* ---------- 進度與控制 ---------- */
.progress {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 16px 0 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--line);
  transition: background .2s ease, transform .2s ease;
}
.dot.is-seen { background: var(--text-dim); }
.dot.is-current { background: var(--deck); transform: scale(1.4); }

.progress-text {
  margin-left: 8px;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.learn-controls {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

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
.ctl svg { width: 30px; height: 30px; fill: currentColor; }
.ctl-nav { padding: 0; width: 72px; }
.ctl-wide svg { width: 24px; height: 24px; }

.ctl-video {
  background: var(--deck);
  color: var(--ink);
}

.ctl-quiz {
  background: var(--accent);
  color: var(--ink);
  box-shadow: inset 0 0 0 2px var(--accent-edge);
}

/* ---------- 考考我 ---------- */
.quiz { justify-content: center; gap: 18px; }

.quiz-progress {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-dim);
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

/* 英文是說給小朋友聽的，底下一行小小的中文給爸媽看 */
.ask-label,
.prompt-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}
.ask-label { align-items: flex-start; }
.ask-zh,
.prompt-zh {
  font-size: .62em;
  font-weight: 700;
  opacity: .75;
}

.ask-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .3);
  font-size: 28px;
}

/* 看圖選數字的題目圖 */
.prompt-img {
  height: min(32vh, 280px);
  max-width: 86vw;
  object-fit: contain;
  border-radius: 20px;
  box-shadow: 0 12px 28px var(--shadow);
  pointer-events: none;
}

.prompt-text {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
}

/* 題目圖已經占掉一塊，選項縮小一點 */
.options.is-compact .option { --size: min(26vw, 22vh, 170px); }

.options {
  display: flex;
  justify-content: center;
  gap: clamp(12px, 3vw, 28px);
  width: 100%;
}

.option {
  --size: min(28vw, 36vh, 220px);
  position: relative;
  width: var(--size);
  height: var(--size);
  container-type: size;
  padding: 0;
  border: 5px solid transparent;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 12px 28px var(--shadow);
  transition: transform .15s ease, opacity .2s ease, border-color .2s ease;
}
.option:active { transform: scale(.94); }

.option-face {
  font-size: min(60cqh, calc(130cqw / max(var(--len), 1.6)));
  font-weight: 900;
  line-height: 1;
}

.option-img {
  max-width: 82%;
  max-height: 82%;
  object-fit: contain;
  border-radius: 14px;
  pointer-events: none;
}

.option.is-right {
  border-color: var(--ok);
  animation: bounce .5s ease;
}

.option.is-wrong {
  animation: shake .4s ease;
}
/* 點錯的只淡掉圖，名字標籤要保持清楚 */
.option.is-wrong .option-img,
.option.is-wrong .option-face { opacity: .3; }

.option-caption {
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: 7%;
  padding: 4cqh 3cqw;
  border-radius: 12px;
  background: var(--ink);
  color: #fff;
  /* 依字的實際寬度縮放，長的說明（一個棍子打棒球10）也維持一行 */
  font-size: max(11px, min(12cqh, calc(78cqw / max(var(--len), 4))));
  font-weight: 800;
  line-height: 1.15;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  animation: pop .25s ease-out;
}

.option-star {
  position: absolute;
  top: -22px;
  right: -14px;
  font-size: 54px;
  animation: star-pop .6s cubic-bezier(.3, 1.6, .5, 1);
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

/* ---------- 影片片段 ---------- */
.clip-veil {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: calc(var(--safe-t) + 16px) calc(var(--safe-r) + 16px) calc(var(--safe-b) + 16px) calc(var(--safe-l) + 16px);
  background: rgba(8, 6, 24, .86);
}

.clip-box {
  position: relative;
  width: min(100%, calc((100vh - 140px) * 16 / 9), 960px);
  aspect-ratio: 16 / 9;
  border-radius: 20px;
  overflow: hidden;
  background: #000;
}

.clip-player,
.clip-player :deep(iframe) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.clip-shield {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.clip-play {
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: rgba(20, 18, 46, .72);
  backdrop-filter: blur(4px);
}
.clip-play svg { width: 46px; height: 46px; fill: var(--accent); }

.clip-msg {
  padding: 14px 22px;
  border-radius: 16px;
  background: rgba(20, 18, 46, .85);
  color: #fff;
  font-size: 19px;
  font-weight: 800;
}

/* ---------- 窄螢幕與手機橫向 ---------- */
@media (max-width: 560px) {
  .mode-tabs { width: 100%; }
  .mode-tab { flex: 1; justify-content: center; }
  .ctl { height: 58px; padding: 0 16px; font-size: 17px; }
  .ctl-nav { width: 60px; }
  .ask-btn { font-size: 18px; }
}

@media (max-height: 520px) {
  .deck-bar { padding-top: calc(var(--safe-t) + 8px); padding-bottom: 6px; }
  .bar-back { height: 42px; }
  .mode-tab { height: 36px; font-size: 15px; }
  .progress { margin: 8px 0 6px; }
  .ctl { height: 48px; font-size: 16px; }
  .quiz { gap: 10px; }
  .ask-btn { padding: 8px 20px 8px 10px; font-size: 17px; }
  .ask-icon { width: 40px; height: 40px; font-size: 22px; }
  .prompt-img { height: 30vh; }
  .prompt-text { font-size: 17px; }
}

/* 手機橫向：高度只剩一點點，按鈕改放到卡片右邊，卡片才能用滿整個高度 */
@media (max-height: 520px) and (min-aspect-ratio: 4 / 3) {
  .learn {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: 1fr auto auto 1fr;
    column-gap: 28px;
    justify-items: center;
  }
  .stage { grid-column: 1; grid-row: 1 / 5; height: 100%; }
  /* 橫向高度不夠放 A～Z、一排數字，用左右鍵或滑動換卡 */
  .jump-strip { display: none; }
  .progress { grid-column: 2; grid-row: 2; margin: 0 0 12px; }
  .learn-controls {
    grid-column: 2;
    grid-row: 3;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-flow: dense;
    gap: 10px;
    width: 180px;
  }
  /* 上一張／下一張並排一列，其他按鈕各占一整列 */
  .learn-controls .ctl { width: 100%; }
  .learn-controls .ctl-wide { grid-column: span 2; }

  /* 看圖選數字：題目圖放左邊、選項放右邊，圖才不會被擠成一小張 */
  .quiz.is-picture {
    display: grid;
    grid-template-areas:
      "img progress"
      "img text"
      "img options";
    grid-template-rows: 1fr auto 1fr;
    column-gap: 32px;
    row-gap: 10px;
    justify-content: center;
  }
  .quiz.is-picture .prompt-img { grid-area: img; height: 72vh; align-self: center; }
  .quiz.is-picture .quiz-progress { grid-area: progress; align-self: end; text-align: center; }
  .quiz.is-picture .prompt-text { grid-area: text; text-align: center; }
  .quiz.is-picture .options { grid-area: options; align-self: start; }
  .quiz.is-picture .options.is-compact .option { --size: min(15vw, 30vh, 150px); }
}

@media (prefers-reduced-motion: reduce) {
  .flip-inner { transition: none; }
  .option.is-right,
  .option.is-wrong,
  .option-star,
  .done-emoji,
  .count-badge,
  .count-option,
  .is-nudging .face-hint,
  .is-nudging .count-question,
  .is-nudging .count-emoji,
  .option-caption { animation: none; }
}
</style>
