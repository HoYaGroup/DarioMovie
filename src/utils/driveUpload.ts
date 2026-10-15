import { ref } from 'vue'
import scriptTemplate from '../../scripts/apps-script/drive-upload.gs?raw'

/**
 * 把照片直接存進雲端硬碟的共用資料夾（選填）：家長自己在 script.google.com 部署一小段 Apps Script（scripts/apps-script/drive-upload.gs），
 * 把部署出來的網址和密碼貼進家長設定，之後選好照片就自動上傳，不用再從分享選單挑位置。
 *
 * ‧ 為什麼不用 API 金鑰：金鑰只能讀公開的檔案，要寫進雲端硬碟一定要有「誰在寫」的身分；Apps Script 以家長本人的身分執行，
 *   App 這邊不碰登入、不會過期
 * ‧ 網址和密碼只存在這台裝置（localStorage），不進備份、不進 GitHub；script 裡寫死資料夾，App 不能指定別的資料夾
 * ‧ 只送 {密碼, 檔名, base64}，不帶任何其他資料；只連 script.google.com（網址格式不對不收）
 * ‧ 上傳的是 photoFiles() 做好的檔案（縮小過、去掉位置資訊的 JPEG，檔名＝卡上的字），script 把它們集中放進資料夾裡的
 *   photos 子資料夾（不會讓最上層越來越亂；cards 是照路徑對應的素材，兩種分開放），其他裝置按「立即同步」就會抓到
 * ‧ 用 text/plain 送（算簡單請求，瀏覽器不會先送 OPTIONS，Apps Script 不會回它），Apps Script 會 302 轉到另一個網址才給回覆，
 *   fetch 會自己跟著轉。「回覆讀得到」這點沒對真的 Google 測過（只用模擬的測），測試連線就是用來確認它
 */

const URL_KEY = 'kidtube.uploadUrl'
const PASS_KEY = 'kidtube.uploadKey'
const AUTO_KEY = 'kidtube.uploadAuto'

/** 部署出來的網址：https://script.google.com/macros/s/<id>/exec（Google Workspace 帳號是 …/a/macros/<網域>/s/<id>/exec） */
const RE_URL = /^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[A-Za-z0-9.-]+\/s)\/[A-Za-z0-9_-]{10,}\/exec$/
/** 密碼只收英數字：它會被填進 script 的程式碼裡，不能有引號之類的符號 */
const RE_KEY = /^[A-Za-z0-9]{8,64}$/
const RE_FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/

/** 一次上傳最久等多久（Apps Script 冷啟動要好幾秒） */
const TIMEOUT_MS = 60_000

/** 設定改了要讓畫面跟著變：localStorage 本身不是反應式的 */
const version = ref(0)

/* ---------- 設定（只存在這台） ---------- */

/** 整理網址：去掉頭尾空白和 #後面的（連線代碼會把密碼接在 # 後面）；格式不對回 null，空字串表示清除 */
export function cleanUploadUrl(text: string): string | null {
  const t = (text.trim().split('#')[0] ?? '').trim()
  if (!t) return ''
  return RE_URL.test(t) ? t : null
}

/** 整理密碼；格式不對回 null，空字串表示清除 */
export function cleanUploadKey(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  return RE_KEY.test(t) ? t : null
}

/** 「網址#密碼」的連線代碼拆成兩段（沒有 # 的話密碼是空的） */
export function splitConnection(text: string): { url: string; key: string } {
  const [url = '', key = ''] = text.trim().split('#')
  return { url: url.trim(), key: key.trim() }
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { /* 略過 */ }
  version.value++
}

export function readUploadUrl(): string {
  void version.value
  return cleanUploadUrl(read(URL_KEY)) ?? ''
}

export function readUploadKey(): string {
  void version.value
  return cleanUploadKey(read(PASS_KEY)) ?? ''
}

export function saveUploadUrl(url: string) {
  write(URL_KEY, url)
}

export function saveUploadKey(key: string) {
  write(PASS_KEY, key)
}

/** 網址和密碼都設好了嗎（才有辦法上傳） */
export function uploadConfigured(): boolean {
  return !!readUploadUrl() && !!readUploadKey()
}

/** 換好照片就自動上傳（設好上傳才有意思；預設開） */
export function readAutoUpload(): boolean {
  void version.value
  return read(AUTO_KEY) !== 'off'
}

export function saveAutoUpload(on: boolean) {
  write(AUTO_KEY, on ? '' : 'off')
}

/** 另一台裝置貼這個就設好了：網址#密碼（# 後面不會被送到任何伺服器） */
export function connectionCode(): string {
  const url = readUploadUrl()
  const key = readUploadKey()
  return url && key ? `${url}#${key}` : ''
}

const KEY_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 亂數產生一組密碼（24 個字，沒有容易看錯的 0 O 1 l I）；已經有就沿用，換裝置貼的時候才會是同一組 */
export function ensureUploadKey(): string {
  const have = readUploadKey()
  if (have) return have
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const key = Array.from(bytes, (b) => KEY_CHARS[b % KEY_CHARS.length]).join('')
  saveUploadKey(key)
  return key
}

/** 要貼到 script.google.com 的整份程式：資料夾和密碼已經填好 */
export function buildScript(folderId: string, key: string): string {
  if (!RE_FOLDER_ID.test(folderId) || !RE_KEY.test(key)) throw new Error('資料夾或密碼的格式不對。')
  return scriptTemplate.split('__FOLDER_ID__').join(folderId).split('__PASSWORD__').join(key)
}

/* ---------- 上傳 ---------- */

export type UploadErrorCode = 'config' | 'network' | 'badreply' | 'setup' | 'password' | 'folder' | 'name' | 'empty' | 'size' | 'other'

/** 訊息可以直接給家長看 */
export class UploadError extends Error {
  readonly code: UploadErrorCode
  constructor(code: UploadErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const WHY: Record<string, string> = {
  setup: '連上了，但部署出去的 script 裡，資料夾和密碼還沒填好。可能是貼到原始檔（要用 App 的「複製 script」）；或是貼對了、但沒有部署新版本（部署 › 管理部署作業 › 編輯 › 新版本 › 部署）。到 script 最上面兩行看看，要是 FOLDER_ID 和 PASSWORD 是一長串字，不是 __FOLDER_ID__ 的樣子，才對。',
  password: '密碼不對：App 裡的密碼要跟 script 裡的 PASSWORD 一樣。重新按「複製 script」貼過去，再「部署 › 管理部署作業 › 編輯 › 新版本」。',
  folder: 'script 打不開那個資料夾（資料夾換過、或不是你的）。換資料夾要重新按「複製 script」，貼過去再部署新版本。',
  name: '檔名不能用。',
  empty: '這個檔案是空的。',
  size: '照片太大了（上限 5 MB）。',
}

/** 只跟這一張有關：記下來、繼續傳下一張。其他錯誤（連不上、密碼不對…）整次停下來 */
const PER_FILE = new Set<string>(['name', 'empty', 'size', 'other'])

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new UploadError('other', '讀不了這個檔案。'))
    r.readAsDataURL(file)
  })
}

/** 送一個請求給 script，回傳它的 JSON；連不上、回來的不是 script 的答案都丟 UploadError */
async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = readUploadUrl()
  const key = readUploadKey()
  if (!url || !key) throw new UploadError('config', '還沒設定上傳的網址和密碼。')

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let text: string
  let status: number
  try {
    // 不設 Content-Type：字串 body 會是 text/plain，算「簡單請求」，不會先送 OPTIONS（Apps Script 不會回）
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ ...body, key }), credentials: 'omit', redirect: 'follow', signal: ctl.signal })
    status = res.status
    text = await res.text()
  } catch (e) {
    throw new UploadError(
      'network',
      (e as Error).name === 'AbortError'
        ? '等了一分鐘 Google 都沒有回應，等一下再試。'
        : '連不上。網址是不是貼錯了、有沒有連網？部署時「誰可以存取」要選「所有人」，選「只有我」的話瀏覽器會被擋。',
    )
  } finally {
    clearTimeout(timer)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new UploadError('badreply', `網址有回應（${status}），但不是這個 script 的答案。請確認貼的是「網頁應用程式」的網址，結尾是 /exec。`)
  }
  if (!data || typeof data !== 'object') throw new UploadError('badreply', '網址有回應，但不是這個 script 的答案。')
  return data as Record<string, unknown>
}

function failure(data: Record<string, unknown>): UploadError {
  const code = typeof data.error === 'string' ? data.error : 'other'
  const known = WHY[code]
  if (known) return new UploadError(code as UploadErrorCode, known)
  const detail = typeof data.message === 'string' ? `：${data.message.slice(0, 120)}` : ''
  return new UploadError('other', `Google 回報錯誤${detail}`)
}

/** 這個 App 要的 script 版本（scripts/apps-script/drive-upload.gs 的 VERSION）：2＝照片放進 photos 子資料夾，1（沒有版本號）＝放最上層 */
export const SCRIPT_VERSION = 2

/** 測試連線：回傳 script 寫入的資料夾（名字和 id）和 script 的版本；密碼對、資料夾打得開才會成功 */
export async function pingUpload(): Promise<{ folder: string; id: string; version: number }> {
  const data = await call({ action: 'ping' })
  if (data.ok !== true) throw failure(data)
  return {
    folder: typeof data.folder === 'string' ? data.folder : '',
    id: typeof data.id === 'string' ? data.id : '',
    version: Number(data.version) || 1,
  }
}

export interface UploadReport {
  /** 傳成功的檔名 */
  saved: string[]
  /** script 回報的存放位置（photos/monday.jpg）；舊版 script 不回報，是空字串 */
  paths: string[]
  /** 其中蓋掉了雲端硬碟上同名舊檔的 */
  replaced: string[]
  failed: Array<{ name: string; why: string }>
}

/** 上傳成功後告訴家長檔案放在哪（照 script 回報的路徑講，舊版 script 沒有路徑，提醒要換新版） */
export function whereText(paths: string[]): string {
  const dirs = new Set(paths.filter((p) => p.includes('/')).map((p) => p.slice(0, p.lastIndexOf('/'))))
  if (dirs.size && paths.every((p) => p.includes('/'))) return `共用資料夾的 ${[...dirs].join('、')} 資料夾`
  return '共用資料夾的最上層（你的 script 是舊版，重新按「複製 script」貼上並部署新版本之後，照片才會放進 photos 資料夾）'
}

/**
 * 一張一張傳到資料夾的最上層，同名的蓋掉（舊的進垃圾桶）。檔名就是對應（apple.jpg），所以另一台按「立即同步」就會換上。
 * 連不上、密碼不對這種整次的錯誤直接丟 UploadError（訊息會註明前面已經傳了幾張）；單張的問題記在 failed 裡，繼續傳下一張。
 */
export async function uploadFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<UploadReport> {
  const report: UploadReport = { saved: [], paths: [], replaced: [], failed: [] }
  onProgress?.(0, files.length)
  for (const [i, file] of files.entries()) {
    try {
      const data = await call({ name: file.name, data: await toBase64(file) })
      if (data.ok !== true) throw failure(data)
      report.saved.push(file.name)
      report.paths.push(typeof data.path === 'string' ? data.path : '')
      if (Number(data.replaced) > 0) report.replaced.push(file.name)
    } catch (e) {
      const err = e instanceof UploadError ? e : new UploadError('other', (e as Error).message || '沒有傳成功。')
      if (!PER_FILE.has(err.code)) {
        throw new UploadError(err.code, report.saved.length ? `${err.message}（前面已經傳了 ${report.saved.length} 張）` : err.message)
      }
      report.failed.push({ name: file.name, why: err.message })
    }
    onProgress?.(i + 1, files.length)
  }
  return report
}
