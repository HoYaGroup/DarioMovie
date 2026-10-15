import type { StageId } from './stage'

/** 片單裡的一筆可以是 YouTube 影片、一個網站，或是一本字卡 */
export type ItemKind = 'video' | 'site' | 'deck'

/** 影片裡教某個字的那一段 */
export interface CardClip {
  /** YouTube 影片 ID */
  id: string
  /** 從第幾秒開始播 */
  start: number
  /** 播到第幾秒停；0 表示一路播到影片結束 */
  end: number
}

/** 字卡本裡的一張卡 */
export interface Card {
  /** 卡片上最大的那個字，例如「3」「cat」 */
  word: string
  /** 補充說明，例如「貓」「一支鉛筆 one pencil」，可以空白 */
  meaning: string
  /**
   * 翻面時接著唸的簡單英文句子，例如「Yum, delicious apple!」，可以沒有。
   * 寫好幾句的話每次翻到這張卡就輪到下一句，同一張卡才不會每天都聽到同一句。
   */
  sentences: string[]
  /** emoji，或圖片網址／public 底下的相對路徑，可以空白 */
  image: string
  /** 翻到背面時換成這張圖（例如正面遮住數字、背面是完整的卡），可以空白 */
  backImage: string
  /** 老師在影片裡教這個字的那一段，沒有就是 null */
  clip: CardClip | null
  /**
   * 語音要怎麼唸這個字，可以沒有（沒有就唸卡片上的字）。
   * 注音符號單獨一個字，語音引擎不一定唸得準，所以 ㄅ 寫成「唸:玻」，唸出來就是「ㄅㄛ」。
   */
  say?: string
  /**
   * 這張卡自己的正面問句（片單寫「問:東西」，試算表是這張卡的「問句」欄）：問句的名字，英文和中文都在「問句」工作表那一列。
   * 是內建的 19 種（AskKind 的代號），或「問句」工作表自己加的名字。沒寫就照字卡本的；
   * 同一本裡有幾張不適用那個問句（天氣裡的雪人、雨傘）時，用它改成別的。
   */
  ask?: string
  /** 相反詞的另一半（片單寫「對:small」）：正面問「Is it big or small?」 */
  pair?: string
  /** 這樣東西屬於家裡哪裡（片單寫「放:廚房」，存地點代號 kitchen，見 utils/places.ts）：有幾張這樣的卡，字卡本就多一個「放哪裡」遊戲 */
  place?: string
  /** 這個東西真正的聲音（片單寫「聲:cards/sounds/cow.wav」）：動物的叫聲。有幾張這樣的卡，字卡本就多一個「聽聲音」遊戲，翻面和卡片上也有叫聲鈕 */
  sound?: string
}

/**
 * 卡片正面問什麼，要問得跟答案對得上：顏色的答案是 red，問「What is this?」只問到一半，
 * 要問「What color is this?」（問句寫在 utils/cards.ts 的 FRONT_QUESTIONS）。
 */
export type AskKind =
  | 'thing' | 'color' | 'shape' | 'feeling' | 'action' | 'should' | 'say' | 'quote' | 'like'
  | 'who' | 'where' | 'weather' | 'season' | 'day' | 'month' | 'time' | 'daypart' | 'sense' | 'sound'

/**
 * 正面問的話不在上面那幾種問法裡、固定的三種卡：數字卡（What number is this?）、識字卡（這個字怎麼唸？）、注音卡（這個注音怎麼唸？）。
 * 試算表的「問句」工作表也能改它們（第一欄寫 數字、識字、注音）。
 */
export type SpecialAsk = 'number' | 'zhChar' | 'bopomofo'
export type QuestionKey = AskKind | SpecialAsk

/**
 * 生活任務：字卡本最後的「走出螢幕」——認識一個東西，再到家裡找找看。
 * 片單寫成一行（寫在字卡本下面）：
 *   任務: 家裡找找看，還有哪些車子？ | Find more vehicles at home! | 找:3 | 提示:玩具車、書上的車都算
 *   任務: 家裡有哪些{zh}的東西？ | Find something {en} at home! | 找:3
 * 話裡的 {zh}、{en} 會換成這一次認識的那張卡（紅色、red），所以顏色、形狀這種一本好幾張的，一行任務就夠。
 */
export interface Mission {
  /** 固定先認識的那張卡（卡片上的字，例如 bus）；沒寫或找不到，每次從字卡本裡換一張 */
  card: string
  /** 任務的那句話，中文：「家裡找找看，還有哪些車子？」，可以有 {zh} */
  zh: string
  /** 任務的那句話，英文：「Find more vehicles at home!」，可以有 {en} */
  en: string
  /** 要找幾個，每找到一個按一次；預設 3 */
  goal: number
  /** 找的個數就是卡片上的數字（認識「3」就找三個），數數的任務用；卡片不是數字時照 goal */
  goalFromCard?: boolean
  /** 小朋友要做的是哪一種事：find 找（預設）、put 放、do 做（刷牙、看時鐘這類）。決定按鈕寫「我找到了／我放好了／我做到了」 */
  act?: MissionAct
  /** 給家長看的一行提示：哪些東西算、怎麼陪孩子玩，可以空白 */
  tip: string
}

/** 任務要小朋友做哪一種事：找東西、把東西放回去、做一件事 */
export type MissionAct = 'find' | 'put' | 'do'

/** 一個任務最多找幾個：再多就不是三分鐘的事了（數 10 個是數數的任務才會用到） */
export const MISSION_MAX = 10
export const MISSION_DEFAULT_GOAL = 3

/** 影片在片單中的資料形狀 */
export interface VideoItem {
  /**
   * 'site' 表示這是一個網站連結，會在 App 內開啟，小朋友不會跳出去；
   * 'deck' 表示這是一本字卡，卡片內容在 cards 裡
   */
  kind?: ItemKind
  /** kind 為 'site' 時的網址 */
  url?: string
  /** kind 為 'deck' 時的卡片，順序就是 playlist.txt 裡寫的順序 */
  cards?: Card[]
  /** 字卡本的英文名稱（字卡本: 數字像什麼 1～10 | Number Shapes），全英文模式顯示這個 */
  titleEn?: string
  /**
   * 這本字卡是照家裡哪一本書的哪一頁做的：那一頁的照片（片單寫「書頁: cards/books/animals/pets.webp」）。
   * 清單上用它當封面，打開時先秀出整頁，小朋友把手上的書翻到同一頁，再邊看書邊翻卡
   */
  page?: string
  /** 這本字卡的生活任務（片單寫「任務:」）：多一個「任務」模式，認識一個東西再到家裡找；沒有就是沒有 */
  mission?: Mission
  /**
   * 同一本字卡的其他題目（片單的字卡本下面多寫幾行「任務:」，第一行是 mission，後面的放這裡）。
   * 同一個任務每次排上首頁換一個題目，不會每次都是同一句話；見 cards.ts 的 missionOf
   */
  missionAlt?: Mission[]
  /** 這本字卡的卡片本身就是依順序排的（片單寫「順序:」：洗手步驟、一天作息、星期、月份）：多一個「排順序」遊戲 */
  order?: boolean
  /**
   * 這本字卡每張卡正面預設問哪一句（片單寫「問法: 顏色」，試算表是「字卡本」那一列的「問句」欄）：問句的名字，見 Card.ask。
   * 沒寫就看字卡本的名稱（utils/cards.ts 的 askKindOf）；每張卡自己的 ask 優先。
   */
  ask?: string
  /**
   * 字卡本以前的識別碼（用分區 id 組成，會跟著分區順序變）。
   * 以前拿到的星星記在這上面，同步片單時由 useCardStars 搬到現在的 uid
   */
  legacyUid?: string
  /**
   * 這一筆在片單裡的唯一識別。
   * 用 id 當識別的話，同一支影片就沒辦法同時出現在好幾個單元 ——
   * 但學校教材常常這樣編（例如節慶影片每學期重複用）。
   */
  uid: string
  /** YouTube 影片 ID，會重複 */
  id: string
  title: string
  /** 屬於哪一個分區（對應 Category.id） */
  categoryId: string
  /**
   * 屬於分區底下哪一個子分區（對應 SubCategory.id）。
   * null 表示不歸任何子分區，會排在該分區最前面、不帶小標題。
   */
  subId: string | null
  /**
   * 適合哪幾班（0 幼幼班、1 小班、2 中班、3 大班），片單裡用「階段: 小班～中班」指定。
   * 孩子的年紀設定好之後，小朋友端只顯示適合他這一班的（和家長另外開放的）。
   * 沒寫就沿用單元、分區、大分類的；全都沒寫就是不分年齡，一直顯示。
   */
  stages?: StageId[]
}

/**
 * 最上層的大分類，例如「數字」「英文單字」。
 * 學習首頁是一排大圖示、點進去才看分區；影片時間有好幾個大分類時是最上面那排標籤。
 * 只有一個大分類時這一層會自動隱藏。影片、網站和字卡本是依類型分到不同畫面（見 useShelf.ts），不靠大分類。
 */
export interface Section {
  id: string
  name: string
  emoji: string
  /** 適合哪幾班；沒寫就是不分年齡（見 VideoItem.stages） */
  stages?: StageId[]
}

/** 分區，例如「第一冊」「故事影片」 */
export interface Category {
  id: string
  /** 屬於哪一個大分類 */
  sectionId: string
  name: string
  emoji: string
  /** 適合哪幾班；沒寫就沿用大分類的 */
  stages?: StageId[]
}

/**
 * 分區底下的細分，例如「第一冊」「第一單元」。
 * 小朋友端會用它當分組小標題。
 */
export interface SubCategory {
  id: string
  categoryId: string
  name: string
  /** 適合哪幾班；沒寫就沿用分區的 */
  stages?: StageId[]
}

/** 存進 localStorage 的整包資料 */
export interface LibraryData {
  sections: Section[]
  categories: Category[]
  subCategories: SubCategory[]
  videos: VideoItem[]
}

/** 沒有指定大分類時用的預設值，這種情況小朋友端不會顯示大分類那排 */
export const DEFAULT_SECTION_ID = 'all'
export const DEFAULT_SECTION_NAME = '全部'

/**
 * 分區的配色，依分區順序取用。
 * 新增分區時會自動接著往下拿，不必手動指定顏色。
 *
 * 深色那組跑過色弱模擬驗證：相鄰兩色的最小色差 ΔE 9.1（deutan）、
 * 一般視覺 15.7，對比度全部高於 3:1。
 * 淺色那組是同色相的深色版，當文字與壓深墨字都符合大文字的 3:1 門檻。
 * 要換色的話請維持這個底線，並且記得分區身份同時靠 emoji 與名稱表達，
 * 不是只靠顏色。
 */
export const CATEGORY_COLORS = {
  /* 深色底：用亮的一端 */
  dark: ['#5ec8f8', '#a78bfa', '#4ddba0', '#ff7b5a', '#f9a8d4', '#ff4d4d'],
  /*
    淺色底：同樣的色相往深處調，直到三種用法都過關 ——
    當文字、壓在卡片上、以及當底色配深墨字。
    標籤是 19px 粗體，屬於 WCAG 的大文字，門檻是 3:1。
  */
  light: ['#0094d7', '#9773ff', '#179f67', '#ff4d20', '#fd3ba4', '#b91c1c'],
} as const

export function categoryColor(index: number, theme: 'dark' | 'light' = 'dark'): string {
  const palette = CATEGORY_COLORS[theme]
  return palette[index % palette.length]!
}

/** 從分區名稱生出一個安全的 id（中文名稱也能用） */
export function makeCategoryId(name: string, taken: string[]): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const seed = base || 'cat'
  let id = seed
  let n = 2
  while (taken.includes(id)) id = `${seed}-${n++}`
  return id
}

/**
 * 從各種 YouTube 網址格式抽出 11 碼影片 ID。
 * 直接給 ID 也接受，方便家長隨手貼。
 */
export function parseVideoId(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s

  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,       // watch?v=
    /youtu\.be\/([A-Za-z0-9_-]{11})/,  // 短網址
    /\/embed\/([A-Za-z0-9_-]{11})/,    // embed
    /\/shorts\/([A-Za-z0-9_-]{11})/,   // Shorts
    /\/live\/([A-Za-z0-9_-]{11})/,     // 直播存檔
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/** 產生一筆影片的唯一識別：同一支影片的第幾次出現 */
export function makeVideoUid(videoId: string, taken: Set<string>): string {
  let n = 1
  let uid = `${videoId}~${n}`
  while (taken.has(uid)) uid = `${videoId}~${++n}`
  taken.add(uid)
  return uid
}

/** 影片縮圖，公開網址不需要 API 金鑰 */
export function thumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/**
 * 用 YouTube 公開的 oEmbed 端點取得片名。
 * 這支 API 不需要金鑰、也支援跨網域，抓不到就回 null 讓呼叫端自己決定。
 */
export async function fetchVideoTitle(id: string): Promise<string | null> {
  try {
    const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${target}`)
    if (!res.ok) return null
    const data = await res.json() as { title?: string }
    return data.title?.trim() || null
  } catch {
    return null
  }
}

/** 秒數轉 0:00 / 1:02:03 */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}
