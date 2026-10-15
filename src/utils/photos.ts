import { shallowRef } from 'vue'

/**
 * 爸媽自己拍的照片，換掉字卡上的 emoji 或網路上的照片。
 *
 * ‧ 存在這台裝置的 IndexedDB（跟 utils/recordings.ts 的錄音一樣），不會寫進片單、不會上傳、
 *   不會跟著公開網站出去。每台裝置各自拍、各自存，換機器靠家長設定的「備份」搬
 * ‧ 照片另外存、不改片單的字：片單同步、字卡改字都不會蓋掉它，「還原預設圖」只要刪掉這一筆，
 *   就會退回片單上原本的圖（emoji 或 cards/ 底下的照片）
 * ‧ 存進來之前一律重畫過一次：縮到最長邊 720px、轉成 webp，順便把拍照時的 EXIF（位置、時間、
 *   手機型號）全部丟掉；這個網站會被孩子拿來看，家裡在哪裡不該跟著照片走
 * ‧ 不依賴 DOM：build-playlist 在 node 裡也會載入 cards.ts，這個檔案載入時不能碰 window、indexedDB
 */

export interface PhotoRecord {
  /** photoKey 開頭的字串，見下面三個 …Key 函式 */
  key: string
  blob: Blob
  at: number
}

interface Loaded extends PhotoRecord {
  /** 給 <img> 用的網址，只存在記憶體 */
  url: string
}

const DB_NAME = 'kidtube-photos'
const STORE = 'photos'

/** 縮圖的最長邊：一張約 50～150KB（JPEG），小朋友的 iPad 螢幕上看起來夠清楚 */
const MAX_EDGE = 720
/** 原檔上限：iPhone 的照片通常 2～5MB，超過這個多半不是照片 */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024
/** 存下來的圖長度上限，匯入備份時也用它擋掉不正常的檔案 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/**
 * 卡上這個字的照片：所有字是 apple 的卡一起換（不分字卡本、不分大小寫）。
 * 這跟共用資料夾裡 apple.jpg 的意思一樣，每台裝置拍的、匯入的照片，換到的卡才會一致。
 */
export function wordPhotoKey(word: string): string {
  return `word|${word.trim().toLowerCase()}`
}

/** 取代某個預設圖片路徑（放哪裡的地點照片）：卡片上所有用到這個路徑的地方都一起換 */
export function pathPhotoKey(path: string): string {
  return `path|${path}`
}

/**
 * 只換某一本字卡本裡的某一張卡（舊版的做法，新的照片都用 wordPhotoKey）。
 * 已經存在裝置上、或備份裡的還認得，而且比「依字」的優先。
 */
export function cardPhotoKey(deckUid: string, word: string): string {
  return `card|${deckUid}|${word.trim().toLowerCase()}`
}

/** 匯入備份時檢查 key 的長相 */
export function isPhotoKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 600 && /^(?:word|card|path)\|\S[^]*$/.test(key)
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
      // 無痕視窗、儲存空間被封鎖：照片功能就當作沒有，字卡照常用預設圖
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
        // 寫入要等整筆交易完成才算數（空間不夠會在 complete 之前以 abort 收場）
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

const photos = new Map<string, Loaded>()
/** 有增減就加一：畫面讀它才會跟著重畫（Map 本身不是響應式的） */
export const photosVersion = shallowRef(0)

function changed() {
  photosVersion.value++
}

function revoke(p: Loaded | undefined) {
  if (p) try { URL.revokeObjectURL(p.url) } catch { /* 略過 */ }
}

function remember(rec: PhotoRecord) {
  revoke(photos.get(rec.key))
  photos.set(rec.key, { ...rec, url: URL.createObjectURL(rec.blob) })
}

let loading: Promise<void> | null = null

/** 把裝置上的照片讀進記憶體；App 啟動時叫一次（讀不到就當作沒有換過照片） */
export function loadPhotos(): Promise<void> {
  loading ??= run<PhotoRecord[]>('readonly', (s) => s.getAll() as IDBRequest<PhotoRecord[]>).then((list) => {
    for (const r of list ?? []) {
      if (isPhotoKey(r?.key) && r.blob instanceof Blob) remember(r)
    }
    if (list?.length) changed()
  })
  return loading
}

/** 有沒有換過任何照片（沒有的話 cardsOf 不用多跑一輪） */
export function hasPhotos(): boolean {
  void photosVersion.value
  return photos.size > 0
}

/** 這個 key 有沒有換過照片，有的話回傳給 <img> 用的網址 */
export function photoUrl(key: string): string | undefined {
  void photosVersion.value
  return photos.get(key)?.url
}

export function getPhoto(key: string): PhotoRecord | undefined {
  void photosVersion.value
  const p = photos.get(key)
  return p ? { key: p.key, blob: p.blob, at: p.at } : undefined
}

/** 這張卡有沒有換過照片：只換這一本的優先，其次是依字換的 */
export function cardPhotoUrl(deckUid: string, word: string): string | undefined {
  return photoUrl(cardPhotoKey(deckUid, word)) ?? photoUrl(wordPhotoKey(word))
}

export function allPhotos(): PhotoRecord[] {
  void photosVersion.value
  return [...photos.values()]
    .map(({ key, blob, at }) => ({ key, blob, at }))
    .sort((a, b) => b.at - a.at)
}

export function photosBytes(): number {
  void photosVersion.value
  let n = 0
  for (const p of photos.values()) n += p.blob.size
  return n
}

/** 存一張（同一個 key 會換掉舊的）。存不進去（無痕視窗、空間不夠）會丟錯，不會假裝存好了 */
export async function putPhoto(rec: PhotoRecord): Promise<void> {
  const ok = await run('readwrite', (s) => s.put({ key: rec.key, blob: rec.blob, at: rec.at }))
  if (ok === null) throw new Error('這台裝置存不下照片（無痕視窗，或儲存空間不夠）。')
  remember(rec)
  changed()
  // 照片是家長花時間拍的，請瀏覽器別在空間不夠時清掉
  try { navigator.storage?.persist?.().catch(() => {}) } catch { /* 略過 */ }
}

export async function savePhoto(key: string, blob: Blob): Promise<void> {
  await putPhoto({ key, blob, at: Date.now() })
}

export async function removePhoto(key: string): Promise<void> {
  const had = photos.get(key)
  if (!had) return
  await run('readwrite', (s) => s.delete(key))
  revoke(had)
  photos.delete(key)
  changed()
}

export async function clearPhotos(): Promise<void> {
  if (!photos.size) return
  await run('readwrite', (s) => s.clear())
  for (const p of photos.values()) revoke(p)
  photos.clear()
  changed()
}

/* ---------- 拍照／選檔之後：檢查、縮小、轉檔 ---------- */

/** 圖片檔真的能打開才算數：回傳寬高。給匯入備份時檢查用 */
export async function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await decodeImage(url)
    return { w: img.naturalWidth, h: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('empty')))
    img.onerror = () => reject(new Error('decode'))
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * 拍好的照片／選的檔 → 要存的小圖，一律是 JPEG。
 * 重新畫一次，EXIF（GPS 位置、拍攝時間、手機型號）都不會帶過去；手機直拍的照片方向瀏覽器會自己轉正。
 * 輸出一律 JPEG（不是 webp）：iPhone 的 HEIC 也在這裡轉成 JPEG，存在這台、分享到雲端資料夾的都是
 * 每台裝置、每個瀏覽器都打得開的 jpg，分享選單也不用再轉一次。
 * 檔案不是圖片、壞掉打不開、是 SVG（裡面可以夾程式）都會丟錯，訊息可以直接給家長看。
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  if (file.size === 0) throw new Error('這個檔案是空的。')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('照片太大了（上限 40 MB）。')
  if (file.type && !/^image\/(?:jpeg|png|webp|heic|heif|gif|avif|bmp)$/i.test(file.type)) {
    throw new Error('只能用照片檔（jpg、png、webp、heic）。')
  }
  const isHeic = /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name ?? '')

  const url = URL.createObjectURL(file)
  try {
    let img: HTMLImageElement
    try {
      img = await decodeImage(url)
    } catch {
      throw new Error(isHeic
        ? '這張是 HEIC 格式，這個瀏覽器打不開。請改用 iPhone／iPad 的 Safari，或先轉成 JPG。'
        : '這張照片打不開，換一張試試看。')
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('這個瀏覽器處理不了照片。')
    // 有透明的 png 轉成 jpeg 會變黑，先鋪一層白底
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const out = await toBlob(canvas, 'image/jpeg', 0.85)
    if (!out || out.size === 0 || out.type !== 'image/jpeg') throw new Error('照片轉檔失敗。')
    if (out.size > MAX_PHOTO_BYTES) throw new Error('照片轉完還是太大，換一張試試看。')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}
