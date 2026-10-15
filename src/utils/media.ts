import { shallowRef } from 'vue'
import { listZip, readZipEntry, ZipError } from './zip'

/**
 * 素材：書頁的圖片、動物的叫聲這類不放在公開 GitHub 的檔案（版權），放在家長自己的雲端硬碟，
 * 抓到這台裝置，之後沒網路也看得到、聽得到。兩種抓法：
 *   ‧ 素材包：做成一個 zip，在這台匯入（不用金鑰，下面的 importMediaZip）
 *   ‧ 雲端硬碟資料夾：資料夾裡放跟素材包一樣的資料夾結構，按同步就抓（要 Google API 金鑰，見 utils/driveSync.ts），
 *     抓下來的檔案記著雲端硬碟上的檔案 id 和 md5，沒變的不再下載，雲端硬碟上刪掉的，這台也跟著刪
 *
 * ‧ zip 裡每個檔案的路徑，就是試算表「圖」「背面圖」「聲音」欄寫的那個路徑（例如 cards/books/animals/pets.webp），
 *   所以試算表不用改：App 要顯示 cards/… 的圖時，先看素材包有沒有，沒有才用網站上的（見 cards.ts 的 imageSrc）
 * ‧ 存在這台裝置的 IndexedDB，原樣存（不縮圖、不轉檔，書頁照片才不會糊），不會上傳、不會跟著公開網站出去
 * ‧ 匯入時把 zip 當不可信的：只收圖片和音檔、路徑不能跳出資料夾、每個檔案和總量都有上限、圖片要真的打得開
 * ‧ 素材包不放進「備份」：它的來源就是雲端硬碟上那個 zip，換機器重新匯入一次就好（備份才不會多出幾十 MB）
 * ‧ 不依賴 DOM：cards.ts 在 node 裡也會載入這個檔案，載入時不能碰 window、indexedDB
 */

export interface MediaRecord {
  /** 試算表裡寫的路徑，例如 cards/books/animals/pets.webp */
  path: string
  blob: Blob
  at: number
  /** 從雲端硬碟資料夾同步來的才有：檔案 id 和內容的 md5（雲端硬碟上的檔案沒變就不用再下載） */
  drive?: { id: string; md5: string }
}

interface Loaded extends MediaRecord {
  /** 給 <img>、音檔用的網址，只存在記憶體 */
  url: string
}

const DB_NAME = 'kidtube-media'
const STORE = 'files'

const IMAGE_TYPES: Record<string, string> = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', avif: 'image/avif',
}
const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
/** 一個素材包最多幾個檔案、解開來總共多大：再多多半是選錯東西了 */
export const MAX_MEDIA_FILES = 3000
const MAX_MEDIA_TOTAL = 300 * 1024 * 1024

const extOf = (path: string) => path.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? ''

/** 這個路徑是不是素材收的種類（圖片、音檔），回傳 MIME；不是回 null */
export function mediaType(path: string): string | null {
  const ext = extOf(path)
  return IMAGE_TYPES[ext] ?? AUDIO_TYPES[ext] ?? null
}

/** 這個路徑的檔案最大可以多大（圖片 8 MB、音檔 10 MB）；不是素材的種類回 null */
export function mediaLimit(path: string): number | null {
  const type = mediaType(path)
  if (!type) return null
  return type.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
}

/**
 * zip 裡的路徑 → 素材路徑：去掉開頭的 ./ 和 /，反斜線換成斜線；
 * 有 ..、空的、含控制字元、太長的、系統垃圾檔（__MACOSX、.DS_Store、._xxx）回 null
 */
export function cleanMediaPath(name: string): string | null {
  const p = name.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '')
  // eslint-disable-next-line no-control-regex
  if (!p || p.length > 300 || /[\u0000-\u001f]/.test(p)) return null
  const parts = p.split('/')
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return null
  if (parts[0] === '__MACOSX' || parts.some((s) => s === '.DS_Store' || s === 'Thumbs.db' || s.startsWith('._'))) return null
  return p
}

/* ---------- IndexedDB ---------- */

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' })
      req.onsuccess = () => resolve(req.result)
      // 無痕視窗、儲存空間被封鎖：素材包就當作沒有，字卡照常用網站上的圖
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
        const tx = db.transaction(STORE, mode)
        const req = work(tx.objectStore(STORE))
        if (mode === 'readwrite') {
          tx.oncomplete = () => resolve(req.result)
          tx.onabort = () => resolve(null)
          tx.onerror = () => resolve(null)
        } else {
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        }
      } catch {
        resolve(null)
      }
    })
  })
}

/* ---------- 記憶體裡的索引：畫面每換一張圖就要查，不能每次都等 IndexedDB ---------- */

const files = new Map<string, Loaded>()
/** 有增減就加一：畫面讀它才會跟著重畫（Map 本身不是響應式的） */
export const mediaVersion = shallowRef(0)

function revoke(f: Loaded | undefined) {
  if (f) try { URL.revokeObjectURL(f.url) } catch { /* 略過 */ }
}

function remember(rec: MediaRecord) {
  revoke(files.get(rec.path))
  files.set(rec.path, { ...rec, url: URL.createObjectURL(rec.blob) })
}

let loading: Promise<void> | null = null

/** 把裝置上的素材讀進記憶體；App 啟動時叫一次（讀不到就當作沒有素材包） */
export function loadMedia(): Promise<void> {
  loading ??= run<MediaRecord[]>('readonly', (s) => s.getAll() as IDBRequest<MediaRecord[]>).then((list) => {
    for (const r of list ?? []) {
      if (typeof r?.path === 'string' && r.blob instanceof Blob) remember(r)
    }
    if (list?.length) mediaVersion.value++
  })
  return loading
}

/** 有沒有匯入過素材（沒有的話 imageSrc 不用多查一次） */
export function hasMedia(): boolean {
  void mediaVersion.value
  return files.size > 0
}

/** 這個路徑在素材包裡有的話，回傳給 <img>、音檔用的網址 */
export function mediaUrl(path: string): string | undefined {
  void mediaVersion.value
  return files.get(path)?.url
}

export function mediaCount(): number {
  void mediaVersion.value
  return files.size
}

export function mediaBytes(): number {
  void mediaVersion.value
  let n = 0
  for (const f of files.values()) n += f.blob.size
  return n
}

export async function clearMedia(): Promise<void> {
  if (!files.size) return
  await run('readwrite', (s) => s.clear())
  for (const f of files.values()) revoke(f)
  files.clear()
  mediaVersion.value++
}

/** 從雲端硬碟資料夾同步來的素材：路徑 → 當時的檔案 id 和 md5（匯入素材包的沒有） */
export function driveMedia(): Map<string, { id: string; md5: string }> {
  const out = new Map<string, { id: string; md5: string }>()
  for (const f of files.values()) if (f.drive) out.set(f.path, f.drive)
  return out
}

/** 刪掉這幾個素材（雲端硬碟上已經沒有的）；不在這台的路徑略過 */
export async function removeMediaFiles(paths: string[]): Promise<number> {
  let n = 0
  for (const p of paths) {
    if (!files.has(p)) continue
    await run('readwrite', (s) => s.delete(p))
    revoke(files.get(p))
    files.delete(p)
    n++
  }
  if (n) mediaVersion.value++
  return n
}

/** 一批素材存完之後叫一次：畫面才會換成新的圖，也請瀏覽器別在空間不夠時清掉（素材是家長特地放進來的） */
export function bumpMedia() {
  mediaVersion.value++
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* 略過 */ }
}

/* ---------- 匯入素材包 ---------- */

export interface MediaReport {
  /** 存好幾個、總共多大 */
  saved: number
  bytes: number
  /** 不是圖片或音檔、路徑不能用、太大：略過了 */
  skipped: Array<{ name: string; why: string }>
  /** 圖片打不開、存不進去 */
  failed: Array<{ name: string; why: string }>
}

function canDecodeImage(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const done = (ok: boolean) => { URL.revokeObjectURL(url); resolve(ok) }
    img.onload = () => done(img.naturalWidth > 0)
    img.onerror = () => done(false)
    img.src = url
  })
}

/** 音檔的開頭要對得上副檔名：wav（RIFF…WAVE）、mp3（ID3 或 frame 同步）、m4a（ftyp）、aac（ADTS） */
function looksLikeAudio(ext: string, b: Uint8Array): boolean {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (ext === 'wav') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE'
  if (ext === 'm4a') return ascii(4, 4) === 'ftyp'
  if (ext === 'mp3') return ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)
  if (ext === 'aac') return b[0] === 0xff && (b[1]! & 0xf0) === 0xf0
  return false
}

/**
 * 檢查一個素材檔、存進這台裝置，回傳存了多少位元組。不合格的丟 Error（訊息給家長看）：不是圖片或音檔、太大、
 * 音檔的開頭對不上副檔名、圖片打不開、存不進去。同一個路徑會換成新的。
 * 檔案是外面來的（zip、雲端硬碟），一律不信任，所以兩種匯入都從這裡進來。
 * 不會自己通知畫面更新：一批存完再叫 bumpMedia()。
 */
export async function storeMediaFile(path: string, data: Uint8Array, drive?: MediaRecord['drive']): Promise<number> {
  const type = mediaType(path)
  if (!type) throw new Error('只收圖片（webp、jpg、png、gif、avif）和音檔（wav、mp3、m4a、aac）')
  const isImage = type.startsWith('image/')
  const limit = isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
  if (data.byteLength > limit) throw new Error(`檔案太大（上限 ${limit / 1048576} MB）`)
  if (!isImage && !looksLikeAudio(extOf(path), data)) throw new Error('不是正常的音檔')
  const blob = new Blob([data as BlobPart], { type })
  if (isImage && !(await canDecodeImage(blob))) throw new Error('圖片打不開')
  const rec: MediaRecord = { path, blob, at: Date.now(), ...(drive ? { drive } : {}) }
  const ok = await run('readwrite', (s) => s.put(rec))
  if (ok === null) throw new Error('這台裝置存不下（無痕視窗，或儲存空間不夠）')
  remember(rec)
  return blob.size
}

/**
 * 匯入素材包（zip）。同一個路徑會換成新的；沒匯入成功的不會影響已經存好的。
 * 整個 zip 打不開（不是 zip、壞掉）會丟錯，訊息可以直接給家長看。
 */
export async function importMediaZip(file: Blob, onProgress?: (done: number, total: number) => void): Promise<MediaReport> {
  const report: MediaReport = { saved: 0, bytes: 0, skipped: [], failed: [] }
  const bytes = new Uint8Array(await file.arrayBuffer())

  let entries
  try {
    entries = listZip(bytes)
  } catch (e) {
    if (e instanceof ZipError) throw new Error(`${e.message}。素材包要是 .zip 檔。`)
    throw e
  }
  if (entries.length > MAX_MEDIA_FILES) throw new Error(`素材包裡有 ${entries.length} 個檔案，最多 ${MAX_MEDIA_FILES} 個。`)
  if (entries.reduce((n, e) => n + e.usize, 0) > MAX_MEDIA_TOTAL) throw new Error('素材包解開來超過 300 MB，太大了。')

  let done = 0
  for (const e of entries) {
    onProgress?.(done++, entries.length)
    const path = cleanMediaPath(e.name)
    if (!path) {
      // 系統自己放的垃圾檔不用提，其他路徑不能用的才說
      if (!/__MACOSX|\.DS_Store|Thumbs\.db|(?:^|\/)\._/.test(e.name)) report.skipped.push({ name: e.name, why: '路徑不能用' })
      continue
    }
    const type = mediaType(path)
    if (!type) {
      report.skipped.push({ name: path, why: '只收圖片（webp、jpg、png、gif、avif）和音檔（wav、mp3、m4a、aac）' })
      continue
    }
    const isImage = type.startsWith('image/')
    if (e.usize > (isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES)) {
      report.skipped.push({ name: path, why: `檔案太大（上限 ${isImage ? 8 : 10} MB）` })
      continue
    }
    try {
      report.bytes += await storeMediaFile(path, await readZipEntry(bytes, e))
      report.saved++
    } catch (err) {
      report.failed.push({ name: path, why: (err as Error).message || '沒有存成功' })
    }
  }
  onProgress?.(entries.length, entries.length)
  bumpMedia()
  return report
}
