<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { categoryColor, type Card, type CardClip, type VideoItem } from '~/utils/youtube'
import {
  countOf, isPicture, imageSrc, speechOf, isAbcDeck, initialOf, cardsOf, chantOf, meaningText, thisIs, isNumberCard,
  isSpokenOnlyMeaning,
} from '~/utils/cards'
import { canSpeak, speak, stopSpeaking, chimeRight, chimeWrong, type SpeechPart, type SpeechText } from '~/utils/speech'
import { useLibrary } from '~/composables/useLibrary'
import { useTheme } from '~/composables/useTheme'
import { useWatchTime } from '~/composables/useWatchTime'
import { useCardStars } from '~/composables/useCardStars'
import { useTvMode } from '~/composables/useTvMode'
import { useYouTubePlayer } from '~/composables/useYouTubePlayer'

const props = defineProps<{ deck: VideoItem }>()
const emit = defineEmits<{ close: [] }>()

const { categories } = useLibrary()
const { resolved: themeResolved } = useTheme()
const { isTv } = useTvMode()
const { addSeconds, flush, isLimitReached } = useWatchTime()
const { starsOf, addStar } = useCardStars()

const cards = computed<Card[]>(() => cardsOf(props.deck))
/** 這本是 ABC 字母卡（單元名稱裡有 ABC）：照 A～Z 排、卡片上標出開頭字母 */
const isAbc = computed(() => isAbcDeck(props.deck.title))
const stars = computed(() => starsOf(props.deck.uid))

/** 跟片單上這一區同一個顏色，小朋友知道自己還在同一個地方 */
const color = computed(() => {
  const idx = categories.value.findIndex((c) => c.id === props.deck.categoryId)
  return categoryColor(Math.max(0, idx), themeResolved.value)
})

type Mode = 'learn' | 'quiz'
const mode = ref<Mode>('learn')

/**
 * 翻面看答案、考考我答對之後唸的：有口訣就照口訣（「P、P、puh、puh、panda」，字母卡再接中文意思），
 * 沒有口訣就把說明裡寫的語言都唸出來。
 */
function fullParts(c: Card): SpeechText[] {
  const { en, zh } = speechOf(c)
  const chant = chantOf(c, isAbc.value)
  if (chant) return [...chant, ...(isAbc.value ? [{ text: zh, lang: 'zh-TW' as const }] : [])]
  return [{ text: en, lang: 'en-US' }, { text: zh, lang: 'zh-TW' }]
}

function say(c: Card) {
  speak(fullParts(c))
}

/**
 * 考考我的題目只唸這張卡本身——單字（mouse）或數字（seven、七），不唸口訣也不給提示，
 * 讓小朋友自己認。只唸一種語言：有英文唸英文，數字卡沒有英文就用中文唸數字。
 */
function promptParts(c: Card): SpeechText[] {
  const { en, zh } = speechOf(c)
  if (en) return [{ text: en, lang: 'en-US' }]
  if (isNumberCard(c)) return [{ text: c.word, lang: 'zh-TW' }]
  return [{ text: zh, lang: 'zh-TW' }]
}

function sayPrompt(c: Card) {
  speak(promptParts(c))
}

/** 這張卡叫什麼：hippo，河馬／勾勾5（點錯的時候告訴小朋友用） */
function nameParts(c: Card): SpeechText[] {
  const { en, zh } = speechOf(c)
  const parts: SpeechText[] = []
  if (en) parts.push({ text: en, lang: 'en-US' })
  if (zh) parts.push({ text: zh, lang: 'zh-TW' })
  return parts.length ? parts : promptParts(c)
}

/**
 * 點錯了要說的話：先說 No!，告訴他點的是什麼，再把題目唸一次（看圖選數字的題目是圖，不用再唸）。
 * 「No」「This is」「Listen again」是固定的教室用語，每一本都講英文，聽久了就懂，順便練聽力；
 * 卡片內容照這本的語言：
 *   英文卡：No! This is a horse. Listen again. …… Frog.
 *   中文卡：No! This is 大肚6. Listen again. …… 八.（說明和題目維持中文）
 * 「Listen again.」後面停將近一秒，小朋友才聽得出接下來那個字是題目，不會跟前一句黏在一起。
 */
function remindParts(wrong: Card, q: Question): SpeechPart[] {
  const prompt = q.kind === 'listen' ? promptParts(cards.value[q.answer]!) : []
  return [
    { pause: 250 },
    { text: 'No!', lang: 'en-US' },
    { pause: 300 },
    ...thisIsParts(wrong, q),
    ...(prompt.length ? [{ pause: 500 }, { text: 'Listen again.', lang: 'en-US' as const }, { pause: 900 }, ...prompt] : []),
  ]
}

/**
 * 「這是…」：英文卡整句英文（This is a horse.），中文卡「This is」接中文說明（This is 勾勾5）。
 * 點錯時說一次；小朋友再點那張點錯的，也是唸這句給他聽。
 */
function thisIsParts(wrong: Card, q: Question): SpeechText[] {
  const wrongEn = speechOf(wrong).en
  const englishDeck = q.kind === 'listen' && promptParts(cards.value[q.answer]!)[0]?.lang === 'en-US'
  return englishDeck && wrongEn
    // 數字、顏色（說明是「紅色」這種）不加 a／an：This is four、This is red
    ? [{ text: thisIs(wrongEn, isNumberCard(wrong) || /色$/.test(meaningText(wrong))), lang: 'en-US' }]
    : [{ text: 'This is', lang: 'en-US' }, ...nameParts(wrong)]
}

/** 點錯的選項下面貼的小標籤：圖片選項寫「hippo 河馬」，數字選項寫說明（five、勾勾5） */
function captionOf(c: Card): string {
  if (isNumberCard(c)) return meaningText(c) || c.word
  return [c.word, meaningText(c)].filter(Boolean).join(' ')
}

/** 字串看起來有多寬（中文字算 1、英文數字算 0.55），標籤用它決定字要縮多小才放得進一行 */
function visualLength(text: string): number {
  return [...text].reduce((n, ch) => n + (/[\u2E80-\uFFEF]/.test(ch) ? 1 : 0.55), 0)
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
/** 數字卡沒有自己的圖，正面才畫一堆東西讓小朋友數；有圖的（例如數字形狀卡）就直接看圖 */
const showCount = computed(() => count.value !== null && !!card.value?.image && !isPicture(card.value))
/** 背面的圖：有指定背面圖就用它，否則跟正面同一張 */
const backPicture = computed(() => {
  const c = card.value
  if (!c) return ''
  return c.backImage || (isPicture(c) ? c.image : '')
})
const isLast = computed(() => index.value === cards.value.length - 1)

/** 數字卡上已經點過的東西，依點的順序排，數字徽章就是它的位置 */
const counted = ref<number[]>([])
/** 一個一個數的時候用哪種語言：跟這張卡一樣，中文卡就數「一、二、三」 */
const countLang = computed(() => (card.value && speechOf(card.value).en ? 'en-US' : 'zh-TW'))

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

function flip() {
  flipped.value = !flipped.value
  if (flipped.value && card.value) say(card.value)
  else stopSpeaking()
}

function go(step: number) {
  const n = cards.value.length
  if (!n) return
  if (flipTimer) clearTimeout(flipTimer)
  index.value = (index.value + step + n) % n
  flipped.value = false
  counted.value = []
  stopSpeaking()
}

function jumpTo(letter: string) {
  const i = letterIndex.value.get(letter)
  if (i !== undefined) go(i - index.value)
}

/** 點一個東西就數一個，數到最後一個自動翻面揭曉答案 */
function countTap(i: number) {
  if (swiped) {
    swiped = false
    return
  }
  if (counted.value.includes(i)) return
  counted.value = [...counted.value, i]
  const n = counted.value.length
  speak([{ text: String(n), lang: countLang.value }], 0.9)

  if (n === count.value) {
    const at = index.value
    flipTimer = setTimeout(() => {
      if (index.value === at && !flipped.value && mode.value === 'learn') flip()
    }, 800)
  }
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
  flip()
}

const cardRef = ref<HTMLElement | null>(null)

function toLearn() {
  clearQuizTimers()
  stopSpeaking()
  mode.value = 'learn'
  flipped.value = false
  counted.value = []
  if (isTv) nextTick(() => cardRef.value?.focus())
}

/* ---------- 考考我：聽發音，從幾張圖裡點出對的 ---------- */

/** 一輪最多幾題：小朋友專注的時間很短，寧可多玩幾輪 */
const QUIZ_LEN = 8

const canQuiz = computed(() => cards.value.length >= 2)

/**
 * 題目的種類：
 *   listen  聽單字（或數字），點出是哪張圖；數字卡沒有自己的圖時，點的是數字
 *   picture 看形狀圖，點出是數字幾（數字卡有自己的圖時）
 */
type QuizKind = 'listen' | 'picture'

interface Question {
  kind: QuizKind
  /** 正確答案是第幾張卡 */
  answer: number
  options: number[]
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
 * 數字形狀卡兩種混著出：看圖選數字，以及聽數字（「七」）從形狀圖裡找出拐杖。
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
  return { kind, answer, options: shuffle([answer, ...others]), missed: false, retry }
}

const optionsRef = ref<HTMLElement | null>(null)

function focusFirstOption() {
  if (!isTv) return
  nextTick(() => optionsRef.value?.querySelector<HTMLElement>('.option:not(:disabled)')?.focus())
}

function startQuiz() {
  clearQuizTimers()
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
  askLater()
  focusFirstOption()
}

/**
 * 數字卡有自己的圖（例如數字形狀卡）：改成看圖選數字。
 * 這種題目不唸出來 —— 一唸就等於把答案說出來了，答對之後才唸完整的口訣。
 */
const pictureQuiz = computed(() => question.value?.kind === 'picture')

function ask() {
  const q = question.value
  if (q && q.kind === 'listen') sayPrompt(cards.value[q.answer]!)
}

function askLater(ms = 450) {
  if (askTimer) clearTimeout(askTimer)
  askTimer = setTimeout(ask, ms)
}

function pick(opt: number) {
  const q = question.value
  if (!q || rightPick.value !== null) return

  // 點過的錯誤選項再點一次：只把它的名字唸給他聽，不再說 No、不再扣分，讓他自己比較
  if (wrongPicks.value.includes(opt)) {
    if (askTimer) clearTimeout(askTimer)
    speak(thisIsParts(cards.value[opt]!, q))
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
    // 先說 Yes!；有口訣的再把口訣唸一遍（字母卡再加中文）當複習，看圖選數字沒聽過題目，也唸一遍。
    // 整串唸完才換下一題，不會被下一題的題目切掉
    const card = cards.value[q.answer]!
    const sayAll = q.kind === 'picture' || Boolean(chantOf(card, isAbc.value))
    speakThen([
      { pause: 250 },
      { text: 'Yes!', lang: 'en-US' },
      ...(sayAll ? [{ pause: 400 }, ...fullParts(card)] : []),
    ], nextQuestion)
    return
  }

  wrongPicks.value = [...wrongPicks.value, opt]
  chimeWrong()
  // 點錯的那個字，這一輪最後再考一次 —— 不會的字多碰一次，比答對的字更值得
  if (!q.missed && !q.retry) questions.value.push(makeQuestion(q.answer, true))
  q.missed = true

  // 點錯正好是教的時候：No!，告訴他點的是什麼，再把題目唸一次（開頭停一下，讓答錯的音效先響完）
  if (askTimer) clearTimeout(askTimer)
  speak(remindParts(cards.value[opt]!, q))
}

function nextQuestion() {
  wrongPicks.value = []
  rightPick.value = null
  if (qIndex.value + 1 >= questions.value.length) {
    quizDone.value = true
    chimeRight()
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
  const c = q ? cards.value[q.answer] : null
  if (!c) return ''
  return isNumberCard(c) ? (speechOf(c).en || c.word) : c.word
})

/* ---------- 影片片段：只播老師教這個字的那幾秒 ---------- */

const clip = ref<CardClip | null>(null)
const clipCloseRef = ref<HTMLButtonElement | null>(null)

const {
  hostRef, status: clipStatus, load: loadClip, toggle: toggleClip, teardown: teardownClip,
} = useYouTubePlayer({ onFinish: closeClip })

async function openClip(c: CardClip) {
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
  if (isTv) nextTick(() => cardRef.value?.focus())
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (flipTimer) clearTimeout(flipTimer)
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
      <nav v-if="isAbc" class="abc-strip" aria-label="字母">
        <button
          v-for="l in ALPHABET"
          :key="l"
          class="abc-chip"
          :class="{ 'is-current': l === currentLetter }"
          :disabled="!letterIndex.has(l)"
          :aria-current="l === currentLetter ? 'true' : undefined"
          @click="jumpTo(l)"
        >
          {{ l }}
        </button>
      </nav>

      <div class="stage">
        <div
          ref="cardRef"
          class="flip"
          :class="{ 'is-flipped': flipped }"
          role="button"
          tabindex="0"
          :aria-label="flipped ? '翻回正面' : '翻面看答案'"
          @click="onCardClick"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="swipeX = null"
          @keydown.enter.prevent="flip"
          @keydown.space.prevent="flip"
        >
          <div class="flip-inner">
            <!-- 正面只有圖：先讓小朋友自己猜、自己數 -->
            <div class="face face-front" :aria-hidden="flipped">
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

              <span class="face-hint">
                {{ showCount ? '點點看，一個一個數' : count !== null ? '這是數字幾？點一下翻面' : '這是什麼？點一下翻面' }}
              </span>
            </div>

            <!-- 背面是答案：大字＋說明，翻過來的同時唸出來 -->
            <div class="face face-back" :class="{ 'has-back-image': card.backImage }" :aria-hidden="!flipped">
              <!-- 背面放了原卡的話，原卡上本來就印著字母，不再疊一個標籤 -->
              <span v-if="currentLetter && !card.backImage" class="abc-badge">{{ badgeOf(card) }}</span>
              <img v-if="backPicture" class="back-img" :src="imageSrc(backPicture)" alt="" draggable="false">
              <span v-else-if="card.image && count === null" class="back-emoji">{{ card.image }}</span>
              <!-- 數字卡背面也排一排小小的實物，數量跟數字放在一起看 -->
              <span v-if="showCount" class="back-count">{{ (card.image || '⭐').repeat(count ?? 0) }}</span>
              <span class="back-word" :style="{ '--len': card.word.length }">
                <!-- 字母卡把開頭字母上色：A is for ant 的那個 a -->
                <template v-if="currentLetter"><span class="back-initial">{{ card.word.charAt(0) }}</span>{{ card.word.slice(1) }}</template>
                <template v-else>{{ card.word }}</template>
              </span>
              <!-- 中文數字卡（13 十三）只顯示數字，「十三」翻面時唸出來就好 -->
              <span v-if="meaningText(card) && !isSpokenOnlyMeaning(card)" class="back-meaning">{{ meaningText(card) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="progress" :aria-label="`第 ${index + 1} 張，共 ${cards.length} 張`">
        <template v-if="cards.length <= 15">
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

        <button v-if="canSpeak" class="ctl ctl-wide" @click="say(card)">
          <span aria-hidden="true">🔊</span>聽
        </button>

        <button v-if="card.clip" class="ctl ctl-wide ctl-video" @click="openClip(card.clip)">
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
          <p class="prompt-text">這是數字幾？</p>
        </template>
        <button v-else class="ask-btn" @click="ask">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span v-if="canSpeak">聽聽看，是哪一個？</span>
          <span v-else>哪一個是「{{ promptText }}」？</span>
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

.face-emoji { font-size: min(52cqw, 48cqh); line-height: 1.1; }
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
.face-img { height: 74%; }
.back-img { flex: none; height: 42%; }

/* 背面另外放了一張完整的卡（上面已經有數字和名稱），圖放大、下面的字縮小 */
.has-back-image { gap: 6px; padding-top: 28px; }
.has-back-image .back-img { height: 66%; }
.has-back-image .back-word { font-size: min(15cqh, calc(80cqw / max(var(--len), 2.4))); }
.has-back-image .back-meaning { font-size: min(8cqh, 9cqw); }


/* 長的字自動縮小，elephant 跟 3 都要剛好塞得下 */
.face-word,
.back-word {
  font-size: min(38cqh, calc(150cqw / max(var(--len), 2.4)));
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
  font-size: min(10cqh, 11cqw);
  font-weight: 800;
  color: var(--ink-dim);
  text-align: center;
}

.face-hint {
  position: absolute;
  bottom: 3.5cqh;
  font-size: max(13px, min(4.6cqh, 5cqw));
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
  margin-bottom: 6cqh;
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

@keyframes pop {
  from { scale: .3; opacity: 0; }
  to { scale: 1; opacity: 1; }
}

/* ---------- 字母卡的 A～Z ---------- */
.abc-strip {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin: 0 0 14px;
}

.abc-chip {
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
.abc-chip:active { transform: scale(.9); }
.abc-chip:disabled { opacity: .28; cursor: default; }
.abc-chip.is-current { background: var(--deck); color: var(--ink); }

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
  /* 橫向高度不夠放 A～Z，用左右鍵或滑動換卡 */
  .abc-strip { display: none; }
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
  .option-caption { animation: none; }
}
</style>
