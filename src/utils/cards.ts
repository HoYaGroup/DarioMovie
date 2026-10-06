import { parseVideoId, type AskKind, type Card, type CardClip, type VideoItem } from './youtube'

/**
 * 字卡的解析與顯示輔助。
 *
 * playlist.txt 裡一張卡寫成一行：
 *
 *   卡: apple | 蘋果 | 🍎 | Yum, delicious apple!
 *   卡: dog | 狗 | cards/dog.jpg
 *   卡: 11 | 🍎 | https://youtu.be/xxxxxxxxxxx 0:35-0:42
 *   卡: 1 | 一支鉛筆 one pencil | cards/shapes/1-q.webp | cards/shapes/1.webp
 *   卡: ㄅ | 唸:玻 | 爸爸 | 👨
 *   卡: snowman | 雪人 | ⛄ | 問:東西
 *   卡: big | 大 | 🐘 | 對:small
 *
 * 第一欄是卡片上最大的字，後面幾欄看內容自動判斷是什麼：
 *   ‧ 有 youtu 字樣的是影片片段，後面可以接「開始-結束」時間
 *   ‧ 只有 emoji，或是圖片網址／路徑的是圖；寫兩張的話，第一張是正面、第二張是背面
 *   ‧ 有英文、而且用 . ! ? 結尾的是句子，翻面時接在單字後面唸；寫好幾句（每句一欄）就輪流唸
 *   ‧ 「唸:」開頭的是語音要怎麼唸這個字（注音符號用同音字代替）
 *   ‧ 「問:」開頭的是這張卡自己的正面問法（東西、顏色、形狀、心情、動作、誰、哪裡、天氣……），
 *     沒寫就照字卡本的名稱決定；同一本裡有幾張不適用的（天氣裡的雪人）才需要寫
 *   ‧ 「對:」開頭的是相反詞的另一半（對:small）：正面問「Is it big or small?」，兩個字誰先講每次換
 *   ‧ 其他的是說明（英文、中文都可以寫在一起）
 * 所以欄位順序寫錯、少寫一欄都沒關係，不會整張卡壞掉。
 *
 * 第一欄是中文字或注音的卡叫「識字卡」（isZhCard）：正面只寫那個字，圖和說明在背面，一律用中文。
 */

const RE_EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]|\s)+$/u
const RE_IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?.*)?$/i
/** 句子：有英文字，用 . ! ? 結尾（Yum, delicious apple!） */
const RE_SENTENCE = /[A-Za-z].*[.!?]["'”’)]?$/
/** 以前用來指定開頭音的 KK 音標（/ju/）：現在不唸口訣了，舊的片單寫了也略過 */
const RE_KK = /(?:^|\s)\/[^/\s]+\/(?=\s|$)/g
/** 唸:玻 */
const RE_SAY = /^(?:唸|念|讀|say)\s*[:：]\s*(.+)$/i
/** 問:東西 */
const RE_ASK = /^(?:問|ask)\s*[:：]\s*(.+)$/i
/** 對:small */
const RE_PAIR = /^(?:對|pair)\s*[:：]\s*(.+)$/i
/** 識字卡：卡片上的字全是中文字或注音符號（含注音擴充區） */
const RE_ZH_WORD = /^[\p{Script=Han}㄀-ㄯㆠ-ㆿ]+$/u
const RE_BOPOMOFO = /^[㄀-ㄯㆠ-ㆿ]+$/

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
  const sentences: string[] = []
  let image = ''
  let backImage = ''
  let clip: CardClip | null = null
  let say = ''
  let ask: AskKind | undefined
  let pair = ''
  let issue = ''

  for (const field of rest) {
    const said = field.match(RE_SAY)
    if (said) {
      say = said[1]!.trim()
      continue
    }
    const asked = field.match(RE_ASK)
    if (asked) {
      ask = parseAskKind(asked[1]!)
      if (!ask) issue = `「問:」後面的「${asked[1]!.trim()}」看不懂，這張卡先照字卡本的問法`
      continue
    }
    const paired = field.match(RE_PAIR)
    if (paired) {
      pair = paired[1]!.trim()
      continue
    }
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
    if (RE_SENTENCE.test(field)) {
      // 一欄是一句（可以是兩小句：Time for bed. Good night!），好幾欄就是好幾句輪流
      sentences.push(field)
      continue
    }
    // 多寫的說明接在一起，不要默默丟掉
    const text = field.replace(RE_KK, ' ').trim()
    if (text) meaning = meaning ? `${meaning} ${text}` : text
  }

  return {
    card: {
      word, meaning, sentences, image, backImage, clip,
      ...(say ? { say } : {}),
      ...(ask ? { ask } : {}),
      ...(pair ? { pair } : {}),
    },
    issue,
  }
}

/**
 * 識字卡：卡片上的字是中文字或注音（山、ㄅ）。小朋友要認的是字本身，所以正面只寫字、不放圖，
 * 圖和說明留到背面；中文字沒有英文，不管上面選哪個語言一律用中文。
 */
export function isZhCard(card: Card): boolean {
  return RE_ZH_WORD.test(card.word.trim())
}

/** 注音符號（ㄅ）：題目要說「這個注音」，不是「這個字」 */
export function isBopomofoCard(card: Card): boolean {
  return RE_BOPOMOFO.test(card.word.trim())
}

/** 識字卡怎麼唸：片單有寫「唸:」就唸那個（ㄅ 唸成玻），沒寫就唸卡片上的字 */
export function zhReading(card: Card): string {
  return card.say?.trim() || card.word
}

/** 數字卡：卡片上的字全是數字（3、13、100） */
export function isNumberCard(card: Card): boolean {
  return /^\d+$/.test(card.word.trim())
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
 * 單字卡的中文、英文名字（數字卡另外看 numberLabels）。
 * 英文：卡片上的字是英文就用它，否則用說明裡的英文；中文：說明裡英文以外的部分。
 */
export function speechOf(card: Card): { en: string; zh: string } {
  return { en: latin(card.word) || latin(card.meaning), zh: zhOf(card.meaning) || zhOf(card.word) }
}

/* ---------- 數字的唸法 ---------- */

/** 一次最多產生到幾：給小朋友認數字，999 已經很夠 */
export const NUMBER_MAX = 999

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 數字的中文唸法：31 → 三十一、105 → 一百零五、200 → 兩百（台灣口語） */
export function zhNumber(n: number): string {
  if (n > NUMBER_MAX) return String(n)
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
  if (n > NUMBER_MAX) return String(n)
  if (n < 20) return EN_ONES[n]!
  if (n < 100) return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? '-' + EN_ONES[n % 10]! : '')
  const rest = n % 100
  return `${EN_ONES[Math.floor(n / 100)]!} hundred` + (rest ? ' ' + enNumber(rest) : '')
}

/**
 * 數東西用的名字：數字卡放這些 emoji，就知道要說「Touch the apples」「十一顆蘋果」。
 * [英文, 量詞, 中文, 英文複數（加 s 就好的不用寫）]
 * 片單裡用了這裡沒有的 emoji 也可以數，只是會說「Touch them」「How many are there?」。
 */
const COUNT_NOUNS: Record<string, [string, string, string, string?]> = {
  '🍎': ['apple', '顆', '蘋果'],
  '🍊': ['orange', '顆', '柳橙'],
  '🍋': ['lemon', '顆', '檸檬'],
  '🍌': ['banana', '根', '香蕉'],
  '🍓': ['strawberry', '顆', '草莓', 'strawberries'],
  '🍐': ['pear', '顆', '梨子'],
  '🍑': ['peach', '顆', '水蜜桃', 'peaches'],
  '🥝': ['kiwi', '顆', '奇異果'],
  '🥕': ['carrot', '根', '紅蘿蔔'],
  '🐶': ['dog', '隻', '狗'],
  '🐱': ['cat', '隻', '貓'],
  '🐭': ['mouse', '隻', '老鼠', 'mice'],
  '🐰': ['rabbit', '隻', '兔子'],
  '🐷': ['pig', '隻', '豬'],
  '🐸': ['frog', '隻', '青蛙'],
  '🐵': ['monkey', '隻', '猴子'],
  '🐥': ['chick', '隻', '小雞'],
  '🐤': ['chick', '隻', '小雞'],
  '🦆': ['duck', '隻', '鴨子'],
  '🐧': ['penguin', '隻', '企鵝'],
  '🐢': ['turtle', '隻', '烏龜'],
  '🐟': ['fish', '條', '魚', 'fish'],
  '🐠': ['fish', '條', '魚', 'fish'],
  '🐙': ['octopus', '隻', '章魚', 'octopuses'],
  '🐞': ['ladybug', '隻', '瓢蟲'],
  '🐝': ['bee', '隻', '蜜蜂'],
  '🦋': ['butterfly', '隻', '蝴蝶', 'butterflies'],
  '🐌': ['snail', '隻', '蝸牛'],
  '⭐': ['star', '顆', '星星'],
  '🎈': ['balloon', '顆', '氣球'],
  '🚗': ['car', '輛', '車'],
  '🍪': ['cookie', '片', '餅乾'],
  '🌸': ['flower', '朵', '花'],
  '🥚': ['egg', '顆', '蛋'],
  '⚽': ['ball', '顆', '球'],
  '✏': ['pencil', '支', '鉛筆'],
  '🐘': ['elephant', '隻', '大象', 'elephants'],
  '🐓': ['chicken', '隻', '雞', 'chickens'],
  '🦛': ['hippo', '隻', '河馬', 'hippos'],
  '🦒': ['giraffe', '隻', '長頸鹿', 'giraffes'],
  '🐜': ['ant', '隻', '螞蟻', 'ants'],
  '🦁': ['lion', '隻', '獅子', 'lions'],
  // 海裡的
  '🐳': ['whale', '隻', '鯨魚'],
  '🐬': ['dolphin', '隻', '海豚'],
  '🦈': ['shark', '隻', '鯊魚'],
  '🦀': ['crab', '隻', '螃蟹'],
  '🦐': ['shrimp', '隻', '蝦子', 'shrimp'],
  '🦑': ['squid', '隻', '魷魚', 'squid'],
  '🦭': ['seal', '隻', '海豹'],
  '🐚': ['shell', '個', '貝殼'],
  // 小蟲
  '🐛': ['caterpillar', '隻', '毛毛蟲'],
  '🦗': ['cricket', '隻', '蟋蟀'],
  '🕷': ['spider', '隻', '蜘蛛'],
  '🪲': ['beetle', '隻', '甲蟲'],
}

export interface CountNoun {
  /** apple */
  en: string
  /** apples */
  plural: string
  /** 蘋果 */
  zh: string
  /** 顆 */
  unit: string
}

/** 數字卡上拿來數的東西叫什麼；不是數東西的卡、或 emoji 不在上面的表裡就回 null */
export function countNounOf(card: Card): CountNoun | null {
  if (countOf(card) === null || !card.image || isPicture(card)) return null
  const hit = COUNT_NOUNS[card.image.replace(/️/g, '').trim()]
  if (!hit) return null
  const [en, unit, zh, plural] = hit
  return { en, plural: plural ?? `${en}s`, zh, unit }
}

/**
 * 數字卡要說的中文、英文：
 *   數東西的卡（11 🍎）：eleven apples／十一顆蘋果
 *   說明寫了東西的卡（1 一支鉛筆 one pencil）：one pencil／一支鉛筆
 *   只有數字的卡（31）：thirty-one／三十一
 * 中英文都要有：數字不再分成中文版、英文版，一張卡兩種都學。
 */
export function numberLabels(card: Card): { en: string; zh: string } {
  const n = Number(card.word)
  const noun = countNounOf(card)
  if (noun) {
    return {
      en: `${enNumber(n)} ${n === 1 ? noun.en : noun.plural}`,
      // 量詞前面的 2 要說「兩」：兩隻狗，不是二隻狗
      zh: `${n === 2 ? '兩' : zhNumber(n)}${noun.unit}${noun.zh}`,
    }
  }
  return { en: latin(card.meaning) || enNumber(n), zh: zhOf(card.meaning) || zhNumber(n) }
}

/**
 * 「數字卡: 0～100」產生的卡：不放 emoji，正面直接顯示數字讓小朋友認，
 * 中文、英文的唸法由 numberLabels 自己算。
 */
export function numberCards(from: number, to: number): Card[] {
  const cards: Card[] = []
  for (let n = from; n <= to; n++) {
    cards.push({ word: String(n), meaning: '', sentences: [], image: '', backImage: '', clip: null })
  }
  return cards
}

/* ---------- 英文的句子 ---------- */

/** 不可數的東西前面不加 a：This is milk */
const UNCOUNTABLE = new Set([
  'milk', 'ice', 'ice cream', 'juice', 'orange juice', 'water', 'rice', 'bread', 'yarn', 'cheese', 'honey', 'soup',
  'tea', 'jelly', 'yogurt', 'sushi', 'pizza', 'corn', 'broccoli', 'lettuce', 'garlic', 'soap',
  'rain', 'snow', 'wind', 'lightning',
])
/** 一定是複數的東西：These are glasses */
const PLURAL = new Set([
  'glasses', 'jeans', 'scissors', 'pants', 'shorts', 'shoes', 'socks', 'chopsticks', 'fries', 'grapes', 'noodles',
  'vegetables', 'gloves', 'boots', 'blocks',
])

/**
 * 單元名稱裡有這些字的字卡本，卡片上是動作、心情、相反詞、時間、禮貌的話，或是卡通角色的名字
 * （Woody、Poli），不是「一個東西」：問的時候不加 the（Where is happy? / Where is Monday?），也不說 a（This is sad.）。
 */
export function isBareDeck(title: string): boolean {
  return /動作|心情|相反|四季|星期|月份|時鐘|習慣|過馬路|禮貌|波力|汪汪隊|玩具總動員|Actions?|Feelings?|Opposites?|Seasons?|Days|Months?|O'clock|Habits?|Cross Safely|Manners|Magic Words|Robocar Poli|PAW Patrol|Toy Story/i.test(title)
}

/**
 * 卡片正面問什麼，要問得跟答案對得上：顏色的答案是 red，問「What is this?」只問到一半，
 * 要問「What color is this?」。預設看字卡本的名稱決定（askKindOf），沒有特別的就問 What is this?；
 * 同一本裡不適用的卡（天氣裡的雪人、雨傘），在那張卡寫「問:東西」改掉。
 * 相反詞不用這張表，每張卡自己組「Is it big or small?」（pairQuestion）。
 */
export const FRONT_QUESTIONS: Record<AskKind, { en: string; zh: string }> = {
  thing: { en: 'What is this?', zh: '這是什麼？' },
  color: { en: 'What color is this?', zh: '這是什麼顏色？' },
  shape: { en: 'What shape is this?', zh: '這是什麼形狀？' },
  feeling: { en: 'How does he feel?', zh: '他的心情怎麼樣？' },
  action: { en: 'What is he doing?', zh: '他在做什麼？' },
  should: { en: 'What should we do?', zh: '我們應該怎麼做？' },
  say: { en: 'What do you say?', zh: '這時候要說什麼？' },
  like: { en: 'What is it like?', zh: '它是什麼樣子？' },
  who: { en: 'Who is this?', zh: '這是誰？' },
  where: { en: 'Where is this?', zh: '這是哪裡？' },
  weather: { en: "How's the weather?", zh: '天氣怎麼樣？' },
  season: { en: 'What season is it?', zh: '現在是哪一季？' },
  day: { en: 'What day is it?', zh: '今天是星期幾？' },
  month: { en: 'What month is it?', zh: '這是幾月？' },
  time: { en: 'What time is it?', zh: '現在幾點鐘？' },
}

/** 字卡本的名稱 → 正面問哪一種問題 */
export function askKindOf(title: string): AskKind {
  const t = (re: RegExp) => re.test(title)
  if (t(/顏色|Colors?/i)) return 'color'
  if (t(/形狀|Shapes?/i)) return 'shape'
  if (t(/心情|Feelings?/i)) return 'feeling'
  if (t(/動作|Actions?/i)) return 'action'
  if (t(/習慣|過馬路|Habits?|Cross Safely/i)) return 'should'
  if (t(/禮貌|Magic Words|Manners/i)) return 'say'
  if (t(/相反|Opposites?/i)) return 'like'
  if (t(/家人|職業|波力|汪汪隊|玩具總動員|Family|Jobs|Robocar Poli|PAW Patrol|Toy Story/i)) return 'who'
  if (t(/地方|Places?/i)) return 'where'
  if (t(/天氣|Weather/i)) return 'weather'
  if (t(/四季|Seasons?/i)) return 'season'
  if (t(/星期|Days/i)) return 'day'
  if (t(/月份|Months?/i)) return 'month'
  if (t(/時鐘|O'clock/i)) return 'time'
  return 'thing'
}

/** 片單「問:」後面寫的字 → 問法；中文名稱、英文代號（thing、color……）都收，看不懂回 undefined */
const ASK_NAMES: Record<string, AskKind> = {
  東西: 'thing', 顏色: 'color', 形狀: 'shape', 心情: 'feeling', 動作: 'action', 該做什麼: 'should', 說什麼: 'say',
  樣子: 'like', 誰: 'who', 哪裡: 'where', 天氣: 'weather', 季節: 'season', 星期: 'day', 月份: 'month', 幾點: 'time',
}

export function parseAskKind(text: string): AskKind | undefined {
  const s = text.trim()
  if (s in ASK_NAMES) return ASK_NAMES[s]
  const key = s.toLowerCase()
  return key in FRONT_QUESTIONS ? (key as AskKind) : undefined
}

/**
 * 相反詞正面的問題：Is it big or small?／它是大還是小？
 * 兩個字誰先講由 swap 決定（每次翻到這張卡換一次），才不會學到「第一個講的就是答案」。
 */
export function pairQuestion(card: Card, partner: Card, swap: boolean): { en: string; zh: string } {
  const [a, b] = swap ? [partner, card] : [card, partner]
  const en = (c: Card) => speechOf(c).en || c.word
  const zhName = (c: Card) => speechOf(c).zh || c.word
  return { en: `Is it ${en(a)} or ${en(b)}?`, zh: `它是${zhName(a)}還是${zhName(b)}？` }
}

/**
 * 數字、顏色、動作、心情前面不加 a／an，問的時候也不加 the：This is four、Can you find red?
 * 顏色卡的說明寫成「紅色」這種「…色」結尾就認得出來；動作、心情看字卡本的名稱（isBareDeck）。
 */
function isBare(card: Card, bareDeck = false): boolean {
  return bareDeck || isNumberCard(card) || /色$/.test(card.meaning)
}

/**
 * 英文名字前面加上 a／an：a horse、an elephant、a unicorn（開頭唸 /ju/）、
 * an x-ray fish（x 唸 /ɛks/）、a xylophone（x 唸 /z/）、milk、glasses
 */
function withArticle(word: string, bare = false): string {
  const w = word.trim()
  const lower = w.toLowerCase()
  if (bare || PLURAL.has(lower) || UNCOUNTABLE.has(lower)) return w
  const an = /^[aeio]/i.test(w) || /^u(?!ni|s[eu])/i.test(w) || /^x(?=[-\s]|$)/i.test(w) || /^h(our|onest)/i.test(w)
  return `${an ? 'an' : 'a'} ${w}`
}

/** 這張卡的英文名字：數字卡是數字的英文（seven），其他是單字本身 */
export function englishOf(card: Card): string {
  return isNumberCard(card) ? enNumber(Number(card.word)) : speechOf(card).en
}

/**
 * 「這是…」的英文，小朋友點錯時說給他聽：
 *   This is a horse／This is an elephant／This is milk／These are glasses／This is four／This is red
 */
export function thisIs(card: Card, bareDeck = false): string {
  const en = englishOf(card)
  if (PLURAL.has(en.toLowerCase())) return `These are ${en}.`
  return `This is ${withArticle(en, isBare(card, bareDeck))}.`
}

/**
 * 翻面時可以接在單字後面唸的句子（好幾句的話由畫面輪流挑一句）。
 * 片單上沒寫的話，英文單字卡至少說一句「I see a cat.」；數字卡寫了句子才說，沒有英文的卡就不說。
 */
export function sentencesOf(card: Card, bareDeck = false): string[] {
  if (card.sentences.length) return card.sentences
  if (isNumberCard(card) || bareDeck) return []
  const en = speechOf(card).en
  return en ? [`I see ${withArticle(en, isBare(card))}.`] : []
}

/** 考考我有幾種問法，每一題輪流換，小朋友聽得懂不同的說法 */
export const ASK_STYLES = 3

/**
 * 考考我的題目：Where is the cat? / Can you find the cat? / Can you touch the cat?
 * 數字說「number seven」，顏色、動作、心情直接說（red、run、happy），複數用 Where are the glasses?
 * 這張卡沒有英文就回空字串，讓呼叫的人改用中文問。
 */
export function askOf(card: Card, style: number, bareDeck = false): string {
  const en = englishOf(card)
  if (!en) return ''
  const target = isNumberCard(card) ? `number ${en}` : isBare(card, bareDeck) ? en : `the ${en}`
  const plural = PLURAL.has(en.toLowerCase())
  switch (style % ASK_STYLES) {
    case 0: return `${plural ? 'Where are' : 'Where is'} ${target}?`
    case 1: return `Can you find ${target}?`
    default: return `Can you touch ${target}?`
  }
}

/* ---------- ABC 字母卡 ---------- */

/**
 * 全英文模式顯示的字卡本名稱：片單上有寫英文名稱（字卡本: 中文 | English）就用它；
 * 名稱本來就中英都有的（農場動物 Farm），把中文拿掉；都沒有英文就只好照原本的名稱。
 */
export function englishTitle(deck: VideoItem): string {
  if (deck.titleEn) return deck.titleEn
  const stripped = deck.title.replace(/[\p{Script=Han}，、（）《》「」]+/gu, ' ').replace(/\s+/g, ' ').trim()
  return /[A-Za-z]{2}/.test(stripped) ? stripped : deck.title
}

/**
 * 全中文模式顯示的字卡本名稱：把英文的部分拿掉（農場動物 Farm → 農場動物）；
 * ABC 是這本的名字，留著（動物篇 ABC）。
 */
export function chineseTitle(deck: VideoItem): string {
  const kept = deck.title.split(/\s+/).filter((w) => w === 'ABC' || !/^[A-Za-z'-]+$/.test(w)).join(' ')
  return kept || deck.title
}

/**
 * 全中文模式的題目，跟英文一樣三種問法輪流：蘋果在哪裡？／你找得到蘋果嗎？／哪一個是蘋果？
 * 數字說「數字七」。
 */
export function askZhOf(card: Card, style: number): string {
  const name = isNumberCard(card) ? `數字${zhNumber(Number(card.word))}` : (zhOf(card.meaning) || card.word)
  switch (style % ASK_STYLES) {
    case 0: return `${name}在哪裡？`
    case 1: return `你找得到${name}嗎？`
    default: return `哪一個是${name}？`
  }
}

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
