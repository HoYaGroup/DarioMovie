/**
 * 爸媽錄的聲音。App 唸一句話的時候，如果這台裝置上有人錄過同一句，就放那段錄音，
 * 沒錄的才用瀏覽器的合成語音（見 utils/speech.ts）。
 *
 * ‧ 依「要唸的那一句話」找，不是依哪張卡：`I'm hungry` 錄一次，出現在哪一本字卡都會用；
 *   比對時不分大小寫、不管標點（`Stand up!` 和 `stand up` 是同一句），語言（英文／中文）分開記
 * ‧ 存在這台裝置的 IndexedDB（Blob 放得進去，localStorage 放不進），每台裝置各自錄、各自存，
 *   不會寫進片單、不會上傳、不會跟著公開網站出去
 * ‧ 錄音前後的靜音會記下來（trim），播放時跳過，不用再剪
 */

export type ClipLang = 'en-US' | 'zh-TW'

export interface Clip {
  /** clipKey(text, lang) */
  key: string
  /** 錄的時候那句話的原樣（給家長看） */
  text: string
  lang: ClipLang
  blob: Blob
  /** 有聲音的那一段（秒），沒有就整段播 */
  trim: [number, number] | null
  /** 有聲音那一段的長度（毫秒） */
  ms: number
  at: number
}

const DB_NAME = 'kidtube-voice'
const STORE = 'clips'

/** 比對用的寫法：小寫、拿掉標點、空白合併（`Stand up!` → `stand up`）；中文只拿掉標點和空白 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // 彎的撇號（I’m）跟直的（I'm）是同一個字
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function clipKey(text: string, lang: ClipLang): string {
  return `${lang}|${normalizeText(text)}`
}

/* ---------- IndexedDB ---------- */

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' })
      req.onsuccess = () => resolve(req.result)
      // 無痕視窗、儲存空間被封鎖：當作沒有錄音，照常用合成語音
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      try {
        const req = work(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
}

/* ---------- 記憶體裡的索引：speak 每唸一段就要查，不能每次都等 IndexedDB ---------- */

const clips = new Map<string, Clip>()
const listeners = new Set<() => void>()
/** 有沒有改過：給畫面判斷要不要重畫（Map 本身不是響應式的） */
let version = 0

function changed() {
  version++
  listeners.forEach((fn) => fn())
}

/** 錄音有增減時通知（回傳取消訂閱） */
export function onClipsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function clipsVersion(): number {
  return version
}

let loading: Promise<void> | null = null

/** 把裝置上的錄音讀進記憶體；啟動時叫一次，speak 會等它（讀不到就當作沒有錄音） */
export function loadClips(): Promise<void> {
  loading ??= run<Clip[]>('readonly', (s) => s.getAll() as IDBRequest<Clip[]>).then((list) => {
    for (const c of list ?? []) clips.set(c.key, c)
    if (list?.length) changed()
  })
  return loading
}

/** 這一句有沒有人錄過，有的話回傳那段錄音 */
export function getClip(text: string, lang: ClipLang): Clip | undefined {
  return clips.get(clipKey(text, lang))
}

export function allClips(): Clip[] {
  return [...clips.values()].sort((a, b) => b.at - a.at)
}

/** 錄音一共佔多少位元組 */
export function clipsBytes(): number {
  let n = 0
  for (const c of clips.values()) n += c.blob.size
  return n
}

export async function saveClip(text: string, lang: ClipLang, blob: Blob, trim: [number, number] | null, ms: number): Promise<Clip> {
  const clip: Clip = { key: clipKey(text, lang), text: text.trim(), lang, blob, trim, ms, at: Date.now() }
  clips.set(clip.key, clip)
  changed()
  await run('readwrite', (s) => s.put(clip))
  // 錄音是家長花時間錄的，請瀏覽器別在空間不夠時清掉
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* 略過 */ }
  return clip
}

/** 還原備份用：照原樣放回一段錄音（key、錄音時間都沿用備份裡的）。存不進去會丟錯 */
export async function restoreClip(clip: Clip): Promise<void> {
  const ok = await run('readwrite', (s) => s.put(clip))
  if (ok === null) throw new Error('這台裝置存不下錄音（無痕視窗，或儲存空間不夠）。')
  clips.set(clip.key, clip)
  changed()
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* 略過 */ }
}

export async function removeClip(text: string, lang: ClipLang): Promise<void> {
  const key = clipKey(text, lang)
  if (!clips.delete(key)) return
  changed()
  await run('readwrite', (s) => s.delete(key))
}

export async function clearClips(): Promise<void> {
  if (!clips.size) return
  clips.clear()
  changed()
  await run('readwrite', (s) => s.clear())
}
