<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { categoryColor, type Card, type CardClip, type VideoItem } from '~/utils/youtube'
import {
  countOf, countNounOf, isPicture, imageSrc, speechOf, isAbcDeck, initialOf, cardsOf, thisIs, isNumberCard,
  numberLabels, sentencesOf, enNumber, zhNumber, englishOf, askOf, askZhOf, ASK_STYLES, isBareDeck, englishTitle,
  chineseTitle, isZhCard, isBopomofoCard, zhReading, askKindOf, frontQuestion, specialQuestion, pairQuestion, emojiCount, sentenceLines,
  missionCardOf, missionOf, missionTextOf, missionGoalOf, missionActOf, isPluralName, isPutMission,
} from '~/utils/cards'
import { placeById, type Place } from '~/utils/places'
import { canSpeak, speak, stopSpeaking, chimeRight, chimeWrong, type SpeechPart, type SpeechText } from '~/utils/speech'
import { cheerParts, cheerText, PROMPTS as P, type CheerKind } from '~/utils/cheers'
import { useChildName } from '~/composables/useChildName'
import { useLibrary } from '~/composables/useLibrary'
import { useTheme } from '~/composables/useTheme'
import { useWatchTime } from '~/composables/useWatchTime'
import { useCardStars } from '~/composables/useCardStars'
import { useMissions } from '~/composables/useMissions'
import { useMissionPlan } from '~/composables/useMissionPlan'
import { missionSeedOf } from '~/utils/missionPlan'
import { useTvMode } from '~/composables/useTvMode'
import { useYouTubePlayer } from '~/composables/useYouTubePlayer'
import { useOnline } from '~/composables/useOffline'
import { useState } from '~/composables/useState'
import { useCardLang } from '~/composables/useCardLang'

const props = defineProps<{
  deck: VideoItem
  /** 從首頁「今日任務」進來的話直接開任務，其他一律先看卡片 */
  start?: 'mission' | ''
}>()
const emit = defineEmits<{ close: []; stickers: [] }>()

const { categories } = useLibrary()
const { resolved: themeResolved } = useTheme()
const { isTv } = useTvMode()
const { addSeconds, flush, isLimitReached } = useWatchTime()
const { starsOf, addStar } = useCardStars()
const { countOf: missionCountOf, complete: completeMission } = useMissions()
const { today: todayPicks, plan: missionPlan } = useMissionPlan()
const { online } = useOnline()
const { lang: cardLang, setLang } = useCardLang()
const { name: childName } = useChildName()

const cards = computed<Card[]>(() => cardsOf(props.deck))
/** 整本都是中文字、注音（識字卡）：不管上面選哪個語言一律用中文，語言切換也用不到 */
const zhDeck = computed(() => cards.value.length > 0 && cards.value.every(isZhCard))
/** 這一本實際用的語言：識字卡本固定中文，其他照上面的選擇 */
const lang = computed(() => (zhDeck.value ? 'zh' : cardLang.value))

/** 全英文：卡片、語音、按鈕都不出現中文 */
const englishOnly = computed(() => lang.value === 'en')
/** 全中文：卡片、語音都不出現英文 */
const chineseOnly = computed(() => lang.value === 'zh')
/** 中英：中文說明＋英文單字（蘋果，apple），不唸英文句子 */
const mixed = computed(() => lang.value === 'mix')
/** 中文的部分：全英文時變成空字串，speak 會自動略過 */
const zhPart = (text: string) => (englishOnly.value ? '' : text)
/** 英文的部分：全中文時變成空字串 */
const enPart = (text: string) => (chineseOnly.value ? '' : text)
/** 畫面上的字：全中文、中英對照用中文（爸媽看得懂），全英文就換成英文 */
const t = (zhText: string, enText: string) => (englishOnly.value ? enText : zhText)
/** 指令、回饋這類的一句話：全英文用英文說，中文、中英都用中文說，小朋友才聽得懂要做什麼 */
const line = (zhText: string, enText: string): SpeechText => (englishOnly.value ? en(enText) : zh(zhText))

const LANGS = [
  { id: 'zh', label: '中文' },
  { id: 'mix', label: '中英' },
  { id: 'en', label: 'English' },
] as const

function switchLang(next: 'zh' | 'mix' | 'en') {
  if (cardLang.value === next) return
  setLang(next)
  stopSpeaking()
}

/** 這本是 ABC 字母卡（單元名稱裡有 ABC）：照 A～Z 排、卡片上標出開頭字母 */
const isAbc = computed(() => isAbcDeck(props.deck.title))
/** 動作、心情這類字卡本：問的時候不加 the（Where is happy?） */
const bareDeck = computed(() => isBareDeck(props.deck.title))
/** 正面問什麼：顏色問 What color is this?、形狀問 What shape is this?…… */
// 試算表在這本字卡寫了「問句」就用它，沒寫才看字卡本的名稱
const askKind = computed(() => props.deck.ask ?? askKindOf(props.deck.title))
/**
 * 卡片上是一句話（生活用語、卡通常說的話、見面問候）或動物的叫聲（woof woof）：
 * 考考我問「Which picture says, moo moo?」，不問「Where is…」
 */
const phraseDeck = computed(() => askKind.value === 'say' || askKind.value === 'quote' || askKind.value === 'sound')
/** 整本都是數字卡：上面放一排數字，今天教到哪裡就直接跳過去 */
const isNumberDeck = computed(() => cards.value.length > 0 && cards.value.every(isNumberCard))
const stars = computed(() => starsOf(props.deck.uid))

/** 跟片單上這一區同一個顏色，小朋友知道自己還在同一個地方 */
const color = computed(() => {
  const idx = categories.value.findIndex((c) => c.id === props.deck.categoryId)
  return categoryColor(Math.max(0, idx), themeResolved.value)
})

/** learn 看卡片、play 跟我說／做動作、quiz 考考我、mission 生活任務（認識一個東西，再到家裡找）、place 放哪裡（把東西拖到對的地方）、order 排順序（照順序點）、compare 比一比（哪邊比較多／哪個數字比較大） */
type Mode = 'learn' | 'play' | 'quiz' | 'mission' | 'place' | 'order' | 'compare'
const mode = ref<Mode>('learn')

const en = (text: string): SpeechText => ({ text, lang: 'en-US' })
const zh = (text: string): SpeechText => ({ text, lang: 'zh-TW' })

/**
 * 答對、答錯、說完、做完的回饋：每種有好幾句輪流說，偶爾叫小朋友的小名（見 utils/cheers.ts）。
 * 答錯不說 No!，說 Hmm, not that one.／Oops!，比較不會嚇到。
 */
const cheer = (kind: CheerKind): SpeechText[] => cheerParts(kind, englishOnly.value, childName.value)

/**
 * 翻面看答案時唸的：
 *   English：Apple. Yum, delicious apple!／One. Like a pencil.／Eleven. Eleven cats.
 *   中文：蘋果。／一。像一支鉛筆。／十一。十一隻貓。
 *   中英：蘋果，apple。／一，one。像一支鉛筆，like a pencil。／十一，eleven。十一隻貓，eleven cats。
 * 英文句子只有 English 唸；中英只唸單字，小朋友專心把中文和英文對起來。
 * 識字卡（中文字、注音）不分語言，一律唸中文：日。太陽、生日。
 */
function answerParts(c: Card, withSentence = true): SpeechText[] {
  if (isZhCard(c)) return zhCardParts(c)
  if (isNumberCard(c)) {
    const n = Number(c.word)
    const num = zhNumber(n)
    const word = enNumber(n)
    const label = numberLabels(c)
    const zhExtra = label.zh !== num ? [zh(label.zh)] : []
    const enExtra = label.en !== word ? [en(label.en)] : []
    const sentence = withSentence ? numberSentence(c) : ''
    if (chineseOnly.value) return [zh(num), ...zhExtra]
    if (mixed.value) return [zh(num), en(word), ...zhExtra, ...enExtra, en(sentence)]
    return [en(word), ...enExtra, en(sentence)]
  }
  const name = speechOf(c)
  if (chineseOnly.value) return [zh(name.zh || c.word)]
  if (mixed.value) return [zh(name.zh), en(name.en || c.word)]
  return [en(name.en || c.word), en(withSentence ? sentenceFor(c) : '')]
}

/**
 * 數字卡這一次要唸、要寫的英文句子：English 都唸；
 * 中英只有在說明只寫中文時（數字在身邊：我有一個鼻子）唸，句子就是那句中文的英文。
 */
function numberSentence(c: Card): string {
  if (englishOnly.value) return sentenceFor(c)
  if (!mixed.value) return ''
  const label = numberLabels(c)
  const n = Number(c.word)
  return label.en === enNumber(n) && label.zh !== zhNumber(n) ? sentenceFor(c) : ''
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
  // 相反詞問「Is it big or small?」，兩個字誰先講每翻到一張卡就隨機換，不會學到「第一個講的就是答案」
  pairSwap.value = Math.random() < 0.5
}

/** 相反詞的問句裡，這張卡的字排在後面（Is it small or big?） */
const pairSwap = ref(false)

/** 這張卡這一次要唸、要寫在背面的那一句 */
function sentenceFor(c: Card): string {
  const list = sentencesOf(c, bareDeck.value)
  return list.length ? list[sentenceTurn.value % list.length]! : ''
}

/** 動物真正的叫聲（片單的「聲:」）：音檔放在 public/，要接上部署的子目錄 */
const soundPart = (c: Card): SpeechPart => ({ sound: imageSrc(c.sound!) })

function say(c: Card) {
  clearPrompt()
  // 有真正叫聲的卡：唸完名字和句子，接著放叫聲
  speak(withSound(c, answerParts(c)))
}

/** 有真正叫聲的卡：名字和句子唸完，接著放叫聲 */
function withSound(c: Card, parts: SpeechPart[]): SpeechPart[] {
  return c.sound ? [...parts, { pause: 400 }, soundPart(c)] : parts
}

/** 只放叫聲：想再聽一次牛怎麼叫 */
function playSound(c: Card) {
  clearPrompt()
  speak([soundPart(c)])
}

/** 識字卡唸出來：先唸字（注音唸同音字），再唸說明——日。太陽、生日。 */
function zhCardParts(c: Card): SpeechText[] {
  return [zh(zhReading(c)), zh(c.meaning)]
}

/** 這張卡叫什麼，考考我答對時說：Cat.／貓。／貓，cat。數字形狀卡連形狀一起說 */
function nameParts(c: Card): SpeechText[] {
  if (isZhCard(c)) return zhCardParts(c)
  if (isNumberCard(c)) {
    const n = Number(c.word)
    if (isPicture(c)) return answerParts(c, false)
    if (chineseOnly.value) return [zh(zhNumber(n))]
    if (mixed.value) return [zh(zhNumber(n)), en(enNumber(n))]
    return [en(enNumber(n))]
  }
  const name = speechOf(c)
  if (chineseOnly.value) return [zh(name.zh || c.word)]
  if (mixed.value) return [zh(name.zh), en(name.en || c.word)]
  return [en(name.en || c.word)]
}

/** 識字卡的題目開頭，三種問法輪流：哪一個是…／找找看…／請點出… */
const ZH_SYMBOL_LEADS = ['哪一個是', '找找看', '請點出']

/**
 * 識字卡「這是…」「找找看…」：那個字（注音唸同音字）前面停一下，才聽得出它是要認的字，
 * 不會跟前一句黏在一起，變成「你找得到摸嗎」。
 */
function zhSymbolLine(lead: string, c: Card): SpeechPart[] {
  return [zh(lead), { pause: 350 }, zh(zhReading(c))]
}

/** 「這是…」：This is a horse.／這是馬。／這是馬，horse。點錯時說一次；小朋友再點那張點錯的，也是唸這句 */
function thisIsParts(c: Card): SpeechPart[] {
  if (isZhCard(c)) return zhSymbolLine('這是', c)
  const zhName = isNumberCard(c) ? zhNumber(Number(c.word)) : (speechOf(c).zh || c.word)
  const enName = englishOf(c)
  if (chineseOnly.value || (mixed.value && !enName)) return [zh(`這是${zhName}。`)]
  if (mixed.value) return [zh(`這是${zhName}，`), en(enName)]
  return [en(enName ? thisIs(c, bareDeck.value, phraseDeck.value) : `This is ${c.word}.`)]
}

/** 點錯的選項下面貼的小標籤：hippo／河馬／河馬 hippo；four／四／四 four */
function captionOf(c: Card): string {
  if (isZhCard(c)) return [c.word, c.meaning].filter(Boolean).join(' ')
  if (isNumberCard(c)) {
    const n = Number(c.word)
    return [zhPart(zhNumber(n)), enPart(enNumber(n))].filter(Boolean).join(' ')
  }
  return [zhPart(c.meaning), enPart(c.word)].filter(Boolean).join(' ') || c.word
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

/* ---------- 家裡的書：打開先翻到同一頁，再邊看書邊翻卡 ---------- */

/** 這本字卡照家裡哪本書的哪一頁做的（片單的「書頁:」）：那一頁的照片，沒有就是空字串 */
const bookPage = computed(() => props.deck.page ?? '')
/** 從書頁照片裁下來的圖：有高窄的（pony 約 1:2），框要留大一點才不會縮成一小條 */
const isBookImage = (src: string) => src.includes('cards/books/')
/** 整頁照片蓋在上面：一打開先秀，小朋友把書翻到同一頁；看卡片時按「這一頁」可以再叫出來 */
const showPage = ref(!!props.deck.page)
const pageDoneRef = ref<HTMLButtonElement | null>(null)

function openPage() {
  clearPrompt()
  stopSpeaking()
  showPage.value = true
  speak([line(P.openBook.zh, P.openBook.en)])
  if (isTv) nextTick(() => pageDoneRef.value?.focus())
}

/** 「找到了！」：書翻好了，開始問第一張卡 */
function closePage() {
  showPage.value = false
  stopSpeaking()
  if (mode.value !== 'learn') return
  askCardLater()
  if (isTv) nextTick(() => cardRef.value?.focus())
}

/* ---------- 看卡片 ---------- */

const index = ref(0)
const flipped = ref(false)
const card = computed(() => cards.value[index.value])
/** 現在這張是識字卡：正面只寫字，圖和說明在背面 */
const zhCard = computed(() => !!card.value && isZhCard(card.value))
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
  return backImageOf(c) || (isPicture(c) ? c.image : '')
})

/**
 * 背面另外放的完整原卡（上面印著「蘋果」「鉛筆」這些中文字）：
 * 全英文模式不用它，背面改放正面那張圖，卡片上才不會冒出中文
 */
function backImageOf(c: Card): string {
  // 全中文時 ABC 原卡上印著英文字母，一樣不用
  if (englishOnly.value || (chineseOnly.value && isAbc.value)) return ''
  return c.backImage
}

/** 背面的大字：全中文時單字卡寫中文（蘋果），其他寫卡片上的字（apple、7） */
function backWordOf(c: Card): string {
  return chineseOnly.value && !isNumberCard(c) && !isZhCard(c) ? (speechOf(c).zh.replace(/，/g, '、') || c.word) : c.word
}
const isLast = computed(() => index.value === cards.value.length - 1)

/**
 * 正面要小朋友做什麼：唸出來，也寫在卡片下面。全英文用英文說，中文、中英用中文說：
 *   數東西的卡：Let's count! Touch the apples.／我們來數蘋果！一顆一顆點。
 *   數字卡：What number is this?／這是數字幾？
 *   單字卡：問得跟答案對得上——What is this?（東西）、What color is this?（顏色）、
 *           What shape is this?（形狀）、How does he feel?（心情）、Who is this?（家人、卡通角色）……
 *           預設看字卡本的名稱（askKindOf），這張卡自己寫了「問:」就用它的（天氣裡的雪人問 What is this?）
 *   相反詞：Is it big or small?／它是大還是小？（每張卡用「對:」指定另一半，誰先講每次換）
 *   識字卡：這個字怎麼唸？／這個注音怎麼唸？
 */
function frontAsk(c: Card): { say: SpeechText; main: string; sub: string } {
  if (isZhCard(c)) {
    const ask = specialQuestion(isBopomofoCard(c) ? 'bopomofo' : 'zhChar').zh
    return { say: zh(ask), main: ask, sub: '點一下翻面' }
  }
  if (isCounting(c)) {
    const noun = countNounOf(c)
    if (!englishOnly.value) {
      // 用量詞說才順：一條一條點（魚）、一顆一顆點（蘋果）、一隻一隻點（貓）
      const what = noun ? noun.zh : '一數'
      const unit = noun ? noun.unit : '個'
      return { say: zh(`我們來數${what}！一${unit}一${unit}點。`), main: `我們來數${what}`, sub: `一${unit}一${unit}點` }
    }
    const touch = `Touch ${noun ? `the ${countOf(c) === 1 ? noun.en : noun.plural}` : 'them'}.`
    return { say: en(`Let's count! ${touch}`), main: touch, sub: '' }
  }
  if (isNumberCard(c)) {
    const q = specialQuestion('number')
    return englishOnly.value
      ? { say: en(q.en), main: q.en, sub: '' }
      : { say: zh(q.zh), main: q.zh, sub: '點一下翻面' }
  }
  // 相反詞：Is it big or small?（對不到另一半就退回字卡本的問法）
  const partner = c.pair ? cards.value.find((x) => x.word.toLowerCase() === c.pair!.toLowerCase()) : undefined
  // 這張卡自己有寫「問:」就用它的，沒有才看字卡本
  const q = partner ? pairQuestion(c, partner, pairSwap.value) : frontQuestion(c.ask ?? askKind.value)
  return englishOnly.value
    ? { say: en(q.en), main: q.en, sub: '' }
    : { say: zh(q.zh), main: q.zh, sub: '點一下翻面' }
}

/** 數完之後的題目：How many apples are there?／有幾顆蘋果？ */
function countQuestion(c: Card): string {
  const noun = countNounOf(c)
  if (!englishOnly.value) return noun ? `有幾${noun.unit}${noun.zh}？` : '有幾個？'
  return `How many ${noun ? `${noun.plural} ` : ''}are there?`
}

/** 數一個就唸一個：one、two、three（English、中英）／一、二、三（中文） */
function countWord(n: number): SpeechText {
  return chineseOnly.value ? zh(zhNumber(n)) : en(enNumber(n))
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
    if (!c || index.value !== at || flipped.value || mode.value !== 'learn' || clip.value || showPage.value) return
    speak([frontAsk(c).say])
  }, 450)
}

function flip() {
  clearPrompt()
  flipped.value = !flipped.value
  if (flipped.value && card.value) speak(withSound(card.value, answerParts(card.value)))
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
  speak([countOptions.value.length ? line(countQuestion(c), countQuestion(c)) : frontAsk(c).say])
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
  speak([countWord(n)], 0.9)

  if (n === count.value) {
    const at = index.value
    flipTimer = setTimeout(() => {
      if (index.value !== at || flipped.value || mode.value !== 'learn' || !card.value) return
      countOptions.value = countChoices(n)
      speak([line(countQuestion(card.value), countQuestion(card.value))])
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
    speak([{ pause: 250 }, ...cheer('right'), { pause: 300 }, ...answerParts(c)])
    return
  }
  if (countWrong.value.includes(opt)) return
  countWrong.value = [...countWrong.value, opt]
  chimeWrong()
  speak([
    { pause: 250 },
    ...cheer('wrong'),
    { pause: 300 },
    line(`這是${zhNumber(opt)}。`, `This is ${enNumber(opt)}.`),
    { pause: 500 },
    line(P.tryAgainBang.zh, P.tryAgainBang.en),
  ])
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
  clearPlayTimers()
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

/** 有真正叫聲的卡（片單寫了「聲:」）是第幾張；4 張以上字卡本才有「聽聲音」 */
const soundCards = computed(() => cards.value.flatMap((c, i) => (c.sound ? [i] : [])))
const canSounds = computed(() => soundCards.value.length >= 4)
/** 這一輪是「聽聲音」：題目放動物真正的叫聲，選項是那幾隻動物的照片 */
const quizSound = ref(false)

/**
 * 題目的種類：
 *   listen  聽題目（Where is the cat? / Can you find number seven?），點出是哪張圖；數字卡沒有自己的圖時，點的是數字
 *   picture 看形狀圖，點出是數字幾（What number is this?，數字卡有自己的圖時）
 */
type QuizKind = 'listen' | 'picture' | 'sound'

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
/**
 * 這一輪有沒有點錯過。點錯的字最後補考答對一樣給星星（鼓勵他再試），
 * 所以星星可能拿滿；「全部答對」要看有沒有點錯過，不能只看星星數。
 */
const roundMissed = ref(false)
const perfectRound = computed(() => !roundMissed.value && roundStars.value >= roundSize.value)

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
  if (quizSound.value) return ['sound']
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
  // 聽聲音：選項也只從有叫聲的動物裡挑，不會冒出一個不會叫的
  const pool = quizSound.value ? soundCards.value : cards.value.map((_, i) => i)
  const rest = shuffle(pool.filter((i) => i !== answer))
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
  beginQuiz(false)
}

/** 聽聲音：放動物真正的叫聲，小朋友從照片裡點出是誰 */
function startSounds() {
  beginQuiz(true)
}

function beginQuiz(sound: boolean) {
  clearQuizTimers()
  clearPlayTimers()
  clearPrompt()
  stopSpeaking()
  quizSound.value = sound
  const order = shuffle(sound ? [...soundCards.value] : cards.value.map((_, i) => i)).slice(0, QUIZ_LEN)
  questions.value = order.map((i) => makeQuestion(i))
  roundSize.value = order.length
  qIndex.value = 0
  roundStars.value = 0
  roundMissed.value = false
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
function promptParts(q: Question): SpeechPart[] {
  if (q.kind === 'picture') return [line('這是數字幾？', 'What number is this?')]
  // 聽聲音：先說「聽聽看」，放叫聲，再問是誰
  if (q.kind === 'sound') {
    return [line(P.soundListen.zh, P.soundListen.en), { pause: 300 }, soundPart(cards.value[q.answer]!), { pause: 600 }, line(P.soundWho.zh, P.soundWho.en)]
  }
  const c = cards.value[q.answer]!
  if (isZhCard(c)) return zhSymbolLine(ZH_SYMBOL_LEADS[q.style % ASK_STYLES]!, c)
  if (chineseOnly.value) return [zh(askZhOf(c, q.style))]
  // 中英：中文問、英文單字——哪一個是… apple？／找找看… apple／apple… 在哪裡？
  if (mixed.value) {
    const enName = englishOf(c)
    if (!enName) return [zh(askZhOf(c, q.style))]
    const style = q.style % ASK_STYLES
    if (style === 0) return [zh('哪一個是'), en(enName)]
    if (style === 1) return [zh('找找看'), en(enName)]
    return [en(enName), zh('在哪裡？')]
  }
  const ask = askOf(c, q.style, bareDeck.value, phraseDeck.value)
  if (ask) return [en(ask)]
  return englishOnly.value ? [en(`Where is ${c.word}?`)] : [zh(`${speechOf(c).zh || c.word}在哪裡？`)]
}

/** 第一題前面先說一聲，小朋友知道要開始玩了 */
function ask(intro = false) {
  const q = question.value
  if (!q) return
  speak([...(intro ? [line(P.quizIntro.zh, P.quizIntro.en), { pause: 400 }] : []), ...promptParts(q)])
}

function askLater(ms = 450, intro = false) {
  if (askTimer) clearTimeout(askTimer)
  askTimer = setTimeout(() => ask(intro), ms)
}

/**
 * 點錯了要說的話：先輕輕說一聲（Hmm, not that one.／Oops!），告訴他點的是什麼，再把題目問一次。
 *   Hmm, not that one. This is a horse. Listen again. …… Where is the frog?
 *   Oops! This is four. Try again. …… What number is this?
 * 「Listen again.」後面停將近一秒，小朋友才聽得出接下來那句是題目，不會跟前一句黏在一起。
 */
function remindParts(wrong: Card, q: Question): SpeechPart[] {
  return [
    { pause: 250 },
    ...cheer('wrong'),
    { pause: 300 },
    ...thisIsParts(wrong),
    { pause: 500 },
    q.kind !== 'picture' ? line(P.listenAgain.zh, P.listenAgain.en) : line(P.tryAgain.zh, P.tryAgain.en),
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
    // 先說一句讚美（Yes!／You got it!……輪流換），再把答案說一遍當複習；整串唸完才換下一題，不會被下一題的題目切掉
    speakThen([
      { pause: 250 },
      ...cheer('right'),
      { pause: 400 },
      ...nameParts(cards.value[q.answer]!),
      // 聽聲音答對了：再放一次叫聲當獎勵
      ...(q.kind === 'sound' ? [{ pause: 300 }, soundPart(cards.value[q.answer]!)] : []),
    ], nextQuestion)
    return
  }

  wrongPicks.value = [...wrongPicks.value, opt]
  chimeWrong()
  // 點錯的那個字，這一輪最後再考一次 —— 不會的字多碰一次，比答對的字更值得
  if (!q.missed && !q.retry) questions.value.push(makeQuestion(q.answer, true))
  q.missed = true
  roundMissed.value = true

  // 點錯正好是教的時候：No!，告訴他點的是什麼，再把題目問一次（開頭停一下，讓答錯的音效先響完）
  if (askTimer) clearTimeout(askTimer)
  speak(remindParts(cards.value[opt]!, q))
}

/** 玩完一輪的鼓勵：Great job! You got five stars! */
function doneParts(): SpeechPart[] {
  const s = roundStars.value
  if (!englishOnly.value) {
    const zhCheer = perfectRound.value
      ? P.perfect.zh
      : s === 0
        ? P.goodTry.zh
        : `好棒！你拿到${s === 2 ? '兩' : zhNumber(s)}顆星！`
    return [{ pause: 500 }, zh(zhCheer)]
  }
  const cheer = perfectRound.value
    ? P.perfect.en
    : s === 0
      ? P.goodTry.en
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
  if (kind === 'picture' || isZhCard(c) || (isNumberCard(c) && !isPicture(c))) return c.word
  return c.image || c.word
}

/** 選項要不要用 <img> 畫（識字卡的選項就是那個字） */
function optionIsImage(c: Card, kind: QuizKind): boolean {
  return kind !== 'picture' && !isZhCard(c) && isPicture(c)
}

/** 沒有語音的裝置（例如部分電視）只好把題目寫出來 */
const promptText = computed(() => {
  const q = question.value
  return q ? promptParts(q).flatMap((p) => ('text' in p ? [p.text] : [])).join(' ') : ''
})

/* ---------- 跟我說／做動作：App 說一句，輪到小朋友開口、動一動 ---------- */

/**
 * 看卡片、考考我都是「App 問、小朋友點」。這一種換成小朋友自己做：
 *   跟我說  App 說一句 → 「Your turn!」圓圈倒數，換他開口 → 說完 App 回應（You said it!）
 *   做動作  動作、口令、習慣這幾本：App 說「Stand up!」→ 「Do it!」換他做 → 做完 App 回應
 * 不做語音辨識：幼兒的口音、iPad 主畫面 App 都容易判錯，判錯會讓他挫折。目標是讓他開口、動起來，
 * 爸媽在旁邊聽、看就好。圓圈倒數完（或小朋友點圓圈）就算說完、做完，一律給鼓勵。
 */
const actKind = computed<'say' | 'do'>(() => (askKind.value === 'action' || askKind.value === 'should' ? 'do' : 'say'))
const canPlay = computed(() => cards.value.length >= 1)

/**
 * 書上找（照家裡的書做的字卡本才有）：一樣是 App 說、換小朋友做，只是換成在手上的書裡找——
 *   App 問「Where is the hamster?」→「Find it in your book!」圓圈倒數，他在書上指出來 → 點圓圈，App 秀出那張圖對答案
 * 找的時候畫面上不放圖，不然看螢幕就知道長什麼樣子，不用翻書了。
 */
const playVariant = ref<'act' | 'find'>('act')
const playKind = computed<'say' | 'do' | 'find'>(() => (playVariant.value === 'find' ? 'find' : actKind.value))
/** 書上找還沒揭曉：圖先蓋起來 */
const findHidden = computed(() => playKind.value === 'find' && playPhase.value !== 'cheer')

function startAct() {
  playVariant.value = 'act'
  startPlay()
}

function startFind() {
  playVariant.value = 'find'
  startPlay()
}

/** 一輪最多幾張：跟考考我一樣，寧可多玩幾輪 */
const PLAY_LEN = 8

type PlayPhase = 'model' | 'turn' | 'cheer'
/** 這一輪要玩哪幾張（卡的順序） */
const playOrder = ref<number[]>([])
const pIndex = ref(0)
const playPhase = ref<PlayPhase>('model')
const playDone = ref(false)
/** 這一輪說完、做完幾張（跳過的不算） */
const playDoneCount = ref(0)
/** 倒數圓圈跑多久（毫秒）：句子越長給越久 */
const turnMs = ref(4000)
/** 說完、做完之後 App 回應的那句，也寫在畫面上 */
const cheerLine = ref('')
/** 下一輪從哪一張開始：卡很多的字卡本（ABC 26 張）每輪接著上一輪玩，不會老是玩前面八張 */
let playNext: number | null = null

const playCard = computed(() => cards.value[playOrder.value[pIndex.value] ?? -1])

/** 每換一個階段、換一張卡、離開都換一個編號，舊的計時和「唸完往下走」發現編號變了就作廢 */
let playToken = 0
let turnTimer: ReturnType<typeof setTimeout> | null = null

function clearPlayTimers() {
  playToken++
  if (turnTimer) clearTimeout(turnTimer)
  turnTimer = null
}

/** 這張卡的英文字數：句子越長，小朋友說的時間要越久 */
function wordCountOf(c: Card): number {
  return (speechOf(c).en || c.word).split(/\s+/).filter(Boolean).length
}

function turnMsFor(c: Card): number {
  // 在書上找要翻、要看，給久一點；找到了點圓圈就不用等
  if (playKind.value === 'find') return 9000
  if (playKind.value === 'do') return 5000
  return Math.min(6500, 2800 + wordCountOf(c) * 450)
}

/** 先唸給他聽：就是卡片上的字，依語言模式唸（English 英文、中文、中英都有）；動作用命令的口氣（Stand up!） */
function playModelParts(c: Card): SpeechPart[] {
  // 書上找：跟考考我一樣問（Where is the hamster?／倉鼠在哪裡？），三種問法輪流
  if (playKind.value === 'find') {
    const answer = playOrder.value[pIndex.value] ?? 0
    return promptParts({ kind: 'listen', answer, options: [], style: pIndex.value, missed: false, retry: false })
  }
  const parts = nameParts(c)
  if (playKind.value === 'do' && englishOnly.value && !isNumberCard(c) && !isZhCard(c)) {
    return parts.map((p) => (p.lang === 'en-US' && p.text && !/[.!?]$/.test(p.text) ? { ...p, text: `${p.text}!` } : p))
  }
  return parts
}

/** 圖旁邊寫的字：全英文寫英文，全中文寫中文，中英寫英文、小字寫中文給爸媽看 */
function playPhrase(c: Card): { main: string; sub: string } {
  if (isZhCard(c)) return { main: c.word, sub: c.meaning }
  if (isNumberCard(c)) return { main: c.word, sub: '' }
  if (chineseOnly.value) return { main: backWordOf(c), sub: '' }
  return { main: c.word, sub: mixed.value ? c.meaning : '' }
}

/** 圖怎麼畫：有圖片檔畫圖片，emoji 畫 emoji，識字卡、數字卡畫字 */
function playFace(c: Card): 'img' | 'emoji' | 'word' {
  if (isZhCard(c) || isNumberCard(c)) return 'word'
  if (isPicture(c)) return 'img'
  return c.image ? 'emoji' : 'word'
}

function startPlay() {
  clearQuizTimers()
  clearPrompt()
  clearPlayTimers()
  stopSpeaking()
  const n = cards.value.length
  if (!n) return
  const len = Math.min(PLAY_LEN, n)
  if (playKind.value === 'find') {
    // 書上找：打亂順序，才不會照著書上的位置一個一個指過去
    playOrder.value = shuffle(cards.value.map((_, i) => i)).slice(0, len)
  } else {
    // 卡不多就整本照順序玩（洗手步驟要照順序）；很多的話從現在看到的那張開始，下一輪接著玩
    const start = n <= PLAY_LEN ? 0 : (playNext ?? index.value)
    playNext = n <= PLAY_LEN ? null : (start + len) % n
    playOrder.value = Array.from({ length: len }, (_, k) => (start + k) % n)
  }
  pIndex.value = 0
  playDone.value = false
  playDoneCount.value = 0
  mode.value = 'play'
  beginPlayCard(true)
}

/** 換到一張新卡（或重聽一次）：先唸給他聽，唸完才輪到他 */
function beginPlayCard(first = false) {
  const c = playCard.value
  if (!c) return
  clearPlayTimers()
  const token = playToken
  playPhase.value = 'model'
  cheerLine.value = ''
  const wait = turnMsFor(c)
  turnMs.value = wait
  const turnCall = playKind.value === 'find'
    ? line(P.findInBook.zh, P.findInBook.en)
    : playKind.value === 'say' ? line(P.yourTurn.zh, P.yourTurn.en) : line(P.doIt.zh, P.doIt.en)
  const intro: SpeechPart[] = first && pIndex.value === 0
    ? [line(P.playIntro.zh, P.playIntro.en), { pause: 400 }]
    : []
  speak([{ pause: 250 }, ...intro, ...playModelParts(c), { pause: 500 }, turnCall]).then(() => {
    if (token !== playToken || mode.value !== 'play') return
    playPhase.value = 'turn'
    turnTimer = setTimeout(() => finishTurn(), wait)
  })
}

/** 倒數完、或小朋友點了圓圈：他說完（做完）了，App 回應 */
function finishTurn() {
  if (mode.value !== 'play' || playPhase.value !== 'turn') return
  clearPlayTimers()
  const token = playToken
  playPhase.value = 'cheer'
  playDoneCount.value++
  chimeRight()
  // 書上找：不知道他指對了沒有，揭曉答案就好（在這裡！倉鼠，hamster）
  const parts = playKind.value === 'find' && playCard.value
    ? [line(P.hereItIs.zh, P.hereItIs.en), ...nameParts(playCard.value)]
    : cheer(playKind.value === 'say' ? 'said' : 'did')
  cheerLine.value = cheerText(parts)
  // 回應唸完才換下一張；沒有語音的裝置至少停 1.4 秒，讓他看到畫面上的鼓勵
  const minWait = new Promise((r) => setTimeout(r, 1400))
  Promise.all([speak([{ pause: 200 }, ...parts]), minWait]).then(() => {
    if (token === playToken && mode.value === 'play') nextPlayCard()
  })
}

function nextPlayCard() {
  clearPlayTimers()
  if (pIndex.value + 1 >= playOrder.value.length) {
    playDone.value = true
    chimeRight()
    speak(playDoneParts())
    return
  }
  pIndex.value++
  beginPlayCard()
}

/** 「換下一張」：不想玩這張就跳過，不算說完、做完 */
function skipPlay() {
  stopSpeaking()
  nextPlayCard()
}

/** 「再聽一次」：重頭唸給他聽，再重新倒數 */
function replayPlay() {
  stopSpeaking()
  beginPlayCard()
}

/** 玩完一輪的鼓勵：Wow! You said six cards! */
function playDoneParts(): SpeechPart[] {
  const n = playDoneCount.value
  if (playKind.value === 'find') {
    if (!englishOnly.value) return [{ pause: 500 }, zh(n ? `哇！你在書上找到${zhNumber(n)}個！好棒！` : '沒關係，我們再玩一次！')]
    return [{ pause: 500 }, en(n ? `Wow! You found ${enNumber(n)} in your book! Great job!` : "Good try! Let's play again!")]
  }
  const verb = playKind.value === 'say' ? 'said' : 'did'
  if (!englishOnly.value) {
    const zhVerb = playKind.value === 'say' ? '說了' : '做了'
    return [{ pause: 500 }, zh(n ? `哇！你${zhVerb}${zhNumber(n)}張卡！好棒！` : '沒關係，我們再玩一次！')]
  }
  return [{ pause: 500 }, en(n ? `Wow! You ${verb} ${enNumber(n)} ${n === 1 ? 'card' : 'cards'}! Great job!` : "Good try! Let's play again!")]
}

/** 圓圈旁邊的提示字 */
const turnLabel = computed(() => {
  if (playPhase.value === 'cheer') return cheerLine.value
  if (playPhase.value === 'model') return t('聽聽看', 'Listen')
  if (playKind.value === 'find') return t('在書上找找看！', 'Find it in your book!')
  return playKind.value === 'say' ? t('換你說！', 'Your turn!') : t('做做看！', 'Do it!')
})

/* ---------- 比一比：哪一邊比較多？哪一個數字比較大？ ---------- */

/**
 * 兩張並排，小朋友點對的那一張：
 *   數一數的字卡本（卡片是 emoji 加數字，小班、中班）：兩堆一樣的東西，「Which has more?／哪一邊比較多？」，不寫數字，要自己數、自己比
 *   純數字的字卡本（認數字 11～20、十個十個數、0～100，中班、大班）：兩個大數字，「Which number is bigger?／哪一個數字比較大？」
 * 問「比較多／比較大」和「比較少／比較小」輪流出，不要學成「選多的就對」。
 *   對了：兩邊的數字亮出來，說「Seven is more than four.／七比四多。」
 *   點錯：說「This is four.」，再問一次，不說 No
 * 前三題兩邊差得多（好分），後面才有差一點點的。一輪六題，一次就對拿一顆星。
 */
interface CmpQuestion {
  /** 左邊、右邊的卡（卡的編號） */
  left: number
  right: number
  /** 問比較多／大，還是比較少／小 */
  ask: 'more' | 'less'
  /** 數一數的題目：兩堆都畫這個 emoji */
  emoji: string
  missed: boolean
}

const CMP_LEN = 6
/** 要有 6 張以上才玩得出變化 */
const CMP_MIN = 6

/** 數一數的卡（emoji 加 1～20）是第幾張；純數字的卡（沒有圖，只有數字）是第幾張 */
const cmpAmountCards = computed(() => cards.value.flatMap((c, i) => (isCounting(c) ? [i] : [])))
const cmpNumberCards = computed(() =>
  cards.value.flatMap((c, i) => (isNumberCard(c) && !c.image && !c.clip ? [i] : [])),
)
/** 這本玩哪一種：數一數的優先；兩種都不夠 6 張就沒有「比一比」 */
const cmpKind = computed<'amount' | 'number' | null>(() =>
  cmpAmountCards.value.length >= CMP_MIN ? 'amount' : cmpNumberCards.value.length >= CMP_MIN ? 'number' : null,
)
const canCompare = computed(() => cmpKind.value !== null)

const cmpQs = ref<CmpQuestion[]>([])
const cmpIdx = ref(0)
const cmpQ = computed(() => cmpQs.value[cmpIdx.value])
const cmpWrong = ref<number[]>([])
const cmpRight = ref<number | null>(null)
const cmpEarned = ref(false)
const cmpStars = ref(0)
const cmpSize = ref(0)
const cmpMissed = ref(false)
const cmpDone = ref(false)
const cmpPerfect = computed(() => !cmpMissed.value && cmpStars.value >= cmpSize.value)

let cmpToken = 0
let cmpTimer: ReturnType<typeof setTimeout> | null = null

function clearCmpTimers() {
  cmpToken++
  if (cmpTimer) clearTimeout(cmpTimer)
  cmpTimer = null
}

/** 這張卡的數量／數字 */
const valueOf = (i: number) => Number(cards.value[i]!.word)

function makeCmpQuestions(): CmpQuestion[] {
  const pool = cmpKind.value === 'amount' ? cmpAmountCards.value : cmpNumberCards.value
  const values = pool.map(valueOf)
  const spread = Math.max(...values) - Math.min(...values)
  const out: CmpQuestion[] = []
  for (let q = 0; q < CMP_LEN; q++) {
    // 前三題要差得多（至少全部範圍的四分之一），後面才差一點點
    const need = q < 3 ? Math.max(1, Math.ceil(spread / 4)) : 1
    let a = pool[0]!
    let b = pool[1]!
    for (let tries = 0; tries < 40; tries++) {
      a = pool[Math.floor(Math.random() * pool.length)]!
      b = pool[Math.floor(Math.random() * pool.length)]!
      if (valueOf(a) !== valueOf(b) && Math.abs(valueOf(a) - valueOf(b)) >= need) break
    }
    if (valueOf(a) === valueOf(b)) b = pool.find((i) => valueOf(i) !== valueOf(a)) ?? b
    const [left, right] = Math.random() < 0.5 ? [a, b] : [b, a]
    // 問「比較少」的穿插在第 3、5 題，其他問比較多
    const ask = q === 2 || q === 4 ? 'less' : 'more'
    const emojiCard = cards.value[pool[Math.floor(Math.random() * pool.length)]!]!
    out.push({ left, right, ask, emoji: emojiCard.image, missed: false })
  }
  return out
}

function startCompare() {
  clearQuizTimers()
  clearPlayTimers()
  clearMissionTimers()
  clearPlaceTimers()
  clearOrderTimers()
  clearCmpTimers()
  clearPrompt()
  stopSpeaking()
  if (!canCompare.value) return
  cmpQs.value = makeCmpQuestions()
  cmpSize.value = cmpQs.value.length
  cmpIdx.value = 0
  cmpStars.value = 0
  cmpMissed.value = false
  cmpWrong.value = []
  cmpRight.value = null
  cmpDone.value = false
  mode.value = 'compare'
  askCmpLater(450, true)
}

/** 題目：Which has more?／哪一邊比較多？（數字卡本問 Which number is bigger?／哪一個數字比較大？） */
function cmpPromptParts(): SpeechPart[] {
  const q = cmpQ.value
  if (!q) return []
  const p =
    cmpKind.value === 'amount'
      ? q.ask === 'more' ? P.cmpMore : P.cmpFewer
      : q.ask === 'more' ? P.cmpBigger : P.cmpSmaller
  return [line(p.zh, p.en)]
}

/** 這個數字怎麼說：中文、英文（中英都唸） */
function numberSpeech(n: number): SpeechText[] {
  if (englishOnly.value) return [en(enNumber(n))]
  if (mixed.value) return [zh(zhNumber(n)), en(enNumber(n))]
  return [zh(zhNumber(n))]
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** 答對了：Seven is more than four.／七比四多。 */
function cmpRightParts(q: CmpQuestion): SpeechPart[] {
  const hi = Math.max(valueOf(q.left), valueOf(q.right))
  const lo = Math.min(valueOf(q.left), valueOf(q.right))
  const amount = cmpKind.value === 'amount'
  if (chineseOnly.value || mixed.value) {
    const [x, y] = q.ask === 'more' ? [hi, lo] : [lo, hi]
    const word = q.ask === 'more' ? (amount ? '多' : '大') : (amount ? '少' : '小')
    const parts: SpeechPart[] = [zh(`${zhNumber(x)}比${zhNumber(y)}${word}。`)]
    return mixed.value ? [...parts, { pause: 250 }, ...numberSpeech(x)] : parts
  }
  const [x, y] = q.ask === 'more' ? [hi, lo] : [lo, hi]
  const rel = q.ask === 'more' ? (amount ? 'more than' : 'bigger than') : (amount ? 'fewer than' : 'smaller than')
  return [en(`${capital(enNumber(x))} is ${rel} ${enNumber(y)}.`)]
}

function askCmp(intro = false) {
  if (!cmpQ.value) return
  speak([...(intro ? [line(P.cmpIntro.zh, P.cmpIntro.en), { pause: 400 }] : []), ...cmpPromptParts()])
}

function askCmpLater(ms = 450, intro = false) {
  if (cmpTimer) clearTimeout(cmpTimer)
  cmpTimer = setTimeout(() => askCmp(intro), ms)
}

function chooseCmp(i: number) {
  const q = cmpQ.value
  if (!q || cmpRight.value !== null) return
  const vl = valueOf(q.left)
  const vr = valueOf(q.right)
  const answer = (q.ask === 'more') === (vl > vr) ? q.left : q.right

  if (cmpWrong.value.includes(i)) {
    // 點過的錯誤那邊再點：只把它是幾說給他聽
    if (cmpTimer) clearTimeout(cmpTimer)
    speak([line(P.cmpThisIs.zh, P.cmpThisIs.en), ...numberSpeech(valueOf(i))])
    return
  }

  if (i === answer) {
    cmpRight.value = i
    cmpEarned.value = !q.missed
    chimeRight()
    if (!q.missed) {
      cmpStars.value++
      addStar(props.deck.uid)
    }
    const token = ++cmpToken
    const minWait = new Promise((r) => setTimeout(r, 1800))
    Promise.all([speak([{ pause: 250 }, ...cheer('right'), { pause: 400 }, ...cmpRightParts(q)]), minWait]).then(() => {
      if (token === cmpToken && mode.value === 'compare') nextCmpQuestion()
    })
    return
  }

  cmpWrong.value = [...cmpWrong.value, i]
  chimeWrong()
  q.missed = true
  cmpMissed.value = true
  if (cmpTimer) clearTimeout(cmpTimer)
  // 告訴他點的那邊是幾，再問一次
  speak([
    { pause: 250 },
    ...cheer('wrong'),
    { pause: 300 },
    line(P.cmpThisIs.zh, P.cmpThisIs.en),
    ...numberSpeech(valueOf(i)),
    { pause: 600 },
    line(P.tryAgain.zh, P.tryAgain.en),
    { pause: 800 },
    ...cmpPromptParts(),
  ])
}

function nextCmpQuestion() {
  cmpWrong.value = []
  cmpRight.value = null
  if (cmpIdx.value + 1 >= cmpQs.value.length) {
    cmpDone.value = true
    chimeRight()
    speak(cmpDoneParts())
    return
  }
  cmpIdx.value++
  askCmpLater()
}

function cmpDoneParts(): SpeechPart[] {
  const s = cmpStars.value
  if (!englishOnly.value) {
    const zhCheer = cmpPerfect.value ? P.perfect.zh : s === 0 ? P.goodTry.zh : `好棒！你拿到${s === 2 ? '兩' : zhNumber(s)}顆星！`
    return [{ pause: 500 }, zh(zhCheer)]
  }
  const cheerEn = cmpPerfect.value ? P.perfect.en : s === 0 ? P.goodTry.en : `Great job! You got ${enNumber(s)} ${s === 1 ? 'star' : 'stars'}!`
  return [{ pause: 500 }, en(cheerEn)]
}

/** 排成五個一排：兩堆放在一起才看得出哪一堆多（同一排的個數一樣，只看有幾排） */
const cmpCols = 5

/* ---------- 排順序：照順序一張一張點 ---------- */

/**
 * 卡片本身就是依順序排的字卡本（片單寫了「順序:」：洗手步驟、一天作息、星期、月份、數字……）才有。
 * 每題從裡面挑連著的三張、打亂擺在下面，小朋友照順序一張一張點：
 *   App 問「What comes first?」→ 點最先的，它飛到上面的第 1 格 →「What comes next?」→ 點第二個 → 最後一張自己放進第 3 格
 *   點錯了：那一張輕輕晃一下、說「Hmm, not that one.」，再問一次，不說 No
 * 排好之後把三樣照順序唸一遍；一輪五題，一次就排對拿一顆星。
 */
interface OrderQuestion {
  /** 連著的三張卡（卡的編號，正確的順序） */
  items: number[]
  /** 下面擺的順序（打亂，不會剛好是對的） */
  shown: number[]
  /** 這題點錯過，排對也不給星星 */
  missed: boolean
}

const ORDER_LEN = 5
const ORDER_SIZE = 3
const canOrder = computed(() => !!props.deck.order && cards.value.length >= ORDER_SIZE)

const orderQs = ref<OrderQuestion[]>([])
const orderIdx = ref(0)
const orderQ = computed(() => orderQs.value[orderIdx.value])
/** 已經照順序排進上面格子的（卡的編號） */
const orderPlaced = ref<number[]>([])
/** 剛點錯的那一張：晃一下 */
const orderFlash = ref<number | null>(null)
const orderStars = ref(0)
const orderSize = ref(0)
const orderMissed = ref(false)
const orderDone = ref(false)
/** 這一題排好了，正在唸、等著換下一題：不能再點 */
const orderLocked = ref(false)
const orderPerfect = computed(() => !orderMissed.value && orderStars.value >= orderSize.value)

let orderToken = 0
let orderTimer: ReturnType<typeof setTimeout> | null = null

function clearOrderTimers() {
  orderToken++
  if (orderTimer) clearTimeout(orderTimer)
  orderTimer = null
}

/** 連著的三張，起點每題不一樣（卡很多的字卡本，每一輪挑到不同的段落） */
function makeOrderQuestions(): OrderQuestion[] {
  const n = cards.value.length
  const starts = shuffle(Array.from({ length: n - ORDER_SIZE + 1 }, (_, i) => i)).slice(0, ORDER_LEN)
  return starts.map((s) => {
    const items = Array.from({ length: ORDER_SIZE }, (_, k) => s + k)
    let shown = shuffle(items)
    // 打亂之後剛好是對的就再打亂，不然第一題就白送
    while (shown.every((v, k) => v === items[k])) shown = shuffle(items)
    return { items, shown, missed: false }
  })
}

function startOrder() {
  clearQuizTimers()
  clearPlayTimers()
  clearMissionTimers()
  clearPlaceTimers()
  clearOrderTimers()
  clearPrompt()
  stopSpeaking()
  if (!canOrder.value) return
  orderQs.value = makeOrderQuestions()
  orderSize.value = orderQs.value.length
  orderIdx.value = 0
  orderPlaced.value = []
  orderFlash.value = null
  orderStars.value = 0
  orderMissed.value = false
  orderDone.value = false
  orderLocked.value = false
  mode.value = 'order'
  askOrderLater(450, true)
}

/** 題目：最先的是哪一個？／接下來是哪一個？ */
function orderPromptParts(): SpeechPart[] {
  return orderPlaced.value.length === 0 ? [line(P.orderFirst.zh, P.orderFirst.en)] : [line(P.orderNext.zh, P.orderNext.en)]
}

function askOrder(intro = false) {
  if (!orderQ.value || orderLocked.value) return
  speak([...(intro ? [line(P.orderIntro.zh, P.orderIntro.en), { pause: 400 }] : []), ...orderPromptParts()])
}

function askOrderLater(ms = 450, intro = false) {
  if (orderTimer) clearTimeout(orderTimer)
  orderTimer = setTimeout(() => askOrder(intro), ms)
}

function chooseOrder(i: number) {
  const q = orderQ.value
  if (!q || orderLocked.value || orderPlaced.value.includes(i)) return
  const expected = q.items[orderPlaced.value.length]!

  if (i !== expected) {
    chimeWrong()
    q.missed = true
    orderMissed.value = true
    orderFlash.value = i
    setTimeout(() => { if (orderFlash.value === i) orderFlash.value = null }, 450)
    if (orderTimer) clearTimeout(orderTimer)
    speak([{ pause: 250 }, ...cheer('wrong'), { pause: 300 }, line(P.tryAgain.zh, P.tryAgain.en), { pause: 700 }, ...orderPromptParts()])
    return
  }

  orderPlaced.value = [...orderPlaced.value, i]
  chimeRight()
  if (orderPlaced.value.length < ORDER_SIZE - 1) {
    // 先唸這張叫什麼，再問下一個
    speak([{ pause: 150 }, ...nameParts(cards.value[i]!), { pause: 450 }, ...orderPromptParts()])
    return
  }
  // 只剩最後一張：自己放進最後一格，這題排好了
  const last = q.items[ORDER_SIZE - 1]!
  setTimeout(() => {
    if (orderQ.value !== q) return
    orderPlaced.value = [...orderPlaced.value, last]
    finishOrderQuestion(q)
  }, 650)
}

/** 排好了：讚美，再把三樣照順序唸一遍；唸完才換下一題 */
function finishOrderQuestion(q: OrderQuestion) {
  orderLocked.value = true
  chimeRight()
  if (!q.missed) {
    orderStars.value++
    addStar(props.deck.uid)
  }
  const token = ++orderToken
  const sequence = q.items.flatMap((k) => [...nameParts(cards.value[k]!), { pause: 350 }])
  const minWait = new Promise((r) => setTimeout(r, 1800))
  Promise.all([speak([{ pause: 200 }, ...cheer('right'), { pause: 400 }, ...sequence]), minWait]).then(() => {
    if (token === orderToken && mode.value === 'order') nextOrderQuestion()
  })
}

function nextOrderQuestion() {
  orderPlaced.value = []
  orderLocked.value = false
  if (orderIdx.value + 1 >= orderQs.value.length) {
    orderDone.value = true
    chimeRight()
    speak(orderDoneParts())
    return
  }
  orderIdx.value++
  askOrderLater()
}

function orderDoneParts(): SpeechPart[] {
  const s = orderStars.value
  if (!englishOnly.value) {
    const zhCheer = orderPerfect.value ? P.perfect.zh : s === 0 ? P.goodTry.zh : `好棒！你拿到${s === 2 ? '兩' : zhNumber(s)}顆星！`
    return [{ pause: 500 }, zh(zhCheer)]
  }
  const cheerEn = orderPerfect.value ? P.perfect.en : s === 0 ? P.goodTry.en : `Great job! You got ${enNumber(s)} ${s === 1 ? 'star' : 'stars'}!`
  return [{ pause: 500 }, en(cheerEn)]
}

/* ---------- 放哪裡：把東西放到對的地方（拖一拖） ---------- */

/**
 * 認識家裡每樣東西屬於哪裡：碗放廚房、牙刷放浴室、鞋子放門口。片單的卡寫了「放:廚房」才玩得到（要 4 張以上、2 個以上的地點）。
 *   App 問「Where does the bowl go?」→ 小朋友把東西拖到對的地方，或是直接點那個地方
 *   對了：東西飛過去、說「Put the bowl in the kitchen.」；放錯：東西彈回來、說「This is the bathroom.」，再問一次，不說 No
 * 幼幼班的手指小、拖不準，直接點地方一樣算。放對了可以接著做「真的放放看」（任務）。
 */
interface PlaceQuestion {
  /** 要放的那張卡是第幾張 */
  card: number
  /** 答案的地點代號 */
  answer: string
  /** 三個地點選項（答案在裡面，順序打亂；地點只有兩種就是兩個） */
  options: string[]
  /** 這題放錯過，放對也不給星星 */
  missed: boolean
  /** 放錯之後補考的那一題，不會再補第二次 */
  retry: boolean
}

/** 一輪最多幾題：跟考考我一樣，寧可多玩幾輪 */
const PLACE_LEN = 8

/** 有寫「放:」的卡是第幾張 */
const placeCards = computed(() => cards.value.flatMap((c, i) => (placeById(c.place) ? [i] : [])))
const canPlace = computed(() =>
  placeCards.value.length >= 4 && new Set(placeCards.value.map((i) => cards.value[i]!.place)).size >= 2,
)

const placeQs = ref<PlaceQuestion[]>([])
const placeIdx = ref(0)
const placeQ = computed(() => placeQs.value[placeIdx.value])
const placeItem = computed(() => (placeQ.value ? cards.value[placeQ.value.card] : undefined))
const placeWrong = ref<string[]>([])
const placeRight = ref<string | null>(null)
const placeEarned = ref(false)
const placeStars = ref(0)
const placeSize = ref(0)
const placeMissed = ref(false)
const placeDone = ref(false)
/** 這一輪最後放對的那樣東西：玩完可以接著「真的放放看」 */
const placeLast = ref<Card | null>(null)
const placePerfect = computed(() => !placeMissed.value && placeStars.value >= placeSize.value)

/** 每換一題、離開都換一個編號，舊的「唸完往下走」發現編號變了就作廢 */
let placeToken = 0
let placeTimer: ReturnType<typeof setTimeout> | null = null

function clearPlaceTimers() {
  placeToken++
  if (placeTimer) clearTimeout(placeTimer)
  placeTimer = null
}

function makePlaceQuestion(cardIdx: number, retry = false): PlaceQuestion {
  const answer = cards.value[cardIdx]!.place!
  const all = [...new Set(placeCards.value.map((i) => cards.value[i]!.place!))]
  const others = shuffle(all.filter((id) => id !== answer)).slice(0, 2)
  return { card: cardIdx, answer, options: shuffle([answer, ...others]), missed: false, retry }
}

function startPlace() {
  clearQuizTimers()
  clearPlayTimers()
  clearMissionTimers()
  clearPlaceTimers()
  clearPrompt()
  stopSpeaking()
  if (!canPlace.value) return
  const order = shuffle(placeCards.value).slice(0, PLACE_LEN)
  placeQs.value = order.map((i) => makePlaceQuestion(i))
  placeSize.value = order.length
  placeIdx.value = 0
  placeStars.value = 0
  placeMissed.value = false
  placeWrong.value = []
  placeRight.value = null
  placeDone.value = false
  placeLast.value = null
  resetDrag()
  mode.value = 'place'
  askPlaceLater(450, true)
}

/** 這樣東西的中文、英文名字 */
function placeNames(c: Card): { zh: string; en: string } {
  const name = speechOf(c)
  return { zh: name.zh || c.word, en: name.en || c.word }
}

/** 題目：Where does the bowl go?／碗要放在哪裡？（複數用 do：Where do the shoes go?）；中英是「碗，bowl，要放在哪裡？」 */
function placePromptParts(): SpeechPart[] {
  const c = placeItem.value
  if (!c) return []
  const n = placeNames(c)
  if (chineseOnly.value) return [zh(`${n.zh}要放在哪裡？`)]
  if (mixed.value) return [zh(`${n.zh}，`), en(n.en), zh('要放在哪裡？')]
  return [en(`Where ${isPluralName(n.en) ? 'do' : 'does'} the ${n.en} go?`)]
}

/** 放對了：Put the bowl in the kitchen.／碗要放在廚房。 */
function placeRightParts(c: Card, p: Place): SpeechPart[] {
  const n = placeNames(c)
  if (chineseOnly.value) return [zh(`${n.zh}要放在${p.zh}。`)]
  if (mixed.value) return [zh(`${n.zh}放在${p.zh}，`), en(p.en)]
  return [en(`Put the ${n.en} ${p.where}.`)]
}

/** 放錯了，告訴他那是哪裡：This is the bathroom.／這是浴室。小朋友再點那個地方也唸這句 */
function thisPlaceParts(p: Place): SpeechPart[] {
  if (chineseOnly.value) return [zh(`這是${p.zh}。`)]
  if (mixed.value) return [zh(`這是${p.zh}，`), en(p.en)]
  return [en(`This is the ${p.en}.`)]
}

function askPlace(intro = false) {
  if (!placeQ.value) return
  speak([...(intro ? [line(P.placeIntro.zh, P.placeIntro.en), { pause: 400 }] : []), ...placePromptParts()])
}

function askPlaceLater(ms = 450, intro = false) {
  if (placeTimer) clearTimeout(placeTimer)
  placeTimer = setTimeout(() => askPlace(intro), ms)
}

/* --- 拖一拖：手指按住那樣東西，拖到哪個地方上放開 --- */

const placeStageRef = ref<HTMLElement | null>(null)
const placeItemRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragX = ref(0)
const dragY = ref(0)
/** 放對之後東西縮小飛進那個地方 */
const dragScale = ref(1)
/** 拖到哪個地方上面了：那個地方亮起來，放開就放在那裡 */
const overPlace = ref<string | null>(null)
let dragFrom = { x: 0, y: 0 }

function resetDrag() {
  dragging.value = false
  dragX.value = 0
  dragY.value = 0
  dragScale.value = 1
  overPlace.value = null
}

/** 這個座標底下是哪個地點（用 data-place 找；東西自己疊在上面也找得到底下的地點） */
function placeIdAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = (el as HTMLElement).closest?.('[data-place]')?.getAttribute('data-place')
    if (id) return id
  }
  return null
}

function onItemDown(e: PointerEvent) {
  if (placeRight.value !== null) return
  dragging.value = true
  dragFrom = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onItemMove(e: PointerEvent) {
  if (!dragging.value) return
  dragX.value = e.clientX - dragFrom.x
  dragY.value = e.clientY - dragFrom.y
  overPlace.value = placeIdAt(e.clientX, e.clientY)
}

function onItemUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  const moved = Math.hypot(dragX.value, dragY.value) > 14
  const id = placeIdAt(e.clientX, e.clientY)
  overPlace.value = null
  if (moved && id) {
    choosePlace(id)
    return
  }
  // 沒放在任何地方：彈回原位；只是點一下的話，把題目再說一次
  dragX.value = 0
  dragY.value = 0
  if (!moved) askPlace()
}

function onItemCancel() {
  resetDrag()
}

/** 放對了：東西飛到那個地方上，縮小停在那裡 */
function flyToPlace(id: string) {
  const item = placeItemRef.value
  // 飛到照片的中央，不蓋住底下的地名
  const target = placeStageRef.value?.querySelector<HTMLElement>(`[data-place="${id}"] .place-photo`)
  if (!item || !target) return
  const a = item.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  dragX.value += (b.left + b.width / 2) - (a.left + a.width / 2)
  dragY.value += (b.top + b.height / 2) - (a.top + a.height / 2)
  dragScale.value = 0.32
}

/** 東西現在的位置：拖的時候跟著手指，放開彈回原位、或飛到地方上 */
const placeItemStyle = computed(() => ({
  transform: `translate(${dragX.value}px, ${dragY.value}px) scale(${dragging.value ? 1.06 : dragScale.value})`,
  transition: dragging.value ? 'none' : 'transform .45s cubic-bezier(.3, 1.25, .5, 1)',
}))

/* --- 放對、放錯 --- */

function choosePlace(id: string) {
  const q = placeQ.value
  const c = placeItem.value
  const p = placeById(id)
  if (!q || !c || !p || placeRight.value !== null) return

  // 點過的錯誤地點再點一次：只把地名唸給他聽，不再說 No、不再扣分，讓他自己比較
  if (placeWrong.value.includes(id)) {
    if (placeTimer) clearTimeout(placeTimer)
    dragX.value = 0
    dragY.value = 0
    speak(thisPlaceParts(p))
    return
  }

  if (id === q.answer) {
    placeRight.value = id
    placeEarned.value = !q.missed
    placeLast.value = c
    chimeRight()
    if (!q.missed) {
      placeStars.value++
      addStar(props.deck.uid)
    }
    flyToPlace(id)
    // 先讚美再說「Put the bowl in the kitchen.」，整串唸完才換下一題；沒有語音的裝置至少停 1.6 秒，讓他看到東西放進去
    const token = ++placeToken
    const minWait = new Promise((r) => setTimeout(r, 1600))
    Promise.all([
      speak([{ pause: 250 }, ...cheer('right'), { pause: 400 }, ...placeRightParts(c, p)]),
      minWait,
    ]).then(() => {
      if (token === placeToken && mode.value === 'place') nextPlaceQuestion()
    })
    return
  }

  placeWrong.value = [...placeWrong.value, id]
  chimeWrong()
  // 放錯的這一題，這一輪最後再考一次——不熟的東西多碰一次
  if (!q.missed && !q.retry) placeQs.value.push(makePlaceQuestion(q.card, true))
  q.missed = true
  placeMissed.value = true
  // 東西彈回原位，告訴他那是哪裡，再把題目問一次
  dragX.value = 0
  dragY.value = 0
  if (placeTimer) clearTimeout(placeTimer)
  speak([
    { pause: 250 },
    ...cheer('wrong'),
    { pause: 300 },
    ...thisPlaceParts(p),
    { pause: 500 },
    line(P.tryAgain.zh, P.tryAgain.en),
    { pause: 900 },
    ...placePromptParts(),
  ])
}

function nextPlaceQuestion() {
  placeWrong.value = []
  placeRight.value = null
  resetDrag()
  if (placeIdx.value + 1 >= placeQs.value.length) {
    placeDone.value = true
    chimeRight()
    speak(placeDoneParts())
    return
  }
  placeIdx.value++
  askPlaceLater()
}

/** 玩完一輪的鼓勵 */
function placeDoneParts(): SpeechPart[] {
  const s = placeStars.value
  if (!englishOnly.value) {
    const zhCheer = placePerfect.value ? P.perfect.zh : s === 0 ? P.goodTry.zh : `好棒！你拿到${s === 2 ? '兩' : zhNumber(s)}顆星！`
    return [{ pause: 500 }, zh(zhCheer)]
  }
  const cheerEn = placePerfect.value ? P.perfect.en : s === 0 ? P.goodTry.en : `Great job! You got ${enNumber(s)} ${s === 1 ? 'star' : 'stars'}!`
  return [{ pause: 500 }, en(cheerEn)]
}

/** 地點名字寫在地點照片下面：全英文寫英文，其他寫中文（中英的英文放在小字） */
function placeLabel(p: Place): { main: string; sub: string } {
  return { main: englishOnly.value ? p.en : p.zh, sub: mixed.value ? p.en : '' }
}

/** 上面有幾顆模式按鈕：五顆（看卡片、跟我說、放哪裡、任務、考考我）手機放不下，圖示先藏起來 */
const modeTabCount = computed(() =>
  1 + [canPlay.value, !!bookPage.value && canPlay.value, canPlace.value, canOrder.value, canCompare.value, canMission.value, canSounds.value, canQuiz.value].filter(Boolean).length,
)

/** 玩完一輪之後「真的放放看」：用最後放對的那樣東西開任務 */
function startPutMission() {
  startMission(undefined, placeLast.value ?? undefined)
}

/* ---------- 生活任務：認識一個東西，再到家裡找找看 ---------- */

/**
 * 看卡片、考考我、跟我說都是在螢幕裡玩。「任務」是走出螢幕：
 *   認識  看那張卡的圖、聽名字（Bus. The bus is big.）
 *   去找  App 說任務（Can you find more vehicles at home?），小朋友離開螢幕去找，找到一個回來按一下，App 數給他聽
 *   貼紙  找夠了，貼一張貼紙、拿一顆星星；畫面停在「去玩吧」，不會自己接下一題
 * 不驗證他是不是真的找到了（跟書上找一樣），目標是讓他動起來、跟爸媽一起看家裡的東西。
 * 「去找」的時候畫面不動，不算進每天的觀看時間。
 */
type MissionPhase = 'meet' | 'go' | 'done'
/** 這一次認識哪一張卡、用哪一個題目（沒有固定的話，依這個編號挑；首頁「今日任務」進來的用首頁排上去時的編號，跟磚上的圖、那句話同一個） */
const missionSeed = ref(0)
/** 這一次的題目：一本字卡有好幾個題目的話，隨編號換 */
const mission = computed(() => missionOf(props.deck, missionSeed.value, missionPlan.value.letter))
const canMission = computed(() => !!mission.value && cards.value.length > 0)
/** 從別的地方（放哪裡）指定要認識這一張；沒有就照 missionSeed 從字卡本裡挑（學校只教到某個字母的話，字母卡只挑教過的） */
const missionForced = ref<Card | null>(null)
const missionCard = computed(() => missionForced.value ?? missionCardOf(props.deck, missionSeed.value, missionPlan.value.letter))
/** 把東西放回去的任務（話裡有 {place}）：玩完放哪裡可以接著做 */
const putMission = computed(() => isPutMission(mission.value))
/** 小朋友要做哪一種事（找、放、做）：按鈕寫「我找到了／我放好了／我做到了」 */
const missionAct = computed(() => missionActOf(mission.value))
const MISSION_BTN = {
  find: { icon: '🙋', zh: '我找到了！', en: 'I found one!', goIcon: '🔎', goZh: '去找找看！', goEn: "Let's find!" },
  put: { icon: '👍', zh: '我放好了！', en: 'I put it there!', goIcon: '🏠', goZh: '去放放看！', goEn: "Let's go!" },
  do: { icon: '💪', zh: '我做到了！', en: 'I did it!', goIcon: '💪', goZh: '去做做看！', goEn: "Let's do it!" },
} as const
const missionBtn = computed(() => MISSION_BTN[missionAct.value])
const missionPhase = ref<MissionPhase>('meet')
/** 這一次已經找到幾個 */
const missionFound = ref(0)
const missionGoal = computed(() => (mission.value ? missionGoalOf(mission.value, missionCard.value) : 3))
/** 任務那句話（中文、英文各一句），{zh}、{en} 已換成這張卡的名字 */
const missionLines = computed(() => (mission.value ? missionTextOf(mission.value, missionCard.value) : { zh: '', en: '' }))
/** 按了「找到了」之後停一下才能再按：不然小朋友連點三下，什麼都沒找就完成了 */
const foundLocked = ref(false)
let foundTimer: ReturnType<typeof setTimeout> | null = null
const missionStickers = computed(() => missionCountOf(props.deck.uid))

/** 任務卡的圖怎麼畫：數字卡畫出那麼多個東西（3 → 🍓🍓🍓），其他照一般卡 */
const missionFace = computed<'img' | 'emoji' | 'count' | 'word'>(() => {
  const c = missionCard.value
  if (!c) return 'word'
  if (isCounting(c)) return 'count'
  return playFace(c)
})

/** 任務那句話：全英文寫英文，其他寫中文（中英的英文放在下面小字） */
const missionText = computed(() => (englishOnly.value ? missionLines.value.en : missionLines.value.zh))

function clearMissionTimers() {
  if (foundTimer) clearTimeout(foundTimer)
  foundTimer = null
  foundLocked.value = false
}

/** 認識時唸的：名字加一句（Bus. The bus is big.），依語言模式 */
function meetParts(): SpeechPart[] {
  const c = missionCard.value
  return c ? answerParts(c) : []
}

/** 任務那句話，依語言模式說英文或中文 */
function missionLineParts(): SpeechPart[] {
  return mission.value ? [line(missionLines.value.zh, missionLines.value.en)] : []
}

/** 找到第 n 個，App 把數字唸出來：One! ／ 一！（中英兩種都唸） */
function foundCountParts(n: number): SpeechText[] {
  if (englishOnly.value) return [en(enNumber(n))]
  if (mixed.value) return [zh(zhNumber(n)), en(enNumber(n))]
  return [zh(zhNumber(n))]
}

/** 換一張認識的卡：不跟上一次同一張（卡只有一張的話沒得換） */
function nextMissionSeed(): number {
  const n = cards.value.length
  return n > 1 ? missionSeed.value + 1 + Math.floor(Math.random() * (n - 1)) : 0
}

function startMission(seed?: number, forCard?: Card) {
  clearQuizTimers()
  clearPlayTimers()
  clearPrompt()
  clearMissionTimers()
  clearPlaceTimers()
  stopSpeaking()
  if (!canMission.value) return
  missionSeed.value = seed ?? nextMissionSeed()
  missionForced.value = forCard ?? null
  mode.value = 'mission'
  missionPhase.value = 'meet'
  missionFound.value = 0
  speak([{ pause: 250 }, line(P.missionIntro.zh, P.missionIntro.en), { pause: 400 }, ...meetParts()])
}

function replayMeet() {
  stopSpeaking()
  speak(meetParts())
}

/** 「去找找看」：認識完了，換小朋友出門找 */
function startSearch() {
  stopSpeaking()
  missionPhase.value = 'go'
  speak([{ pause: 200 }, ...missionLineParts(), { pause: 400 }, line(P.missionGo.zh, P.missionGo.en)])
}

function replaySearch() {
  stopSpeaking()
  speak(missionLineParts())
}

/** 「我找到了」：數給他聽，還沒找夠就再找一個，找夠了就貼貼紙 */
function foundOne() {
  if (missionPhase.value !== 'go' || foundLocked.value) return
  stopSpeaking()
  missionFound.value++
  const n = missionFound.value
  chimeRight()
  // 只要找一個的任務（拿來給爸媽看、放回去）不用數 One!，直接說完成
  const counted = missionGoal.value > 1 ? foundCountParts(n) : []
  if (n >= missionGoal.value) {
    missionPhase.value = 'done'
    addStar(props.deck.uid)
    completeMission(props.deck.uid)
    speak([{ pause: 200 }, ...counted, { pause: 400 }, line(P.missionDone.zh, P.missionDone.en)])
    return
  }
  foundLocked.value = true
  foundTimer = setTimeout(() => { foundLocked.value = false }, 1800)
  speak([{ pause: 200 }, ...counted, { pause: 400 }, line(P.missionAnother.zh, P.missionAnother.en)])
}

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
  if (showPage.value) {
    if (e.key === 'Escape') closePage()
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
    // 任務「去找」的時候畫面不動、小朋友人在別處，不算進每天的觀看時間
    const searching = mode.value === 'mission' && missionPhase.value === 'go'
    if (delta > 0 && delta < 3 && !searching) addSeconds(delta)
    if (isLimitReached.value) emit('close')
  }, 1000)

  window.addEventListener('keydown', onKey)
  nextSentence()
  // 照家裡的書做的：先秀整頁，叫小朋友把書翻到這一頁；按了「找到了」才開始問第一張
  if (showPage.value) openPage()
  else if (props.start === 'mission' && canMission.value) startMission(missionSeedOf(todayPicks.value, props.deck.uid))
  else {
    askCardLater()
    if (isTv) nextTick(() => cardRef.value?.focus())
  }
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (flipTimer) clearTimeout(flipTimer)
  clearPrompt()
  clearQuizTimers()
  clearPlayTimers()
  clearMissionTimers()
  clearPlaceTimers()
  clearOrderTimers()
  clearCmpTimers()
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
        <span>{{ t('返回', 'Back') }}</span>
      </button>

      <h2 class="deck-title">{{ englishOnly ? englishTitle(deck) : chineseOnly ? chineseTitle(deck) : deck.title }}</h2>

      <span class="star-pill" :aria-label="`已經拿到 ${stars} 顆星`">
        <span aria-hidden="true">⭐</span>{{ stars }}
      </span>

      <!-- 兩排的時候（直放、窄的橫放）在這裡換行：第一排返回、名稱、星星，第二排語言和模式按鈕，每一顆就有更多寬度 -->
      <span class="bar-break" aria-hidden="true" />

      <!-- 中文／中英／English：記在這台裝置上，每一本字卡都照這個設定 -->
      <div v-if="!zhDeck" class="lang-toggle" role="group" aria-label="字卡語言">
        <button
          v-for="l in LANGS"
          :key="l.id"
          class="lang-btn"
          :class="{ 'is-active': cardLang === l.id }"
          :aria-pressed="cardLang === l.id"
          @click="switchLang(l.id)"
        >
          {{ l.label }}
        </button>
      </div>

      <nav class="mode-tabs" :class="{ 'is-many': modeTabCount >= 5 }" aria-label="模式">
        <button
          class="mode-tab"
          :class="{ 'is-active': mode === 'learn' }"
          :aria-current="mode === 'learn' ? 'true' : undefined"
          @click="toLearn"
        >
          <span aria-hidden="true">📖</span>{{ t('看卡片', 'Cards') }}
        </button>
        <!-- 跟我說（一般字卡）／做動作（動作、口令、習慣）：換小朋友開口、動一動 -->
        <button
          v-if="canPlay"
          class="mode-tab"
          :class="{ 'is-active': mode === 'play' && playKind !== 'find' }"
          :aria-current="mode === 'play' && playKind !== 'find' ? 'true' : undefined"
          @click="startAct"
        >
          <span aria-hidden="true">{{ actKind === 'say' ? '🗣️' : '🏃' }}</span>{{ actKind === 'say' ? t('跟我說', 'Say it') : t('做動作', 'Do it') }}
        </button>
        <!-- 書上找：照家裡的書做的字卡本才有，聽到名字就在手上的書裡找出來 -->
        <button
          v-if="bookPage && canPlay"
          class="mode-tab"
          :class="{ 'is-active': mode === 'play' && playKind === 'find' }"
          :aria-current="mode === 'play' && playKind === 'find' ? 'true' : undefined"
          @click="startFind"
        >
          <span aria-hidden="true">🔍</span>{{ t('書上找', 'Find') }}
        </button>
        <!-- 放哪裡：有寫「放:」的卡，把東西拖到對的地方 -->
        <button
          v-if="canPlace"
          class="mode-tab"
          :class="{ 'is-active': mode === 'place' }"
          :aria-current="mode === 'place' ? 'true' : undefined"
          @click="startPlace"
        >
          <span aria-hidden="true">🏠</span>{{ t('放哪裡', 'Where') }}
        </button>
        <!-- 比一比：數一數的字卡本比哪邊比較多、純數字的字卡本比哪個數字比較大 -->
        <button
          v-if="canCompare"
          class="mode-tab"
          :class="{ 'is-active': mode === 'compare' }"
          :aria-current="mode === 'compare' ? 'true' : undefined"
          @click="startCompare"
        >
          <span aria-hidden="true">⚖️</span>{{ t('比一比', 'Compare') }}
        </button>
        <!-- 排順序：卡片本身依順序排的字卡本（片單的「順序:」），照順序一張一張點 -->
        <button
          v-if="canOrder"
          class="mode-tab"
          :class="{ 'is-active': mode === 'order' }"
          :aria-current="mode === 'order' ? 'true' : undefined"
          @click="startOrder"
        >
          <span aria-hidden="true">🔢</span>{{ t('排順序', 'Order') }}
        </button>
        <!-- 任務：認識一個東西，再到家裡找找看；片單有寫「任務:」的字卡本才有 -->
        <button
          v-if="canMission"
          class="mode-tab"
          :class="{ 'is-active': mode === 'mission' }"
          :aria-current="mode === 'mission' ? 'true' : undefined"
          @click="startMission()"
        >
          <span aria-hidden="true">🔎</span>{{ t('任務', 'Mission') }}
        </button>
        <!-- 聽聲音：有真正叫聲（片單的「聲:」）的字卡本，聽叫聲點出是哪隻動物 -->
        <button
          v-if="canSounds"
          class="mode-tab"
          :class="{ 'is-active': mode === 'quiz' && quizSound }"
          :aria-current="mode === 'quiz' && quizSound ? 'true' : undefined"
          @click="startSounds()"
        >
          <span aria-hidden="true">🔊</span>{{ t('聽聲音', 'Sounds') }}
        </button>
        <button
          v-if="canQuiz"
          class="mode-tab"
          :class="{ 'is-active': mode === 'quiz' && !quizSound }"
          :aria-current="mode === 'quiz' && !quizSound ? 'true' : undefined"
          @click="startQuiz()"
        >
          <span aria-hidden="true">🎯</span>{{ t('考考我', 'Quiz') }}
        </button>
      </nav>
    </header>

    <!-- ===== 看卡片 ===== -->
    <main v-if="mode === 'learn' && card" class="learn" :class="{ 'has-extra-btns': !!bookPage || !!(card.clip && online) || !!card.sound }">
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
              <span v-if="currentLetter && !chineseOnly" class="abc-badge">{{ badgeOf(card) }}</span>
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
              <img v-else-if="isPicture(card) && !zhCard" class="face-img" :class="{ 'is-book': isBookImage(card.image) }" :src="imageSrc(card.image)" alt="" draggable="false">
              <span v-else-if="card.image && !zhCard" class="face-emoji" :style="{ '--n': emojiCount(card.image) }">{{ card.image }}</span>
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
                    :class="{ 'is-wrong': countWrong.includes(opt), 'is-two': opt >= 10 }"
                    @click.stop="pickCount(opt)"
                  >
                    {{ opt }}
                  </button>
                </div>
              </div>
              <!-- 現在要做什麼：英文那行是說給小朋友聽的，中文那行給爸媽看 -->
              <span v-else class="face-hint">
                <span class="hint-en">{{ frontAsk(card).main }}</span>
                <span v-if="frontAsk(card).sub" class="hint-zh">{{ frontAsk(card).sub }}</span>
              </span>
            </div>

            <!-- 背面是答案：大字＋說明，翻過來的同時唸出來 -->
            <div
              class="face face-back"
              :class="{ 'has-back-image': backImageOf(card), 'has-number-sentence': isNumberCard(card) && numberSentence(card) }"
              :aria-hidden="!flipped"
            >
              <!-- 背面放了原卡的話，原卡上本來就印著字母，不再疊一個標籤 -->
              <span v-if="currentLetter && !backImageOf(card) && !chineseOnly" class="abc-badge">{{ badgeOf(card) }}</span>
              <img v-if="backPicture" class="back-img" :src="imageSrc(backPicture)" alt="" draggable="false">
              <span v-else-if="card.image && count === null" class="back-emoji" :style="{ '--n': emojiCount(card.image) }">{{ card.image }}</span>
              <!-- 數字卡背面也排一排小小的實物，數量跟數字放在一起看 -->
              <span v-if="showCount" class="back-count">{{ (card.image || '⭐').repeat(count ?? 0) }}</span>
              <span class="back-word" :class="{ 'is-number': isNumberCard(card) }" :style="{ '--len': visualLength(backWordOf(card)) / 0.55 }">
                <!-- 字母卡把開頭字母上色：A is for ant 的那個 a（全中文寫的是「螞蟻」，就不上色） -->
                <template v-if="currentLetter && !chineseOnly"><span class="back-initial">{{ card.word.charAt(0) }}</span>{{ card.word.slice(1) }}</template>
                <template v-else>{{ backWordOf(card) }}</template>
              </span>
              <!-- 數字卡：one pencil／一支鉛筆；單字卡：說明，再加上翻面時唸的那句英文 -->
              <template v-if="isNumberCard(card)">
                <span class="back-meaning">{{ chineseOnly ? numberLabels(card).zh : numberLabels(card).en }}</span>
                <span v-if="mixed" class="back-sub">{{ numberLabels(card).zh }}</span>
                <span v-if="numberSentence(card)" class="back-sub back-sentence">
                  <span v-for="(line, li) in sentenceLines(numberSentence(card))" :key="li" class="sub-line">{{ line }}</span>
                </span>
              </template>
              <template v-else>
                <span v-if="card.meaning && (mixed || zhCard)" class="back-meaning">{{ card.meaning }}</span>
                <span v-if="englishOnly && sentenceFor(card)" class="back-sub">
                  <span v-for="(line, li) in sentenceLines(sentenceFor(card))" :key="li" class="sub-line">{{ line }}</span>
                </span>
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

        <button v-if="canSpeak" class="ctl ctl-wide ctl-listen" @click="listen">
          <span aria-hidden="true">🔊</span>{{ t('聽', 'Listen') }}
        </button>

        <!-- 照家裡的書做的：再看一次是書上的哪一頁 -->
        <button v-if="bookPage" class="ctl ctl-wide ctl-page" :aria-label="t('看書上的這一頁', 'Book page')" @click="openPage">
          <span aria-hidden="true">📖</span><span class="ctl-text">{{ t('這一頁', 'Page') }}</span>
        </button>

        <!-- 影片片段要有網路才放得出來，沒網路時先藏起來，字卡本身照常玩 -->
        <button v-if="card.clip && online" class="ctl ctl-wide ctl-video" @click="openClip(card.clip)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>{{ t('看影片', 'Video') }}
        </button>

        <!-- 動物真正的叫聲（有影片片段的卡，位置讓給影片） -->
        <button v-if="card.sound && !(card.clip && online)" class="ctl ctl-wide ctl-video ctl-sound" @click="playSound(card)">
          <span aria-hidden="true">🔊</span>{{ t('叫聲', 'Sound') }}
        </button>

        <!-- 看到最後一張，下一步順勢接到考考我 -->
        <button v-if="isLast && canQuiz" class="ctl ctl-wide ctl-quiz" @click="startQuiz()">
          <span aria-hidden="true">🎯</span>{{ t('考考我', 'Quiz') }}
        </button>
        <button v-else class="ctl ctl-nav" aria-label="下一張" @click="go(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
        </button>
      </div>
    </main>

    <!-- ===== 跟我說／做動作 ===== -->
    <main v-else-if="mode === 'play'" class="quiz play" :class="`is-${playPhase}`">
      <template v-if="!playDone && playCard">
        <p class="quiz-progress">
          {{ t(`第 ${pIndex + 1} 張／共 ${playOrder.length} 張`, `Card ${pIndex + 1} of ${playOrder.length}`) }}
        </p>

        <!-- 圖和那句話：圖是小朋友要說（做）的情境，點圖再聽一次 -->
        <button class="play-card" :aria-label="t('再聽一次', 'Listen again')" @click="replayPlay">
          <!-- 書上找：還沒揭曉先蓋一本書，要在手上的書裡找，不是看螢幕 -->
          <span v-if="findHidden" class="play-emoji" style="--n: 1">📖</span>
          <img v-else-if="playFace(playCard) === 'img'" class="play-img" :class="{ 'is-book': isBookImage(playCard.image) }" :src="imageSrc(playCard.image)" alt="" draggable="false">
          <span
            v-else-if="playFace(playCard) === 'emoji'"
            class="play-emoji"
            :style="{ '--n': emojiCount(playCard.image) }"
          >{{ playCard.image }}</span>
          <span v-else class="play-big" :style="{ '--len': visualLength(playPhrase(playCard).main) / 0.55 }">{{ playPhrase(playCard).main }}</span>
          <template v-if="playFace(playCard) !== 'word'">
            <span class="play-phrase" :style="{ '--len': visualLength(playPhrase(playCard).main) / 0.55 }">{{ playPhrase(playCard).main }}</span>
          </template>
          <span v-if="playPhrase(playCard).sub" class="play-sub">{{ playPhrase(playCard).sub }}</span>
          <!-- 說完、做完：星星往四周飛出去 -->
          <span v-if="playPhase === 'cheer'" class="burst" aria-hidden="true">
            <i v-for="n in 8" :key="n" :style="{ '--a': `${n * 45}deg` }">{{ n % 2 ? '⭐' : '✨' }}</i>
          </span>
        </button>

        <!-- 輪到你：圓圈倒數，點一下就算說完（做完） -->
        <div class="turn" :class="{ 'is-turn': playPhase === 'turn' }" :style="{ '--dur': `${turnMs}ms` }">
          <button
            class="turn-btn"
            :disabled="playPhase !== 'turn'"
            :aria-label="playKind === 'find' ? t('我找到了', 'I found it') : playKind === 'say' ? t('我說完了', 'I said it') : t('我做完了', 'I did it')"
            @click="finishTurn"
          >
            <svg class="turn-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="turn-track" cx="50" cy="50" r="44" />
              <circle class="turn-fill" cx="50" cy="50" r="44" pathLength="100" />
            </svg>
            <span class="turn-icon" aria-hidden="true">{{ playPhase === 'cheer' ? '🎉' : playPhase === 'model' ? '👂' : playKind === 'find' ? '👆' : playKind === 'say' ? '🎤' : '🙌' }}</span>
          </button>
          <p class="turn-label" aria-live="polite">{{ turnLabel }}</p>
        </div>

        <div class="learn-controls play-controls">
          <button v-if="canSpeak" class="ctl ctl-wide" @click="replayPlay">
            <span aria-hidden="true">🔊</span>{{ t('再聽一次', 'Again') }}
          </button>
          <button class="ctl ctl-wide" @click="skipPlay">
            {{ t('下一張', 'Next') }}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
          </button>
        </div>
      </template>

      <div v-else class="quiz-done">
        <span class="done-emoji" aria-hidden="true">🎉</span>
        <p class="done-title">{{ t('玩完一輪了！', 'Great job!') }}</p>
        <p class="done-stars">
          <template v-if="playKind === 'find'">
            <template v-if="englishOnly">You found <strong>{{ playDoneCount }}</strong> in your book</template>
            <template v-else>在書上找到 <strong>{{ playDoneCount }}</strong> 個</template>
          </template>
          <template v-else-if="englishOnly">You {{ playKind === 'say' ? 'said' : 'did' }} <strong>{{ playDoneCount }}</strong> {{ playDoneCount === 1 ? 'card' : 'cards' }}</template>
          <template v-else>{{ playKind === 'say' ? '你說了' : '你做了' }} <strong>{{ playDoneCount }}</strong> 張卡</template>
        </p>
        <div class="done-actions" style="margin-top: 14px">
          <button class="ctl ctl-wide ctl-quiz" @click="startPlay">{{ t('再玩一次', 'Play again') }}</button>
          <button v-if="canQuiz" class="ctl ctl-wide" @click="startQuiz()">
            <span aria-hidden="true">🎯</span>{{ t('考考我', 'Quiz') }}
          </button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 比一比：哪一邊比較多？哪一個數字比較大？ ===== -->
    <main v-else-if="mode === 'compare'" class="quiz compare">
      <template v-if="!cmpDone && cmpQ">
        <p class="quiz-progress">
          {{ t(`第 ${cmpIdx + 1} 題／共 ${cmpQs.length} 題`, `Question ${cmpIdx + 1} of ${cmpQs.length}`) }}
        </p>

        <!-- 題目用聽的，沒有語音的裝置才寫出來 -->
        <button class="ask-btn" @click="askCmp()">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span class="ask-label">
            <template v-if="canSpeak">{{ t('看一看，比一比', 'Look and compare!') }}</template>
            <template v-else>{{ cmpPromptParts().map((p) => ('text' in p ? p.text : '')).join(' ') }}</template>
          </span>
        </button>

        <div class="cmp-board">
          <button
            v-for="side in [cmpQ.left, cmpQ.right]"
            :key="`${cmpIdx}-${side}`"
            class="cmp-card"
            :class="{ 'is-right': cmpRight === side, 'is-wrong': cmpWrong.includes(side), 'is-number': cmpKind === 'number' }"
            :aria-label="cmpKind === 'number' ? String(valueOf(side)) : t('一堆東西', 'A pile')"
            @click="chooseCmp(side)"
          >
            <!-- 數一數：一堆 emoji，五個一排；數字先不寫，要自己數、自己比 -->
            <span v-if="cmpKind === 'amount'" class="cmp-grid" :style="{ '--cols': cmpCols }">
              <i v-for="k in valueOf(side)" :key="k" aria-hidden="true">{{ cmpQ.emoji }}</i>
            </span>
            <!-- 純數字：一個大數字 -->
            <span v-else class="cmp-num" :style="{ '--len': String(valueOf(side)).length }">{{ valueOf(side) }}</span>
            <!-- 答完才亮出數字：數一數的兩堆各是幾個 -->
            <span v-if="cmpRight !== null && cmpKind === 'amount'" class="cmp-value" aria-hidden="true">{{ valueOf(side) }}</span>
            <span v-if="cmpRight === side" class="option-star" aria-hidden="true">{{ cmpEarned ? '⭐' : '👍' }}</span>
          </button>
        </div>
      </template>

      <div v-else class="quiz-done">
        <span class="done-emoji" aria-hidden="true">{{ cmpPerfect ? '🏆' : '🎉' }}</span>
        <p class="done-title">
          <template v-if="cmpPerfect">{{ t('全部比對了！', 'All correct!') }}</template>
          <template v-else>{{ t('比完了！', 'Well done!') }}</template>
        </p>
        <p class="done-stars">
          <template v-if="englishOnly">You got <strong>{{ cmpStars }}</strong> {{ cmpStars === 1 ? 'star' : 'stars' }}</template>
          <template v-else>拿到 <strong>{{ cmpStars }}</strong> 顆星</template>
        </p>
        <div class="done-row" aria-hidden="true">
          <span v-for="i in cmpSize" :key="i" class="done-star" :class="{ 'is-on': i <= cmpStars }">⭐</span>
        </div>
        <div class="done-actions">
          <button class="ctl ctl-wide ctl-quiz" @click="startCompare">{{ t('再玩一次', 'Play again') }}</button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 排順序：照順序一張一張點 ===== -->
    <main v-else-if="mode === 'order'" class="quiz order">
      <template v-if="!orderDone && orderQ">
        <p class="quiz-progress">
          {{ t(`第 ${orderIdx + 1} 題／共 ${orderQs.length} 題`, `Question ${orderIdx + 1} of ${orderQs.length}`) }}
        </p>

        <button class="ask-btn" @click="askOrder()">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span class="ask-label">{{ t('照順序點', 'Tap in order') }}</span>
        </button>

        <div class="order-board">
        <!-- 上面三格：排對的卡一張一張飛進來，格子上的數字是第幾個 -->
        <div class="order-slots">
          <div
            v-for="(_, s) in ORDER_SIZE"
            :key="s"
            class="order-slot"
            :class="{ 'is-filled': orderPlaced[s] !== undefined }"
          >
            <span class="order-num" aria-hidden="true">{{ s + 1 }}</span>
            <template v-if="orderPlaced[s] !== undefined">
              <img v-if="playFace(cards[orderPlaced[s]!]!) === 'img'" class="of-img" :src="imageSrc(cards[orderPlaced[s]!]!.image)" alt="" draggable="false">
              <span
                v-else-if="playFace(cards[orderPlaced[s]!]!) === 'emoji'"
                class="of-emoji"
                :style="{ '--n': emojiCount(cards[orderPlaced[s]!]!.image) }"
              >{{ cards[orderPlaced[s]!]!.image }}</span>
              <span class="of-word">{{ playPhrase(cards[orderPlaced[s]!]!).main }}</span>
            </template>
          </div>
        </div>

        <!-- 下面三張：打亂的，點的順序要跟上面格子的數字一樣；排進去的位置留空，其他的不會跳位 -->
        <div class="order-choices">
          <button
            v-for="i in orderQ.shown"
            :key="`${orderIdx}-${i}`"
            class="order-card"
            :class="{ 'is-gone': orderPlaced.includes(i), 'is-wrong': orderFlash === i }"
            :disabled="orderPlaced.includes(i) || orderLocked"
            :aria-label="placeNames(cards[i]!).zh"
            @click="chooseOrder(i)"
          >
            <img v-if="playFace(cards[i]!) === 'img'" class="of-img" :src="imageSrc(cards[i]!.image)" alt="" draggable="false">
            <span v-else-if="playFace(cards[i]!) === 'emoji'" class="of-emoji" :style="{ '--n': emojiCount(cards[i]!.image) }">{{ cards[i]!.image }}</span>
            <span class="of-word">{{ playPhrase(cards[i]!).main }}</span>
          </button>
        </div>
        </div>
      </template>

      <div v-else class="quiz-done">
        <span class="done-emoji" aria-hidden="true">{{ orderPerfect ? '🏆' : '🎉' }}</span>
        <p class="done-title">
          <template v-if="orderPerfect">{{ t('全部排對了！', 'All in order!') }}</template>
          <template v-else>{{ t('排好了！', 'Well done!') }}</template>
        </p>
        <p class="done-stars">
          <template v-if="englishOnly">You got <strong>{{ orderStars }}</strong> {{ orderStars === 1 ? 'star' : 'stars' }}</template>
          <template v-else>拿到 <strong>{{ orderStars }}</strong> 顆星</template>
        </p>
        <div class="done-row" aria-hidden="true">
          <span v-for="i in orderSize" :key="i" class="done-star" :class="{ 'is-on': i <= orderStars }">⭐</span>
        </div>
        <div class="done-actions">
          <button class="ctl ctl-wide ctl-quiz" @click="startOrder">{{ t('再玩一次', 'Play again') }}</button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 放哪裡：把東西拖到（或點）對的地方 ===== -->
    <main v-else-if="mode === 'place'" class="quiz place" :class="{ 'is-dragging': dragging }">
      <template v-if="!placeDone && placeQ && placeItem">
        <p class="quiz-progress">
          {{ t(`第 ${placeIdx + 1} 題／共 ${placeQs.length} 題`, `Question ${placeIdx + 1} of ${placeQs.length}`) }}
        </p>

        <!-- 題目用聽的；東西的名字寫在卡上，小朋友看得到是什麼，要想的是它放哪裡 -->
        <button class="ask-btn" @click="askPlace()">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span class="ask-label">{{ t('放到對的地方', 'Where does it go?') }}</span>
        </button>

        <div ref="placeStageRef" class="place-stage">
          <!-- 要放的東西：按住拖到下面的地方，放開就放在那裡 -->
          <div
            ref="placeItemRef"
            class="place-item"
            :class="{ 'is-dragging': dragging, 'is-placed': placeRight !== null }"
            :style="placeItemStyle"
            role="img"
            :aria-label="placeNames(placeItem).zh"
            @pointerdown="onItemDown"
            @pointermove="onItemMove"
            @pointerup="onItemUp"
            @pointercancel="onItemCancel"
          >
            <img v-if="playFace(placeItem) === 'img'" class="place-img" :src="imageSrc(placeItem.image)" alt="" draggable="false">
            <span v-else-if="playFace(placeItem) === 'emoji'" class="place-emoji" :style="{ '--n': emojiCount(placeItem.image) }">{{ placeItem.image }}</span>
            <span class="place-word" :style="{ '--len': visualLength(playPhrase(placeItem).main) / 0.55 }">{{ playPhrase(placeItem).main }}</span>
            <span v-if="playPhrase(placeItem).sub" class="place-sub">{{ playPhrase(placeItem).sub }}</span>
          </div>

          <div class="place-options">
            <button
              v-for="id in placeQ.options"
              :key="`${placeIdx}-${id}`"
              class="place-opt"
              :class="{ 'is-over': overPlace === id, 'is-right': placeRight === id, 'is-wrong': placeWrong.includes(id) }"
              :data-place="id"
              :aria-label="placeById(id)!.zh"
              @click="choosePlace(id)"
            >
              <img v-if="placeById(id)!.image" class="place-photo" :src="imageSrc(placeById(id)!.image)" alt="" draggable="false">
              <span v-else class="place-photo place-photo-emoji" aria-hidden="true">{{ placeById(id)!.emoji }}</span>
              <span class="place-name">
                {{ placeLabel(placeById(id)!).main }}
                <small v-if="placeLabel(placeById(id)!).sub">{{ placeLabel(placeById(id)!).sub }}</small>
              </span>
              <span v-if="placeRight === id" class="option-star" aria-hidden="true">{{ placeEarned ? '⭐' : '👍' }}</span>
            </button>
          </div>
        </div>
      </template>

      <div v-else class="quiz-done">
        <span class="done-emoji" aria-hidden="true">{{ placePerfect ? '🏆' : '🎉' }}</span>
        <p class="done-title">
          <template v-if="placePerfect">{{ t('全部放對了！', 'All in the right place!') }}</template>
          <template v-else>{{ t('收好了！', 'All tidy!') }}</template>
        </p>
        <p class="done-stars">
          <template v-if="englishOnly">You got <strong>{{ placeStars }}</strong> {{ placeStars === 1 ? 'star' : 'stars' }}</template>
          <template v-else>拿到 <strong>{{ placeStars }}</strong> 顆星</template>
        </p>
        <div class="done-row" aria-hidden="true">
          <span v-for="i in placeSize" :key="i" class="done-star" :class="{ 'is-on': i <= placeStars }">⭐</span>
        </div>
        <div class="done-actions">
          <button class="ctl ctl-wide ctl-quiz" @click="startPlace">{{ t('再玩一次', 'Play again') }}</button>
          <!-- 玩完螢幕裡的，接著把真的東西放回去 -->
          <button v-if="canMission && putMission && placeLast" class="ctl ctl-wide" @click="startPutMission">
            <span aria-hidden="true">🏠</span>{{ t('真的放放看', 'Do it for real') }}
          </button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 生活任務：認識一個東西，再到家裡找找看 ===== -->
    <main v-else-if="mode === 'mission' && missionCard && mission" class="quiz mission" :class="`is-${missionPhase}`">
      <ol class="mission-steps" aria-hidden="true">
        <li :class="{ 'is-on': missionPhase === 'meet', 'is-past': missionPhase !== 'meet' }"><span>1</span>{{ t('認識', 'Meet') }}</li>
        <li :class="{ 'is-on': missionPhase === 'go', 'is-past': missionPhase === 'done' }"><span>2</span>{{ t('去找', 'Find') }}</li>
        <li :class="{ 'is-on': missionPhase === 'done' }"><span>3</span>{{ t('貼紙', 'Sticker') }}</li>
      </ol>

      <template v-if="missionPhase !== 'done'">
        <!-- 認識和去找都放同一張卡：認識時大、去找時縮小，騰出位置給任務那句話 -->
        <button
          class="play-card mission-card"
          :class="{ 'is-small': missionPhase === 'go' }"
          :aria-label="t('再聽一次', 'Listen again')"
          @click="missionPhase === 'meet' ? replayMeet() : replaySearch()"
        >
          <img v-if="missionFace === 'img'" class="play-img" :src="imageSrc(missionCard.image)" alt="" draggable="false">
          <span
            v-else-if="missionFace === 'emoji'"
            class="play-emoji"
            :style="{ '--n': emojiCount(missionCard.image) }"
          >{{ missionCard.image }}</span>
          <span
            v-else-if="missionFace === 'count'"
            class="play-emoji"
            :style="{ '--n': Number(missionCard.word) }"
          >{{ missionCard.image.repeat(Number(missionCard.word)) }}</span>
          <span v-else class="play-big" :style="{ '--len': visualLength(playPhrase(missionCard).main) / 0.55 }">{{ playPhrase(missionCard).main }}</span>
          <template v-if="missionFace !== 'word'">
            <span class="play-phrase" :style="{ '--len': visualLength(playPhrase(missionCard).main) / 0.55 }">{{ playPhrase(missionCard).main }}</span>
          </template>
          <span v-if="playPhrase(missionCard).sub" class="play-sub">{{ playPhrase(missionCard).sub }}</span>
        </button>

        <!-- 1 認識：看一看、聽名字，準備好了就出發 -->
        <template v-if="missionPhase === 'meet'">
          <p class="mission-say">{{ t('先認識一下！', 'Meet it first!') }}</p>
          <button class="mission-main" @click="startSearch">
            <span aria-hidden="true">{{ missionBtn.goIcon }}</span>{{ t(missionBtn.goZh, missionBtn.goEn) }}
          </button>
        </template>

        <!-- 2 去找：任務那句話、要找幾個，找到一個按一下 -->
        <template v-else>
          <p class="mission-say">
            {{ missionText }}
            <small v-if="mixed" class="mission-say-sub">{{ missionLines.en }}</small>
          </p>
          <ul class="mission-slots" :class="{ 'is-many': missionGoal > 5 }" :aria-label="t(`找到 ${missionFound} 個，要找 ${missionGoal} 個`, `Found ${missionFound} of ${missionGoal}`)">
            <li v-for="n in missionGoal" :key="n" :class="{ 'is-found': n <= missionFound }">
              <span aria-hidden="true">{{ n <= missionFound ? '⭐' : '' }}</span>
            </li>
          </ul>
          <button class="mission-main" :disabled="foundLocked" @click="foundOne">
            <span aria-hidden="true">{{ missionBtn.icon }}</span>{{ t(missionBtn.zh, missionBtn.en) }}
          </button>
          <p v-if="mission.tip" class="mission-tip"><span aria-hidden="true">💡</span> {{ mission.tip }}</p>
        </template>

        <div class="mission-controls">
          <button v-if="canSpeak" class="ctl ctl-wide" @click="missionPhase === 'meet' ? replayMeet() : replaySearch()">
            <span aria-hidden="true">🔊</span>{{ t('再聽一次', 'Again') }}
          </button>
        </div>
      </template>

      <!-- 3 貼紙：畫面停在這裡，不會自己接下一題 -->
      <div v-else class="quiz-done mission-done">
        <span class="mission-sticker" aria-hidden="true">
          <img v-if="missionFace === 'img'" :src="imageSrc(missionCard.image)" alt="" draggable="false">
          <template v-else-if="missionFace === 'word'">{{ missionCard.word }}</template>
          <template v-else>{{ missionCard.image }}</template>
        </span>
        <p class="done-title">{{ t('任務完成！', 'Mission complete!') }}</p>
        <p class="done-stars">
          <template v-if="englishOnly">You found <strong>{{ missionFound }}</strong> · <strong>{{ missionStickers }}</strong> {{ missionStickers === 1 ? 'sticker' : 'stickers' }}</template>
          <template v-else>找到 <strong>{{ missionFound }}</strong> 個 · 貼紙 <strong>{{ missionStickers }}</strong> 張</template>
        </p>
        <p class="mission-say">{{ t('關掉螢幕，去玩吧！', 'Now go and play!') }}</p>
        <div class="done-actions" style="margin-top: 14px">
          <button class="ctl ctl-wide" @click="startMission()">{{ t('再玩一次', 'Play again') }}</button>
          <button class="ctl ctl-wide" @click="emit('stickers')"><span aria-hidden="true">🏅</span>{{ t('貼紙本', 'Stickers') }}</button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 考考我 ===== -->
    <main v-else-if="mode === 'quiz'" class="quiz" :class="{ 'is-picture': pictureQuiz && !quizDone }">
      <template v-if="!quizDone && question">
        <p class="quiz-progress">
          {{ t(`第 ${qIndex + 1} 題／共 ${questions.length} 題`, `Question ${qIndex + 1} of ${questions.length}`) }}
        </p>

        <!-- 看圖選數字：題目就是那張形狀圖 -->
        <template v-if="pictureQuiz">
          <img class="prompt-img" :src="imageSrc(cards[question.answer]!.image)" alt="" draggable="false">
          <p class="prompt-text">
            {{ englishOnly ? 'What number is this?' : '這是數字幾？' }}
          </p>
        </template>
        <!-- 題目不寫出來（寫了就等於把答案給他看），用聽的；沒有語音的裝置才把題目寫出來 -->
        <button v-else class="ask-btn" @click="ask()">
          <span class="ask-icon" aria-hidden="true">🔊</span>
          <span v-if="canSpeak" class="ask-label">
            {{ englishOnly ? 'Listen and touch!' : '聽聽看，點出對的那一張' }}
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
        <span class="done-emoji" aria-hidden="true">{{ perfectRound ? '🏆' : '🎉' }}</span>
        <p class="done-title">
          <template v-if="perfectRound">{{ t('全部答對！', 'All correct!') }}</template>
          <template v-else>{{ t('玩完一輪了！', 'Great job!') }}</template>
        </p>
        <p class="done-stars">
          <template v-if="englishOnly">You got <strong>{{ roundStars }}</strong> {{ roundStars === 1 ? 'star' : 'stars' }}</template>
          <template v-else>拿到 <strong>{{ roundStars }}</strong> 顆星</template>
        </p>
        <div class="done-row" aria-hidden="true">
          <span v-for="i in roundSize" :key="i" class="done-star" :class="{ 'is-on': i <= roundStars }">⭐</span>
        </div>
        <div class="done-actions">
          <button class="ctl ctl-wide ctl-quiz" @click="quizSound ? startSounds() : startQuiz()">{{ t('再玩一次', 'Play again') }}</button>
          <button class="ctl ctl-wide" @click="toLearn">{{ t('回去看卡片', 'Back to cards') }}</button>
        </div>
      </div>
    </main>

    <!-- ===== 影片片段 ===== -->
    <div v-if="clip" class="clip-veil" role="dialog" aria-label="影片片段" @click.self="closeClip">
      <div class="clip-box">
        <div ref="hostRef" class="clip-player" />
        <!-- 蓋一層在影片上：點畫面就是暫停／播放，不會點到 YouTube 自己的東西 -->
        <button class="clip-shield" :aria-label="clipStatus === 'playing' ? '暫停' : '播放'" @click="toggleClip">
          <span v-if="clipStatus === 'error'" class="clip-msg">😅 {{ t('這段影片沒辦法播放', "This video can't play.") }}</span>
          <span v-else-if="clipStatus !== 'playing'" class="clip-play" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      </div>
      <button ref="clipCloseRef" class="ctl ctl-wide" @click="closeClip">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z" /></svg>{{ t('關掉影片', 'Close') }}
      </button>
    </div>

    <!-- ===== 書上的這一頁：小朋友把手上的書翻到同一頁，再開始翻卡 ===== -->
    <div v-if="showPage && bookPage" class="page-veil" role="dialog" :aria-label="t('書上的這一頁', 'Book page')" @click.self="closePage">
      <p class="page-ask">
        <span aria-hidden="true">📖</span>{{ t('把書翻到這一頁', 'Open your book to this page') }}
      </p>
      <img class="page-img" :src="imageSrc(bookPage)" alt="" draggable="false">
      <button ref="pageDoneRef" class="ctl ctl-wide ctl-quiz" @click="closePage">
        <span aria-hidden="true">👍</span>{{ t('找到了！', 'Found it!') }}
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
  /* 三個模式按鈕加語言切換擠在同一排時，名稱不能被壓成「M…」：寬度不夠就讓按鈕換到第二排 */
  min-width: 150px;
  margin: 0;
  font-size: clamp(19px, 2.4vw, 26px);
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-break { display: none; }

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

/* 中英對照／全英文：比模式切換小一號，放在旁邊不搶眼 */
.lang-toggle {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg-card);
}
.lang-btn {
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}
.lang-btn.is-active { background: var(--text); color: var(--bg); }

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
  /* iPad mini 直放要能長到 640×800 左右，不然上下左右都是空的；字和圖都跟著卡片大小縮放 */
  max-height: 920px;
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

/* 兩、三個 emoji 組成的情境圖（👧⚽👦）：依個數縮小，才擺得進一行；一個 emoji 的大小跟以前一樣 */
.face-emoji { font-size: min(52cqw, 44cqh, calc(84cqw / (var(--n, 1) * 1.3))); line-height: 1.1; }
.back-emoji { font-size: min(30cqw, 26cqh, calc(84cqw / (var(--n, 1) * 1.3))); line-height: 1.1; }

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
/* 書上裁下來的圖：高窄的（pony）原本被 64% 的高度框成一小條，卡片上下其實還有很多空位 */
.face-front > .face-img.is-book { height: 84%; margin-bottom: 7cqh; }
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
/* 兩小句一句一行；一句太長要折行時，兩行長度平均一點 */
.sub-line { display: block; text-wrap: balance; }

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
.is-asking .count-grid { margin-bottom: 46cqh; }
.is-asking .count-emoji { font-size: min(calc(66cqw / var(--cols)), calc(28cqh / var(--rows)), 22cqh); }
.is-asking .count-badge { font-size: max(10px, min(calc(14cqw / var(--cols)), 5cqh)); }

.count-ask {
  position: absolute;
  left: 3%;
  right: 3%;
  bottom: 3.5cqh;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 題目和按鈕要隔開：按鈕輕輕跳起來的時候才不會碰到字 */
  gap: max(10px, 4cqh);
  cursor: default;
}
.count-question {
  margin: 0;
  font-size: max(16px, min(6cqh, 7cqw));
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
}
/* 三個選項平分一整排，間隙小：小朋友手指粗又不準，點在按鈕之間也不會落空 */
.count-options { display: flex; gap: 2.5cqw; width: 100%; }
/* 實心的大按鈕、底下一圈厚邊，看起來就是「可以按下去」的；出現後輕輕上下跳，吸引小朋友去按 */
.count-option {
  flex: 1 1 0;
  min-width: 0;
  height: max(68px, min(36cqh, 40cqw));
  padding: 0;
  border: 4px solid var(--deck);
  border-color: color-mix(in srgb, var(--deck) 70%, var(--ink));
  border-radius: 24px;
  background: var(--deck);
  box-shadow: 0 6px 0 rgba(0, 0, 0, .22);
  color: var(--ink);
  font-family: inherit;
  font-size: min(21cqh, 22cqw);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  touch-action: manipulation;
  animation: pop .25s ease-out, beckon 1.6s ease-in-out .7s infinite;
}
.count-option:nth-child(2) { animation-delay: 0s, 1s; }
.count-option:nth-child(3) { animation-delay: 0s, 1.3s; }
/* 兩位數（10、12…）字縮一點，才不會貼到邊框 */
.count-option.is-two { font-size: min(17cqh, 18cqw); }
.count-option:active { transform: scale(.92); }
.count-option.is-wrong { opacity: .35; animation: shake .4s ease; }

@keyframes beckon {
  0%, 60%, 100% { translate: 0 0; }
  30% { translate: 0 -4px; }
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
/* 上一張、下一張：要跟旁邊的「聽」搭得起來，不能小小一顆；
   只用字卡本的顏色描一圈邊，裡面不塗色，才不會跟「How many」的實心答案鈕搶焦點 */
.ctl-nav { padding: 0; width: 88px; height: 76px; border: 4px solid var(--deck); }
.ctl-nav svg { width: 36px; height: 36px; }
.ctl-wide svg { width: 24px; height: 24px; }

.ctl-video {
  background: var(--deck);
  color: var(--ink);
}

/* 「聽」是小朋友最常按的鈕：比其他按鈕大一圈、字也大。
   底色用「最亮 / 最深」的反白（深色主題是白底、淺色主題是深藍底），不是字卡本的顏色——
   字卡本的顏色已經用在卡片和 How many 的答案鈕上，兩個同色小朋友分不出哪個是答案 */
.ctl-listen {
  background: var(--text);
  color: var(--bg);
  box-shadow: 0 5px 0 rgba(0, 0, 0, .25);
  height: 80px;
  padding: 0 36px;
  border-radius: 26px;
  font-size: 26px;
  gap: 12px;
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
  /* 用容器單位：直式照片（狗、貓）用百分比會超出框 */
  max-width: 82cqw;
  max-height: 82cqh;
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

/* ---------- 跟我說／做動作 ---------- */
.play { gap: 14px; }

/* 圖和那句話：一張紙卡，點一下再聽一次 */
.play-card {
  position: relative;
  container-type: size;
  width: min(88vw, 460px);
  height: min(38vh, 300px);
  padding: 22px 16px 16px;
  border: 0;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1cqh;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 18px 40px var(--shadow), 0 2px 0 rgba(0, 0, 0, .06);
}
.play-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 10px;
  background: var(--deck);
}
.play-card:active { transform: scale(.98); }

/* 兩、三個 emoji 組成的情境圖：依個數縮小排成一行 */
.play-emoji { font-size: min(46cqh, calc(84cqw / (var(--n, 1) * 1.3))); line-height: 1.1; }
.play-img { width: 80%; height: 58%; object-fit: contain; border-radius: 14px; pointer-events: none; }
.play-img.is-book { width: 88%; height: 68%; }
.play-phrase {
  font-size: min(16cqh, calc(130cqw / max(var(--len), 2.4)));
  font-weight: 900;
  line-height: 1.05;
  text-align: center;
}
.play-big { font-size: min(44cqh, calc(150cqw / max(var(--len), 2.4))); font-weight: 900; line-height: 1; }
.play-sub { font-size: min(9cqh, 7cqw); font-weight: 800; color: var(--ink-dim); text-align: center; }

/* 說完、做完：星星從圖卡中間往四周飛出去 */
.burst { position: absolute; inset: 0; pointer-events: none; display: grid; place-items: center; }
.burst i {
  position: absolute;
  font-style: normal;
  font-size: 30px;
  animation: burst .9s ease-out forwards;
}
@keyframes burst {
  from { transform: rotate(var(--a)) translateY(0) scale(.3); opacity: 1; }
  to { transform: rotate(var(--a)) translateY(-110px) scale(1.1); opacity: 0; }
}

/* 輪到你：圓圈跑一圈就是他說（做）的時間 */
.turn { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.turn-btn {
  position: relative;
  width: 104px;
  height: 104px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bg-card);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform .15s ease, background .2s ease;
}
.turn-btn:disabled { cursor: default; }
.turn-btn:not(:disabled):active { transform: scale(.92); }
.is-turn .turn-btn { background: var(--deck); box-shadow: 0 10px 24px var(--shadow); }
.is-cheer .turn-btn { background: var(--accent); }
.turn-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.turn-track { fill: none; stroke: var(--line); stroke-width: 6; }
.turn-fill {
  fill: none;
  stroke: var(--ink);
  stroke-width: 6;
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  opacity: 0;
}
.is-turn .turn-fill { opacity: 1; animation: turn-run var(--dur) linear forwards; }
@keyframes turn-run { to { stroke-dashoffset: 0; } }
.turn-icon { position: relative; font-size: 44px; line-height: 1; }
.is-turn .turn-icon { animation: turn-pulse .9s ease-in-out infinite; }
@keyframes turn-pulse { 50% { scale: 1.18; } }
.turn-label {
  min-height: 1.4em;
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  text-align: center;
}
.play-controls { gap: 12px; }

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

/* ---------- 比一比 ---------- */
.compare { gap: 18px; }

.cmp-board {
  display: flex;
  justify-content: center;
  gap: clamp(14px, 4vw, 40px);
  width: 100%;
}

/* 兩張一樣大的方卡：點哪一張就是選哪一邊 */
.cmp-card {
  --cw: min(44vw, 340px, 40vh);
  position: relative;
  container-type: inline-size;
  width: var(--cw);
  aspect-ratio: 1;
  padding: 4cqw;
  border: 6px solid transparent;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 12px 28px var(--shadow);
  transition: transform .15s ease, border-color .2s ease;
}
.cmp-card:active { transform: scale(.95); }
.cmp-card.is-right { border-color: var(--ok); animation: bounce .5s ease; }
.cmp-card.is-wrong { animation: shake .4s ease; }
.cmp-card.is-wrong .cmp-grid,
.cmp-card.is-wrong .cmp-num { opacity: .35; }

/* 一堆東西：五個一排，從左上角排起 */
.cmp-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(var(--cols, 5), 1fr);
  align-content: center;
  justify-items: center;
}
.cmp-grid i {
  font-style: normal;
  font-size: 16.5cqw;
  line-height: 1.12;
}

/* 純數字：一個大數字 */
.cmp-num {
  font-size: min(54cqw, calc(120cqw / max(var(--len, 1), 1.4)));
  font-weight: 900;
  line-height: 1;
}

/* 答完才亮出來：這一堆有幾個 */
.cmp-value {
  position: absolute;
  left: 50%;
  bottom: -18px;
  translate: -50% 0;
  min-width: 46px;
  height: 46px;
  padding: 0 12px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--ink);
  color: #fff;
  font-size: 26px;
  font-weight: 900;
  animation: pop .25s ease-out;
}

@media (min-width: 700px) and (min-height: 600px) {
  .compare { gap: 28px; }
  .cmp-card { --cw: min(42vw, 400px, 42vh); }
  .cmp-value { min-width: 56px; height: 56px; font-size: 32px; bottom: -22px; }
}

/* ---------- 排順序 ---------- */
.order { gap: 14px; --ow: min(28vw, 220px, 22vh); }

/* 上面三格（空的是虛線圈，排對的卡飛進來）和下面三張打亂的卡一樣大 */
.order-slots,
.order-choices {
  display: flex;
  justify-content: center;
  gap: clamp(10px, 2.4vw, 22px);
  width: 100%;
}

.order-slot,
.order-card {
  position: relative;
  container-type: size;
  width: var(--ow);
  aspect-ratio: 3 / 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1cqh;
  padding: 8px 6px;
  border-radius: 22px;
  color: var(--ink);
  font-family: inherit;
}

.order-slot {
  border: 4px dashed var(--line);
  background: var(--bg-card);
  transition: background .25s ease, border-color .25s ease;
}
.order-slot.is-filled {
  border: 4px solid var(--deck);
  background: var(--paper);
  animation: pop .3s ease-out;
}
/* 格子左上角的數字：第 1、第 2、第 3 */
.order-num {
  position: absolute;
  top: -12px;
  left: -8px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--text);
  color: var(--bg);
  font-size: 20px;
  font-weight: 900;
}

.order-card {
  border: 0;
  background: var(--paper);
  box-shadow: 0 12px 26px var(--shadow);
  cursor: pointer;
  transition: transform .15s ease, opacity .2s ease;
}
.order-card:active { transform: scale(.94); }
.order-card.is-gone { visibility: hidden; pointer-events: none; }
.order-card.is-wrong { animation: shake .4s ease; }
.order-card:disabled { cursor: default; }

/* 卡上的圖和字，格子裡、下面的卡都一樣 */
.of-img { width: 86%; height: 58%; object-fit: contain; border-radius: 12px; pointer-events: none; }
.of-emoji { font-size: min(44cqh, calc(80cqw / (var(--n, 1) * 1.3))); line-height: 1.1; pointer-events: none; }
.of-word {
  /* 長的說明（scrub your fingers）換行，字不縮到看不見 */
  max-width: 100%;
  font-size: min(13cqh, 17cqw);
  font-weight: 900;
  line-height: 1.1;
  text-align: center;
  text-wrap: balance;
  overflow-wrap: anywhere;
  pointer-events: none;
}
/* 只有字的卡（數字、星期）：字放大 */
.order-slot > .of-word:only-of-type,
.order-card > .of-word:only-child { font-size: min(36cqh, 40cqw); }

@media (min-width: 700px) and (min-height: 600px) {
  .order { gap: 22px; --ow: min(26vw, 230px, 22vh); }
}

/* 橫放：上面三格和下面三張左右並排（上下排太高會被擠到邊） */
.order-board { display: contents; }
@media (min-aspect-ratio: 4 / 3) {
  .order { --ow: min(13.5vw, 210px, 30vh); }
  .order-board { display: flex; align-items: center; justify-content: center; gap: 4vw; width: 100%; }
  .order-slots, .order-choices { width: auto; }
}

/* ---------- 放哪裡 ---------- */
.place { gap: 12px; }

.place-stage {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-evenly;
  gap: 14px;
}

/* 要放的東西：一張紙卡，按住拖著走，拖的時候稍微放大、影子變深 */
.place-item {
  position: relative;
  z-index: 5;
  container-type: size;
  width: min(60vw, 300px);
  height: min(28vh, 240px);
  padding: 18px 12px 10px;
  border-radius: 28px;
  background: var(--paper);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1cqh;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  box-shadow: 0 14px 30px var(--shadow), 0 2px 0 rgba(0, 0, 0, .06);
}
.place-item::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 10px;
  border-radius: 28px 28px 0 0;
  background: var(--deck);
}
.place-item.is-dragging { cursor: grabbing; box-shadow: 0 30px 50px var(--shadow); }
/* 小朋友第一次看到不知道可以拖：輕輕晃一晃 */
.place-item:not(.is-dragging):not(.is-placed) { animation: place-wiggle 2.6s ease-in-out 1.2s 2; }
.place-item.is-placed { pointer-events: none; }
@keyframes place-wiggle {
  0%, 70%, 100% { rotate: 0deg; }
  78% { rotate: -3deg; }
  86% { rotate: 3deg; }
  94% { rotate: -2deg; }
}

.place-img { width: 84%; height: 66%; object-fit: contain; border-radius: 14px; pointer-events: none; }
.place-emoji { font-size: min(52cqh, calc(84cqw / (var(--n, 1) * 1.3))); line-height: 1.1; pointer-events: none; }
.place-word {
  font-size: min(16cqh, calc(130cqw / max(var(--len), 2.4)));
  font-weight: 900;
  line-height: 1.05;
  text-align: center;
  pointer-events: none;
}
.place-sub { font-size: min(9cqh, 7cqw); font-weight: 800; color: var(--ink-dim); pointer-events: none; }

/* 三個地方：照片加名字，點一下或把東西拖上來 */
.place-options {
  display: flex;
  justify-content: center;
  gap: clamp(10px, 2.4vw, 22px);
  width: 100%;
}

.place-opt {
  position: relative;
  width: min(29vw, 220px);
  aspect-ratio: 3 / 4;
  padding: 0;
  border: 5px solid transparent;
  border-radius: 24px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 12px 28px var(--shadow);
  transition: transform .15s ease, border-color .2s ease;
}
.place-opt:active { transform: scale(.95); }
.place-opt.is-over { border-color: var(--deck); transform: scale(1.07); }
.place-opt.is-right { border-color: var(--ok); animation: bounce .5s ease; }
.place-opt.is-wrong { animation: shake .4s ease; }
.place-opt.is-wrong .place-photo { opacity: .35; }

.place-photo { flex: 1; min-height: 0; width: 100%; object-fit: cover; pointer-events: none; }
.place-photo-emoji { display: grid; place-items: center; font-size: clamp(48px, 9vw, 96px); line-height: 1; }
.place-name {
  flex: none;
  padding: 8px 4px 9px;
  font-size: clamp(16px, 3.6vw, 24px);
  font-weight: 900;
  line-height: 1.15;
  text-align: center;
}
.place-name small { display: block; font-size: .72em; font-weight: 800; color: var(--ink-dim); }

/* 橫放：東西在左邊、地方在右邊一排，拖著橫著走 */
@media (min-aspect-ratio: 4 / 3) {
  .place-stage { flex-direction: row; justify-content: center; gap: clamp(20px, 5vw, 64px); }
  .place-item { width: min(30vw, 320px); height: min(46vh, 320px); }
  .place-options { width: auto; }
  .place-opt { width: min(17vw, 210px); }
}

/* 大螢幕：東西和地方放大 */
@media (min-width: 700px) and (min-height: 600px) {
  .place-item { width: min(52vw, 400px); height: min(30vh, 340px); }
  .place-opt { width: min(28vw, 240px); }
}
@media (min-width: 700px) and (min-height: 600px) and (min-aspect-ratio: 4 / 3) {
  .place-item { width: min(30vw, 380px); height: min(46vh, 380px); }
  .place-opt { width: min(17vw, 220px); }
}

/* ---------- 生活任務 ---------- */
.mission { gap: 14px; }
.mission-controls { flex: none; display: flex; justify-content: center; gap: 12px; }

/* 認識 → 去找 → 貼紙：三個圓點，現在在哪一步一眼就看得到 */
.mission-steps {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mission-steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px 4px 5px;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 800;
}
.mission-steps li span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--line);
  font-size: 14px;
}
.mission-steps li.is-past { color: var(--text); }
.mission-steps li.is-on { background: var(--text); color: var(--bg); }
.mission-steps li.is-on span { background: var(--bg); color: var(--text); }

/* 去找的時候卡片縮小，騰出位置給任務那句話和大按鈕 */
.mission-card.is-small { height: min(24vh, 210px); }

.mission-say {
  margin: 0;
  max-width: min(92vw, 640px);
  font-size: clamp(24px, 6.4vw, 34px);
  font-weight: 900;
  line-height: 1.3;
  text-align: center;
}
.mission-say-sub {
  display: block;
  margin-top: 4px;
  font-size: .62em;
  font-weight: 800;
  color: var(--text-dim);
}

/* 要找幾個：找到一個亮一顆星 */
.mission-slots {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mission-slots li {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: 4px dashed var(--line);
  font-size: 30px;
  line-height: 1;
}
.mission-slots { flex-wrap: wrap; justify-content: center; }
.mission-slots.is-many li { width: 40px; height: 40px; border-width: 3px; font-size: 22px; }
.mission-slots li.is-found {
  border: 4px solid var(--deck);
  background: var(--paper);
  animation: star-pop .5s cubic-bezier(.3, 1.6, .5, 1);
}

/* 這一頁唯一的實心大按鈕：認識完「去找找看」、找到一個「我找到了」 */
.mission-main {
  min-width: min(86vw, 340px);
  height: 88px;
  padding: 0 34px;
  border: 0;
  border-radius: 28px;
  background: var(--deck);
  color: var(--ink);
  box-shadow: 0 6px 0 rgba(0, 0, 0, .28), 0 14px 28px var(--shadow);
  font-family: inherit;
  font-size: 30px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, opacity .2s ease;
}
.mission-main:not(:disabled):active { transform: translateY(4px); box-shadow: 0 2px 0 rgba(0, 0, 0, .28); }
.mission-main:disabled { opacity: .45; cursor: default; }
.mission-main span { font-size: 38px; line-height: 1; }
.is-meet .mission-main span,
.is-go .mission-main:not(:disabled) span { animation: turn-pulse 1.1s ease-in-out infinite; }

.mission-tip {
  margin: 0;
  max-width: min(92vw, 560px);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  text-align: center;
  color: var(--text-dim);
}

/* 貼紙：圓形的貼紙，放那張卡的圖 */
.mission-sticker {
  display: grid;
  place-items: center;
  width: clamp(150px, 32vh, 240px);
  height: clamp(150px, 32vh, 240px);
  overflow: hidden;
  border-radius: 50%;
  border: 8px solid var(--deck);
  background: var(--paper);
  box-shadow: 0 12px 28px var(--shadow);
  font-size: clamp(70px, 15vh, 110px);
  font-weight: 900;
  color: var(--ink);
  line-height: 1;
  animation: star-pop .7s cubic-bezier(.3, 1.6, .5, 1);
}
.mission-sticker img { width: 80%; height: 80%; object-fit: contain; }
.mission-done { gap: 10px; }

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

/* ---------- 書上的這一頁 ---------- */
.page-veil {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: calc(var(--safe-t) + 16px) calc(var(--safe-r) + 16px) calc(var(--safe-b) + 16px) calc(var(--safe-l) + 16px);
  background: rgba(8, 6, 24, .88);
}

.page-ask {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: clamp(20px, 3vw, 30px);
  font-weight: 900;
  text-align: center;
}

/* 整頁照片要盡量大，小朋友才對得出是哪一頁；上下留位子給題目和按鈕 */
.page-img {
  min-height: 0;
  max-width: 100%;
  max-height: calc(100% - 150px);
  object-fit: contain;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
}

/* ---------- 頂部列：直放，或橫放但寬度不夠一排放下（手機橫放）---------- */
/* 第一排放返回、名稱、星星（星星靠右）；第二排放語言、看卡片／跟我說／考考我，放得下就同一排，
   放不下（手機）就換行，換行後每一排的按鈕都撐滿整排寬度。要比手機的 max-width 規則先寫，手機的才蓋得過。
   橫放寬度 1100px 以上（iPad mini 橫放 1133）一排放得下，不走這一段；
   高度 520px 以下的手機橫放，寬度 844px 以上也一排放得下（高度寶貴，不拆成兩排） */
@media (orientation: portrait), (max-width: 843px), (min-height: 521px) and (max-width: 1099px) {
  /* 行距改用每顆按鈕下緣的留白，換行用的空元素才不會多出一段空隙 */
  .deck-bar { gap: 0 10px; padding-bottom: 0; }
  .deck-bar > * { margin-bottom: var(--bar-gap, 10px); }
  .deck-bar > .bar-break { display: block; flex: 0 0 100%; height: 0; margin: 0; }
  /* 名稱和星星同一排，名稱讓出位置：長的名稱折成兩行（跟旁邊的返回鈕一樣高），不夠再用刪節號 */
  .deck-title {
    min-width: 0;
    white-space: normal;
    line-height: 1.15;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  /* 空間夠就拉寬：語言和模式按鈕分掉第二排剩下的寬度，每一顆平分 */
  .lang-toggle { flex: 1 1 auto; }
  .lang-btn { flex: 1 1 auto; }
  .mode-tabs { flex: 1.4 1 auto; min-width: 0; }
  /* 左右留白收小一點，三顆（照家裡的書做的字卡本有四顆）才擠得進星星、語言旁邊同一排 */
  .mode-tab { flex: 1 1 auto; justify-content: center; padding: 0 12px; }
  .lang-btn { padding: 0 10px; }
}

/* 兩排、而且橫向有很多空間（iPad 橫放，寬 900～1099）：按鈕放大一點，小朋友比較好點 */
@media (min-width: 900px) and (max-width: 1099px) and (min-height: 521px) {
  .bar-back { height: 58px; font-size: 18px; }
  .deck-title { font-size: 28px; }
  .star-pill { padding: 10px 18px; font-size: 21px; }
  .lang-btn { height: 46px; padding: 0 16px; font-size: 17px; }
  .mode-tab { height: 54px; padding: 0 18px; font-size: 19px; }
}

/* ---------- 窄螢幕與手機橫向 ---------- */
@media (max-width: 560px) {
  /* 語言和看卡片／跟我說／考考我：手機放得下就同一排，放不下就各占一整排，都撐滿寬度 */
  .mode-tabs { flex: 1.4 1 auto; min-width: 0; }
  /* 照家裡的書做的字卡本多一顆「書上找」，四顆要擠進手機一排：字和間距都收小一點 */
  .mode-tab { flex: 1 1 auto; justify-content: center; gap: 3px; padding: 0 6px; font-size: 15px; white-space: nowrap; }
  .lang-btn { padding: 0 8px; font-size: 13px; }
  /* 五顆模式按鈕（有任務、放哪裡的字卡本）：小圖示先藏起來，字才放得下一排 */
  .mode-tabs.is-many .mode-tab { padding: 0 5px; }
  .mode-tabs.is-many .mode-tab span[aria-hidden] { display: none; }
  .ctl { height: 58px; padding: 0 16px; font-size: 17px; }
  .ctl-listen { height: 68px; padding: 0 20px; font-size: 22px; }
  .ctl-nav { width: 70px; height: 68px; }
  .ctl-nav svg { width: 34px; height: 34px; }
  /* 下面一排已經有上一張、聽、下一張（最後一張是考考我），手機上「這一頁」只留書本圖示才擺得下 */
  .ctl-page { padding: 0; width: 60px; justify-content: center; }
  .ctl-page .ctl-text { display: none; }
  .ask-btn { font-size: 18px; }
}

/* 很窄的手機：模式按鈕上的小圖示先藏起來，字才放得下一行 */
@media (max-width: 380px) {
  .mode-tab span[aria-hidden] { display: none; }
}

@media (max-height: 520px) {
  /* 手機橫向高度很少：名稱少留一點，按鈕才不用換到第二排 */
  .deck-title { min-width: 100px; }
  .deck-bar { padding-top: calc(var(--safe-t) + 8px); padding-bottom: 6px; }
  .deck-bar { gap: 6px 10px; }
  .bar-back { height: 42px; }
  .star-pill { padding: 6px 10px; font-size: 15px; }
  .lang-btn { height: 32px; padding: 0 9px; font-size: 13px; }
  .mode-tab { height: 36px; padding: 0 12px; font-size: 15px; }
  .progress { margin: 8px 0 6px; }
  .ctl { height: 48px; font-size: 16px; }
  .ctl-listen { height: 56px; font-size: 19px; }
  .quiz { gap: 10px; }
  .play-card { height: 34vh; }
  .turn-btn { width: 72px; height: 72px; }
  .turn-icon { font-size: 32px; }
  .turn-label { font-size: 17px; }
  .ask-btn { padding: 8px 20px 8px 10px; font-size: 17px; }
  .ask-icon { width: 40px; height: 40px; font-size: 22px; }
  .prompt-img { height: 30vh; }
  .prompt-text { font-size: 17px; }
  /* 卡片矮：題目常折成兩行、按鈕又不能再小，數過的東西再縮一點讓位置 */
  .is-asking .count-grid { margin-bottom: 54cqh; }
  .is-asking .count-emoji { font-size: min(calc(60cqw / var(--cols)), calc(22cqh / var(--rows)), 18cqh); }
}

/* 手機橫放、頂部列要換行的時候：行距縮小一點，把高度留給卡片（要寫在上面「gap: 6px 10px」那段的後面才蓋得過） */
@media (max-height: 520px) and (orientation: portrait), (max-height: 520px) and (max-width: 843px) {
  .deck-bar { --bar-gap: 6px; gap: 0 10px; padding-bottom: 0; }
  /* 四顆模式按鈕（照家裡的書做的字卡本）也要擠進星星、語言旁邊同一排：字和左右留白再縮一點，多出的寬度仍會撐開 */
  .mode-tab { padding: 0 7px; gap: 4px; font-size: 14px; }
  .lang-btn { padding: 0 8px; }
}

/* 手機橫向：高度只剩一點點，卡片才能用滿整個高度（版面跟 iPad 橫放一樣，在下面） */
@media (max-height: 520px) and (min-aspect-ratio: 4 / 3) {
  /* 橫向高度不夠放 A～Z、一排數字，用左右鍵或滑動換卡 */
  .jump-strip { display: none; }

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

/* 橫放（iPad、手機都一樣）：卡片是直的，放在按鈕上面會被壓得很小；按鈕改放兩側，卡片用滿高度 */
@media (min-aspect-ratio: 4 / 3) and (max-height: 900px) {
  .learn {
    --side: clamp(150px, 20vw, 230px);
    display: grid;
    /* 左右兩欄一樣寬：卡片正好在畫面正中間（小朋友的視線先落在卡片上），上一張在左、下一張在右 */
    grid-template-columns: var(--side) minmax(0, 1fr) var(--side);
    /* 2：卡片和兩側的箭頭；3～5：卡片底下那一排（頁數、聽、書頁、影片），沒有的按鈕那一列就是 0 高 */
    grid-template-rows: auto 1fr auto auto auto;
    column-gap: 20px;
    justify-items: center;
  }
  .jump-strip { grid-column: 1 / 4; grid-row: 1; margin-bottom: 10px; }
  .stage { grid-column: 2; grid-row: 2 / 6; height: 100%; }

  /* 按鈕一顆顆直接放進格子裡（不再包在一個盒子裡），上一張、下一張才能分到卡片的左右兩邊 */
  .learn-controls { display: contents; }
  .learn-controls .ctl { width: 100%; padding-inline: 0; }
  .learn-controls .ctl-nav { height: 104px; border-radius: 28px; }
  .learn-controls .ctl-nav svg { width: 44px; height: 44px; }
  /* 箭頭跨過整張卡的高度、垂直置中，正好在卡片中線的兩側 */
  .learn-controls > .ctl-nav:first-child { grid-column: 1; grid-row: 2 / 6; align-self: center; }
  /* 最後一個：下一張；看到最後一張時換成「考考我」 */
  .learn-controls > :last-child { grid-column: 3; grid-row: 2 / 6; align-self: center; }
  .learn-controls > .ctl-quiz:last-child { height: 104px; border-radius: 28px; }
  .learn-controls > .ctl-listen { grid-column: 3; grid-row: 3; align-self: end; height: 92px; border-radius: 28px; font-size: 28px; }
  .learn-controls > .ctl-page { grid-column: 3; grid-row: 4; align-self: end; margin-top: 12px; }
  .learn-controls > .ctl-video { grid-column: 3; grid-row: 5; align-self: end; margin-top: 12px; }
  /* 左欄放得下的點點有限，太多就折行 */
  .progress { grid-column: 1; grid-row: 3; align-self: end; margin: 0; padding-bottom: 22px; flex-wrap: wrap; justify-content: center; }
}

/* 同樣的版面，手機橫放高度只有 300 多：按鈕和兩側留白都縮小一點 */
@media (max-height: 520px) and (min-aspect-ratio: 4 / 3) {
  .learn { --side: clamp(124px, 18vw, 170px); column-gap: 12px; }
  /* 欄位窄：「聽」的字縮一點才放得下；頁數只留 1 / 9 的數字，點點放不下 */
  .learn-controls > .ctl-listen { gap: 8px; }
  .progress .dot { display: none; }
  /* 右邊除了下一張和「聽」，還有「這一頁」或「看影片」要放：高度不夠，箭頭改靠上，才不會壓到底下那排 */
  .learn.has-extra-btns .learn-controls > .ctl-nav:first-child,
  .learn.has-extra-btns .learn-controls > :last-child { align-self: start; }
  /* 卡片本身就窄，裡面的答案鈕不大；兩側的箭頭別比答案鈕還大，才不會搶走視線 */
  .learn-controls .ctl-nav,
  .learn-controls > .ctl-quiz:last-child { height: 64px; border-radius: 22px; }
  .learn-controls .ctl-nav svg { width: 34px; height: 34px; }
  .learn-controls > .ctl-listen { height: 64px; border-radius: 22px; font-size: 20px; }
  .learn-controls > .ctl-page,
  .learn-controls > .ctl-video { height: 48px; margin-top: 10px; }
  .progress { padding-bottom: 18px; }
}

/* iPad 這種大螢幕（直放橫放都是）：考考我、跟我說的選項、圖卡、按鈕都放大，不然只占中間一小塊 */
@media (min-width: 700px) and (min-height: 600px) {
  /* 直放時卡片底下那排：上一張、聽、下一張一樣高，手指寬的箭頭比較好點 */
  .ctl-nav { width: 124px; height: 88px; border-radius: 28px; }
  .ctl-nav svg { width: 44px; height: 44px; }
  .ctl-listen { height: 88px; padding: 0 44px; font-size: 30px; border-radius: 28px; }
  .learn-controls { gap: 16px; }
  .quiz { gap: 28px; }
  .quiz-progress { font-size: 20px; }
  .ask-btn { gap: 16px; padding: 18px 38px 18px 22px; font-size: 28px; }
  .ask-icon { width: 64px; height: 64px; font-size: 34px; }
  .prompt-img { height: min(34vh, 380px); }
  .prompt-text { font-size: 30px; }
  .option { --size: min(29vw, 38vh, 320px); }
  .options.is-compact .option { --size: min(29vw, 26vh, 240px); }
  .play { gap: 22px; }
  .play-card { width: min(88vw, 640px); height: min(44vh, 460px); }
  .turn-btn { width: 132px; height: 132px; }
  .turn-icon { font-size: 56px; }
  .turn-label { font-size: 28px; }
  .mission { gap: 22px; }
  .mission-card.is-small { height: min(28vh, 300px); }
  .mission-say { font-size: 40px; }
  .mission-main { height: 104px; min-width: 420px; font-size: 36px; border-radius: 32px; }
  .mission-slots li { width: 68px; height: 68px; font-size: 38px; }
  .mission-tip { font-size: 18px; }
  .mission-steps li { font-size: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .flip-inner { transition: none; }
  .burst { display: none; }
  .option.is-right,
  .option.is-wrong,
  .option-star,
  .done-emoji,
  .count-badge,
  .count-option,
  .is-turn .turn-icon,
  .mission-slots li.is-found,
  .mission-sticker,
  .mission-main span,
  .is-nudging .face-hint,
  .is-nudging .count-question,
  .is-nudging .count-emoji,
  .option-caption { animation: none; }
}
</style>
