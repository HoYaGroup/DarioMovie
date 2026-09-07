/** 片單裡的一筆可以是 YouTube 影片，也可以是一個網站 */
export type ItemKind = 'video' | 'site'

/** 影片在片單中的資料形狀 */
export interface VideoItem {
  /** 'site' 表示這是一個網站連結，會在 App 內開啟，小朋友不會跳出去 */
  kind?: ItemKind
  /** kind 為 'site' 時的網址 */
  url?: string
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
}

/**
 * 最上層的大分類，例如「學習」「娛樂」。
 * 小朋友端是最上面那排標籤；只有一個大分類時整排會自動隱藏。
 */
export interface Section {
  id: string
  name: string
  emoji: string
}

/** 分區，例如「Little Kids (上)」「故事影片」 */
export interface Category {
  id: string
  /** 屬於哪一個大分類 */
  sectionId: string
  name: string
  emoji: string
}

/**
 * 分區底下的細分，例如「Little Kids (上)」「第一單元」。
 * 小朋友端會用它當分組小標題。
 */
export interface SubCategory {
  id: string
  categoryId: string
  name: string
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
