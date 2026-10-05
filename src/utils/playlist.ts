import {
  parseVideoId, makeVideoUid, DEFAULT_SECTION_ID, DEFAULT_SECTION_NAME,
  type Section, type Category, type SubCategory, type VideoItem, type LibraryData,
} from './youtube'
import { parseCard, numberCards, NUMBER_MAX } from './cards'

/**
 * 純文字片單的解析器。
 *
 * 設計目標：家長用任何文字編輯器（記事本、備忘錄）就能維護，
 * 不會因為少一個引號或逗號就整份壞掉。
 *
 * 三層結構，由大到小：
 *
 *   # 學習 🎓                大分類　只有一個的話小朋友端不會顯示這排
 *   【Little Kids (上)】🐰    分區　　也可以寫 ## Little Kids　或　[Little Kids]
 *   《第 1 課》               冊／單元　也可以寫 ### 第 1 課　或　-- 第 1 課
 *   https://youtu.be/xxx | 第一課    影片，| 後面的標題可以省略
 *   site: https://example.com | 每日英文   網站，會在 App 裡面開，小朋友不會跳出去
 *   卡: cat | 貓 | 🐱         字卡，同一個單元裡的卡會集成一本（寫法見 utils/cards.ts）
 *   字卡本: 數字像什麼          開一本新的字卡，不另外分一層，同一區的好幾本排在同一個畫面
 *   // 這行是註解            也可以用 ; 開頭
 *
 * 每一筆都歸到它上面最近的那一層。大分類和冊都可以省略。
 */

const RE_SECTION = [
  /^#(?!#)\s*(.+)$/,             // # 學習
  /^〖\s*(.+?)\s*〗\s*(.*)$/,     // 〖學習〗🎓
]

const RE_CATEGORY = [
  /^【\s*(.+?)\s*】\s*(.*)$/,     // 【Little Kids (上)】🐰
  /^\[\s*(.+?)\s*\]\s*(.*)$/,    // [Little Kids (上)] 🐰
  /^##(?!#)\s*(.+)$/,            // ## Little Kids (上)
]

/** 網站連結：site: 開頭，後面接網址 */
const RE_SITE = /^(?:site|網站)\s*[:：]\s*(\S+)\s*$/i

/** 字卡：卡: 開頭，也可以寫 字卡: 或 card: */
const RE_CARD = /^(?:字?卡|card)\s*[:：]\s*(.*)$/i

/**
 * 開一本新的字卡，但不另外分一層：字卡本: 數字像什麼
 * 同一個分區裡的好幾本會排在同一個畫面，點一下就打開，不用再多點一排標籤
 */
const RE_DECK = /^(?:字卡本|deck)\s*[:：]\s*(.+)$/i

/** 一次產生一串數字卡：數字卡: 0～100 */
const RE_NUMBERS = /^(?:數字卡|numbers)\s*[:：]\s*(\d+)\s*[-~～到]\s*(\d+)\s*(?:\|\s*(\S+))?\s*$/i

const RE_SUB = [
  /^《\s*(.+?)\s*》\s*$/,         // 《第 1 課》
  /^###\s*(.+)$/,                // ### 第 1 課
  /^--\s*(.+)$/,                 // -- 第 1 課
]

/** 抓出字串裡的第一個 emoji 當分區圖示 */
function pickEmoji(...parts: string[]): string {
  const re = /(\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*)/u
  for (const p of parts) {
    const m = p?.match(re)
    if (m?.[1]) return m[1]
  }
  return ''
}

/** 把 emoji 從名稱裡拿掉，剩下純文字 */
function stripEmoji(s: string): string {
  return s
    .replace(/(\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*)/gu, '')
    .trim()
}

/** 名稱轉成安全的 id，中文也能用 */
function toId(prefix: string, name: string, taken: string[]): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const seed = base || prefix
  let id = seed
  let n = 2
  while (taken.includes(id)) id = `${seed}-${n++}`
  return id
}

export interface ParseResult extends LibraryData {
  /** 解析時遇到的問題，會顯示在家長設定頁 */
  warnings: string[]
}

export function parsePlaylist(text: string): ParseResult {
  const sections: Section[] = []
  const categories: Category[] = []
  const subCategories: SubCategory[] = []
  const videos: VideoItem[] = []
  const warnings: string[] = []

  let currentSection: Section | null = null
  let currentCat: Category | null = null
  let currentSub: SubCategory | null = null
  /** 目前這個單元的字卡本；換了分區或單元就重新開一本 */
  let currentDeck: VideoItem | null = null
  /** 「字卡本: 名稱」指定的下一本字卡名稱；沒指定就用單元或分區的名字 */
  let deckTitle: string | null = null
  const takenUids = new Set<string>()

  /** 檔案沒寫大分類時，所有分區都歸到一個隱形的預設分類 */
  function ensureSection(): Section {
    if (currentSection) return currentSection
    const fallback: Section = {
      id: DEFAULT_SECTION_ID,
      name: DEFAULT_SECTION_NAME,
      emoji: '📚',
    }
    sections.push(fallback)
    currentSection = fallback
    return fallback
  }

  const lines = text.split(/\r?\n/)

  lines.forEach((raw, index) => {
    const line = raw.trim()
    const lineNo = index + 1

    if (!line) return
    if (line.startsWith('//') || line.startsWith(';')) return

    // ---- 大分類 ----
    for (const re of RE_SECTION) {
      const m = line.match(re)
      if (m) {
        const rest = m[2] ?? ''
        const emoji = pickEmoji(m[1]!, rest) || '📚'
        const name = stripEmoji(m[1]!) || m[1]!.trim()

        const existing = sections.find((x) => x.name === name)
        if (existing) {
          currentSection = existing
        } else {
          currentSection = { id: toId('sec', name, sections.map((x) => x.id)), name, emoji }
          sections.push(currentSection)
        }
        currentCat = null
        currentSub = null
        currentDeck = null
        deckTitle = null
        return
      }
    }

    // ---- 分區 ----
    for (const re of RE_CATEGORY) {
      const m = line.match(re)
      if (m) {
        const rest = m[2] ?? ''
        const emoji = pickEmoji(m[1]!, rest) || '📁'
        const name = stripEmoji(m[1]!) || m[1]!.trim()

        const section = ensureSection()
        const existing = categories.find((c) => c.name === name && c.sectionId === section.id)
        if (existing) {
          currentCat = existing
        } else {
          currentCat = {
            id: toId('cat', name, categories.map((c) => c.id)),
            sectionId: section.id,
            name,
            emoji,
          }
          categories.push(currentCat)
        }
        currentSub = null
        currentDeck = null
        deckTitle = null
        return
      }
    }

    // ---- 冊／單元 ----
    for (const re of RE_SUB) {
      const m = line.match(re)
      if (m) {
        if (!currentCat) {
          warnings.push(`第 ${lineNo} 行：「${m[1]}」上面還沒有分區，已略過。`)
          return
        }
        const name = m[1]!.trim()
        const existing = subCategories.find((s) => s.categoryId === currentCat!.id && s.name === name)
        if (existing) {
          currentSub = existing
        } else {
          currentSub = {
            id: toId('sub', name, subCategories.map((s) => s.id)),
            categoryId: currentCat.id,
            name,
          }
          subCategories.push(currentSub)
        }
        currentDeck = null
        deckTitle = null
        return
      }
    }

    // ---- 字卡 ----
    /** 同一個單元的卡集成一本，出現在第一張卡的位置 */
    const deckHere = (cat: Category): VideoItem => {
      if (!currentDeck) {
        currentDeck = {
          kind: 'deck',
          uid: makeVideoUid(`deck:${cat.id}:${currentSub?.id ?? ''}:${deckTitle ?? ''}`, takenUids),
          id: '',
          title: deckTitle ?? currentSub?.name ?? cat.name,
          categoryId: cat.id,
          subId: currentSub?.id ?? null,
          cards: [],
        }
        videos.push(currentDeck)
      }
      return currentDeck
    }

    {
      const m = line.match(RE_DECK)
      if (m) {
        if (!currentCat) {
          warnings.push(`第 ${lineNo} 行：這本字卡上面還沒有分區，已略過。`)
          return
        }
        // 接下來的卡放進一本新的字卡
        deckTitle = stripEmoji(m[1]!) || m[1]!.trim()
        currentDeck = null
        return
      }
    }

    {
      const m = line.match(RE_CARD)
      if (m) {
        if (!currentCat) {
          warnings.push(`第 ${lineNo} 行：這張字卡上面還沒有分區，已略過。`)
          return
        }
        const { card, issue } = parseCard(m[1]!)
        if (issue) warnings.push(`第 ${lineNo} 行：${issue}。`)
        if (!card) return
        deckHere(currentCat).cards!.push(card)
        return
      }
    }

    // ---- 一串數字卡 ----
    {
      const m = line.match(RE_NUMBERS)
      if (m) {
        if (!currentCat) {
          warnings.push(`第 ${lineNo} 行：這串數字卡上面還沒有分區，已略過。`)
          return
        }
        const from = Number(m[1])
        const to = Number(m[2])
        if (from > to || to > NUMBER_MAX) {
          warnings.push(`第 ${lineNo} 行：數字卡的範圍要從小寫到大、最多到 ${NUMBER_MAX}，已略過。`)
          return
        }
        // 以前後面要寫「| 中文」或「| 英文」，現在每張卡中英文都唸，寫了也不影響
        deckHere(currentCat).cards!.push(...numberCards(from, to))
        return
      }
    }

    // ---- 網站連結 ----
    {
      const [head, ...rest] = line.split('|')
      const m = head!.trim().match(RE_SITE)
      if (m) {
        if (!currentCat) {
          warnings.push(`第 ${lineNo} 行：這個網站上面還沒有分區，已略過。`)
          return
        }
        const url = m[1]!
        videos.push({
          kind: 'site',
          url,
          uid: makeVideoUid(`site-${videos.length}`, takenUids),
          id: '',
          title: rest.join('|').trim() || url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
          categoryId: currentCat.id,
          subId: currentSub?.id ?? null,
        })
        return
      }
    }

    // ---- 影片 ----
    const [urlPart, ...titleParts] = line.split('|')
    const id = parseVideoId(urlPart!.trim())

    if (!id) {
      warnings.push(`第 ${lineNo} 行看不懂，已略過：${line.slice(0, 40)}`)
      return
    }
    if (!currentCat) {
      warnings.push(`第 ${lineNo} 行：這部影片上面還沒有分區，已略過。`)
      return
    }
    // 同一支影片可以出現在不同單元（教材常這樣編），
    // 但同一個單元裡貼兩次就是手誤了
    const dupInSameGroup = videos.some(
      (v) => v.id === id
        && v.categoryId === currentCat!.id
        && v.subId === (currentSub?.id ?? null),
    )
    if (dupInSameGroup) {
      warnings.push(`第 ${lineNo} 行：這部影片在同一個單元裡重複了，已略過。`)
      return
    }

    videos.push({
      uid: makeVideoUid(id, takenUids),
      id,
      title: titleParts.join('|').trim(),
      categoryId: currentCat.id,
      subId: currentSub?.id ?? null,
    })
  })

  return { sections, categories, subCategories, videos, warnings }
}

/**
 * 內容的指紋。
 * 家長改過片單檔案，指紋就會變，各台 iPad 下次開啟就知道該更新了 ——
 * 不必自己記得去改版本號。
 */
export function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}
