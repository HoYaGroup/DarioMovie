import { parseVideoId, type Card, type CardClip, type VideoItem } from './youtube'
import type { SpeechText } from './speech'

/**
 * 字卡的解析與顯示輔助。
 *
 * playlist.txt 裡一張卡寫成一行：
 *
 *   卡: 3 | three 三 | 🍎 | https://youtu.be/xxxxxxxxxxx 0:35-0:42
 *   卡: cat | 貓 | 🐱
 *   卡: dog | 狗 | cards/dog.jpg
 *   卡: 3 | 3、3、蝴蝶3 | cards/shapes/3-q.webp | cards/shapes/3.webp
 *
 * 第一欄是卡片上最大的字，後面幾欄看內容自動判斷是什麼：
 *   ‧ 有 youtu 字樣的是影片片段，後面可以接「開始-結束」時間
 *   ‧ 只有 emoji，或是圖片網址／路徑的是圖；寫兩張的話，第一張是正面、第二張是背面
 *   ‧ 其他的是說明（英文、中文都可以寫在一起）
 * 所以欄位順序寫錯、少寫一欄都沒關係，不會整張卡壞掉。
 */

const RE_EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]|\s)+$/u
const RE_IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?.*)?$/i

/** 數字卡最多畫幾個東西，再多就數不清楚了 */
const MAX_COUNT = 20

/** 整串都是 emoji（可以好幾個） */
export function isEmojiOnly(s: string): boolean {
  return RE_EMOJI_ONLY.test(s) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)
}

/** 圖片網址，或 public 底下的圖片路徑 */
export function isImageRef(s: string): boolean {
  if (/youtu/i.test(s)) return false
  return /^https?:\/\//i.test(s) || RE_IMAGE_EXT.test(s)
}

/** 圖片路徑轉成實際網址：相對路徑要接上部署的子目錄 */
export function imageSrc(image: string): string {
  if (/^https?:\/\//i.test(image) || image.startsWith('/')) return image
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : base + '/'}${image}`
}

/** 「1:05」「65」「1:02:03」轉成秒數，看不懂就回 null */
function toSeconds(s: string): number | null {
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(s)) return null
  return s.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
}

/**
 * 影片欄位：網址後面接時間範圍。
 *   https://youtu.be/xxx 0:35-0:42   只播 35～42 秒
 *   https://youtu.be/xxx 0:35        從 35 秒播到結束
 *   https://youtu.be/xxx?t=35        網址裡的 t= 也看得懂
 */
export function parseClip(field: string): CardClip | null {
  const [url = '', ...rest] = field.trim().split(/\s+/)
  const id = parseVideoId(url)
  if (!id) return null

  let start = 0
  let end = 0
  const range = rest.join('').match(/^(\d+(?::\d{1,2}){0,2})(?:[-~～到](\d+(?::\d{1,2}){0,2}))?$/)
  if (range) {
    start = toSeconds(range[1]!) ?? 0
    end = range[2] ? (toSeconds(range[2]) ?? 0) : 0
  } else {
    const t = url.match(/[?&](?:t|start)=(\d+)s?/)
    if (t) start = Number(t[1])
  }
  // 結束寫得比開始還早，當作沒寫結束，至少影片放得出來
  if (end && end <= start) end = 0
  return { id, start, end }
}

/** 解析「卡:」後面那一串，至少要有一個字才算數 */
export function parseCard(text: string): { card: Card | null; issue: string } {
  const [word, ...rest] = text.split('|').map((s) => s.trim()).filter(Boolean)
  if (!word) return { card: null, issue: '字卡至少要寫一個字' }

  let meaning = ''
  let image = ''
  let backImage = ''
  let clip: CardClip | null = null
  let issue = ''

  for (const field of rest) {
    if (/youtu/i.test(field)) {
      clip = parseClip(field)
      if (!clip) issue = '影片網址看不懂，這張卡先不放影片'
      continue
    }
    if (!backImage && (isEmojiOnly(field) || isImageRef(field))) {
      if (image) backImage = field
      else image = field
      continue
    }
    // 多寫的說明接在一起，不要默默丟掉
    meaning = meaning ? `${meaning} ${field}` : field
  }

  return { card: { word, meaning, image, backImage, clip }, issue }
}

/** 數字卡：卡片上的字全是數字（3、13、100） */
export function isNumberCard(card: Card): boolean {
  return /^\d+$/.test(card.word.trim())
}

/**
 * 數字卡的說明只是中文唸法（13 → 十三）：畫面上只顯示數字，「十三」用聽的就好，
 * 重點是認數字的樣子。說明是口訣（鉛筆1）或英文（thirty）的照樣顯示。
 */
export function isSpokenOnlyMeaning(card: Card): boolean {
  return isNumberCard(card) && /^[零〇一二兩三四五六七八九十百千萬]+$/.test(meaningText(card))
}

/**
 * 數得出來的數字卡：1～20，正面可以畫出那麼多個東西讓小朋友數（卡片要放 emoji 才會畫）。
 * 不是數字、或超過 20 就回 null。
 */
export function countOf(card: Card): number | null {
  if (!/^\d{1,2}$/.test(card.word)) return null
  const n = Number(card.word)
  return n >= 1 && n <= MAX_COUNT ? n : null
}

/** 圖是 emoji 的話直接當文字畫，不是的話要用 <img> */
export function isPicture(card: Card): boolean {
  return Boolean(card.image) && !isEmojiOnly(card.image)
}

const latin = (s: string) => (s.match(/[A-Za-z][A-Za-z' .-]*[A-Za-z]|[A-Za-z]/g) ?? []).join(' ')
const hasHan = (s: string) => /\p{Script=Han}/u.test(s)

/**
 * 交給中文語音唸的部分：用空白分開的純英文字拿掉，其他留著——
 * 「鉛筆1」唸成「鉛筆一」，「X光魚」的 X 黏在中文上，也照樣唸出來。
 * 中間有空白的地方換成逗號，語音才會停頓一下。完全沒有中文字就不唸。
 */
function zhOf(s: string): string {
  if (!hasHan(s)) return ''
  return s.split(/\s+/).filter((t) => t && !/^[A-Za-z'.-]+$/.test(t)).join('，')
}

/**
 * 這張卡要唸什麼。說明寫哪種語言就唸哪種，兩種都寫才兩種都唸——
 * 一本卡固定一種語言，小朋友比較不會搞混。
 * 英文：卡片上的字是英文就唸它，否則唸說明裡的英文；說明完全沒寫中文、卡片又是數字，
 * 交給英文語音唸（「3」會唸成 three）。
 * 中文：說明裡英文以外的部分（有中文字才唸）。
 */
export function speechOf(card: Card): { en: string; zh: string } {
  const meaning = meaningText(card)
  const numberInEnglish = isNumberCard(card) && !hasHan(meaning) ? card.word : ''
  const en = latin(card.word) || latin(meaning) || numberInEnglish
  const zh = zhOf(meaning) || zhOf(card.word)
  return { en, zh }
}

/* ---------- 開頭的音（KK 音標） ---------- */

const RE_KK = /^\/[^/\s]+\/$/

/**
 * 說明裡可以單獨寫一段 KK 音標，指定這張卡開頭的音，例如 unicorn 開頭不是 U 平常的音：
 *   卡: unicorn | /ju/ 獨角獸 | 🦄
 * 拿出來當 sound（不含斜線），剩下的才是真正顯示、唸出來的說明。
 */
function splitSound(meaning: string): { sound: string; text: string } {
  const tokens = meaning.split(/\s+/).filter(Boolean)
  const i = tokens.findIndex((t) => RE_KK.test(t))
  if (i < 0) return { sound: '', text: meaning }
  return { sound: tokens[i]!.slice(1, -1), text: tokens.filter((_, j) => j !== i).join(' ') }
}

const RE_CHANT = /^(\S+?)\s*[、，,]\s*(\S+?)\s*[、，,]\s*(.+)$/

/** 說明寫成口訣「1、1、鉛筆1」時拆出後半「鉛筆1」；開頭兩次要跟卡片上的字一樣才算口訣 */
function chantTail(card: Card): string | null {
  const m = splitSound(card.meaning).text.match(RE_CHANT)
  return m && m[1] === card.word && m[2] === card.word ? m[3]! : null
}

/**
 * 卡片上顯示、點錯時說的說明：拿掉指定開頭音的那段音標；
 * 口訣只留後半「鉛筆1」——「1、1、」是唸口訣的節奏，翻面時唸就好，不用寫出來。
 */
export function meaningText(card: Card): string {
  return chantTail(card) ?? splitSound(card.meaning).text
}

/**
 * 自然發音：每個字母開頭最常見的音（KK 音標）。
 * 老師教的不一樣，改這張表，或在卡片上用 /音標/ 指定都可以。
 */
export const LETTER_SOUNDS: Record<string, string> = {
  A: 'æ', B: 'b', C: 'k', D: 'd', E: 'ɛ', F: 'f', G: 'g', H: 'h', I: 'ɪ',
  J: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', O: 'ɑ', P: 'p', Q: 'kw', R: 'r',
  S: 's', T: 't', U: 'ʌ', V: 'v', W: 'w', X: 'ks', Y: 'j', Z: 'z',
}

/** 這張字母卡開頭的音：卡片上有指定就用指定的，否則用字母平常的音 */
export function soundOf(card: Card): string {
  return splitSound(card.meaning).sound || LETTER_SOUNDS[initialOf(card.word)] || ''
}

/*
 * 瀏覽器的語音沒辦法直接唸音標，只能給它文字。這裡把音標換成英文語音會唸成「一個音」的拼法
 * （/p/ → puh），每一個都用 Samantha 語音實測過：唸出來的長度跟一個單音節字一樣，不會被拆成字母一個一個拼。
 * /æ/（apple）、/ɪ/（it）試過好幾種拼法都唸不準，寧可不唸，口訣就只唸字母兩次；
 * /ks/ 的開頭跟 X 的字母唸法一樣，也不另外唸。
 */
const KK_SAY: Record<string, string> = {
  b: 'buh', p: 'puh', d: 'duh', t: 'tuh', g: 'guh', k: 'kuh', f: 'fuh', v: 'vuh',
  s: 'suh', z: 'zuh', h: 'huh', m: 'muh', n: 'nuh', l: 'luh', r: 'ruh', w: 'wuh',
  j: 'yuh', dʒ: 'juh', tʃ: 'chuh', ʃ: 'shuh', kw: 'kwuh',
  ɛ: 'eh', ɑ: 'ah', ʌ: 'uh', e: 'ay', i: 'ee', o: 'oh', u: 'oo', ɔ: 'aw', aɪ: 'eye', aʊ: 'ow', ju: 'you',
}

/* ---------- 口訣 ---------- */

/**
 * 口訣，翻面看答案、考考我答對之後唸：
 *   數字卡：說明寫成「3、3、蝴蝶3」
 *   字母卡：自動組成「P、P、puh、puh、panda」
 * 考考我出題時不唸口訣——口訣等於提示，題目只唸單字本身，讓小朋友自己認。
 */
export function chantOf(card: Card, abc: boolean): SpeechText[] | null {
  // 說明自己寫成口訣：「1、1、鉛筆1」，整句照唸
  if (chantTail(card) !== null) {
    const chant = splitSound(card.meaning).text
    return [{ text: chant, lang: hasHan(chant) ? 'zh-TW' : 'en-US' }]
  }

  // ABC 字母卡：字母唸兩次、開頭的音唸兩次，再接單字，全部用英文語音唸
  if (!abc) return null
  const letter = initialOf(card.word)
  if (!letter) return null
  const say = KK_SAY[soundOf(card)] ?? ''
  const sound = say ? ` ${say}, ${say},` : ''
  return [{ text: `${letter}, ${letter},${sound} ${card.word}`, lang: 'en-US' }]
}

/* ---------- 數字卡一次產生一串 ---------- */

/** 一次最多產生到幾：給小朋友認數字，999 已經很夠 */
export const NUMBER_MAX = 999

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 數字的中文唸法：31 → 三十一、105 → 一百零五、200 → 兩百（台灣口語） */
export function zhNumber(n: number): string {
  const d = (x: number) => ZH_DIGITS[x]!
  if (n < 10) return d(n)
  if (n < 20) return '十' + (n % 10 ? d(n % 10) : '')
  if (n < 100) return d(Math.floor(n / 10)) + '十' + (n % 10 ? d(n % 10) : '')
  const h = Math.floor(n / 100)
  const rest = n % 100
  const head = (h === 2 ? '兩' : d(h)) + '百'
  if (rest === 0) return head
  if (rest < 10) return head + '零' + d(rest)
  // 百位以上的十位要唸出「一」：110 → 一百一十
  return head + d(Math.floor(rest / 10)) + '十' + (rest % 10 ? d(rest % 10) : '')
}

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 數字的英文：31 → thirty-one、100 → one hundred、125 → one hundred twenty-five（美式） */
export function enNumber(n: number): string {
  if (n < 20) return EN_ONES[n]!
  if (n < 100) return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? '-' + EN_ONES[n % 10]! : '')
  const rest = n % 100
  return `${EN_ONES[Math.floor(n / 100)]!} hundred` + (rest ? ' ' + enNumber(rest) : '')
}

/**
 * 「數字卡: 0～100 | 中文」產生的卡：不放 emoji，正面直接顯示數字讓小朋友認，
 * 說明是唸法（中文「三十一」只用聽的，英文「thirty-one」會顯示出來）。
 */
export function numberCards(from: number, to: number, lang: 'zh' | 'en'): Card[] {
  const cards: Card[] = []
  for (let n = from; n <= to; n++) {
    cards.push({
      word: String(n),
      meaning: lang === 'zh' ? zhNumber(n) : enNumber(n),
      image: '',
      backImage: '',
      clip: null,
    })
  }
  return cards
}

/* ---------- 英文的「這是…」 ---------- */

/** 不可數的東西前面不加 a：This is milk */
const UNCOUNTABLE = new Set([
  'milk', 'ice', 'ice cream', 'juice', 'orange juice', 'water', 'rice', 'bread', 'yarn', 'cheese', 'honey', 'soup',
])
/** 一定是複數的東西：These are glasses */
const PLURAL = new Set(['glasses', 'jeans', 'scissors', 'pants', 'shorts', 'shoes', 'socks', 'chopsticks'])

/**
 * 「這是…」的英文，小朋友點錯時說給他聽，a、an 要分對：
 *   This is a horse／This is an elephant／This is a unicorn（開頭唸 /ju/）／
 *   This is an x-ray fish（x 唸 /ɛks/）／This is milk／These are glasses
 * bare：不加 a／an 的，像數字（This is four）、顏色（This is red）
 */
export function thisIs(word: string, bare = false): string {
  const w = word.trim()
  const lower = w.toLowerCase()
  if (PLURAL.has(lower)) return `These are ${w}.`
  if (bare || UNCOUNTABLE.has(lower)) return `This is ${w}.`
  const an = /^[aeio]/i.test(w) || /^u(?!ni|s[eu])/i.test(w) || /^x/i.test(w) || /^h(our|onest)/i.test(w)
  return `This is ${an ? 'an' : 'a'} ${w}.`
}

/* ---------- ABC 字母卡 ---------- */

/** 單元名稱裡有 ABC（半形、全形都算）就是字母卡：照 A～Z 排好，卡片上標出開頭字母 */
export function isAbcDeck(title: string): boolean {
  return /ABC|ＡＢＣ/i.test(title)
}

/** 英文字的開頭字母（大寫），不是英文開頭就回空字串 */
export function initialOf(word: string): string {
  return word.trim().match(/^[A-Za-z]/)?.[0].toUpperCase() ?? ''
}

/**
 * 字卡本實際要顯示的卡。字母卡照開頭字母排，同一個字母裡維持片單上寫的順序——
 * 家長新加一個動物寫在最後面也沒關係，會自己排到對的字母去。
 */
export function cardsOf(deck: VideoItem): Card[] {
  const list = deck.cards ?? []
  if (!isAbcDeck(deck.title)) return list
  const key = (c: Card) => initialOf(c.word) || '~'
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => key(a.c).localeCompare(key(b.c)) || a.i - b.i)
    .map((x) => x.c)
}
