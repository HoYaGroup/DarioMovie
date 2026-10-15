import { MAX_IMPORT_FILES, PHOTO_EXT_RE, readFolderUrl, targetOf } from './photoFiles'
import { getPhoto, loadPhotos, preparePhoto, savePhoto } from './photos'
import {
  MAX_MEDIA_FILES, bumpMedia, cleanMediaPath, driveMedia, loadMedia, mediaLimit, mediaType, mediaUrl, removeMediaFiles, storeMediaFile,
} from './media'
import { clipKey, getClip, loadClips } from './recordings'
import { CLIP_EXT_RE, MAX_CLIP_FILE_BYTES, importClipFile } from './clipFiles'
import { lineOfFileName, type VoiceLine } from './voiceLines'

/**
 * 從 Google 雲端硬碟的資料夾同步（選填；家長按「立即同步」才會下載，不會自己跑）：填好資料夾網址和 Google API 金鑰，
 * 這台就能把資料夾裡的東西抓下來。一個資料夾管三種東西：
 *   ‧ 最上層的照片，和最上層 photos 子資料夾裡的照片（App 的「上傳」放的地方，utils/driveUpload.ts）：用檔名對卡
 *     （規則同 utils/photoFiles.ts：apple.jpg、place-kitchen.jpg），存成「換成家裡的照片」；photos 不當素材，不然會多下載一份
 *   ‧ 最上層的音檔：檔名就是那句話（I'm hungry.m4a，規則同 utils/clipFiles.ts），存成爸媽的錄音
 *   ‧ 子資料夾裡的圖片和音檔：資料夾結構跟「素材包」一樣（cards/books/animals/pets.webp），路徑就是試算表
 *     「圖」「背面圖」「聲音」欄寫的路徑，原樣存成素材（utils/media.ts）；雲端硬碟上刪掉的，這台也跟著刪
 *
 * ‧ 為什麼要金鑰：網頁沒辦法「列出」別人資料夾裡有哪些檔案，Google 只開放給帶 API 金鑰的 Drive API。
 *   金鑰由每位家長自己在 Google Cloud 建（免費、唯讀），只存在自己這台裝置，不進備份、不進 GitHub
 * ‧ 只讀：只對資料夾做「列出」和「下載」，不上傳、不改、不刪；資料夾要設成「知道連結的人都能檢視」
 * ‧ 只連 googleapis.com，金鑰只放在網址的 key= 裡，不寫進任何訊息、記錄
 * ‧ 抓下來的檔案一律當不可信的：照片照一般照片重新處理（縮小、轉 JPEG、去位置資訊、擋掉不是圖片的），
 *   素材檢查種類、大小、檔頭、圖片打不打得開才存（跟匯入素材包同一套），錄音要解得開、有聲音才收（跟批次匯入音檔同一套）
 * ‧ 只抓有變的：記下每個檔案的 id 和 md5，沒變就不再下載；本機的照片、錄音比資料夾的檔案新就不蓋掉
 * ‧ 錄音只加進來、不會因為資料夾裡沒有就刪（錄音是爸媽花時間錄的，只存在裝置上）
 * ‧ 沒有捷徑、Google 文件；最上層一次最多 400 張照片、1500 個錄音，素材最多 3000 個檔案、300 個子資料夾、8 層
 */

const API = 'https://www.googleapis.com/drive/v3'
const KEY_KEY = 'kidtube.driveKey'
const SYNCED_KEY = 'kidtube.driveSynced'
const LAST_KEY = 'kidtube.driveSyncLast'
/** 單一檔案上限：跟 preparePhoto 的原檔上限一樣 */
const MAX_FILE_BYTES = 40 * 1024 * 1024
/** 資料夾列表最多翻幾頁（一頁 200 個） */
const MAX_PAGES = 5

/** Google API 金鑰長得像 AIzaSy…（39 個字）：只收英數字、底線、連字號，擋掉貼錯的東西 */
const RE_KEY = /^[A-Za-z0-9_-]{20,80}$/
const RE_ID = /^[A-Za-z0-9_-]{10,}$/

export type DriveErrorCode = 'config' | 'network' | 'key' | 'api' | 'referrer' | 'quota' | 'notfound' | 'forbidden' | 'other'

/** 訊息可以直接給家長看 */
export class DriveError extends Error {
  readonly code: DriveErrorCode
  constructor(code: DriveErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/* ---------- 設定：金鑰（只存在這台）、資料夾網址（photoFiles.ts） ---------- */

/** 從貼上的網址（或單純的 id）取出資料夾 id；看不懂回 null */
export function folderIdOf(text: string): string | null {
  const t = text.trim()
  const hit = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? t.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (hit) return hit[1]!
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null
}

/** 整理金鑰：去掉頭尾空白；格式不對回 null，空字串表示清除 */
export function cleanApiKey(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  return RE_KEY.test(t) ? t : null
}

export function readApiKey(): string {
  try {
    return cleanApiKey(localStorage.getItem(KEY_KEY) ?? '') ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_KEY, key)
    else localStorage.removeItem(KEY_KEY)
  } catch { /* 略過 */ }
}

/** 網址和金鑰都設好了嗎 */
export function driveConfigured(): boolean {
  return !!readApiKey() && !!folderIdOf(readFolderUrl())
}

/* ---------- 同步記錄 ---------- */

interface Synced { id: string; md5: string }

function readSynced(): Record<string, Synced> {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '{}')
    const out: Record<string, Synced> = {}
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, Synced>)) {
        if (v && typeof v.id === 'string' && typeof v.md5 === 'string') out[k] = { id: v.id, md5: v.md5 }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeSynced(map: Record<string, Synced>) {
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify(map)) } catch { /* 略過 */ }
}

/** 上一次同步的結果，家長設定拿來顯示：saved／unchanged 是照片，clips 是錄音，media／mediaUnchanged／removed 是素材 */
export interface SyncLast {
  at: number
  saved: number
  unchanged: number
  clips?: number
  media?: number
  mediaUnchanged?: number
  removed?: number
  error?: string
}

export function readSyncLast(): SyncLast | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as SyncLast | null
    return v && typeof v.at === 'number'
      ? {
          at: v.at,
          saved: Number(v.saved) || 0,
          unchanged: Number(v.unchanged) || 0,
          clips: Number(v.clips) || 0,
          media: Number(v.media) || 0,
          mediaUnchanged: Number(v.mediaUnchanged) || 0,
          removed: Number(v.removed) || 0,
          error: typeof v.error === 'string' ? v.error : undefined,
        }
      : null
  } catch {
    return null
  }
}

export function writeSyncLast(last: SyncLast) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(last)) } catch { /* 略過 */ }
}

/** 換了資料夾或金鑰之後，舊的對應記錄不能再用（檔案 id 是上一個資料夾的） */
export function forgetSynced() {
  try {
    localStorage.removeItem(SYNCED_KEY)
    localStorage.removeItem(LAST_KEY)
  } catch { /* 略過 */ }
}

/* ---------- Google Drive API（只讀） ---------- */

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
  /** 檔案在雲端硬碟最後修改的時間（毫秒） */
  modifiedTime: number
  md5: string
}

async function errorOf(res: Response): Promise<DriveError> {
  let reason = ''
  let message = ''
  try {
    const body = await res.json() as { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } }
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? ''
    message = body?.error?.message ?? ''
  } catch { /* 不是 JSON */ }
  const text = `${reason} ${message}`.toLowerCase()
  const s = res.status

  if (s === 400 && /api key|keyinvalid/.test(text)) return new DriveError('key', 'API 金鑰不對，請重新複製（整串、前後不要有空白）。')
  if (s === 403 && /has not been used|accessnotconfigured|service_disabled|is disabled/.test(text)) {
    return new DriveError('api', '這把金鑰所在的 Google Cloud 專案還沒開啟「Google Drive API」，到「API 和服務 › 程式庫」搜尋 Google Drive API 按「啟用」。')
  }
  if ((s === 403 || s === 400) && /referer|referrer/.test(text)) {
    return new DriveError('referrer', '這把金鑰限制了可以使用的網站，目前這個網站不在允許名單裡（到金鑰的「網站限制」把這個網址加進去）。')
  }
  if ((s === 403 || s === 429) && /ratelimit|quota|dailylimit/.test(text)) {
    return new DriveError('quota', 'Google 說查詢太頻繁或今天的額度用完了，晚一點再試。')
  }
  if (s === 404) return new DriveError('notfound', '找不到這個資料夾：網址不對，或資料夾沒有設成「知道連結的人都能檢視」。')
  if (s === 401 || s === 403) return new DriveError('forbidden', '沒有權限讀這個資料夾：請把資料夾設成「知道連結的人都能檢視」。')
  return new DriveError('other', `Google 回傳錯誤（${s}），晚一點再試。`)
}

async function call(url: string): Promise<Response> {
  let res: Response
  try {
    // 不帶 cookie：只靠金鑰讀公開（連結分享）的資料夾，不會用到任何登入身分
    res = await fetch(url, { credentials: 'omit' })
  } catch {
    throw new DriveError('network', '連不上 Google（沒有網路，或被擋住了）。')
  }
  if (!res.ok) throw await errorOf(res)
  return res
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFolder { id: string; name: string }

/** 上傳的照片集中放的子資料夾（跟 scripts/apps-script/drive-upload.gs 的 PHOTO_DIR 一樣）：裡面的照片跟最上層的一樣依檔名換卡片的圖 */
export const PHOTO_DIR = 'photos'
const isPhotoDir = (f: DriveFolder) => f.name.trim().toLowerCase() === PHOTO_DIR

/** 列出資料夾裡的檔案和子資料夾（一層）。回來的資料都是外面來的，逐欄檢查過才收；truncated＝太多了沒有列完 */
async function listChildren(folderId: string, apiKey: string): Promise<{ files: DriveFile[]; folders: DriveFolder[]; truncated: boolean }> {
  if (!RE_ID.test(folderId)) throw new DriveError('config', '資料夾網址看不懂。')
  const files: DriveFile[] = []
  const folders: DriveFolder[] = []
  let pageToken = ''
  let truncated = false
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key: apiKey,
    })
    if (pageToken) p.set('pageToken', pageToken)
    const body = await (await call(`${API}/files?${p}`)).json() as { nextPageToken?: string; files?: Array<Record<string, unknown>> }
    for (const f of body.files ?? []) {
      if (typeof f.id !== 'string' || !RE_ID.test(f.id) || typeof f.name !== 'string' || f.name.length > 300) continue
      const mimeType = typeof f.mimeType === 'string' ? f.mimeType : ''
      if (mimeType === FOLDER_MIME) {
        folders.push({ id: f.id, name: f.name })
        continue
      }
      const modified = Date.parse(String(f.modifiedTime ?? ''))
      files.push({
        id: f.id,
        name: f.name,
        mimeType,
        size: Number(f.size) || 0,
        modifiedTime: Number.isFinite(modified) ? modified : 0,
        md5: typeof f.md5Checksum === 'string' ? f.md5Checksum : '',
      })
    }
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : ''
    if (!pageToken) break
    if (i === MAX_PAGES - 1) truncated = true
  }
  return { files, folders, truncated }
}

/** 列出資料夾裡的檔案（不含子資料夾） */
export async function listFolder(folderId: string, apiKey: string): Promise<DriveFile[]> {
  return (await listChildren(folderId, apiKey)).files
}

/** 子資料夾裡的檔案，path 是從最上層算起的路徑（cards/books/a.webp） */
interface DriveNode { path: string; file: DriveFile }

/** 每一層同時讀幾個資料夾 */
const LIST_PARALLEL = 6
const MAX_FOLDERS = 300
const MAX_DEPTH = 8

/** Drive 的檔名可以有 / 和 \，路徑就分不清楚了：這種名字不收 */
const badName = (name: string) => /[\\/]/.test(name)

/**
 * 從最上層的子資料夾一層一層往下讀，收集所有檔案和它們的路徑。
 * complete＝全部都讀完了（資料夾太多、太深、名稱不能用沒辦法往下讀，或單一資料夾檔案太多，就不算完整，這時不能拿來判斷「雲端硬碟上已經沒有了」）。
 */
async function listTree(top: DriveFolder[], apiKey: string): Promise<{ nodes: DriveNode[]; complete: boolean; bad: string[] }> {
  const nodes: DriveNode[] = []
  const bad: string[] = []
  let complete = true
  let folderCount = 0
  const enqueue = (list: DriveFolder[], parent: string, depth: number, out: Array<{ id: string; path: string; depth: number }>) => {
    for (const f of list) {
      const path = parent ? `${parent}/${f.name}` : f.name
      if (badName(f.name)) { bad.push(path); complete = false; continue }
      if (depth > MAX_DEPTH || ++folderCount > MAX_FOLDERS) { complete = false; continue }
      out.push({ id: f.id, path, depth })
    }
  }
  let level: Array<{ id: string; path: string; depth: number }> = []
  enqueue(top, '', 1, level)
  while (level.length) {
    const next: typeof level = []
    for (let i = 0; i < level.length; i += LIST_PARALLEL) {
      const batch = level.slice(i, i + LIST_PARALLEL)
      const results = await Promise.all(batch.map(async (dir) => ({ dir, kids: await listChildren(dir.id, apiKey) })))
      for (const { dir, kids } of results) {
        if (kids.truncated) complete = false
        for (const f of kids.files) {
          // 名稱不能用的檔案只是不收它，其他檔案都讀到了，所以不算「沒讀完」
          if (badName(f.name)) { bad.push(`${dir.path}/${f.name}`); continue }
          nodes.push({ path: `${dir.path}/${f.name}`, file: f })
        }
        enqueue(kids.folders, dir.path, dir.depth + 1, next)
      }
    }
    level = next
  }
  return { nodes, complete, bad }
}

async function downloadFile(f: DriveFile, apiKey: string): Promise<File> {
  const p = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true', key: apiKey })
  const blob = await (await call(`${API}/files/${encodeURIComponent(f.id)}?${p}`)).blob()
  if (blob.size === 0 || blob.size > MAX_FILE_BYTES) throw new Error('檔案是空的，或太大了。')
  return new File([blob], f.name, { type: f.mimeType || blob.type, lastModified: f.modifiedTime })
}

/* ---------- 同步 ---------- */

/** 子資料夾裡的素材（圖片、音檔）這次同步的結果 */
export interface MediaSyncReport {
  /** 子資料夾裡的圖片和音檔數 */
  total: number
  /** 這次下載並存好的 */
  saved: number
  /** 上次就同步過、沒有變的 */
  unchanged: number
  /** 雲端硬碟上已經沒有、這台跟著刪掉的 */
  removed: number
  /** 同一個路徑有好幾個檔，只用了最新的，其他略過 */
  older: string[]
  /** 不是圖片或音檔的檔 */
  ignored: number
  failed: Array<{ name: string; why: string }>
  /** 資料夾太多、太深或檔名不能用，沒有讀完（這時不會刪這台的素材） */
  partial: boolean
}

/** 最上層的音檔（爸媽的錄音）這次同步的結果 */
export interface ClipSyncReport {
  /** 這次下載並存好的檔名 */
  saved: string[]
  /** 這台已經有、沒有變的（或是這台自己存上去的）句數 */
  unchanged: number
  /** 這台的錄音比資料夾的檔案新，沒有蓋掉的 */
  localNewer: string[]
  /** 檔名對不到任何一句話 */
  unmatched: string[]
  /** 同一句有好幾個檔，只用了最新的，其他略過 */
  older: string[]
  failed: Array<{ name: string; why: string }>
}

export interface DriveSyncReport {
  /** 最上層的檔案數（照片、錄音和其他） */
  total: number
  /** 這次下載並換成功的檔名 */
  saved: string[]
  /** 上次就同步過、沒有變的張數 */
  unchanged: number
  /** 這台的照片比資料夾的檔案新，沒有蓋掉的 */
  localNewer: string[]
  /** 檔名對不到任何卡或地點 */
  unmatched: string[]
  /** 同一個名字有好幾個檔，只用了最新的，其他略過 */
  older: string[]
  /** 不是照片的檔 */
  ignored: number
  failed: Array<{ name: string; why: string }>
  clips: ClipSyncReport
  media: MediaSyncReport
}

/** 同步進度：done／total 是這一段要下載的檔案數 */
export type SyncProgress = (done: number, total: number) => void

let running: Promise<DriveSyncReport> | null = null

/**
 * 把資料夾裡的照片、錄音、素材同步到這台。同一時間只跑一份（連按兩次共用同一次）。
 * words 是卡上有哪些字（對照片檔名）、lines 是有哪些句子（對錄音檔名）。
 * 設定不對、連不上、Google 拒絕會丟 DriveError（訊息給家長看）；單一檔案壞掉只記在 failed，不影響其他。
 */
export function syncFromDrive(
  folderUrl: string, apiKey: string, words: Map<string, string>, lines: Map<string, VoiceLine>, onProgress?: SyncProgress,
): Promise<DriveSyncReport> {
  running ??= run(folderUrl, apiKey, words, lines, onProgress).finally(() => { running = null })
  return running
}

/** 同時下載幾個檔案 */
const PARALLEL = 4
/** 最上層一次最多幾個錄音 */
const MAX_CLIPS = 1500

/** 這些錯是整次同步都會碰到的（金鑰、網路、額度）；找不到、沒權限、其他只是這一個檔案的問題 */
const isGlobal = (e: DriveError) => !['notfound', 'forbidden', 'other'].includes(e.code)

/**
 * 一次同時做幾件事：items 一個一個交給 work，全部做完才回來。
 * work 裡碰到整次都會碰到的錯（isGlobal）就把它丟進 stop.error，其他的人看到就不再接新的工作。
 */
async function pool<T>(items: T[], stop: { error: DriveError | null }, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (!stop.error) {
      const item = items[cursor++]
      if (item === undefined) return
      await work(item)
    }
  }))
}

/** 在 pool 的 work 裡接住錯誤：整次都會碰到的記下來停掉，其他的交給 onFile */
function guard(stop: { error: DriveError | null }, onFile: (e: unknown) => void) {
  return (e: unknown) => {
    if (e instanceof DriveError && isGlobal(e)) stop.error ??= e
    else onFile(e)
  }
}

/**
 * 最上層的音檔 → 爸媽的錄音（檔名就是那句話）。只加進來、不刪。
 * 同一句這台已經有大小一樣的，多半就是這台自己存上去的，不再抓回來；這台比資料夾新的不蓋掉。
 */
async function syncClips(
  files: DriveFile[], lines: Map<string, VoiceLine>, apiKey: string, synced: Record<string, Synced>, onProgress?: SyncProgress,
): Promise<ClipSyncReport> {
  const report: ClipSyncReport = { saved: [], unchanged: 0, localNewer: [], unmatched: [], older: [], failed: [] }
  if (!files.length) return report
  await loadClips()

  const groups = new Map<string, { line: VoiceLine; files: DriveFile[] }>()
  for (const f of files) {
    if (f.size > MAX_CLIP_FILE_BYTES) {
      report.failed.push({ name: f.name, why: '檔案太大了（上限 30 MB）' })
      continue
    }
    const line = lineOfFileName(lines, f.name)
    if (!line) {
      report.unmatched.push(f.name)
      continue
    }
    const key = clipKey(line.text, line.lang)
    const g = groups.get(key) ?? { line, files: [] }
    g.files.push(f)
    groups.set(key, g)
  }

  const todo: Array<{ key: string; line: VoiceLine; file: DriveFile }> = []
  for (const [key, g] of groups) {
    const [newest, ...rest] = [...g.files].sort((a, b) => b.modifiedTime - a.modifiedTime) as [DriveFile, ...DriveFile[]]
    report.older.push(...rest.map((f) => f.name))
    const syncKey = `clip|${key}`
    const existing = getClip(g.line.text, g.line.lang)
    const before = synced[syncKey]
    if (existing && before && before.id === newest.id && before.md5 === newest.md5) {
      report.unchanged++
      continue
    }
    if (existing && !before && existing.blob.size === newest.size) {
      synced[syncKey] = { id: newest.id, md5: newest.md5 }
      report.unchanged++
      continue
    }
    if (existing && existing.at >= newest.modifiedTime) {
      report.localNewer.push(newest.name)
      continue
    }
    todo.push({ key: syncKey, line: g.line, file: newest })
  }

  let done = 0
  const stop: { error: DriveError | null } = { error: null }
  onProgress?.(0, todo.length)
  await pool(todo, stop, async (item) => {
    try {
      const r = await importClipFile(item.line, await downloadFile(item.file, apiKey))
      if ('why' in r) report.failed.push({ name: item.file.name, why: r.why })
      else {
        synced[item.key] = { id: item.file.id, md5: item.file.md5 }
        report.saved.push(item.file.name)
      }
    } catch (e) {
      guard(stop, (err) => report.failed.push({ name: item.file.name, why: (err as Error).message || '沒有存成功。' }))(e)
    }
    onProgress?.(++done, todo.length)
  })
  if (stop.error) throw stop.error
  return report
}

/**
 * 子資料夾裡的圖片和音檔 → 素材（路徑就是檔案在資料夾裡的位置）。
 * 沒變的（id 和 md5 一樣）不下載；雲端硬碟上已經沒有的，這台從雲端硬碟抓來的也刪掉（匯入素材包的不動）。
 */
async function syncMedia(top: DriveFolder[], apiKey: string, onProgress?: SyncProgress): Promise<MediaSyncReport> {
  const report: MediaSyncReport = { total: 0, saved: 0, unchanged: 0, removed: 0, older: [], ignored: 0, failed: [], partial: false }
  if (!top.length) return report
  await loadMedia()

  const { nodes, complete, bad } = await listTree(top, apiKey)
  report.partial = !complete
  for (const p of bad) report.failed.push({ name: p, why: '名稱裡有 / 或 \\，路徑會分不清楚，沒有收。' })

  // 同一個路徑（Drive 允許同一個資料夾裡兩個同名檔案）只留最新的
  const byPath = new Map<string, DriveNode[]>()
  for (const n of nodes) {
    const path = cleanMediaPath(n.path)
    if (!path || !mediaType(path) || n.file.mimeType.startsWith('application/vnd.google-apps.')) {
      report.ignored++
      continue
    }
    const list = byPath.get(path) ?? []
    list.push(n)
    byPath.set(path, list)
  }
  if (byPath.size > MAX_MEDIA_FILES) throw new DriveError('other', `資料夾裡有 ${byPath.size} 個圖片和音檔，一次最多同步 ${MAX_MEDIA_FILES} 個。`)

  const known = driveMedia()
  const todo: Array<{ path: string; file: DriveFile }> = []
  for (const [path, list] of byPath) {
    const [newest, ...rest] = [...list].sort((a, b) => b.file.modifiedTime - a.file.modifiedTime) as [DriveNode, ...DriveNode[]]
    report.older.push(...rest.map((x) => x.path))
    report.total++
    const limit = mediaLimit(path)!
    if (newest.file.size > limit) {
      report.failed.push({ name: path, why: `檔案太大（上限 ${limit / 1048576} MB）` })
      continue
    }
    const before = known.get(path)
    if (before && before.id === newest.file.id && newest.file.md5 && before.md5 === newest.file.md5 && mediaUrl(path)) {
      report.unchanged++
      continue
    }
    todo.push({ path, file: newest.file })
  }

  // 幾個檔案同時下載：一個一個來，幾百個檔案會等很久
  let done = 0
  const stop: { error: DriveError | null } = { error: null }
  onProgress?.(0, todo.length)
  await pool(todo, stop, async (item) => {
    try {
      const data = new Uint8Array(await (await downloadFile(item.file, apiKey)).arrayBuffer())
      await storeMediaFile(item.path, data, { id: item.file.id, md5: item.file.md5 })
      report.saved++
    } catch (e) {
      guard(stop, (err) => report.failed.push({ name: item.path, why: (err as Error).message || '沒有存成功。' }))(e)
    }
    onProgress?.(++done, todo.length)
  })
  if (report.saved) bumpMedia()
  if (stop.error) throw stop.error

  // 雲端硬碟上已經沒有的，這台也刪（沒讀完、或資料夾裡一個素材都沒有的時候不刪，免得出一點狀況就把整批清掉）
  if (complete && byPath.size) {
    report.removed = await removeMediaFiles([...driveMedia().keys()].filter((p) => !byPath.has(p)))
  }
  return report
}

async function run(folderUrl: string, apiKey: string, words: Map<string, string>, lines: Map<string, VoiceLine>, onProgress?: SyncProgress): Promise<DriveSyncReport> {
  const folderId = folderIdOf(folderUrl)
  if (!folderId) throw new DriveError('config', '請先填資料夾網址（https://drive.google.com/drive/folders/… 那一串）。')
  if (!RE_KEY.test(apiKey)) throw new DriveError('config', '請先填 Google API 金鑰。')

  await loadPhotos()
  const top = await listChildren(folderId, apiKey)
  const files = top.files
  // photos 子資料夾（一層）：裡面的圖片當照片，其他子資料夾才是路徑對應的素材
  const photoDirs = top.folders.filter(isPhotoDir)
  const mediaDirs = top.folders.filter((f) => !isPhotoDir(f))
  const dirFiles: DriveFile[] = []
  for (const d of photoDirs) dirFiles.push(...(await listChildren(d.id, apiKey)).files)
  const report: DriveSyncReport = {
    total: files.length + dirFiles.length, saved: [], unchanged: 0, localNewer: [], unmatched: [], older: [], ignored: 0, failed: [],
    clips: { saved: [], unchanged: 0, localNewer: [], unmatched: [], older: [], failed: [] },
    media: { total: 0, saved: 0, unchanged: 0, removed: 0, older: [], ignored: 0, failed: [], partial: false },
  }

  // 最上層的檔案：圖片是照片、音檔是錄音，其他略過
  const clipFiles: DriveFile[] = []
  const photoFiles: DriveFile[] = []
  for (const f of files) {
    if (/^audio\//i.test(f.mimeType) || CLIP_EXT_RE.test(f.name)) clipFiles.push(f)
    else photoFiles.push(f)
  }
  photoFiles.push(...dirFiles)
  if (photoFiles.length > MAX_IMPORT_FILES) throw new DriveError('other', `資料夾最上層和 ${PHOTO_DIR} 資料夾共有 ${photoFiles.length} 個檔案，一次最多同步 ${MAX_IMPORT_FILES} 個。`)
  if (clipFiles.length > MAX_CLIPS) throw new DriveError('other', `資料夾最上層有 ${clipFiles.length} 個音檔，一次最多同步 ${MAX_CLIPS} 個。`)

  // 依對到的照片分組，每組只看最新的那個檔
  const groups = new Map<string, DriveFile[]>()
  for (const f of photoFiles) {
    if (!/^image\//i.test(f.mimeType) && !PHOTO_EXT_RE.test(f.name)) {
      report.ignored++
      continue
    }
    if (f.size > MAX_FILE_BYTES) {
      report.failed.push({ name: f.name, why: '檔案太大了（上限 40 MB）。' })
      continue
    }
    const key = targetOf(f.name, words)
    if (!key) {
      report.unmatched.push(f.name)
      continue
    }
    const list = groups.get(key) ?? []
    list.push(f)
    groups.set(key, list)
  }

  const synced = readSynced()
  for (const [key, list] of groups) {
    const [newest, ...rest] = [...list].sort((a, b) => b.modifiedTime - a.modifiedTime) as [DriveFile, ...DriveFile[]]
    report.older.push(...rest.map((f) => f.name))

    // 上次同步的就是這個檔、內容沒變：不用再下載
    const before = synced[key]
    if (before && before.id === newest.id && before.md5 === newest.md5 && getPhoto(key)) {
      report.unchanged++
      continue
    }
    // 這台自己拍的、比資料夾的檔案還新：以這台為準
    const existing = getPhoto(key)
    if (existing && existing.at >= newest.modifiedTime) {
      report.localNewer.push(newest.name)
      continue
    }

    try {
      await savePhoto(key, await preparePhoto(await downloadFile(newest, apiKey)))
      synced[key] = { id: newest.id, md5: newest.md5 }
      report.saved.push(newest.name)
    } catch (e) {
      // 連線、金鑰、額度的問題不是這一個檔的錯，整次停下來讓家長看到原因
      if (e instanceof DriveError) {
        writeSynced(synced)
        throw e
      }
      report.failed.push({ name: newest.name, why: (e as Error).message || '沒有存成功。' })
    }
  }

  // 最上層的音檔 → 爸媽的錄音（照片已經記進 synced，錄音出錯停下來時一起記下來）
  try {
    report.clips = await syncClips(clipFiles, lines, apiKey, synced, onProgress)
  } finally {
    writeSynced(synced)
  }

  // 子資料夾裡的素材（cards/books/… 這種跟素材包一樣的結構）
  report.media = await syncMedia(mediaDirs, apiKey, onProgress)
  return report
}
