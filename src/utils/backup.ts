import { shallowRef } from 'vue'
import { allClips, loadClips, restoreClip, type Clip, type ClipLang } from './recordings'
import { MAX_PHOTO_BYTES, allPhotos, imageSize, isPhotoKey, loadPhotos, putPhoto, type PhotoRecord } from './photos'

/**
 * 這台裝置的備份：爸媽拍的照片、錄的聲音，加上幾項設定，包成一個檔案。
 * iPad 壞了、重灌、要換新的，把這個檔案匯入就全部回來。檔案由家長自己存到「檔案」App 或 Google 雲端硬碟，
 * 程式本身不連任何雲端，也沒有任何帳號或金鑰。
 *
 * 檔案長相（照片、錄音是原樣的位元組，不轉 base64，幾十 MB 也不會吃光記憶體）：
 *   「KTBK」 版本(1) 旗標(1)
 *   旗標沒有加密：  ［長度(4)］［標頭 JSON］［照片…］［錄音…］
 *   旗標有加密(1)： 迭代次數(4) salt(16) iv(12)，後面是上面那一整段用 AES-256-GCM 加密的結果
 *                   （密碼用 PBKDF2-SHA256 變成金鑰，前 10 個位元組一起驗證，被改過就解不開）
 *
 * 安全：
 *   ‧ 不備份家長密碼（PIN）：備份檔會放在雲端，裡面不該有進得了家長設定的鑰匙，還原後請重設
 *   ‧ 家裡的照片、孩子的聲音可以設一個備份密碼加密；忘了密碼就打不開，沒有後門
 *   ‧ 還原時檔案當作不可信：設定只收白名單裡的項目，照片、錄音的格式、大小、數量都要對得上，
 *     照片真的打得開才收，任何一處不對就整份拒絕，不會收一半
 */

export const BACKUP_EXT = 'kidtube'

/** 備份裡帶走的設定（localStorage 的 key）。沒有家長密碼、觀看紀錄、休息倒數這些不該搬走的 */
export const BACKUP_SETTING_KEYS = [
  'kidtube.library.v2',     // 片單（含在這台裝置上加的影片）
  'kidtube.playlistHash',   // 片單對應的檔案版本，沒有它還原後會立刻被檔案蓋掉
  'kidtube.sheetUrl',       // Google 試算表片單的連結（知道連結的人看得到那份片單，備份檔設密碼才不會外流）
  'kidtube.appTitle',
  'kidtube.localEdits',     // 在這台裝置上改過的字卡、標題、網址、班級
  'kidtube.child',          // 孩子的年紀
  'kidtube.childName',
  'kidtube.cardStars',
  'kidtube.missions',       // 任務貼紙
  'kidtube.watchSettings',  // 每日上限、休息設定
  'kidtube.cardLang',
  'kidtube.display',
  'kidtube.theme',
] as const

const LAST_KEY = 'kidtube.lastBackup'

const MAGIC = [0x4b, 0x54, 0x42, 0x4b] // KTBK
const VERSION = 1
const FLAG_ENCRYPTED = 1
const PBKDF2_ITER = 250_000
/** 檔案裡寫的迭代次數太大會讓這台裝置卡住很久，超過就當作壞檔 */
const MAX_ITER = 2_000_000

const MAX_BACKUP_BYTES = 600 * 1024 * 1024
const MAX_HEADER_BYTES = 32 * 1024 * 1024
const MAX_SETTING_BYTES = 16 * 1024 * 1024
const MAX_CLIP_BYTES = 30 * 1024 * 1024
const MAX_PHOTOS = 3000
const MAX_CLIPS = 6000
const PHOTO_TYPES = ['image/webp', 'image/jpeg', 'image/png']

interface PhotoEntry { key: string; at: number; type: string; size: number }
interface ClipEntry { key: string; text: string; lang: ClipLang; trim: [number, number] | null; ms: number; at: number; type: string; size: number }

interface Header {
  app: 'kidtube'
  v: number
  at: number
  settings: Record<string, string>
  photos: PhotoEntry[]
  clips: ClipEntry[]
}

export interface BackupSummary {
  /** 備份做好的時間 */
  at: number
  photos: number
  clips: number
  /** 帶了幾項設定 */
  settings: number
  /** 檔案大小 */
  bytes: number
  encrypted: boolean
}

export type BackupErrorCode = 'not-backup' | 'unsupported' | 'password-needed' | 'bad-password' | 'corrupt' | 'too-big' | 'no-crypto'

/** 訊息可以直接給家長看 */
export class BackupError extends Error {
  readonly code: BackupErrorCode
  constructor(code: BackupErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/* ---------- 上次備份：畫面用它提醒「有東西還沒備份」 ---------- */

function readLast(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** 上次備份（或還原）的時間，從來沒有就是 null */
export const lastBackupAt = shallowRef<number | null>(readLast())

export function markBackedUp(at = Date.now()) {
  lastBackupAt.value = at
  try { localStorage.setItem(LAST_KEY, String(at)) } catch { /* 略過 */ }
}

/* ---------- 加解密 ---------- */

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new BackupError('no-crypto', '這個瀏覽器不支援加密，請不要設備份密碼，或換 Safari／Chrome。')
  return s
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtle()
  const raw = await s.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return s.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ---------- 做備份 ---------- */

export async function buildBackup(passphrase = ''): Promise<{ blob: Blob; summary: BackupSummary }> {
  await Promise.all([loadPhotos(), loadClips()])
  const photos = allPhotos()
  const clips = allClips()

  const settings: Record<string, string> = {}
  for (const k of BACKUP_SETTING_KEYS) {
    try {
      const v = localStorage.getItem(k)
      if (v !== null) settings[k] = v
    } catch { /* 略過 */ }
  }

  const at = Date.now()
  const header: Header = {
    app: 'kidtube',
    v: VERSION,
    at,
    settings,
    photos: photos.map((p) => ({ key: p.key, at: p.at, type: p.blob.type, size: p.blob.size })),
    clips: clips.map((c) => ({
      key: c.key, text: c.text, lang: c.lang, trim: c.trim, ms: c.ms, at: c.at, type: c.blob.type, size: c.blob.size,
    })),
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, headerBytes.length, true)
  const body = new Blob([len, headerBytes, ...photos.map((p) => p.blob), ...clips.map((c) => c.blob)])

  let blob: Blob
  if (passphrase) {
    const prefix = new Uint8Array(10)
    prefix.set(MAGIC)
    prefix[4] = VERSION
    prefix[5] = FLAG_ENCRYPTED
    new DataView(prefix.buffer).setUint32(6, PBKDF2_ITER, true)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(passphrase, salt, PBKDF2_ITER)
    const sealed = await subtle().encrypt(
      { name: 'AES-GCM', iv, additionalData: prefix },
      key,
      await body.arrayBuffer(),
    )
    blob = new Blob([prefix, salt, iv, sealed], { type: 'application/octet-stream' })
  } else {
    blob = new Blob([new Uint8Array([...MAGIC, VERSION, 0]), body], { type: 'application/octet-stream' })
  }

  return {
    blob,
    summary: { at, photos: photos.length, clips: clips.length, settings: Object.keys(settings).length, bytes: blob.size, encrypted: !!passphrase },
  }
}

/** 備份檔的建議檔名：kidtube-備份-2026-10-14.kidtube */
export function backupFileName(at = Date.now()): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `kidtube-備份-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${BACKUP_EXT}`
}

/**
 * 把備份檔交給家長：iPad 上用分享選單（存到「檔案」、Google 雲端硬碟），不能分享就下載。
 * 分享選單要在按鈕剛按下去的那一刻叫出來，所以備份檔要先做好，再由另一個按鈕呼叫這裡。
 */
export async function saveBackupFile(blob: Blob, name: string, mode: 'share' | 'download'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (mode === 'share') {
    try {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
      if (!navigator.canShare?.({ files: [file] })) throw new Error('no-share')
      await navigator.share({ files: [file], title: name })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
      // 這台不能分享檔案：往下改成下載
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // 給瀏覽器一點時間開始下載再收掉網址
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return 'downloaded'
}

/* ---------- 讀備份 ---------- */

export interface OpenedBackup {
  header: Header
  /** 解密後（沒加密就是原檔去掉前 6 個位元組）的內容，照片、錄音依標頭的順序接在標頭後面 */
  body: Blob
  /** 第一張照片從 body 的第幾個位元組開始 */
  dataStart: number
  summary: BackupSummary
}

const corrupt = (why: string) => new BackupError('corrupt', `備份檔的內容不正確（${why}），沒有動到這台裝置上的資料。`)

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isSize = (n: unknown, max: number): n is number => isNum(n) && Number.isInteger(n) && n > 0 && n <= max
const isAudioType = (t: unknown): t is string => typeof t === 'string' && t.length <= 100 && /^audio\/[\w.+-]+(?:;[\w =.,"+-]*)?$/i.test(t)

/** 標頭是檔案裡讀出來的，什麼都可能有：逐項確認長相，不對就整份拒絕 */
function checkHeader(raw: unknown): Header {
  if (!raw || typeof raw !== 'object') throw corrupt('標頭')
  const h = raw as Record<string, unknown>
  if (h.app !== 'kidtube') throw new BackupError('not-backup', '這不是這個 App 做的備份檔。')
  if (h.v !== VERSION) throw new BackupError('unsupported', '這個備份是比較新的版本做的，請先把 App 更新到最新版再還原。')
  if (!isNum(h.at)) throw corrupt('時間')

  const settings: Record<string, string> = {}
  if (h.settings !== undefined) {
    if (!h.settings || typeof h.settings !== 'object' || Array.isArray(h.settings)) throw corrupt('設定')
    for (const [k, v] of Object.entries(h.settings as Record<string, unknown>)) {
      // 白名單以外的項目（以後版本新增的、或被塞進來的）一律不收
      if (!(BACKUP_SETTING_KEYS as readonly string[]).includes(k)) continue
      if (typeof v !== 'string' || v.length > MAX_SETTING_BYTES) throw corrupt('設定')
      settings[k] = v
    }
  }

  if (!Array.isArray(h.photos) || h.photos.length > MAX_PHOTOS) throw corrupt('照片數量')
  const photos = h.photos.map((p: Record<string, unknown>): PhotoEntry => {
    if (!p || !isPhotoKey(p.key) || !isNum(p.at) || !isSize(p.size, MAX_PHOTO_BYTES)
      || typeof p.type !== 'string' || !PHOTO_TYPES.includes(p.type)) throw corrupt('照片')
    return { key: p.key, at: p.at, type: p.type, size: p.size }
  })

  if (!Array.isArray(h.clips) || h.clips.length > MAX_CLIPS) throw corrupt('錄音數量')
  const clips = h.clips.map((c: Record<string, unknown>): ClipEntry => {
    const lang = c?.lang
    const trim = c?.trim
    const trimOk = trim === null
      || (Array.isArray(trim) && trim.length === 2 && isNum(trim[0]) && isNum(trim[1]) && trim[0] >= 0 && trim[0] < trim[1] && trim[1] <= 3600)
    if (!c || (lang !== 'en-US' && lang !== 'zh-TW') || typeof c.key !== 'string' || !c.key.startsWith(`${lang}|`) || c.key.length > 600
      || typeof c.text !== 'string' || c.text.length > 600 || !trimOk || !isNum(c.ms) || c.ms < 0 || c.ms > 3_600_000
      || !isNum(c.at) || !isSize(c.size, MAX_CLIP_BYTES) || !isAudioType(c.type)) throw corrupt('錄音')
    return { key: c.key, text: c.text, lang, trim: trim as [number, number] | null, ms: c.ms, at: c.at, type: c.type, size: c.size }
  })

  return { app: 'kidtube', v: VERSION, at: h.at, settings, photos, clips }
}

/** 打開備份檔，檢查格式（還沒動這台裝置上的任何資料）。有加密的要給密碼，沒給會丟 password-needed */
export async function openBackup(file: Blob, passphrase = ''): Promise<OpenedBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too-big', '這個檔案太大了，不像是備份檔。')

  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer())
  if (head.length < 6 || MAGIC.some((b, i) => head[i] !== b)) throw new BackupError('not-backup', '這不是這個 App 做的備份檔。')
  if (head[4] !== VERSION) throw new BackupError('unsupported', '這個備份是比較新的版本做的，請先把 App 更新到最新版再還原。')

  const encrypted = (head[5]! & FLAG_ENCRYPTED) === FLAG_ENCRYPTED
  let body: Blob
  if (encrypted) {
    if (head.length < 10 || file.size < 38 + 16) throw corrupt('檔案被截斷')
    const iterations = new DataView(head.buffer).getUint32(6, true)
    if (iterations < 1000 || iterations > MAX_ITER) throw corrupt('加密參數')
    if (!passphrase) throw new BackupError('password-needed', '這個備份有設密碼，請輸入備份密碼。')
    const salt = new Uint8Array(await file.slice(10, 26).arrayBuffer())
    const iv = new Uint8Array(await file.slice(26, 38).arrayBuffer())
    const key = await deriveKey(passphrase, salt, iterations)
    try {
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: head.slice(0, 10) }, key, await file.slice(38).arrayBuffer())
      body = new Blob([plain])
    } catch (e) {
      if (e instanceof BackupError) throw e
      // 密碼不對，或檔案被改過（GCM 兩種都會失敗）
      throw new BackupError('bad-password', '密碼不對，或是檔案已經損壞。')
    }
  } else {
    body = file.slice(6)
  }

  if (body.size < 4) throw corrupt('檔案被截斷')
  const headerLen = new DataView(await body.slice(0, 4).arrayBuffer()).getUint32(0, true)
  if (headerLen > MAX_HEADER_BYTES || 4 + headerLen > body.size) throw corrupt('標頭長度')

  let parsed: unknown
  try {
    parsed = JSON.parse(await body.slice(4, 4 + headerLen).text())
  } catch {
    throw corrupt('標頭')
  }
  const header = checkHeader(parsed)

  const dataStart = 4 + headerLen
  const dataBytes = header.photos.reduce((n, p) => n + p.size, 0) + header.clips.reduce((n, c) => n + c.size, 0)
  if (dataStart + dataBytes !== body.size) throw corrupt('檔案長度對不上')

  return {
    header,
    body,
    dataStart,
    summary: {
      at: header.at,
      photos: header.photos.length,
      clips: header.clips.length,
      settings: Object.keys(header.settings).length,
      bytes: file.size,
      encrypted,
    },
  }
}

/**
 * 把備份放回這台裝置：照片、錄音「加進去」（同一張、同一句用備份的蓋掉），設定整項換成備份裡的。
 * 先確認每張照片都打得開，才開始寫入，壞檔不會寫到一半。寫完後要重新載入頁面，各處的設定才會讀新的。
 */
export async function applyBackup(o: OpenedBackup): Promise<{ photos: number; clips: number; settings: number }> {
  let offset = o.dataStart

  const photos: PhotoRecord[] = []
  for (const p of o.header.photos) {
    const blob = o.body.slice(offset, offset + p.size, p.type)
    offset += p.size
    try {
      await imageSize(blob)
    } catch {
      throw corrupt('有一張照片打不開')
    }
    photos.push({ key: p.key, blob, at: p.at })
  }

  const clips: Clip[] = o.header.clips.map((c) => {
    const blob = o.body.slice(offset, offset + c.size, c.type)
    offset += c.size
    return { key: c.key, text: c.text, lang: c.lang, trim: c.trim, ms: c.ms, at: c.at, blob }
  })

  for (const p of photos) await putPhoto(p)
  for (const c of clips) await restoreClip(c)

  const entries = Object.entries(o.header.settings)
  try {
    for (const [k, v] of entries) localStorage.setItem(k, v)
  } catch {
    throw new BackupError('corrupt', '這台裝置的儲存空間放不下備份裡的設定。')
  }

  // 剛還原的東西，備份裡本來就有
  markBackedUp()
  return { photos: photos.length, clips: clips.length, settings: entries.length }
}
