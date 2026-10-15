import { parseVideoId, MISSION_DEFAULT_GOAL, MISSION_MAX, type AskKind, type SpecialAsk, type QuestionKey, type Card, type CardClip, type Mission, type MissionAct, type VideoItem } from './youtube'
import { parsePlace, placeById } from './places'
import { cardPhotoUrl, hasPhotos, pathPhotoKey, photoUrl } from './photos'
import { hasMedia, mediaUrl } from './media'
import { questionNames, questionOverride } from './questions'

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
 *   ‧ 「問:」開頭的是這張卡自己的正面問句的名字（東西、顏色、形狀、心情、動作、誰、哪裡、天氣、時段……，或「問句」工作表自己加的），
 *     沒寫就照字卡本的名稱決定；同一本裡有幾張不適用的（天氣裡的雪人）才需要寫
 *   ‧ 「對:」開頭的是相反詞的另一半（對:small）：正面問「Is it big or small?」，兩個字誰先講每次換
 *   ‧ 「放:」開頭的是這樣東西屬於家裡哪裡（放:廚房）：有幾張這樣的卡，字卡本就多一個「放哪裡」遊戲（見 utils/places.ts）
 *   ‧ 「聲:」開頭的是這個東西真正的聲音（聲:cards/sounds/cow.wav，動物的叫聲）：有幾張這樣的卡，字卡本就多一個「聽聲音」遊戲
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
/** 問:東西（「問句:東西」「問法:東西」也一樣） */
const RE_ASK = /^(?:問句|問法|問|ask)\s*[:：]\s*(.+)$/i
/** 聲:cards/sounds/cow.wav */
const RE_SOUND = /^(?:聲|sound)\s*[:：]\s*(\S+)$/i
/** iPad 放得出來的音檔格式（ogg 不行） */
const RE_SOUND_EXT = /\.(?:wav|mp3|m4a|aac)(?:\?.*)?$/i
/** 放:廚房 */
const RE_PLACE = /^(?:放|place)\s*[:：]\s*(.+)$/i
/** 對:small */
const RE_PAIR = /^(?:對|pair)\s*[:：]\s*(.+)$/i
/**
 * 欄位前面寫明是什麼（試算表的欄位就是這樣轉成文字的，字、句子裡寫什麼都不會被誤判成別的欄位）：
 *   說明:蘋果　句:Yum!　圖:🍎　背面:cards/a.webp　片段:https://youtu.be/xxx 0:35-0:42
 */
const RE_MEANING = /^(?:說明|meaning)\s*[:：]\s*(.*)$/i
const RE_SENT = /^(?:句|sentence)\s*[:：]\s*(.+)$/i
const RE_IMG = /^(?:圖|image)\s*[:：]\s*(.+)$/i
const RE_BACK = /^(?:背面|back)\s*[:：]\s*(.+)$/i
const RE_CLIP = /^(?:片段|clip)\s*[:：]\s*(.+)$/i
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

/**
 * 圖片（或音檔）路徑轉成實際網址：相對路徑要接上部署的子目錄。
 * 優先順序：家長換過這張圖（見 utils/photos.ts）→ 這台裝置匯入的素材包（見 utils/media.ts，書頁圖片、叫聲放這裡）→ 網站上的
 */
export function imageSrc(image: string): string {
  const own = hasPhotos() ? photoUrl(pathPhotoKey(image)) : undefined
  if (own) return own
  const packed = hasMedia() ? mediaUrl(image) : undefined
  if (packed) return packed
  if (/^(?:https?|blob):/i.test(image) || image.startsWith('/')) return image
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
  let ask: string | undefined
  let pair = ''
  let place = ''
  let sound = ''
  let issue = ''

  for (const field of rest) {
    const meant = field.match(RE_MEANING)
    if (meant) {
      const text = meant[1]!.trim()
      if (text) meaning = meaning ? `${meaning} ${text}` : text
      continue
    }
    const sentence = field.match(RE_SENT)
    if (sentence) {
      sentences.push(sentence[1]!.trim())
      continue
    }
    const front = field.match(RE_IMG)
    if (front) {
      image = front[1]!.trim()
      continue
    }
    const back = field.match(RE_BACK)
    if (back) {
      backImage = back[1]!.trim()
      continue
    }
    const clipped = field.match(RE_CLIP)
    if (clipped) {
      clip = parseClip(clipped[1]!)
      if (!clip) issue = '影片網址看不懂，這張卡先不放影片'
      continue
    }
    const said = field.match(RE_SAY)
    if (said) {
      say = said[1]!.trim()
      continue
    }
    const asked = field.match(RE_ASK)
    if (asked) {
      ask = parseAskName(asked[1]!)
      if (!ask) issue = '「問:」後面沒有寫問句的名字，這張卡先照字卡本的問句'
      continue
    }
    const paired = field.match(RE_PAIR)
    if (paired) {
      pair = paired[1]!.trim()
      continue
    }
    const sounded = field.match(RE_SOUND)
    if (sounded) {
      if (RE_SOUND_EXT.test(sounded[1]!)) sound = sounded[1]!
      else issue = `「聲:」後面的音檔要是 wav、mp3 或 m4a（ogg 在 iPad 放不出來），這張卡先不放聲音`
      continue
    }
    const placed = field.match(RE_PLACE)
    if (placed) {
      const hit = parsePlace(placed[1]!)
      if (hit) place = hit.id
      else issue = `「放:」後面的「${placed[1]!.trim()}」不是認得的地點（廚房、浴室、臥室、門口、客廳），這張卡先不放進「放哪裡」`
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
      ...(place ? { place } : {}),
      ...(sound ? { sound } : {}),
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

/** 數東西的卡：放了 emoji 的 1～20，正面畫出那麼多個讓小朋友點著數；有自己的圖的（數字形狀卡）就直接看圖 */
export function isCounting(card: Card): boolean {
  return countOf(card) !== null && !!card.image && !isPicture(card)
}

/**
 * 一張卡的圖放了幾個 emoji（👧⚽👦 是 3 個，👨‍🍳 是 1 個）：詞句卡用兩三個 emoji 畫出情境，
 * 卡片上的大圖要依個數縮小才擺得下一行。最多算 3，更多的（🍪🍪🍪🍪🍪🍪）讓它自己換行。
 */
export function emojiCount(image: string): number {
  const isEmoji = (s: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s)
  let n = 0
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(image)) {
      if (isEmoji(segment)) n++
    }
  } else {
    // 沒有 Segmenter 的舊瀏覽器：不算 ZWJ 連起來的（👨‍🍳 會算成 2 個），只會縮得多一點
    n = [...image].filter((ch) => /\p{Extended_Pictographic}/u.test(ch)).length
  }
  return Math.min(Math.max(n, 1), 3)
}

/** 英文部分：字母開頭，中間可以接數字（Taipei 101），單獨的數字不算 */
const latin = (s: string) => (s.match(/[A-Za-z][A-Za-z0-9' .-]*[A-Za-z0-9]|[A-Za-z]/g) ?? []).join(' ')
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
  // 交通工具：量詞不一樣，一架飛機、一列火車、一艘帆船
  '✈': ['airplane', '架', '飛機'],
  '🚁': ['helicopter', '架', '直升機'],
  '🚂': ['train', '列', '火車'],
  '🚌': ['bus', '輛', '公車', 'buses'],
  '🚲': ['bike', '輛', '腳踏車'],
  '🚕': ['taxi', '輛', '計程車'],
  '🚒': ['fire truck', '輛', '消防車'],
  '🚓': ['police car', '輛', '警車'],
  '⛵': ['sailboat', '艘', '帆船'],
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
  'bubble tea', 'shaved ice', 'oden', 'curry rice', 'fried chicken', 'paint', 'paper', 'grass', 'bamboo',
  'rain', 'snow', 'wind', 'lightning',
  'soy milk', 'honey', 'cereal', 'toast', 'popcorn', 'chocolate', 'pudding', 'sunscreen', 'medicine', 'money', 'sand', 'hair',
  'pasta', 'toothpaste', 'underwear',
])
/** 一定是複數的東西：These are glasses */
const PLURAL = new Set([
  'glasses', 'jeans', 'scissors', 'pants', 'shorts', 'shoes', 'socks', 'chopsticks', 'fries', 'grapes', 'noodles',
  'vegetables', 'gloves', 'boots', 'blocks', 'sunglasses', 'flip-flops', 'twins', 'grandparents',
  // 家裡的書（我的書）上印的是複數
  'ants', 'bananas', 'building blocks', 'stickers', 'crayons', 'books', 'friends', 'bubbles', 'pyjamas', 'leggings', 'blue gloves',
])

/** 英文名字是不是一定複數（shoes、glasses）：問「Where do the shoes go?」要用 do，不是 does */
export function isPluralName(en: string): boolean {
  return PLURAL.has(en.trim().toLowerCase())
}

/**
 * 單元名稱裡有這些字的字卡本，卡片上是動作、心情、相反詞、時間、禮貌、五感、該怎麼做的話，或是卡通角色、國家的名字
 * （Woody、Poli、Japan），不是「一個東西」：問的時候不加 the（Where is happy? / Where is Monday?），也不說 a（This is sad.）。
 */
export function isBareDeck(title: string): boolean {
  return /動作|心情|不舒服|運動|作息|相反|四季|星期|月份|一天的時間|時鐘|習慣|過馬路|口令|守則|步驟|地震|禮貌|問候|怎麼說|常說的話|五感|好朋友|冷靜|世界各國|大洲|好地方|波力|汪汪隊|玩具總動員|誰的聲音|叫聲|Who says|Animal Sounds?|Actions?|Feelings?|Not Feeling Well|Sports|Routine|Opposites?|Seasons?|Days|Months?|Parts of the Day|O'clock|Habits?|Cross Safely|Commands|Rules|Steps|Earthquake|Manners|Magic Words|Greetings|Phrases|Senses|Good Friends|Calm Down|Around the World|Continents|in Taiwan|Robocar Poli|PAW Patrol|Toy Story/i.test(title)
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
  // 卡通角色常說的話：正面是角色或場景，答案是那句台詞
  quote: { en: 'What do they say?', zh: '他們會說什麼？' },
  like: { en: 'What is it like?', zh: '它是什麼樣子？' },
  who: { en: 'Who is this?', zh: '這是誰？' },
  where: { en: 'Where is this?', zh: '這是哪裡？' },
  weather: { en: "How's the weather?", zh: '天氣怎麼樣？' },
  season: { en: 'What season is it?', zh: '現在是哪一季？' },
  day: { en: 'What day is it?', zh: '今天是星期幾？' },
  month: { en: 'What month is it?', zh: '這是幾月？' },
  time: { en: 'What time is it?', zh: '現在幾點鐘？' },
  daypart: { en: 'What time of day is it?', zh: '現在是一天的什麼時候？' },
  // 五感：正面是眼睛、耳朵，答案是 see、hear
  sense: { en: 'What can you do with it?', zh: '可以用它做什麼？' },
  // 動物的叫聲：正面是狗，答案是 woof woof
  sound: { en: 'What does it say?', zh: '牠怎麼叫？' },
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * 這個問句的英文和中文：試算表「問句」工作表上有那一列就用它（utils/questions.ts），沒有就用上面程式內建的；
 * 名字查不到（試算表上自己加的問句被刪了）就問「這是什麼？」。
 * 畫面要顯示、要唸的問句都從這裡拿，不要直接讀 FRONT_QUESTIONS。
 */
export function frontQuestion(name: string): { en: string; zh: string } {
  const own = questionOverride(name)
  const base = hasOwn(FRONT_QUESTIONS, name) ? FRONT_QUESTIONS[name as AskKind] : FRONT_QUESTIONS.thing
  return { en: own?.en || base.en, zh: own?.zh || base.zh }
}

/** 「問句」工作表自己加的問句的名字（不是程式內建的 19 種，也不是固定的三種卡） */
export function customQuestionNames(): string[] {
  return questionNames().filter((k) => !hasOwn(FRONT_QUESTIONS, k) && !hasOwn(SPECIAL_QUESTIONS, k))
}

/** 字卡本的名稱 → 正面問哪一種問題 */
export function askKindOf(title: string): AskKind {
  const t = (re: RegExp) => re.test(title)
  if (t(/顏色|Colors?/i)) return 'color'
  if (t(/形狀|Shapes?/i)) return 'shape'
  if (t(/心情|不舒服|Feelings?|Not Feeling Well/i)) return 'feeling'
  if (t(/動作|運動|作息|Actions?|Sports|Routine/i)) return 'action'
  // 卡通角色常說的話要排在 who 前面：「汪汪隊常說的話」名稱裡也有汪汪隊
  if (t(/台詞|常說的話|Phrases/i)) return 'quote'
  // 「這是誰的聲音？」也有「誰」，要排在 who 前面
  if (t(/誰的聲音|叫聲|Who says|Animal Sounds?/i)) return 'sound'
  if (t(/習慣|過馬路|好朋友|冷靜|口令|守則|步驟|地震|Habits?|Cross Safely|Good Friends|Calm Down|Commands|Rules|Steps|Earthquake/i)) return 'should'
  if (t(/禮貌|問候|怎麼說|Magic Words|Manners|Greetings/i)) return 'say'
  if (t(/相反|Opposites?/i)) return 'like'
  if (t(/家人|職業|親戚|童話|波力|汪汪隊|玩具總動員|Family|Jobs|Relatives|Fairy Tale|Robocar Poli|PAW Patrol|Toy Story/i)) return 'who'
  if (t(/地方|世界各國|房間|大洲|Places?|Around the World|Rooms|Continents/i)) return 'where'
  if (t(/五感|Senses/i)) return 'sense'
  if (t(/天氣|Weather/i)) return 'weather'
  if (t(/一天的時間|Parts of the Day/i)) return 'daypart'
  if (t(/四季|Seasons?/i)) return 'season'
  if (t(/星期|Days/i)) return 'day'
  if (t(/月份|Months?/i)) return 'month'
  if (t(/時鐘|O'clock/i)) return 'time'
  return 'thing'
}

/** 片單「問:」後面寫的字 → 問法；中文名稱、英文代號（thing、color……）都收，看不懂回 undefined */
const ASK_NAMES: Record<string, AskKind> = {
  東西: 'thing', 顏色: 'color', 形狀: 'shape', 心情: 'feeling', 動作: 'action', 該做什麼: 'should', 說什麼: 'say',
  台詞: 'quote', 樣子: 'like', 誰: 'who', 哪裡: 'where', 天氣: 'weather', 季節: 'season', 星期: 'day', 月份: 'month', 幾點: 'time',
  時段: 'daypart', 感官: 'sense', 叫聲: 'sound',
}

/** 問句 → 試算表「問句」欄寫的名字：內建的是中文名（東西、顏色、誰……），自己加的就是它自己的名字；跟 parseAskKind 相反 */
export function askKindName(name: string): string {
  return Object.entries(ASK_NAMES).find(([, k]) => k === name)?.[0] ?? name
}

/** 固定的三種卡正面問的話（程式內建的，「問句」工作表可以改）：數字卡、識字卡、注音卡。中文字沒有英文，只問中文 */
export const SPECIAL_QUESTIONS: Record<SpecialAsk, { en: string; zh: string }> = {
  number: { en: 'What number is this?', zh: '這是數字幾？' },
  zhChar: { en: '', zh: '這個字怎麼唸？' },
  bopomofo: { en: '', zh: '這個注音怎麼唸？' },
}

const SPECIAL_NAMES: Record<string, SpecialAsk> = {
  數字: 'number', 數字卡: 'number', 識字: 'zhChar', 識字卡: 'zhChar', 注音: 'bopomofo', 注音卡: 'bopomofo',
}

/** 「問句」工作表第一欄的名字：內建的 19 種，或 數字、識字、注音；其他是自己加的問句，回 undefined */
export function parseQuestionKey(text: string): QuestionKey | undefined {
  return parseAskKind(text) ?? (hasOwn(SPECIAL_NAMES, text.trim()) ? SPECIAL_NAMES[text.trim()] : undefined)
}

/** 自己加的問句的名字最長幾個字：它會寫在字卡本、卡片的「問句」欄，太長多半貼錯東西了 */
const MAX_ASK_NAME = 30

/** 整理問句的名字：頭尾空白去掉、空白合併；不能有 | 和括號（書單的語法），太長、空的回 undefined */
export function cleanAskName(text: string): string | undefined {
  const s = text.replace(/\s+/g, ' ').trim()
  if (!s || s.length > MAX_ASK_NAME || /[|【】《》[\]]/.test(s)) return undefined
  return s
}

/**
 * 卡片、字卡本寫的問句名字 → 存起來的名字：內建的存代號（東西 → thing），其他（問句工作表自己加的）原樣存。
 * 名字在不在「問句」工作表，這裡不管（讀試算表時才查，沒有的會提醒）；寫法不能用的回 undefined。
 */
export function parseAskName(text: string): string | undefined {
  return parseAskKind(text) ?? (hasOwn(SPECIAL_NAMES, text.trim()) ? undefined : cleanAskName(text))
}

/** 數字卡、識字卡、注音卡正面問的話：「問句」工作表改過的就用它 */
export function specialQuestion(kind: SpecialAsk): { en: string; zh: string } {
  const own = questionOverride(kind)
  const base = SPECIAL_QUESTIONS[kind]
  return { en: own?.en || base.en, zh: own?.zh || base.zh }
}

export function parseAskKind(text: string): AskKind | undefined {
  const s = text.trim()
  if (hasOwn(ASK_NAMES, s)) return ASK_NAMES[s]
  const key = s.toLowerCase()
  return hasOwn(FRONT_QUESTIONS, key) ? (key as AskKind) : undefined
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
export function thisIs(card: Card, bareDeck = false, phrase = false): string {
  const en = englishOf(card)
  // 詞句字卡（I can do it）不是東西：不說 This is I can do it.
  if (phrase) return `This picture says, ${en}.`
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

/**
 * 卡片背面那一欄寫了兩小句（My tummy is rumbling. Let's eat a hamburger.），一句一行顯示，
 * 不要擠成一段、從句子中間折行。Mr. Dr. 這種縮寫後面的句號不算句尾。
 */
export function sentenceLines(sentence: string): string[] {
  const lines: string[] = []
  const end = /[.!?]+["'”’)]*(?:\s+|$)/g
  let start = 0
  let m: RegExpExecArray | null
  while ((m = end.exec(sentence))) {
    const head = sentence.slice(start, m.index + m[0].trimEnd().length).trim()
    if (/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr)\.$/.test(head)) continue
    if (head) lines.push(head)
    start = m.index + m[0].length
  }
  const rest = sentence.slice(start).trim()
  if (rest) lines.push(rest)
  return lines.length ? lines : [sentence]
}

/** 考考我有幾種問法，每一題輪流換，小朋友聽得懂不同的說法 */
export const ASK_STYLES = 3

/**
 * 考考我的題目：Where is the cat? / Can you find the cat? / Can you touch the cat?
 * 數字說「number seven」，顏色、動作、心情直接說（red、run、happy），複數用 Where are the glasses?
 * 這張卡沒有英文就回空字串，讓呼叫的人改用中文問。
 */
export function askOf(card: Card, style: number, bareDeck = false, phrase = false): string {
  const en = englishOf(card)
  if (!en) return ''
  // 詞句字卡（生活用語、卡通常說的話、見面問候）：Which picture says, I'm hungry?
  if (phrase) {
    switch (style % ASK_STYLES) {
      case 0: return `Which picture says, ${en}?`
      case 1: return `Can you find the picture for, ${en}?`
      default: return `Touch the picture that says, ${en}.`
    }
  }
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

/** 數字卡的圖是用 emoji 畫出幾個東西讓孩子數，不能換成一張照片 */
export function canHavePhoto(card: Card): boolean {
  return !isNumberCard(card)
}

/** 家長幫這幾個字拍過照片的話，卡上的圖換成那張照片（沒換過的卡原封不動） */
function withOwnPhotos(deckUid: string, list: Card[]): Card[] {
  if (!hasPhotos()) return list
  return list.map((c) => {
    const url = canHavePhoto(c) ? cardPhotoUrl(deckUid, c.word) : undefined
    return url ? { ...c, image: url } : c
  })
}

/**
 * 字卡本實際要顯示的卡。字母卡照開頭字母排，同一個字母裡維持片單上寫的順序——
 * 家長新加一個動物寫在最後面也沒關係，會自己排到對的字母去。
 */
export function cardsOf(deck: VideoItem): Card[] {
  const list = withOwnPhotos(deck.uid, deck.cards ?? [])
  if (!isAbcDeck(deck.title)) return list
  const key = (c: Card) => initialOf(c.word) || '~'
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => key(a.c).localeCompare(key(b.c)) || a.i - b.i)
    .map((x) => x.c)
}

/* ---------- 生活任務 ---------- */

/** 認識:bus */
const RE_MISSION_CARD = /^(?:認識|card)\s*[:：]\s*(.+)$/i
/** 找:3 */
const RE_MISSION_GOAL = /^(?:找|數量|goal)\s*[:：]\s*(\d+)\s*$/i
/** 動作:做（找、放、做） */
const RE_MISSION_ACT = /^(?:動作|act|action)\s*[:：]\s*(.+)$/i
const MISSION_ACTS: Record<string, MissionAct> = { 找: 'find', find: 'find', 放: 'put', put: 'put', 做: 'do', do: 'do' }
/** 找:數字（找的個數就是卡片上的數字） */
const RE_MISSION_GOAL_CARD = /^(?:找|數量|goal)s*[:：]s*(?:數字|同卡片|number)s*$/i
/** 提示:玩具車、書上的車都算 */
const RE_MISSION_TIP = /^(?:提示|家長|tip)\s*[:：]\s*(.+)$/i

/**
 * 解析「任務:」後面那一串（寫在字卡本下面）：
 *   任務: 家裡找找看，還有哪些車子？ | Find more vehicles at home! | 找:3 | 提示:玩具車、書上的車都算
 *   任務: 家裡有哪些{zh}的東西？ | Find something {en} at home! | 找:3
 *   任務: 拿出{zh}個東西，一個一個數！ | Get {en} things and count them! | 找:數字
 *   任務: 家裡有什麼東西是 {abc} 開頭的？ | Find something that starts with {abc}! | 找:3
 * 同一本字卡寫幾行「任務:」就有幾個題目，每次換一個（見 missionOf）。
 * 欄位看內容自動判斷：有中文字的是中文那句、英文句子是英文那句，「認識:」「找:」「提示:」開頭的各有用途，
 * 順序寫錯、少寫一欄（沒寫找幾個就是 3 個）都不會整個壞掉。
 *   ‧ 話裡的 {zh}、{en} 換成這一次認識的那張卡（紅色、red）；沒寫「認識:」就每次從字卡本裡換一張
 *   ‧ 「找:數字」是找的個數就是卡片上的數字（數數的任務）
 *   ‧ 「動作:做」是小朋友要做的事（找、放、做），決定按鈕寫「我找到了／我放好了／我做到了」；沒寫就是找，話裡有 {place} 的是放
 * 只寫了一種語言的話，另一種先用同一句，並提醒補上，不然中文模式會聽到英文。
 */
export function parseMission(text: string): { mission: Mission | null; issue: string } {
  let card = ''
  let zh = ''
  let en = ''
  let tip = ''
  let goal = MISSION_DEFAULT_GOAL
  let goalFromCard = false
  let act: MissionAct | undefined
  let issue = ''

  for (const field of text.split('|').map((s) => s.trim()).filter(Boolean)) {
    const c = field.match(RE_MISSION_CARD)
    if (c) { card = c[1]!.trim(); continue }
    const a = field.match(RE_MISSION_ACT)
    if (a) {
      act = MISSION_ACTS[a[1]!.trim().toLowerCase()]
      if (!act) issue = `「動作:」後面的「${a[1]!.trim()}」看不懂（要寫 找、放 或 做），這個任務先當成「找」`
      continue
    }
    if (RE_MISSION_GOAL_CARD.test(field)) { goalFromCard = true; continue }
    const g = field.match(RE_MISSION_GOAL)
    if (g) {
      goal = Number(g[1])
      if (goal < 1 || goal > MISSION_MAX) {
        issue = `任務要找幾個要寫 1～${MISSION_MAX}，這個先改成 ${MISSION_DEFAULT_GOAL}`
        goal = MISSION_DEFAULT_GOAL
      }
      continue
    }
    const t = field.match(RE_MISSION_TIP)
    if (t) { tip = t[1]!.trim(); continue }
    if (/\p{Script=Han}/u.test(field) && !zh) zh = field
    else if (/[A-Za-z]/.test(field) && !en) en = field
    else if (!tip) tip = field
  }

  if (!zh && !en) return { mission: null, issue: '任務至少要寫一句話（中文和英文各一句最好）' }
  if (!zh || !en) issue = issue || `任務要中文、英文各寫一句，只寫了${zh ? '中文' : '英文'}，另一種先用同一句`
  return { mission: { card, zh: zh || en, en: en || zh, goal, ...(goalFromCard ? { goalFromCard } : {}), ...(act ? { act } : {}), tip }, issue }
}

/** 這本字卡所有的題目：片單第一行「任務:」是主要的，後面幾行是其他題目 */
export function missionsOf(deck: VideoItem): Mission[] {
  return deck.mission ? [deck.mission, ...(deck.missionAlt ?? [])] : []
}

/**
 * 字母卡（單元名稱有 ABC）：學校只教到某個字母（家長設定的「字母教到 J」），認識的卡只從 A～那個字母裡挑。
 * 沒設定、不是字母卡、或限制之後一張都不剩，就維持原本的卡。
 */
function taughtCards(deck: VideoItem, list: Card[], maxLetter: string): Card[] {
  if (!maxLetter || !isAbcDeck(deck.title)) return list
  const limit = maxLetter.toUpperCase()
  const taught = list.filter((c) => !initialOf(c.word) || initialOf(c.word) <= limit)
  return taught.length ? taught : list
}

/**
 * 這一次用哪一個題目：一本字卡有好幾個的話，每排上首頁一次（seed 加一）換一個。
 * 卡片也是每次換一張，兩個都照 seed 轉的話，題目數整除張數時永遠是同樣的搭配（兩個題目、十張卡：偶數張卡永遠是第一個題目），
 * 所以卡片轉完一圈（第幾圈 lapNo），題目就多偏一格：第 c 張卡在第 lapNo 圈用第 (c + lapNo) 個題目，
 * 不管張數、題目數是多少，每張卡都會遇到每個題目。
 */
export function missionOf(deck: VideoItem, seed = 0, maxLetter = ''): Mission | undefined {
  const all = missionsOf(deck)
  if (all.length < 2) return all[0]
  const cards = taughtCards(deck, cardsOf(deck), maxLetter).length || 1
  const s = Math.max(0, Math.trunc(seed))
  return all[((s % cards) + Math.floor(s / cards)) % all.length]
}

/**
 * 這一次任務要認識的那張卡：片單用「認識:」固定了就是它（卡片上的字，大小寫不拘）；
 * 沒寫或找不到，就從字卡本裡依 seed 挑一張——首頁「今日任務」用排上去時的編號（見 missionSeedOf）挑，點進去認識的就是磚上看到的那張。
 * maxLetter 是學校教到哪個字母（見 taughtCards）。
 */
export function missionCardOf(deck: VideoItem, seed = 0, maxLetter = ''): Card | undefined {
  const mission = missionOf(deck, seed, maxLetter)
  const all = isPutMission(mission) ? cardsOf(deck).filter((c) => placeById(c.place)) : cardsOf(deck)
  const want = mission?.card.trim().toLowerCase()
  const fixed = want ? all.find((c) => c.word.trim().toLowerCase() === want) : undefined
  if (fixed) return fixed
  const list = taughtCards(deck, all, maxLetter)
  if (!list.length) return undefined
  return list[((Math.trunc(seed) % list.length) + list.length) % list.length]
}

/**
 * 任務的話裡有 {place}、{where}（把{zh}放在{place}）：這是「把東西放回去」的任務，
 * 只有指定了地點（放:）的卡才認得出要放哪裡，認識的卡只從那些裡面挑。
 */
export function isPutMission(mission: Mission | undefined): boolean {
  return !!mission && /\{(?:place|where)\}/.test(mission.zh + mission.en)
}

/**
 * 任務磚、貼紙上放的圖：真實的照片優先，數字卡畫出那麼多個東西，其他放 emoji；n 是 emoji 的個數（決定縮多小）。
 * 識字卡（中文字、注音）沒有適合的圖，放那個字。
 */
export function missionCover(card: Card | undefined): { src: string; text: string; n: number } {
  if (!card) return { src: '', text: '', n: 1 }
  if (isPicture(card) && !isZhCard(card)) return { src: imageSrc(card.image), text: '', n: 1 }
  const n = countOf(card)
  if (n !== null && card.image) return { src: '', text: card.image.repeat(n), n }
  return { src: '', text: card.image || card.word, n: card.image ? emojiCount(card.image) : 1 }
}

/** 這個任務小朋友要做哪一種事：片單寫了「動作:」就照寫的，沒寫的話，話裡有 {place} 是放，其他是找 */
export function missionActOf(mission: Mission | undefined): MissionAct {
  return mission?.act ?? (isPutMission(mission) ? 'put' : 'find')
}

/** 一張卡的中文、英文名字，代進任務的話裡：紅色／red、三／three（2 說「兩」，拿出兩個東西才是對的說法） */
function missionNames(card: Card): { zh: string; en: string } {
  if (isNumberCard(card)) {
    const n = Number(card.word)
    return { zh: n === 2 ? '兩' : zhNumber(n), en: enNumber(n) }
  }
  const name = speechOf(card)
  // 說明寫了好幾個說法（奶奶、外婆）：句子裡只用第一個，不然會念成「你的奶奶、外婆叫什麼名字」
  const first = (s: string) => s.split('、')[0]!.trim()
  return { zh: first(name.zh || card.word), en: name.en || card.word }
}

/** 任務那句話（中文、英文各一句），{zh}、{en} 換成這張卡的名字，{abc} 換成這張卡開頭的字母（apple → A） */
export function missionTextOf(mission: Mission, card: Card | undefined): { zh: string; en: string } {
  const blank = (s: string) => s.replace(/{(?:zh|en|place|where|abc)}/g, '')
  if (!card) return { zh: blank(mission.zh), en: blank(mission.en) }
  const names = missionNames(card)
  const place = placeById(card.place)
  const fill = (s: string) => s
    .replace(/{zh}/g, names.zh).replace(/{en}/g, names.en).replace(/{abc}/g, initialOf(card.word))
    .replace(/{place}/g, place?.zh ?? '').replace(/{where}/g, place?.where ?? '')
  return { zh: fill(mission.zh), en: fill(mission.en) }
}

/** 這一次要找幾個：「找:數字」的任務就是卡片上的數字，其他照任務寫的 */
export function missionGoalOf(mission: Mission, card: Card | undefined): number {
  if (mission.goalFromCard && card && isNumberCard(card)) {
    return Math.min(Math.max(Number(card.word), 1), MISSION_MAX)
  }
  return mission.goal
}
