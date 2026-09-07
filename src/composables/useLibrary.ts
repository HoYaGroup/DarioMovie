import {
  parseVideoId, fetchVideoTitle, makeCategoryId, makeVideoUid,
  DEFAULT_SECTION_ID, DEFAULT_SECTION_NAME,
  type VideoItem, type Section, type Category, type SubCategory, type LibraryData,
} from '~/utils/youtube'
import { computed } from 'vue'
import { parsePlaylist, hashText } from '~/utils/playlist'
import { useState } from './useState'
import appConfig from '../app.config'

const STORE_KEY = 'kidtube.library.v2'
const LEGACY_KEY = 'kidtube.videos'   // 還沒有分區時的舊格式
const TITLE_KEY = 'kidtube.appTitle'
const SYNC_KEY = 'kidtube.playlistHash'
const PLAYLIST_FILE = 'playlist.txt'

const HISTORY_KEY = 'kidtube.history'
const HISTORY_LIMIT = 15   // 最多留幾步，免得 localStorage 一直長大

/** 一次修改前的完整快照，用來復原 */
export interface HistoryEntry {
  data: LibraryData
  /** 這一步做了什麼，顯示在復原鈕上 */
  label: string
  at: number
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'updated' | 'same' | 'missing' | 'offline' | 'error'
  message: string
  warnings: string[]
}

/**
 * 分區、子分區與片單管理。
 *
 * 三層結構：分區（學校教學）→ 子分區（Little Kids 上）→ 影片。
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
  /** 目前已經存檔的內容，下一次修改時它就是「修改前」的樣子 */
  const snapshot = useState<LibraryData | null>('library.snapshot', () => null)

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

  const clone = (d: LibraryData): LibraryData => JSON.parse(JSON.stringify(d))

  function persistHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
    } catch { /* 空間不夠就算了，歷史紀錄不是必要資料 */ }
  }

  /**
   * 存檔。
   *
   * @param label 這一步做了什麼。有給就會把「修改前」的樣子存進歷史，
   *              家長按復原時可以退回去。內部整理（例如補標題）不必給。
   */
  function persist(label = '') {
    try {
      if (label && snapshot.value) {
        history.value = [
          ...history.value,
          { data: snapshot.value, label, at: Date.now() },
        ].slice(-HISTORY_LIMIT)
        persistHistory()
      }
      const data = currentData()
      snapshot.value = clone(data)
      localStorage.setItem(STORE_KEY, JSON.stringify(data))
    } catch { /* 無痕模式寫不進去，讓它靜靜失敗就好 */ }
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

    sections.value = entry.data.sections
    categories.value = entry.data.categories
    subCategories.value = entry.data.subCategories
    videos.value = entry.data.videos

    snapshot.value = clone(currentData())
    try { localStorage.setItem(STORE_KEY, JSON.stringify(currentData())) } catch { /* 略過 */ }
    persistHistory()

    const left = history.value.length
    return {
      ok: true,
      message: left
        ? `已復原：${entry.label}（還可以再退 ${left} 步）`
        : `已復原：${entry.label}（已經回到最初的狀態）`,
    }
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
      // 抓標題是非同步的，這段時間片單檔案可能已經同步進來並帶了正式名稱，
      // 那就別用 YouTube 的原始標題蓋掉家長自己取的名字
      if (hit && !hit.title) hit.title = titles.get(v.id) || '影片'
    }
    persist()
  }

  /* ---------- 從片單檔案同步 ---------- */

  function playlistUrl(): string {
    const base = import.meta.env.BASE_URL || '/'
    return `${base.endsWith('/') ? base : base + '/'}${PLAYLIST_FILE}`
  }

  /**
   * 讀 public/playlist.txt 並套用。
   *
   * 檔案內容的指紋跟上次不一樣，就表示家長改過片單 —— 這時直接覆蓋本機資料，
   * 所有 iPad 因此都會跟著更新，不用一台一台設定。
   * 指紋一樣就保留本機，家長在 iPad 上臨時加的影片才不會每次開啟都不見。
   *
   * @param force 家長按「立即同步」時用，不比對指紋直接套用
   */
  async function syncFromPlaylist(force = false): Promise<SyncStatus> {
    syncStatus.value = { state: 'syncing', message: '正在讀取片單檔案…', warnings: [] }

    let text: string
    try {
      // 加時間戳避開瀏覽器與 Service Worker 的快取，才拿得到剛更新的版本
      const res = await fetch(`${playlistUrl()}?t=${Date.now()}`, { cache: 'no-store' })
      if (res.status === 404) {
        syncStatus.value = { state: 'missing', message: '找不到 playlist.txt，目前用的是 App 內建的片單。', warnings: [] }
        return syncStatus.value
      }
      if (!res.ok) throw new Error(String(res.status))
      text = await res.text()
    } catch {
      syncStatus.value = { state: 'offline', message: '連不上網路，先用這台裝置上的片單。', warnings: [] }
      return syncStatus.value
    }

    const hash = hashText(text)
    const parsed = parsePlaylist(text)

    if (!parsed.categories.length) {
      syncStatus.value = {
        state: 'error',
        message: 'playlist.txt 裡找不到任何分區，沒有更新。',
        warnings: parsed.warnings,
      }
      return syncStatus.value
    }

    let lastHash: string | null = null
    try { lastHash = localStorage.getItem(SYNC_KEY) } catch { /* 略過 */ }

    if (!force && hash === lastHash) {
      syncStatus.value = {
        state: 'same',
        message: '片單檔案沒有變動，保留這台裝置上的調整。',
        warnings: parsed.warnings,
      }
      return syncStatus.value
    }

    sections.value = parsed.sections
    categories.value = parsed.categories
    subCategories.value = parsed.subCategories
    videos.value = parsed.videos
    persist('從片單檔案同步')
    try { localStorage.setItem(SYNC_KEY, hash) } catch { /* 略過 */ }

    const secPart = parsed.sections.length > 1 ? `${parsed.sections.length} 個大分類、` : ''
    syncStatus.value = {
      state: 'updated',
      message: `已從片單檔案更新：${secPart}${parsed.categories.length} 個分區、${parsed.videos.length} 部影片。`,
      warnings: parsed.warnings,
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
      const raw = localStorage.getItem(HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) history.value = parsed.slice(-HISTORY_LIMIT)
    } catch { /* 歷史壞掉就從空的開始 */ }

    // 記下目前的樣子，之後第一次修改才有「修改前」可以退回
    snapshot.value = clone(currentData())

    isReady.value = true
    backfillTitles()

    // 先讓畫面用本機資料立刻顯示，再背景比對片單檔案有沒有更新
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

  function renameVideo(uid: string, title: string) {
    const hit = videos.value.find((v) => v.uid === uid)
    if (!hit) return
    hit.title = title.trim() || hit.title
    persist(`改影片名稱「${hit.title}」`)
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

  function exportJson(): string {
    return JSON.stringify({
      sections: sections.value,
      categories: categories.value,
      subCategories: subCategories.value,
      videos: videos.value,
    }, null, 2)
  }

  function importJson(text: string): { ok: boolean; message: string } {
    try {
      const parsed = JSON.parse(text)

      const secs: Section[] = (Array.isArray(parsed.sections) && parsed.sections.length
        ? parsed.sections
        : [{ id: DEFAULT_SECTION_ID, name: DEFAULT_SECTION_NAME, emoji: '📚' }])
        .filter((x: Section) => x?.id && x?.name)
        .map((x: Section) => ({ id: x.id, name: x.name, emoji: x.emoji || '📚' }))

      const secIds = new Set(secs.map((x) => x.id))
      const cats: Category[] = (Array.isArray(parsed.categories) ? parsed.categories : [])
        .filter((c: Category) => c?.id && c?.name)
        .map((c: Category) => ({
          id: c.id,
          sectionId: secIds.has(c.sectionId) ? c.sectionId : secs[0]!.id,
          name: c.name,
          emoji: c.emoji || '📁',
        }))

      if (!cats.length) return { ok: false, message: '內容裡找不到分區資料。' }

      const subs: SubCategory[] = (Array.isArray(parsed.subCategories) ? parsed.subCategories : [])
        .filter((s: SubCategory) => s?.id && s?.name && cats.some((c) => c.id === s.categoryId))
        .map((s: SubCategory) => ({ id: s.id, categoryId: s.categoryId, name: s.name }))

      const rawVideos: Array<{
        id?: string; url?: string; title?: string
        categoryId?: string; category?: string; subId?: string | null; sub?: string
      }> = Array.isArray(parsed.videos) ? parsed.videos : []

      const fallback = cats[0]!.id
      const taken = new Set<string>()
      const vids = rawVideos
        .map((v) => {
          const id = parseVideoId(v.id || v.url || '')
          const cat = v.categoryId || v.category
          const categoryId = cats.some((c) => c.id === cat) ? cat! : fallback
          const subKey = v.subId ?? v.sub ?? null
          const sub = subs.find((s) => s.id === subKey && s.categoryId === categoryId)
          return {
            uid: id ? makeVideoUid(id, taken) : '',
            id: id || '',
            title: v.title || '',
            categoryId,
            subId: sub?.id ?? null,
          }
        })
        .filter((v): v is VideoItem => Boolean(v.id))

      sections.value = secs
      categories.value = cats
      subCategories.value = subs
      videos.value = vids
      persist('匯入片單')
      backfillTitles()
      return {
        ok: true,
        message: `已匯入 ${cats.length} 個分區、${subs.length} 個細分、${vids.length} 部影片。`,
      }
    } catch {
      return { ok: false, message: '格式不正確，請確認貼上的是完整內容。' }
    }
  }

  return {
    sections, categories, subCategories, videos, appTitle, isReady, syncStatus,
    canUndo, lastAction, undo, clearHistory,
    init, syncFromPlaylist, playlistUrl,
    categoriesIn, countInSection, subsIn, videosIn, looseVideosIn, videosInSub, countIn, groupsIn,
    addSection, renameSection, removeSection, reorderSections, setCategorySection,
    addVideo, removeVideo, renameVideo, setVideoPlace, reorderVideos,
    addCategory, renameCategory, removeCategory, reorderCategories,
    addSubCategory, renameSubCategory, removeSubCategory, reorderSubCategories,
    setAppTitle, exportJson, importJson,
  }
}
