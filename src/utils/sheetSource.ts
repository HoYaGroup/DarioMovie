import { parseVideoId } from './youtube'
import { parseStages } from './stage'
import { cleanAskName, parseAskKind, parseQuestionKey } from './cards'
import type { QuestionTexts } from './questions'
import { readXlsx, XlsxError, type XlsxSheet } from './xlsx'

/**
 * Google 試算表書單：整個學習庫（影片、網站、字卡）都在試算表裡，專案裡沒有任何 txt 書單。
 *
 * App 在瀏覽器裡把試算表「下載成 Excel」（docs.google.com/spreadsheets/d/<id>/export?format=xlsx，
 * 只讀、不用登入、不用 API 金鑰，回應帶 Access-Control-Allow-Origin 所以瀏覽器可以直接讀），
 * 一次拿到整本，轉成 utils/playlist.ts 看得懂的文字再解析。所以大分類、分區、單元、階段、字卡的
 * 任務／問法／放哪裡……全部照舊，在這台裝置上改的標題、字卡、看過的紀錄也都照舊。
 *
 * 試算表的樣子：**一個工作表就是一個分區**，工作表的順序就是顯示順序；沒有「目錄」，分區自己的設定寫在工作表的「分區」那一列。
 * 第一列是欄位名稱（欄的順序不拘，沒有資料的欄可以不要）：
 *   類型 | 名稱 | 大分類 | 網址 | 說明 | 圖 | 句子1 | 句子2 | 句子3 | 問句 | 階段 | 背面圖 | 影片片段 | 唸法 | 相反詞 | 放哪裡 | 聲音
 *
 * 類型（第一欄，空白的話看有沒有網址：有就是影片）：
 *   分區    這個工作表自己的設定：名稱＝小朋友看到的分區名稱（空白就用工作表名），大分類，圖＝圖示，階段＝這一整區適合哪幾班
 *   單元    名稱＝單元名稱，階段＝這個單元適合哪幾班
 *   字卡本  名稱＝字卡本的中文名，說明＝英文名稱，階段；問句＝這一本每張卡正面問的那一句（卡自己寫了就用卡的）
 *   卡      名稱＝卡片上的字，說明＝中文，圖、句子、問句……
 *   影片    名稱＝標題（可空白，會自動抓），網址，階段
 *   網站    名稱＝標題，網址，階段
 *   設定    名稱＝一行設定：任務: …、順序: 是、書頁: …、數字卡: 0～100（寫法見 README）
 *   備註    給人看的，App 不讀
 *
 * 階段寫在哪一列就管哪一層（分區、單元、字卡本、影片），底下沒寫的沿用上一層，都沒寫就每一班都顯示。
 *
 * 卡片正面問的問句，由近到遠：卡自己的「問句」欄 → 字卡本那一列的「問句」欄 → 照字卡本的名稱自動決定。
 * 「問句」欄寫的是問句的名字（東西、顏色、誰、哪裡……，或自己加的）；問句的英文和中文都寫在「問句」工作表那一列
 * （問句｜英文｜中文，一個問句一列，統一改，英文和中文不會對不起來），沒有那一列的內建問句用程式內建的。
 *
 * 舊的寫法還讀得懂：有一個叫「目錄」的工作表（大分類｜工作表｜分區｜圖示｜階段｜大分類階段，一列一個工作表，順序照列）的話，
 * 沒有「分區」那一列的工作表就用它的設定，只讀它列出來的工作表。新的試算表不用做目錄。
 * 這個檔案不碰 DOM：fetch 以外都是純函式，Node 裡也能測。
 */

/** 寫給人看的說明工作表，App 不讀 */
const GUIDE_TABS = new Set(['說明', '使用說明', 'readme'])
const isGuide = (name: string) => GUIDE_TABS.has(name.trim().toLowerCase())
/** 「問句」工作表：一個問句一列（名字｜英文｜中文），改字、新增問句都在這裡；不是分區，不會出現在小朋友的畫面 */
const QUESTION_TABS = new Set(['問句', '問句表', 'questions'])
const isQuestionTab = (name: string) => QUESTION_TABS.has(name.trim().toLowerCase())
/** 舊的寫法：分區的設定集中寫在這張表（新的寫法寫在每個工作表自己的「分區」那一列，不用這張表） */
const OLD_INDEX_TAB = '目錄'
/** 沒寫大分類時，歸到上一個工作表的大分類；第一個工作表也沒寫的話，歸到這一個 */
export const DEFAULT_SHEET_SECTION = '學習 🎓'

const MAX_TABS = 200
const MAX_ROWS = 6000
const TIMEOUT_MS = 60_000

export type SheetErrorKind = 'link' | 'unreachable' | 'empty'

export class SheetError extends Error {
  kind: SheetErrorKind

  constructor(kind: SheetErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface SheetPlaylist {
  /** 轉好的書單文字（utils/playlist.ts 的寫法） */
  text: string
  /** text 的第 n 行（從 0 算）是試算表的哪裡：「認數字」第 5 列；解析器回報第幾行時用來指回試算表 */
  origins: string[]
  /** 轉換時看不懂、略過的列 */
  warnings: string[]
  /** 讀到幾個工作表、幾筆影片和網站、幾張卡 */
  tabs: number
  items: number
  cards: number
  /** 「問句」工作表上的問句（一個問句一組英文和中文，鍵是內建的代號或自己加的名字）；沒有這個工作表就是空的 */
  questions: QuestionTexts
}

/* ---------- 連結 ---------- */

/** 貼上去的連結（或單獨一串 ID）→ 試算表 ID；看不懂回 null。「發布到網路」的連結（/d/e/…）不是這種 ID，不收 */
export function sheetIdOf(input: string): string | null {
  const s = (input || '').trim()
  if (!s) return null
  const m = s.match(/^(?:https?:\/\/)?docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/i)
  if (m) return m[1]!
  return /^[A-Za-z0-9_-]{30,80}$/.test(s) ? s : null
}

export function sheetExportUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`
}

/* ---------- 欄位 ---------- */

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

const INDEX_COLS: Record<string, string[]> = {
  tab: ['工作表', '工作表名稱', 'tab', 'sheet'],
  section: ['大分類', '分類', 'section'],
  display: ['分區', '分區名稱', '顯示名稱'],
  emoji: ['圖示', 'emoji', 'icon'],
  stage: ['階段', '班級', 'stage'],
  sectionStage: ['大分類階段'],
}

const TAB_COLS: Record<string, string[]> = {
  type: ['類型', 'type'],
  sub: ['單元', '冊', 'unit'],
  name: ['名稱', '字', '標題', 'name', 'title'],
  section: ['大分類', '分類', 'section'],
  url: ['網址', '連結', 'url', 'link'],
  meaning: ['說明', '中文', 'meaning'],
  image: ['圖', '正面圖', 'image'],
  back: ['背面圖', '背面', 'back'],
  clip: ['影片片段', '片段', 'clip'],
  say: ['唸法', '唸', 'say'],
  // 「問句」欄：選問句的名字。舊的叫「問法」，兩種都收（兩欄都有的話，寫在前面的名字優先）
  ask: ['問法', '問句', '問', 'ask'],
  // 舊的「問句中文」欄（以前每張卡自己寫整句）：已經不用了，有字的話提醒
  oldQuestionZh: ['問句中文', '中文問句', 'questionzh'],
  pair: ['相反詞', '對', 'pair'],
  place: ['放哪裡', '放', 'place'],
  sound: ['聲音', '聲', 'sound'],
  stage: ['階段', '班級', 'stage'],
}

/** 句子1、句子2、句子3……（多幾欄都可以，照欄的順序） */
const RE_SENTENCE_COL = /^(?:句子|句|sentence)\d*$/i

/** 欄位名稱 → 第幾欄（-1＝沒有）；同一個欄位有好幾個名字的話，寫在前面的名字優先 */
function colsOf(header: string[], want: Record<string, string[]>): Record<string, number> {
  const normed = header.map(norm)
  const out: Record<string, number> = {}
  for (const [key, names] of Object.entries(want)) {
    out[key] = -1
    for (const n of names) {
      const i = normed.indexOf(n)
      if (i >= 0) { out[key] = i; break }
    }
  }
  return out
}

/** 一格的字：去掉前後空白，換行、tab 換成空白（一格只能變成書單裡的一行），不然會變成別的指令 */
function oneLine(s: string | undefined): string {
  return (s ?? '').replace(/[\r\n\t]+/g, ' ').trim()
}

/** 欄位裡的字：書單用 | 隔欄，字裡的 | 換成全形 */
const field = (s: string | undefined) => oneLine(s).replace(/\|/g, '｜')

/** 名稱：不能含括號（【】《》是書單的語法） */
function nameOf(s: string | undefined): string {
  return oneLine(s).replace(/[【】《》[\]]/g, '').replace(/^#+\s*/, '').trim()
}

const isYouTube = (u: string) => /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(u)

/** 網址欄 → 書單的一行（影片或網站）；看不懂回 null */
function itemLine(url: string, title: string, want: 'video' | 'site' | ''): { line: string; kind: 'video' | 'site' } | null {
  if (/\s/.test(url)) return null
  // 標題裡的 | 解析器會原樣留著（第一個 | 以後都是標題），不用換掉
  const t = title
  const site = url.match(/^(?:site|網站)\s*[:：]\s*(\S+)$/i)
  if (site || (want === 'site' && /^https?:\/\/\S+$/i.test(url))) {
    const u = site ? site[1]! : url
    if (!/^https?:\/\//i.test(u)) return null
    return { line: t ? `site: ${u} | ${t}` : `site: ${u}`, kind: 'site' }
  }
  if (want === 'video' || isYouTube(url) || /^[A-Za-z0-9_-]{11}$/.test(url)) {
    if (!parseVideoId(url)) return null
    return { line: t ? `${url} | ${t}` : url, kind: 'video' }
  }
  if (/^https?:\/\/\S+$/i.test(url)) return { line: t ? `site: ${url} | ${t}` : `site: ${url}`, kind: 'site' }
  return null
}

type RowType = 'cat' | 'sub' | 'deck' | 'card' | 'video' | 'site' | 'setting' | 'note'

const TYPE_NAMES: Record<string, RowType> = {
  分區: 'cat', category: 'cat',
  單元: 'sub', 冊: 'sub', sub: 'sub', unit: 'sub',
  字卡本: 'deck', deck: 'deck',
  卡: 'card', 字卡: 'card', card: 'card',
  影片: 'video', video: 'video',
  網站: 'site', site: 'site',
  設定: 'setting', setting: 'setting',
  備註: 'note', 註解: 'note', note: 'note', '//': 'note',
}

/** 「設定」那一列可以寫的指令：其他的不收，免得試算表裡的字變成大分類、分區這類會改變結構的行 */
const RE_SETTING = /^(?:任務|mission|順序|排序|order|書頁|page|數字卡|numbers|階段|stage)\s*[:：]/i

/* ---------- 試算表 → 書單文字 ---------- */

/**
 * 整本試算表 → 書單文字。
 * @param sheets 每個工作表（順序就是試算表裡的順序）；隱藏的工作表不讀，家長可以用隱藏來暫停一整區
 */
export function sheetsToPlaylist(sheets: XlsxSheet[]): SheetPlaylist {
  const lines: string[] = []
  const origins: string[] = []
  const warnings: string[] = []
  let tabCount = 0
  let items = 0
  let cardCount = 0

  const push = (line: string, origin: string) => {
    lines.push(line)
    origins.push(origin)
  }

  const checkStage = (stage: string, at: string): boolean => {
    if (!stage) return false
    if (parseStages(stage)) return true
    warnings.push(`${at}：看不懂階段「${stage}」（要寫幼幼班、小班、中班、大班），已略過。`)
    return false
  }

  // 「問句」工作表：一個問句一列，第一欄是名字，英文和中文在同一列。名字是內建的（東西、顏色……、數字、識字、注音）就改那一種的字，
  // 其他的名字就是自己加的問句（英文和中文都要寫），字卡本、卡片的「問句」欄可以選它
  const questionMap = new Map<string, { en?: string; zh?: string }>()
  for (const qs of sheets.filter((x) => !x.hidden && isQuestionTab(x.name))) {
    const [qh = [], ...qrows] = qs.rows
    const normed = qh.map(norm)
    const find = (...names: string[]) => {
      for (const n of names) {
        const i = normed.indexOf(n)
        if (i >= 0) return i
      }
      return -1
    }
    // 舊的標題是 問法｜問句｜問句中文（問句＝英文）；新的是 問句｜英文｜中文
    const oldHeader = normed.includes('問法')
    const kc = oldHeader ? find('問法') : find('問句', '名稱', 'name')
    const ec = oldHeader ? find('問句', '英文', 'english', 'en') : find('英文', '英文問句', '問句英文', 'english', 'en')
    const zc = find('中文', '中文問句', '問句中文', 'zh', 'chinese')
    if (kc < 0) {
      warnings.push(`「${qs.name}」工作表的第一列要有「問句」「英文」「中文」三欄，這個工作表沒有讀。`)
      continue
    }
    qrows.forEach((r, i) => {
      const at = `「${qs.name}」第 ${i + 2} 列`
      const name = oneLine(r[kc])
      const en = ec >= 0 ? oneLine(r[ec]) : ''
      const zh = zc >= 0 ? oneLine(r[zc]) : ''
      if (!en && !zh) return   // 整列沒寫字：用程式內建的
      if (!name) {
        warnings.push(`${at}：有寫問句的字，但第一欄沒有名字，已略過。`)
        return
      }
      const builtin = parseQuestionKey(name)
      const key = builtin ?? cleanAskName(name)
      if (!key) {
        warnings.push(`${at}：問句的名字「${name.slice(0, 20)}」不能用（不能含 | 或括號，最多 30 個字），已略過。`)
        return
      }
      if (!builtin && !(en && zh)) {
        warnings.push(`${at}：「${name}」是新加的問句，英文和中文都要寫，已略過。`)
        return
      }
      if (questionMap.has(key)) warnings.push(`${at}：問句「${name}」寫了兩次，用後面這一列。`)
      questionMap.set(key, { ...(en ? { en } : {}), ...(zh ? { zh } : {}) })
    })
  }
  const questions: QuestionTexts = Object.fromEntries(questionMap)

  /** 字卡本、卡片的「問句」欄寫的名字，認不認得：內建的，或「問句」工作表有那一列 */
  const knownAsk = (name: string) => {
    if (parseAskKind(name)) return true
    const k = cleanAskName(name)
    return k !== undefined && questionMap.has(k)
  }
  const unknownAsk = (at: string, name: string) => warnings.push(
    `${at}：看不懂問句「${name.slice(0, 20)}」（要寫「問句」工作表第一欄有的名字，例如 東西、顏色、誰、哪裡……），這個設定略過，照字卡本的問句（字卡本沒寫就照它的名稱自動決定）。`,
  )

  // 舊的寫法：「目錄」工作表。有的話只讀它列出來的工作表，順序照它；沒有分區那一列的工作表用它的設定
  interface Legacy { section: string; display: string; emoji: string; stage: string; sectionStage: string }
  const legacy = new Map<string, Legacy>()
  const legacyStages = new Map<string, string>()
  let tabs = sheets.filter((x) => !x.hidden && !isGuide(x.name) && !isQuestionTab(x.name) && x.name !== OLD_INDEX_TAB)
  const indexSheet = sheets.find((x) => x.name === OLD_INDEX_TAB && !x.hidden)
  if (indexSheet) {
    const [header = [], ...rows] = indexSheet.rows
    const ic = colsOf(header, INDEX_COLS)
    if (ic.tab! < 0) {
      warnings.push(`「${OLD_INDEX_TAB}」工作表的第一列要有「工作表」這一欄，這個工作表沒有讀。`)
    } else {
      const byName = new Map(tabs.map((x) => [x.name, x]))
      const listed: XlsxSheet[] = []
      let lastSection = ''
      rows.forEach((row, i) => {
        const where = `「${OLD_INDEX_TAB}」第 ${i + 2} 列`
        const cell = (key: string) => (ic[key]! >= 0 ? oneLine(row[ic[key]!]) : '')
        const name = oneLine(row[ic.tab!])
        if (!name) return
        const sheet = byName.get(name)
        if (!sheet) {
          if (!sheets.some((x) => x.name === name && x.hidden)) warnings.push(`${where}：找不到名為「${name}」的工作表（名字要跟目錄一模一樣），已略過。`)
          return
        }
        if (listed.includes(sheet)) {
          warnings.push(`${where}：工作表「${name}」重複了，已略過。`)
          return
        }
        lastSection = (cell('section') || lastSection).replace(/^#+\s*/, '')
        legacy.set(name, { section: lastSection, display: nameOf(cell('display')), emoji: cell('emoji'), stage: cell('stage'), sectionStage: cell('sectionStage') })
        const ss = cell('sectionStage')
        if (ss && lastSection && !legacyStages.has(lastSection)) legacyStages.set(lastSection, ss)
        listed.push(sheet)
      })
      for (const x of tabs) {
        if (!listed.includes(x)) warnings.push(`工作表「${x.name}」沒有列在「${OLD_INDEX_TAB}」裡，所以沒有讀進來（不要它就隱藏起來，要它就在目錄加一列；或不用目錄，直接在那個工作表寫一列「分區」）。`)
      }
      tabs = listed
    }
  }

  let section = ''
  for (const sheet of tabs) {
    if (tabCount >= MAX_TABS) {
      warnings.push(`超過 ${MAX_TABS} 個工作表，後面的略過。`)
      break
    }
    const tabName = sheet.name
    const [header = [], ...data] = sheet.rows
    const c = colsOf(header, TAB_COLS)
    const sentenceCols = header.map((h, i) => (RE_SENTENCE_COL.test(norm(h)) ? i : -1)).filter((i) => i >= 0)
    if (c.name! < 0 && c.url! < 0) {
      warnings.push(`「${tabName}」：第一列要寫欄位名稱（至少要有「名稱」或「網址」），這個工作表沒有讀。`)
      continue
    }
    const cellOf = (r: string[], key: string) => (c[key]! >= 0 ? oneLine(r[c[key]!]) : '')
    if (c.oldQuestionZh! >= 0 && data.some((r) => oneLine(r[c.oldQuestionZh!]))) {
      warnings.push(`「${tabName}」的「問句中文」欄已經不用了，這一欄的字沒有讀：英文和中文的問句現在一起寫在「問句」工作表（一個問句一列），這裡的「問句」欄是用來選問句的名字。`)
    }
    const typeOf = (r: string[]): RowType | undefined => TYPE_NAMES[cellOf(r, 'type').toLowerCase()]

    // 這個工作表自己的設定：第一個類型是「分區」的那一列
    const catAt = data.findIndex((r) => typeOf(r) === 'cat')
    const catRow = catAt >= 0 ? data[catAt]! : undefined
    const old = legacy.get(tabName)
    const display = nameOf(catRow ? cellOf(catRow, 'name') : '') || old?.display || nameOf(tabName)
    section = ((catRow ? cellOf(catRow, 'section') : '') || old?.section || section || DEFAULT_SHEET_SECTION).replace(/^#+\s*/, '')
    const emoji = (catRow ? cellOf(catRow, 'image') : '') || old?.emoji || ''
    const catStage = (catRow ? cellOf(catRow, 'stage') : '') || old?.stage || ''
    const catWhere = `「${tabName}」${catAt >= 0 ? `第 ${catAt + 2} 列` : ''}`

    tabCount++
    if (data.length > MAX_ROWS) warnings.push(`「${tabName}」：超過 ${MAX_ROWS} 列，後面的略過。`)

    // 每個工作表都先寫一行大分類（同名的大分類解析器會併在一起，順序照第一次出現的）
    push(`# ${section}`, catWhere)
    const sectionStage = legacyStages.get(section)
    if (sectionStage && checkStage(sectionStage, catWhere)) push(`階段: ${sectionStage}`, catWhere)
    push(`【${display}】${emoji}`, catWhere)
    if (checkStage(catStage, catWhere)) push(`階段: ${catStage}`, catWhere)

    let sub = ''
    const inUnit = new Set<string>()

    data.slice(0, MAX_ROWS).forEach((r, j) => {
      const at = `「${tabName}」第 ${j + 2} 列`
      const cell = (key: string) => cellOf(r, key)
      const rawType = cell('type')
      const name = cell('name')
      const url = cell('url')

      let type: RowType | undefined
      let inferred = false
      if (rawType) {
        type = TYPE_NAMES[rawType.toLowerCase()]
        if (!type) {
          warnings.push(`${at}：看不懂類型「${rawType}」（要寫 分區、單元、字卡本、卡、影片、網站、設定 或 備註），已略過。`)
          return
        }
      } else if (url) {
        type = 'video'   // 沒寫類型、有網址：影片（不是 YouTube 的網址會當網站）
        inferred = true
      } else if (r.every((x) => !oneLine(x))) {
        return           // 整列空白
      } else {
        warnings.push(`${at}：沒寫「類型」也沒有網址，看不出這一列是什麼，已略過。`)
        return
      }
      if (type === 'note') return
      if (type === 'cat') {
        if (j !== catAt) warnings.push(`${at}：這個工作表已經有一列「分區」了（第 ${catAt + 2} 列），這一列略過。`)
        return
      }

      // 單元欄：換了單元就先開一個新的（類型是「單元」的那一列自己寫在名稱裡）
      const unitCell = type === 'sub' ? '' : nameOf(cell('sub'))
      const openSub = (unit: string) => {
        push(`《${unit}》`, at)
        sub = unit
      }
      if (unitCell && unitCell !== sub && type !== 'setting') openSub(unitCell)

      switch (type) {
        case 'sub': {
          const unit = nameOf(name)
          if (!unit) { warnings.push(`${at}：單元沒有名稱，已略過。`); return }
          openSub(unit)
          if (checkStage(cell('stage'), at)) push(`階段: ${cell('stage')}`, at)
          return
        }
        case 'deck': {
          const title = field(name).replace(/[【】《》]/g, '')
          if (!title) { warnings.push(`${at}：字卡本沒有名稱，已略過。`); return }
          const en = field(cell('meaning'))
          push(en ? `字卡本: ${title} | ${en}` : `字卡本: ${title}`, at)
          if (checkStage(cell('stage'), at)) push(`階段: ${cell('stage')}`, at)
          // 這一本每張卡預設問哪一句（卡自己的「問句」優先）
          const ask = cell('ask')
          if (ask) {
            if (knownAsk(ask)) push(`問法: ${field(ask)}`, at)
            else unknownAsk(at, ask)
          }
          return
        }
        case 'card': {
          const word = field(name)
          if (!word) { warnings.push(`${at}：這張卡沒有寫字（「名稱」欄），已略過。`); return }
          const parts = [`卡: ${word}`]
          const add = (prefix: string, v: string) => { if (v) parts.push(`${prefix}:${field(v)}`) }
          add('說明', cell('meaning'))
          add('圖', cell('image'))
          add('背面', cell('back'))
          add('片段', cell('clip'))
          for (const i of sentenceCols) add('句', oneLine(r[i]))
          add('唸', cell('say'))
          const ask = cell('ask')
          if (ask) {
            if (knownAsk(ask)) add('問', ask)
            else unknownAsk(at, ask)
          }
          add('對', cell('pair'))
          add('放', cell('place'))
          add('聲', cell('sound'))
          push(parts.join(' | '), at)
          cardCount++
          return
        }
        case 'video':
        case 'site': {
          const hit = itemLine(url, name, inferred ? '' : type)
          if (!hit) {
            warnings.push(url
              ? `${at}：看不懂網址「${url.slice(0, 40)}」（要貼 YouTube 或網站的網址），已略過。`
              : `${at}：沒有網址，已略過。`)
            return
          }
          // 同一個單元裡貼了兩次同一支影片，解析器會略過第二支，它下面的階段就會跑到別的項目上，所以這裡先擋掉
          const id = hit.kind === 'video' ? parseVideoId(url) : null
          if (id) {
            const key = `${sub}|${id}`
            if (inUnit.has(key)) {
              warnings.push(`${at}：這部影片在同一個單元裡重複了，已略過。`)
              return
            }
            inUnit.add(key)
          }
          push(hit.line, at)
          items++
          if (checkStage(cell('stage'), at)) push(`階段: ${cell('stage')}`, at)
          return
        }
        case 'setting': {
          if (!RE_SETTING.test(name)) {
            warnings.push(`${at}：「設定」那一列要寫 任務:、順序:、書頁:、數字卡: 或 階段: 開頭的一行，已略過。`)
            return
          }
          push(name, at)
          return
        }
      }
    })
  }

  if (!tabCount) throw new SheetError('empty', '試算表裡沒有可以讀的工作表。')
  return { text: lines.join('\n') + '\n', origins, warnings, tabs: tabCount, items, cards: cardCount, questions }
}

/** 解析器回報的「第 N 行」指回試算表的哪一列 */
export function locateSheetWarning(sheet: SheetPlaylist, warning: string): string {
  return warning.replace(/^第 (\d+) 行/, (m, n) => {
    const origin = sheet.origins[Number(n) - 1]
    return origin ? `試算表${origin}` : m
  })
}

/* ---------- 讀試算表 ---------- */

const UNREACHABLE = '讀不到試算表。請確認有連上網路，而且試算表的共用設定是「知道連結的人都能檢視」（也不要關掉「檢視者可以下載」）。'

export async function fetchSheetPlaylist(id: string): Promise<SheetPlaylist> {
  let res: Response
  try {
    res = await fetch(sheetExportUrl(id), {
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    })
  } catch {
    // 沒開放檢視的試算表會被導去登入頁，瀏覽器看到的就是網路錯誤，所以和斷線分不出來
    throw new SheetError('unreachable', UNREACHABLE)
  }
  if (!res.ok) throw new SheetError('unreachable', `${UNREACHABLE}（${res.status}）`)

  const bytes = new Uint8Array(await res.arrayBuffer())
  // xlsx 是 zip，開頭是 PK；要登入的試算表回的是登入頁（HTML）
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new SheetError('unreachable', UNREACHABLE)

  try {
    return sheetsToPlaylist(await readXlsx(bytes))
  } catch (err) {
    if (err instanceof XlsxError) throw new SheetError('unreachable', err.message)
    throw err
  }
}
