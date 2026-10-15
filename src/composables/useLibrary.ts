import {
  parseVideoId, fetchVideoTitle, makeCategoryId, makeVideoUid,
  DEFAULT_SECTION_ID, DEFAULT_SECTION_NAME,
  MISSION_MAX,
  type VideoItem, type Section, type Category, type SubCategory, type LibraryData, type Card, type Mission,
} from '~/utils/youtube'
import { computed } from 'vue'
import { parsePlaylist, hashText } from '~/utils/playlist'
import { isEmojiOnly, isImageRef, missionsOf } from '~/utils/cards'
import type { StageId } from '~/utils/stage'
import { useState } from './useState'
import { useCardStars } from './useCardStars'
import { useSheetSource } from './useSheetSource'
import { locateSheetWarning } from '~/utils/sheetSource'
import { setQuestionTexts } from '~/utils/questions'
import appConfig from '../app.config'

const STORE_KEY = 'kidtube.library.v2'
const LEGACY_KEY = 'kidtube.videos'   // 還沒有分區時的舊格式
const TITLE_KEY = 'kidtube.appTitle'
const SYNC_KEY = 'kidtube.playlistHash'
const EDITS_KEY = 'kidtube.localEdits'

const HISTORY_KEY = 'kidtube.history'
const HISTORY_LIMIT = 15   // 最多留幾步，免得 localStorage 一直長大
const SYNC_LABEL = '從試算表同步'

/** 在這台裝置上改了、同步試算表之後還要留著的地方 */
type EditField = 'title' | 'id' | 'url' | 'cards' | 'stages' | 'missions'
const EDIT_FIELDS: EditField[] = ['title', 'id', 'url', 'cards', 'stages', 'missions']

export interface EditValues {
  title?: string
  /** 影片：YouTube 影片 ID */
  id?: string
  /** 網站：網址 */
  url?: string
  cards?: Card[]
  /** 空的表示沒有自己的設定（不分年齡，或沿用單元、分區的） */
  stages?: StageId[]
  /** 字卡本的任務題目（第一個是主要的）；空的表示這本字卡沒有任務，不會排進今日任務 */
  missions?: Mission[]
}

/**
 * 在這台裝置上改過的一筆（用 uid 對應）。
 * 試算表更新時整份片單會換成檔案的，這些地方要再套回去，家長改的字卡、網址才不會被蓋掉
 */
export interface LocalEdit extends EditValues {
  /** 試算表裡的樣子（每次同步都換成檔案最新的），「還原成試算表的內容」用 */
  file: EditValues
  /** 試算表後來也改了同一個地方：現在用的是這台裝置的版本，要讓家長知道 */
  fileChanged?: boolean
}

export type LocalEdits = Record<string, LocalEdit>

/** 片單加上這台裝置改過的地方；復原時兩個要一起退回去 */
interface LibraryState extends LibraryData {
  edits: LocalEdits
}

/**
 * 復原一步要用的東西：只存修改前後不一樣的部分。
 * 整份片單有幾十萬字（字卡很多），以前每一步都存一份完整的，
 * localStorage 存不到十幾步就滿了，所以只存有變的地方
 */
interface HistoryPatch {
  sections?: Section[]
  categories?: Category[]
  subCategories?: SubCategory[]
  /** 修改前的順序（uid）；順序沒變就不存 */
  order?: string[]
  /** 修改後變了或不見的那幾筆，修改前的樣子 */
  items?: Record<string, VideoItem>
  /** localEdits 裡變了的那幾筆，修改前的樣子；null 表示修改前還沒改過這一筆 */
  edits?: Record<string, LocalEdit | null>
}

export interface HistoryEntry {
  patch: HistoryPatch
  /** 這一步做了什麼，顯示在復原鈕上 */
  label: string
  at: number
  /** 這一步改的東西同步試算表之後也會留著（標題、網址、字卡、班級） */
  kept?: boolean
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x))

function diffState(before: LibraryState, after: LibraryState): HistoryPatch {
  const patch: HistoryPatch = {}
  if (!same(before.sections, after.sections)) patch.sections = before.sections
  if (!same(before.categories, after.categories)) patch.categories = before.categories
  if (!same(before.subCategories, after.subCategories)) patch.subCategories = before.subCategories

  const edits: Record<string, LocalEdit | null> = {}
  for (const uid of new Set([...Object.keys(before.edits), ...Object.keys(after.edits)])) {
    if (!same(before.edits[uid], after.edits[uid])) edits[uid] = before.edits[uid] ?? null
  }
  if (Object.keys(edits).length) patch.edits = edits

  const order = before.videos.map((v) => v.uid)
  if (!same(order, after.videos.map((v) => v.uid))) patch.order = order

  const now = new Map(after.videos.map((v) => [v.uid, v]))
  const items: Record<string, VideoItem> = {}
  for (const v of before.videos) {
    const hit = now.get(v.uid)
    if (!hit || !same(v, hit)) items[v.uid] = v
  }
  if (Object.keys(items).length) patch.items = items
  return patch
}

function applyPatch(state: LibraryState, patch: HistoryPatch): LibraryState {
  const now = new Map(state.videos.map((v) => [v.uid, v]))
  const order = patch.order ?? state.videos.map((v) => v.uid)
  const edits = { ...state.edits }
  for (const [uid, e] of Object.entries(patch.edits ?? {})) {
    if (e) edits[uid] = e
    else delete edits[uid]
  }
  return {
    sections: patch.sections ?? state.sections,
    categories: patch.categories ?? state.categories,
    subCategories: patch.subCategories ?? state.subCategories,
    videos: order
      .map((uid) => patch.items?.[uid] ?? now.get(uid))
      .filter((v): v is VideoItem => Boolean(v)),
    edits,
  }
}

/** 舊版的復原紀錄每一步都存整份片單，讀進來換成只存差異的 */
function upgradeHistory(list: unknown[], current: LibraryState): HistoryEntry[] {
  type Raw = Partial<HistoryEntry> & { data?: LibraryData }
  const raw = list as Raw[]
  if (!raw.some((e) => e?.data)) return raw.filter((e): e is HistoryEntry => Boolean(e?.patch))

  const out: HistoryEntry[] = []
  let after = current
  for (let i = raw.length - 1; i >= 0; i--) {
    const e = raw[i]!
    const before = Array.isArray(e.data?.videos)
      ? { ...e.data!, edits: {} }
      : e.patch ? applyPatch(after, e.patch) : null
    if (!before) break
    out.unshift({ patch: diffState(before, after), label: e.label ?? '', at: e.at ?? 0 })
    after = before
  }
  return out
}

function readField(v: VideoItem, f: EditField): EditValues[EditField] {
  if (f === 'stages') return v.stages ?? []
  if (f === 'cards') return v.cards ?? []
  if (f === 'missions') return missionsOf(v)
  return v[f] ?? ''
}

function writeField(v: VideoItem, f: EditField, value: EditValues[EditField]) {
  if (f === 'stages') {
    const stages = (value as StageId[] | undefined) ?? []
    if (stages.length) v.stages = [...stages]
    else delete v.stages
  } else if (f === 'cards') {
    v.cards = copy((value as Card[] | undefined) ?? [])
  } else if (f === 'missions') {
    // 第一個是主要的題目，其他放 missionAlt；一個都沒有就是沒有任務
    const [first, ...rest] = copy((value as Mission[] | undefined) ?? [])
    if (first) v.mission = first
    else delete v.mission
    if (rest.length) v.missionAlt = rest
    else delete v.missionAlt
  } else {
    v[f] = (value as string | undefined) ?? ''
  }
}

/**
 * 試算表剛讀進來（list 是檔案的內容），把這台裝置改過的地方套回去。
 * 檔案已經改成一樣的就不用再記；檔案裡找不到的（改了名字或刪掉了）就捨棄
 */
function applyLocalEdits(list: VideoItem[], edits: LocalEdits): { edits: LocalEdits; kept: number; dropped: number } {
  const byUid = new Map(list.map((v) => [v.uid, v]))
  const next: LocalEdits = {}
  let kept = 0
  let dropped = 0

  for (const [uid, prev] of Object.entries(edits)) {
    const v = byUid.get(uid)
    if (!v) {
      dropped++
      continue
    }
    const e: LocalEdit = { ...prev, file: { ...prev.file } }
    for (const f of EDIT_FIELDS) {
      if (!(f in prev)) continue
      const inFile = readField(v, f)
      if (same(inFile, prev[f])) {
        delete e[f]
        delete e.file[f]
        continue
      }
      if (!same(inFile, prev.file[f])) {
        e.fileChanged = true
        e.file = { ...e.file, [f]: copy(inFile) }
      }
      writeField(v, f, prev[f])
    }
    if (EDIT_FIELDS.some((f) => f in e)) {
      next[uid] = e
      kept++
    }
  }
  return { edits: next, kept, dropped }
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'updated' | 'same' | 'missing' | 'offline' | 'error'
  message: string
  warnings: string[]
  /** 這次同步蓋掉了幾個在這台裝置上做的修改（拖到班級、改名、搬移…） */
  discarded?: number
}

/**
 * 分區、子分區與片單管理。
 *
 * 三層結構：分區（學校教學）→ 子分區（第一冊）→ 影片。
 * 子分區是選用的，影片的 subId 為 null 就直接掛在分區下。
 *
 * 兩層來源：
 *   1. app/app.config.ts —— 家長在電腦上維護、跟著版本控管走的預設內容
 *   2. localStorage      —— iPad 上臨時增減的結果，會蓋過預設內容
 * 「還原預設」可以隨時退回第 1 層。
 */
export function useLibrary() {
  const sections = useState<Section[]>('library.sections', () => [])
  const categories = useState<Category[]>('library.categories', () => [])
  const subCategories = useState<SubCategory[]>('library.subCategories', () => [])
  const videos = useState<VideoItem[]>('library.videos', () => [])
  const appTitle = useState<string>('library.appTitle', () => appConfig.appTitle)
  const isReady = useState<boolean>('library.ready', () => false)
  const syncStatus = useState<SyncStatus>('library.sync', () => ({
    state: 'idle', message: '', warnings: [],
  }))
  const history = useState<HistoryEntry[]>('library.history', () => [])
  /** 在這台裝置上改過的地方，同步試算表之後會再套回去 */
  const localEdits = useState<LocalEdits>('library.localEdits', () => ({}))
  /** 目前已經存檔的內容，下一次修改時它就是「修改前」的樣子 */
  const snapshot = useState<LibraryState | null>('library.snapshot', () => null)

  /* ---------- 讀寫 ---------- */

  function defaultData(): LibraryData {
    const secs: Section[] = [{
      id: DEFAULT_SECTION_ID,
      name: DEFAULT_SECTION_NAME,
      emoji: '📚',
    }]
    const cats: Category[] = (appConfig.categories || []).map((c) => ({
      id: c.id,
      sectionId: DEFAULT_SECTION_ID,
      name: c.name,
      emoji: c.emoji || '📁',
    }))
    const fallback = cats[0]?.id || 'other'

    const subs: SubCategory[] = (appConfig.subCategories || [])
      .filter((s) => cats.some((c) => c.id === s.category))
      .map((s) => ({ id: s.id, categoryId: s.category, name: s.name }))

    const taken = new Set<string>()
    const vids: VideoItem[] = (appConfig.videos || [])
      .map((v) => {
        // 設定檔寫錯分區時，退到第一區而不是整筆消失
        const categoryId = cats.some((c) => c.id === v.category) ? v.category! : fallback
        const sub = subs.find((s) => s.id === v.sub && s.categoryId === categoryId)
        const id = parseVideoId(v.url) || ''
        return {
          uid: id ? makeVideoUid(id, taken) : '',
          id,
          title: v.title?.trim() || '',
          categoryId,
          subId: sub?.id ?? null,
        }
      })
      .filter((v): v is VideoItem => Boolean(v.id))

    return { sections: secs, categories: cats, subCategories: subs, videos: vids }
  }

  function currentData(): LibraryData {
    return {
      sections: sections.value,
      categories: categories.value,
      subCategories: subCategories.value,
      videos: videos.value,
    }
  }

  function currentState(): LibraryState {
    return { ...currentData(), edits: localEdits.value }
  }

  function setState(s: LibraryState) {
    sections.value = s.sections
    categories.value = s.categories
    subCategories.value = s.subCategories
    videos.value = s.videos
    localEdits.value = s.edits
  }

  /** 復原紀錄寫不下就從最舊的開始丟，留得下幾步算幾步（這次開著的期間還是可以退 15 步） */
  function persistHistory() {
    for (let keep = history.value.length; keep >= 0; keep--) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value.slice(history.value.length - keep)))
        return
      } catch { /* 空間不夠，少存一步再試 */ }
    }
  }

  /**
   * 寫進 localStorage。片單本身最重要，先寫；
   * 空間不夠的話先清掉復原紀錄再試一次，不然家長改的東西重新打開就不見了
   */
  function save(withHistory: boolean) {
    const data = JSON.stringify(currentData())
    try {
      localStorage.setItem(STORE_KEY, data)
    } catch {
      try {
        localStorage.removeItem(HISTORY_KEY)
        localStorage.setItem(STORE_KEY, data)
        withHistory = true
      } catch { /* 無痕模式寫不進去，讓它靜靜失敗就好 */ }
    }
    try { localStorage.setItem(EDITS_KEY, JSON.stringify(localEdits.value)) } catch { /* 同上 */ }
    if (withHistory) persistHistory()
  }

  /**
   * 存檔。
   *
   * @param label 這一步做了什麼。有給就會把「修改前」的樣子存進歷史，
   *              家長按復原時可以退回去。內部整理（例如補標題）不必給。
   * @param kept  這一步改的東西同步試算表之後也會留著（記在 localEdits 裡的）
   */
  function persist(label = '', kept = false) {
    const state = currentState()
    if (label && snapshot.value) {
      history.value = [
        ...history.value,
        { patch: diffState(snapshot.value, state), label, at: Date.now(), ...(kept ? { kept } : {}) },
      ].slice(-HISTORY_LIMIT)
    }
    snapshot.value = copy(state)
    save(Boolean(label))
  }

  /* ---------- 復原 ---------- */

  const canUndo = computed(() => history.value.length > 0)

  /** 最近一步做了什麼，顯示在復原鈕上 */
  const lastAction = computed(() => history.value.at(-1)?.label ?? '')

  /**
   * 退回上一步，可以連按一路退回去。
   *
   * 這裡刻意不把「復原前」的狀態推回歷史 —— 推回去的話會變成
   * 在最後兩個狀態之間來回切換，退不到更早的地方。
   */
  function undo(): { ok: boolean; message: string } {
    const entry = history.value.at(-1)
    if (!entry) return { ok: false, message: '沒有可以復原的動作。' }

    history.value = history.value.slice(0, -1)

    // 復原回來的幾筆是歷史紀錄裡的物件，複製一份再用，之後改它們才不會動到別的紀錄
    setState(copy(applyPatch(currentState(), entry.patch)))
    snapshot.value = copy(currentState())
    save(true)

    const left = history.value.length
    return {
      ok: true,
      message: left
        ? `已復原：${entry.label}（還可以再退 ${left} 步）`
        : `已復原：${entry.label}（已經回到最初的狀態）`,
    }
  }

  /**
   * 上次從檔案同步之後，在這台裝置上又做了幾步會被檔案蓋掉的修改（搬移、排序、新增刪除…）。
   * 改標題、網址、字卡、班級會套回去，不算。歷史只留 15 步，所以最多算到 15
   */
  function localEditsSinceSync(): number {
    let n = 0
    for (let i = history.value.length - 1; i >= 0 && history.value[i]!.label !== SYNC_LABEL; i--) {
      if (!history.value[i]!.kept) n++
    }
    return n
  }

  function clearHistory() {
    history.value = []
    persistHistory()
  }

  /** 讀舊版的平面片單，全部塞進第一個分區 */
  function migrateLegacy(cats: Category[]): VideoItem[] | null {
    try {
      const raw = localStorage.getItem(LEGACY_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null

      const target = cats[0]?.id || 'other'
      const taken = new Set<string>()
      return parsed
        .filter((v) => v?.id)
        .map((v) => ({
          uid: makeVideoUid(v.id, taken),
          id: v.id,
          title: v.title || '',
          categoryId: target,
          subId: null,
        }))
    } catch {
      return null
    }
  }

  /** title 留空的影片，跟 YouTube 要一次正式片名並記下來 */
  async function backfillTitles() {
    const pending = videos.value.filter((v) => !v.title)
    if (!pending.length) return

    // 同一支影片可能出現在多個單元，用 id 去查會改到別筆，所以用 uid 對位
    const uniqueIds = [...new Set(pending.map((v) => v.id))]
    const titles = new Map<string, string>()
    await Promise.all(uniqueIds.map(async (id) => {
      titles.set(id, (await fetchVideoTitle(id)) || '影片')
    }))
    for (const v of pending) {
      const hit = videos.value.find((x) => x.uid === v.uid)
      // 抓標題是非同步的，這段時間試算表可能已經同步進來並帶了正式名稱，
      // 那就別用 YouTube 的原始標題蓋掉家長自己取的名字
      if (hit && !hit.title) hit.title = titles.get(v.id) || '影片'
    }
    persist()
  }

  /* ---------- 從試算表同步 ---------- */

  /**
   * 讀 Google 試算表（家長設定貼的網址）並套用；專案裡沒有任何 txt 書單，書單只在試算表。
   *
   * 試算表內容的指紋跟上次不一樣，就表示家長改過書單 —— 這時直接覆蓋本機資料，
   * 每台 iPad 因此都會跟著更新，不用一台一台設定。
   * 指紋一樣就保留本機，家長在 iPad 上臨時加的影片才不會每次開啟都不見。
   * 覆蓋之後，在這台裝置上改過的標題、網址、字卡、班級（localEdits）會再套回去。
   * 讀不到（斷線、試算表暫時打不開）就用上一次讀到的內容，不會把已經有的書單清掉。
   *
   * @param force 家長按「立即同步」時用，不比對指紋直接套用
   */
  async function syncFromPlaylist(force = false): Promise<SyncStatus> {
    const source = useSheetSource()
    if (!source.link.value) {
      syncStatus.value = {
        state: 'missing',
        message: '還沒設定學習單試算表的網址，目前用的是這台裝置上的書單。家長設定 →「來源備份」貼上網址就會讀進來。',
        warnings: [],
      }
      return syncStatus.value
    }

    syncStatus.value = { state: 'syncing', message: '正在讀取試算表…', warnings: [] }

    const sheet = await source.load()
    if (!sheet) {
      // 讀不到，而且從來沒讀成功過
      syncStatus.value = {
        state: 'offline',
        message: `${source.status.value.message || '讀不到試算表。'}先用這台裝置上的書單。`,
        warnings: [],
      }
      return syncStatus.value
    }

    // 試算表「問句」工作表改過的問句：每次都換成最新的（跟書單文字有沒有變無關）
    setQuestionTexts(sheet.questions ?? {})

    const text = sheet.text
    const hash = hashText(text)
    const parsed = parsePlaylist(text)
    // 解析器回報的是轉出來的第幾行，指回試算表的哪個工作表、第幾列
    // （轉換時就看不懂的列，由「學習單（Google 試算表）」面板自己列出來，這裡不重複）
    parsed.warnings = parsed.warnings.map((w) => locateSheetWarning(sheet, w))

    if (!parsed.categories.length) {
      syncStatus.value = {
        state: 'error',
        message: '試算表裡找不到任何分區，沒有更新。',
        warnings: parsed.warnings,
      }
      return syncStatus.value
    }

    let lastHash: string | null = null
    try { lastHash = localStorage.getItem(SYNC_KEY) } catch { /* 略過 */ }

    if (!force && hash === lastHash) {
      syncStatus.value = {
        state: 'same',
        message: '試算表沒有變動，保留這台裝置上的調整。',
        warnings: parsed.warnings,
      }
      return syncStatus.value
    }

    // 上次同步之後在這台裝置上改過的東西，這次會被試算表蓋掉。
    // 以前是靜靜蓋掉，家長會以為自己拖到班級沒有成功，所以要算出來講清楚
    const discarded = localEditsSinceSync()
    const { edits, kept, dropped } = applyLocalEdits(parsed.videos, localEdits.value)

    setState({ ...parsed, edits })
    useCardStars().adoptLegacy(parsed.videos)
    persist(SYNC_LABEL)
    try { localStorage.setItem(SYNC_KEY, hash) } catch { /* 略過 */ }

    const secPart = parsed.sections.length > 1 ? `${parsed.sections.length} 個大分類、` : ''
    const deckCount = parsed.videos.filter((v) => v.kind === 'deck').length
    const deckPart = deckCount ? `、${deckCount} 本字卡` : ''
    const keptPart = kept ? `這台裝置上改過的 ${kept} 筆（標題、網址、字卡、班級）照樣保留。` : ''
    const droppedPart = dropped
      ? `另外有 ${dropped} 筆在這台裝置改過的，試算表裡已經找不到（可能改了名字或刪掉了），這些修改就不留了。`
      : ''
    const discardedPart = discarded
      ? `這台裝置上手動調整的 ${discarded} 個地方（搬移、排序、新增刪除…）已經換成試算表的內容；`
        + '要留著的請寫進試算表，或按「目前片單」的復原退回同步前。'
      : ''
    syncStatus.value = {
      state: 'updated',
      message: `已從試算表更新：${secPart}${parsed.categories.length} 個分區、${parsed.videos.length - deckCount} 部影片${deckPart}。${keptPart}${droppedPart}${discardedPart}`,
      warnings: parsed.warnings,
      discarded: discarded + dropped,
    }
    backfillTitles()
    return syncStatus.value
  }

  function init() {
    if (isReady.value) return
    const fallbackData = defaultData()

    let stored: LibraryData | null = null
    try {
      const raw = localStorage.getItem(STORE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && Array.isArray(parsed.categories) && Array.isArray(parsed.videos)) {
        // 舊版沒有 uid，讀進來時補上
        const taken = new Set<string>()
        // 舊版沒有大分類，全部歸到預設的那一個
        const secs: Section[] = Array.isArray(parsed.sections) && parsed.sections.length
          ? parsed.sections
          : [{ id: DEFAULT_SECTION_ID, name: DEFAULT_SECTION_NAME, emoji: '📚' }]
        const validSecIds = new Set(secs.map((x) => x.id))

        stored = {
          sections: secs,
          categories: (parsed.categories as Category[]).map((c) => ({
            ...c,
            sectionId: validSecIds.has(c.sectionId) ? c.sectionId : secs[0]!.id,
          })),
          // 沒有子分區的舊版資料照樣讀得進來
          subCategories: Array.isArray(parsed.subCategories) ? parsed.subCategories : [],
          videos: parsed.videos.map((v: VideoItem) => ({
            ...v,
            subId: v.subId ?? null,
            uid: v.uid && !taken.has(v.uid) ? (taken.add(v.uid), v.uid) : makeVideoUid(v.id, taken),
          })),
        }
      }
    } catch { /* 資料壞掉就退回預設內容 */ }

    if (stored) {
      sections.value = stored.sections
      categories.value = stored.categories
      subCategories.value = stored.subCategories
      videos.value = stored.videos
    } else {
      sections.value = fallbackData.sections
      categories.value = fallbackData.categories
      subCategories.value = fallbackData.subCategories
      // 從沒有分區的舊版升級上來的話，把舊片單接過來
      const legacy = migrateLegacy(fallbackData.categories)
      videos.value = legacy?.length ? legacy : fallbackData.videos
      persist()
    }

    const savedTitle = localStorage.getItem(TITLE_KEY)
    if (savedTitle) appTitle.value = savedTitle

    try {
      const raw = localStorage.getItem(EDITS_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) localEdits.value = parsed
    } catch { /* 壞掉就當作沒改過 */ }

    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) {
        history.value = upgradeHistory(parsed.slice(-HISTORY_LIMIT), currentState())
        // 舊格式一筆就幾十萬字，換成差異之後馬上寫回去，把空間空出來
        if (parsed.some((e) => e?.data)) persistHistory()
      }
    } catch { /* 歷史壞掉就從空的開始 */ }

    // 記下目前的樣子，之後第一次修改才有「修改前」可以退回
    snapshot.value = copy(currentState())

    isReady.value = true
    backfillTitles()

    // 先讓畫面用本機資料立刻顯示，再背景比對試算表有沒有更新
    syncFromPlaylist().catch(() => {})
  }

  /* ---------- 查詢 ---------- */

  /** 某個大分類底下的分區，順序就是顯示順序 */
  function categoriesIn(sectionId: string): Category[] {
    return categories.value.filter((c) => c.sectionId === sectionId)
  }

  /** 某個大分類底下總共幾部影片 */
  function countInSection(sectionId: string): number {
    const ids = new Set(categoriesIn(sectionId).map((c) => c.id))
    return videos.value.filter((v) => ids.has(v.categoryId)).length
  }

  /** 某一區的子分區，順序就是顯示順序 */
  function subsIn(categoryId: string): SubCategory[] {
    return subCategories.value.filter((s) => s.categoryId === categoryId)
  }

  /** 某一區的影片，順序就是清單裡的相對順序 */
  function videosIn(categoryId: string): VideoItem[] {
    return videos.value.filter((v) => v.categoryId === categoryId)
  }

  /** 某一區裡不屬於任何子分區的影片 */
  function looseVideosIn(categoryId: string): VideoItem[] {
    return videos.value.filter((v) => v.categoryId === categoryId && !v.subId)
  }

  /** 某個子分區的影片 */
  function videosInSub(subId: string): VideoItem[] {
    return videos.value.filter((v) => v.subId === subId)
  }

  function countIn(categoryId: string): number {
    return videosIn(categoryId).length
  }

  /**
   * 小朋友端要的完整結構：分區底下依序是「沒分冊的影片」＋各個子分區。
   * 空的子分區不會出現，免得畫面上一堆空標題。
   */
  function groupsIn(categoryId: string): Array<{ id: string | null; name: string; videos: VideoItem[] }> {
    const out: Array<{ id: string | null; name: string; videos: VideoItem[] }> = []

    const loose = looseVideosIn(categoryId)
    if (loose.length) out.push({ id: null, name: '', videos: loose })

    for (const sub of subsIn(categoryId)) {
      const list = videosInSub(sub.id)
      if (list.length) out.push({ id: sub.id, name: sub.name, videos: list })
    }
    return out
  }

  /* ---------- 影片 ---------- */

  async function addVideo(
    rawUrl: string,
    categoryId: string,
    subId: string | null = null,
    manualTitle = '',
  ): Promise<{ ok: boolean; message: string }> {
    const id = parseVideoId(rawUrl)
    if (!id) return { ok: false, message: '看不懂這個網址，請貼完整的 YouTube 連結。' }

    const target = categories.value.some((c) => c.id === categoryId)
      ? categoryId
      : categories.value[0]?.id
    if (!target) return { ok: false, message: '請先建立一個分區。' }

    // 子分區必須真的屬於這個分區，否則當作沒選
    const sub = subCategories.value.find((s) => s.id === subId && s.categoryId === target)

    // 同一支影片可以放在不同單元，但同一個單元裡重複就是手誤
    const dup = videos.value.find(
      (v) => v.id === id && v.categoryId === target && v.subId === (sub?.id ?? null),
    )
    if (dup) {
      const catName = categories.value.find((c) => c.id === target)?.name || ''
      const where = sub ? `${catName} › ${sub.name}` : catName
      return { ok: false, message: `這部影片已經在「${where}」裡了。` }
    }

    // 沒填標題才去問 YouTube；問不到通常表示影片不存在、是私人的，
    // 或被設定為禁止嵌入 —— 這幾種加了也播不了，要讓家長知道
    const fetched = manualTitle.trim() ? null : await fetchVideoTitle(id)
    const title = manualTitle.trim() || fetched || `影片 ${videos.value.length + 1}`

    const taken = new Set(videos.value.map((v) => v.uid))
    videos.value.push({
      uid: makeVideoUid(id, taken),
      id,
      title,
      categoryId: target,
      subId: sub?.id ?? null,
    })
    persist(`新增影片「${title}」`)

    const catName = categories.value.find((c) => c.id === target)?.name || ''
    const where = sub ? `${catName} › ${sub.name}` : catName
    if (!manualTitle.trim() && !fetched) {
      return {
        ok: true,
        message: `已加入「${where}」，但抓不到片名。請確認這部影片可以公開觀看、也允許嵌入播放。`,
      }
    }
    return { ok: true, message: `已加入「${where}」：${title}` }
  }

  function removeVideo(uid: string) {
    const title = videos.value.find((v) => v.uid === uid)?.title ?? '影片'
    videos.value = videos.value.filter((v) => v.uid !== uid)
    persist(`刪除影片「${title}」`)
  }

  /**
   * 改片單上的某一筆，同時記進 localEdits：試算表更新之後會再套回去。
   * 第一次改某個地方時記下檔案原本的樣子，之後才還原得回去；改回跟檔案一樣就不算改過
   */
  function recordEdit(v: VideoItem, changes: EditValues) {
    const all = { ...localEdits.value }
    const prev = all[v.uid]
    const e: LocalEdit = prev ? { ...prev, file: { ...prev.file } } : { file: {} }

    for (const f of EDIT_FIELDS) {
      if (!(f in changes)) continue
      const value = changes[f]
      if (!(f in e.file)) e.file = { ...e.file, [f]: copy(readField(v, f)) }
      if (same(value, e.file[f])) {
        delete e[f]
        delete e.file[f]
      } else {
        Object.assign(e, { [f]: copy(value) })
      }
      writeField(v, f, value)
    }

    if (EDIT_FIELDS.some((f) => f in e)) all[v.uid] = e
    else delete all[v.uid]
    localEdits.value = all
  }

  function renameVideo(uid: string, title: string) {
    const hit = videos.value.find((v) => v.uid === uid)
    const next = title.trim()
    // 點了標題沒改就離開，不要多出一步復原
    if (!hit || !next || next === hit.title) return
    recordEdit(hit, { title: next })
    persist(`改影片名稱「${hit.title}」`, true)
  }

  /**
   * 改一筆的內容：標題、影片或網站的網址、字卡本的卡片。
   * 改的只存在這台裝置，試算表更新之後會再套回去，不會被蓋掉
   */
  function editItem(
    uid: string,
    input: { title?: string; url?: string; cards?: Card[]; missions?: Mission[] },
  ): { ok: boolean; message: string } {
    const hit = videos.value.find((v) => v.uid === uid)
    if (!hit) return { ok: false, message: '找不到這一筆，可能已經被刪掉了。' }
    const changes: EditValues = {}

    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title) return { ok: false, message: '標題不能空白。' }
      if (title !== hit.title) changes.title = title
    }

    if (input.url !== undefined && hit.kind === 'site') {
      const url = input.url.trim()
      if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, message: '網站網址要用 http:// 或 https:// 開頭。' }
      if (url !== hit.url) changes.url = url
    } else if (input.url !== undefined && hit.kind !== 'deck') {
      const id = parseVideoId(input.url.trim())
      if (!id) return { ok: false, message: '看不懂這個網址，請貼完整的 YouTube 連結。' }
      const dup = videos.value.some(
        (v) => v !== hit && v.id === id && v.categoryId === hit.categoryId && v.subId === hit.subId,
      )
      if (dup) return { ok: false, message: '同一個單元裡已經有這部影片了。' }
      if (id !== hit.id) changes.id = id
    }

    if (input.cards !== undefined && hit.kind === 'deck') {
      const cards = input.cards.map((c) => ({
        ...c,
        word: c.word.trim(),
        meaning: c.meaning.trim(),
        image: c.image.trim(),
        sentences: c.sentences.map((s) => s.trim()).filter(Boolean),
      }))
      if (!cards.length) return { ok: false, message: '字卡本至少要留一張卡。' }
      const noWord = cards.findIndex((c) => !c.word)
      if (noWord >= 0) return { ok: false, message: `第 ${noWord + 1} 張卡還沒寫字。` }
      const badImage = cards.findIndex((c) => c.image && !isEmojiOnly(c.image) && !isImageRef(c.image))
      if (badImage >= 0) {
        return {
          ok: false,
          message: `第 ${badImage + 1} 張卡的圖看不懂：要放 emoji，或 cards/ 開頭的圖片路徑（.jpg、.png、.webp），或圖片網址。`,
        }
      }
      // 句子一律用英文語音唸，夾了中文會唸得亂七八糟
      const badSentence = cards.findIndex((c) => c.sentences.some((s) => !/[A-Za-z]/.test(s) || /\p{Script=Han}/u.test(s)))
      if (badSentence >= 0) {
        return {
          ok: false,
          message: `第 ${badSentence + 1} 張卡的英文句子裡有中文，或沒有英文字：這一欄會用英文語音唸，中文請寫在「中文／說明」。`,
        }
      }
      if (!same(cards, hit.cards)) changes.cards = cards
    }

    if (input.missions !== undefined && hit.kind === 'deck') {
      const missions: Mission[] = []
      for (const [i, m] of input.missions.entries()) {
        const at = `第 ${i + 1} 個題目`
        const zh = m.zh.trim()
        const en = m.en.trim()
        if (!zh || !en) return { ok: false, message: `${at}要中文、英文各寫一句。` }
        if (!/\p{Script=Han}/u.test(zh)) return { ok: false, message: `${at}的中文那句要有中文字。` }
        // 英文那句用英文語音唸，夾了中文會唸得亂七八糟（{zh}、{en}、{abc} 是會換成卡片上的字的記號，可以放）
        if (!/[A-Za-z]/.test(en) || /\p{Script=Han}/u.test(en)) {
          return { ok: false, message: `${at}的英文那句要用英文寫，不能夾中文（會用英文語音唸）。` }
        }
        const goal = Math.trunc(Number(m.goal))
        if (!(goal >= 1 && goal <= MISSION_MAX)) return { ok: false, message: `${at}要找幾個，要寫 1～${MISSION_MAX}。` }
        // 欄位順序跟 parseMission 一樣：之後拿來跟試算表的內容比對（JSON 字串），順序不同會被當成改過
        missions.push({
          card: m.card,
          zh,
          en,
          goal,
          ...(m.goalFromCard ? { goalFromCard: true } : {}),
          ...(m.act ? { act: m.act } : {}),
          tip: m.tip.trim(),
        })
      }
      if (!same(missions, missionsOf(hit))) changes.missions = missions
    }

    if (!Object.keys(changes).length) return { ok: true, message: '沒有改到任何地方。' }
    recordEdit(hit, changes)
    persist(`編輯「${hit.title}」`, true)
    return { ok: true, message: `已儲存「${hit.title}」。試算表更新之後也會保留。` }
  }

  /** 這一筆在這台裝置上改過的地方全部退回試算表的樣子 */
  function revertItem(uid: string) {
    const e = localEdits.value[uid]
    if (!e) return
    const hit = videos.value.find((v) => v.uid === uid)
    if (hit) for (const f of EDIT_FIELDS) if (f in e.file) writeField(hit, f, e.file[f])
    const all = { ...localEdits.value }
    delete all[uid]
    localEdits.value = all
    persist(`還原「${hit?.title ?? '這一筆'}」成試算表的內容`, true)
  }

  /** 這台裝置上改過的全部退回試算表的樣子 */
  function revertAllEdits(): { ok: boolean; message: string } {
    const entries = Object.entries(localEdits.value)
    if (!entries.length) return { ok: false, message: '這台裝置上沒有改過的內容。' }
    for (const [uid, e] of entries) {
      const hit = videos.value.find((v) => v.uid === uid)
      if (hit) for (const f of EDIT_FIELDS) if (f in e.file) writeField(hit, f, e.file[f])
    }
    localEdits.value = {}
    persist('全部還原成試算表的內容', true)
    return { ok: true, message: `已把 ${entries.length} 筆還原成試算表的內容，弄錯了可以按「目前片單」的復原。` }
  }

  /** 把影片換到別的分區或子分區。subId 傳 null 表示不歸子分區 */
  function setVideoPlace(uid: string, categoryId: string, subId: string | null) {
    const hit = videos.value.find((v) => v.uid === uid)
    if (!hit || !categories.value.some((c) => c.id === categoryId)) return

    const sub = subCategories.value.find((s) => s.id === subId && s.categoryId === categoryId)
    hit.categoryId = categoryId
    hit.subId = sub?.id ?? null
    persist(`搬移影片「${hit.title}」`)
  }

  /**
   * 設定這一筆適合哪幾班。傳空的表示不分年齡（拿掉自己的設定，沿用單元、分區的）。
   * 跟改標題一樣記在這台裝置上，試算表更新之後會再套回去。
   */
  function setVideoStages(uid: string, stages: StageId[]) {
    const hit = videos.value.find((v) => v.uid === uid)
    if (!hit) return
    recordEdit(hit, { stages: [...new Set(stages)].sort((a, b) => a - b) })
    persist(`改「${hit.title}」適合的班級`, true)
  }

  /**
   * 在同一個群組裡重新排序（取出再插入，也就是拖曳的語意）。
   * videos 是一份平面陣列，所以要把整組影片按新順序寫回它們原本的位置。
   */
  function reorderVideos(categoryId: string, subId: string | null, from: number, to: number) {
    const positions = videos.value
      .map((v, i) => (v.categoryId === categoryId && (v.subId ?? null) === subId ? i : -1))
      .filter((i) => i >= 0)

    if (from === to || from < 0 || to < 0 || from >= positions.length || to >= positions.length) return

    const picked = positions.map((p) => videos.value[p]!)
    const [moved] = picked.splice(from, 1)
    picked.splice(to, 0, moved!)
    positions.forEach((p, i) => { videos.value[p] = picked[i]! })
    persist('調整影片順序')
  }

  /* ---------- 大分類 ---------- */

  function addSection(name: string, emoji: string): { ok: boolean; message: string } {
    const n = name.trim()
    if (!n) return { ok: false, message: '請輸入名稱。' }
    if (sections.value.some((x) => x.name === n)) {
      return { ok: false, message: '已經有同名的大分類了。' }
    }
    const id = makeCategoryId(n, sections.value.map((x) => x.id))
    sections.value.push({ id, name: n, emoji: emoji.trim() || '📚' })
    persist(`新增大分類「${n}」`)
    return { ok: true, message: `已新增大分類「${n}」` }
  }

  function renameSection(id: string, name: string, emoji?: string) {
    const hit = sections.value.find((x) => x.id === id)
    if (!hit) return
    hit.name = name.trim() || hit.name
    if (emoji !== undefined) hit.emoji = emoji.trim() || hit.emoji
    persist(`改大分類名稱「${hit.name}」`)
  }

  /** 刪掉大分類，底下的分區、冊與影片一起刪（呼叫端要先問過家長） */
  function removeSection(id: string): { ok: boolean; message: string } {
    if (sections.value.length <= 1) {
      return { ok: false, message: '至少要留一個大分類。' }
    }
    const name = sections.value.find((x) => x.id === id)?.name || ''
    const catIds = new Set(categoriesIn(id).map((c) => c.id))

    sections.value = sections.value.filter((x) => x.id !== id)
    categories.value = categories.value.filter((c) => c.sectionId !== id)
    subCategories.value = subCategories.value.filter((sc) => !catIds.has(sc.categoryId))
    videos.value = videos.value.filter((v) => !catIds.has(v.categoryId))
    persist(`刪除大分類「${name}」`)
    return { ok: true, message: `已刪除「${name}」及底下所有內容。` }
  }

  function reorderSections(from: number, to: number) {
    if (from === to) return
    const list = [...sections.value]
    const [moved] = list.splice(from, 1)
    if (!moved) return
    list.splice(to, 0, moved)
    sections.value = list
    persist('調整大分類順序')
  }

  /** 把整個分區搬到別的大分類底下 */
  function setCategorySection(categoryId: string, sectionId: string) {
    const hit = categories.value.find((c) => c.id === categoryId)
    if (!hit || !sections.value.some((x) => x.id === sectionId)) return
    hit.sectionId = sectionId
    persist(`搬移分區「${hit.name}」`)
  }

  /* ---------- 分區 ---------- */

  function addCategory(sectionId: string, name: string, emoji: string): { ok: boolean; message: string } {
    const n = name.trim()
    if (!n) return { ok: false, message: '請輸入分區名稱。' }

    const section = sections.value.find((x) => x.id === sectionId) ?? sections.value[0]
    if (!section) return { ok: false, message: '請先建立一個大分類。' }

    if (categoriesIn(section.id).some((c) => c.name === n)) {
      return { ok: false, message: '這個大分類底下已經有同名的分區了。' }
    }

    const id = makeCategoryId(n, categories.value.map((c) => c.id))
    categories.value.push({ id, sectionId: section.id, name: n, emoji: emoji.trim() || '📁' })
    persist(`新增分區「${n}」`)
    return { ok: true, message: `已新增分區「${n}」` }
  }

  function renameCategory(id: string, name: string, emoji?: string) {
    const hit = categories.value.find((c) => c.id === id)
    if (!hit) return
    hit.name = name.trim() || hit.name
    if (emoji !== undefined) hit.emoji = emoji.trim() || hit.emoji
    persist(`改分區名稱「${hit.name}」`)
  }

  /** 刪掉分區，裡面的子分區與影片一起刪（呼叫端要先問過家長） */
  function removeCategory(id: string): { ok: boolean; message: string } {
    if (categories.value.length <= 1) {
      return { ok: false, message: '至少要留一個分區。' }
    }
    const name = categories.value.find((c) => c.id === id)?.name || ''
    categories.value = categories.value.filter((c) => c.id !== id)
    subCategories.value = subCategories.value.filter((s) => s.categoryId !== id)
    videos.value = videos.value.filter((v) => v.categoryId !== id)
    persist(`刪除分區「${name}」`)
    return { ok: true, message: `已刪除分區「${name}」及其中的影片。` }
  }

  /** 在同一個大分類底下重新排序分區 */
  function reorderCategories(sectionId: string, from: number, to: number) {
    const positions = categories.value
      .map((c, i) => (c.sectionId === sectionId ? i : -1))
      .filter((i) => i >= 0)

    if (from === to || from < 0 || to < 0 || from >= positions.length || to >= positions.length) return

    const picked = positions.map((p) => categories.value[p]!)
    const [moved] = picked.splice(from, 1)
    picked.splice(to, 0, moved!)
    positions.forEach((p, i) => { categories.value[p] = picked[i]! })
    persist('調整分區順序')
  }

  /* ---------- 子分區 ---------- */

  function addSubCategory(categoryId: string, name: string): { ok: boolean; message: string } {
    const n = name.trim()
    if (!n) return { ok: false, message: '請輸入名稱。' }
    if (!categories.value.some((c) => c.id === categoryId)) {
      return { ok: false, message: '找不到這個分區。' }
    }
    if (subsIn(categoryId).some((s) => s.name === n)) {
      return { ok: false, message: '這一區已經有同名的了。' }
    }

    const id = makeCategoryId(n, subCategories.value.map((s) => s.id))
    subCategories.value.push({ id, categoryId, name: n })
    persist(`新增單元「${n}」`)
    return { ok: true, message: `已新增「${n}」` }
  }

  function renameSubCategory(id: string, name: string) {
    const hit = subCategories.value.find((s) => s.id === id)
    if (!hit) return
    hit.name = name.trim() || hit.name
    persist(`改單元名稱「${hit.name}」`)
  }

  /** 刪掉子分區，裡面的影片退回分區底下（不刪影片） */
  function removeSubCategory(id: string): { ok: boolean; message: string } {
    const hit = subCategories.value.find((s) => s.id === id)
    if (!hit) return { ok: false, message: '找不到這一項。' }

    const n = videosInSub(id).length
    subCategories.value = subCategories.value.filter((s) => s.id !== id)
    for (const v of videos.value) {
      if (v.subId === id) v.subId = null
    }
    persist(`刪除單元「${hit.name}」`)
    return {
      ok: true,
      message: n
        ? `已刪除「${hit.name}」，裡面 ${n} 部影片退回「${categories.value.find((c) => c.id === hit.categoryId)?.name}」底下。`
        : `已刪除「${hit.name}」`,
    }
  }

  function reorderSubCategories(categoryId: string, from: number, to: number) {
    const positions = subCategories.value
      .map((s, i) => (s.categoryId === categoryId ? i : -1))
      .filter((i) => i >= 0)

    if (from === to || from < 0 || to < 0 || from >= positions.length || to >= positions.length) return

    const picked = positions.map((p) => subCategories.value[p]!)
    const [moved] = picked.splice(from, 1)
    picked.splice(to, 0, moved!)
    positions.forEach((p, i) => { subCategories.value[p] = picked[i]! })
    persist('調整單元順序')
  }

  /* ---------- 其他 ---------- */

  function setAppTitle(title: string) {
    appTitle.value = title.trim() || '我的學習影片'
    try { localStorage.setItem(TITLE_KEY, appTitle.value) } catch { /* 略過 */ }
  }

  /**
   * 清掉這台裝置上的書單（回到還沒有書單的樣子）：移除試算表連結的時候，家長可以選擇連書單一起清掉。
   * 在這台改過的標題、字卡（localEdits）也一起清；字卡星星、任務貼紙這些孩子的紀錄不動。
   */
  function clearLibrary() {
    const d = defaultData()
    setState({ ...d, edits: {} })
    persist('清掉這台的書單')
    try { localStorage.removeItem(SYNC_KEY) } catch { /* 略過 */ }
  }

  return {
    sections, categories, subCategories, videos, appTitle, isReady, syncStatus, localEdits,
    canUndo, lastAction, undo, clearHistory,
    init, syncFromPlaylist,
    categoriesIn, countInSection, subsIn, videosIn, looseVideosIn, videosInSub, countIn, groupsIn,
    addSection, renameSection, removeSection, reorderSections, setCategorySection,
    addVideo, removeVideo, renameVideo, setVideoPlace, setVideoStages, reorderVideos,
    editItem, revertItem, revertAllEdits,
    addCategory, renameCategory, removeCategory, reorderCategories,
    addSubCategory, renameSubCategory, removeSubCategory, reorderSubCategories,
    setAppTitle, clearLibrary,
  }
}
