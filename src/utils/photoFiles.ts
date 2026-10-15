import { PLACES } from './places'
import { allPhotos, pathPhotoKey, preparePhoto, savePhoto, wordPhotoKey, type PhotoRecord } from './photos'

/**
 * 照片和「共用資料夾」（Google 雲端硬碟、iCloud、隨便哪個資料夾）之間搬來搬去：檔名就是對應，不用另外記錄。
 *
 *   apple.jpg          → 所有字是 apple 的卡（不分字卡本、大小寫）
 *   place-kitchen.jpg  → 放哪裡的廚房照片（跟 cards/real/place-kitchen.webp 同名）
 *
 * ‧ 分享出去的檔案，檔名由程式照卡上的字取好，家長不用改名；一律是縮小過、去掉位置資訊的 JPEG
 * ‧ 匯入時用檔名對卡：副檔名、大小寫、重複檔名後面的「 (1)」都不計較；同一個名字有好幾個檔，取最新的
 * ‧ 匯入的每一張都照一般照片重新處理一次（縮小、去 EXIF、擋掉不是圖片的），不直接相信資料夾裡的檔案
 * ‧ 程式不連任何雲端：上傳靠 iPad 的分享選單，匯入靠「檔案」App 的選檔
 */

export const PHOTO_EXT_RE = /\.(?:jpe?g|png|webp|heic|heif|gif|avif|bmp)$/i

/** 一次最多匯入幾個檔案，再多多半選錯資料夾了 */
export const MAX_IMPORT_FILES = 400

const FOLDER_KEY = 'kidtube.photoFolder'

/** 檔名最長幾個字：再長的句子，檔名會被截短（錄音的檔名是整句話，見 utils/voiceLines.ts 的 lineOfFileName） */
export const FILE_NAME_MAX = 80

/** 檔名不能有的符號（/ \ : * ? " < > |）換成底線，頭尾的空白和點去掉，太長的截短 */
export function fileSafeName(text: string): string {
  return text
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, FILE_NAME_MAX)
}

/** 拿來比對的寫法：檔名安全化後小寫 */
export function nameKey(text: string): string {
  return fileSafeName(text).toLowerCase()
}

/** 放哪裡的地點照片的檔名（不含副檔名）：cards/real/place-kitchen.webp → place-kitchen */
function placeName(image: string): string {
  return image.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
}

const EXT_OF_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }

/** 這張照片分享出去時的檔名（不含副檔名）；對不到名字（字是空的）回 null */
function baseNameOfKey(key: string): string | null {
  const [kind, ...rest] = key.split('|')
  let name = ''
  if (kind === 'word') name = rest.join('|')
  else if (kind === 'card') name = rest[rest.length - 1] ?? ''   // card|<字卡本>|<字>
  else if (kind === 'path') name = placeName(rest.join('|'))
  name = fileSafeName(name)
  return name || null
}

/**
 * 要分享的照片 → 檔案（檔名已經取好）。同一個名字有好幾張（舊版只換一本的和依字換的）取最新的。
 * 全部是同步做完的：iPad 的分享選單要在按鈕剛按下去的那一刻叫出來，中間不能等。
 */
export function photoFiles(photos: PhotoRecord[] = allPhotos()): File[] {
  const byName = new Map<string, { at: number; file: File }>()
  for (const p of photos) {
    const base = baseNameOfKey(p.key)
    if (!base) continue
    const ext = EXT_OF_TYPE[p.blob.type] ?? 'jpg'
    const name = `${base}.${ext}`
    const seen = byName.get(name.toLowerCase())
    if (seen && seen.at >= p.at) continue
    byName.set(name.toLowerCase(), { at: p.at, file: new File([p.blob], name, { type: p.blob.type || 'image/jpeg' }) })
  }
  return [...byName.values()].map((x) => x.file)
}

/**
 * 把檔案交給家長：iPad 上叫出分享選單（選「雲端硬碟」再選共用資料夾），不能分享就一個一個下載。
 * 要在按鈕的點擊裡直接呼叫，前面不能有 await。
 */
export async function shareFiles(files: File[], title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try {
    if (!navigator.canShare?.({ files })) throw new Error('no-share')
    await navigator.share({ files, title })
    return 'shared'
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
    // 這台不能分享檔案：往下改成下載
  }
  for (const f of files) {
    const url = URL.createObjectURL(f)
    const a = document.createElement('a')
    a.href = url
    a.download = f.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return 'downloaded'
}

/* ---------- 從資料夾匯入 ---------- */

export interface ImportReport {
  /** 換成功的檔名 */
  saved: string[]
  /** 檔名對不到任何卡或地點 */
  unmatched: string[]
  /** 同一個名字有好幾個檔，只用了最新的，其他略過 */
  older: string[]
  /** 不是照片的檔（資料夾裡混了別的東西），直接略過 */
  ignored: string[]
  failed: Array<{ name: string; why: string }>
}

/** 卡片上有哪些字可以換照片（字 → 小寫的字），給匯入時比對檔名用 */
export function wordTargets(words: Iterable<string>): Map<string, string> {
  const m = new Map<string, string>()
  for (const w of words) {
    const key = nameKey(w)
    if (key && !m.has(key)) m.set(key, w.trim().toLowerCase())
  }
  return m
}

/** 檔名 → 要換的照片 key；對不到回 null */
export function targetOf(fileName: string, words: Map<string, string>): string | null {
  // 去副檔名；手機、電腦遇到同名會自動加「 (1)」「 2」，那也是同一個名字
  const base = fileName.replace(PHOTO_EXT_RE, '').replace(/\s*\(\d+\)$/, '')
  const key = nameKey(base)
  if (!key) return null
  const place = PLACES.find((p) => p.image && nameKey(placeName(p.image)) === key)
  if (place) return pathPhotoKey(place.image)
  const word = words.get(key)
  return word ? wordPhotoKey(word) : null
}

export async function importPhotoFiles(files: File[], words: Map<string, string>): Promise<ImportReport> {
  const report: ImportReport = { saved: [], unmatched: [], older: [], ignored: [], failed: [] }
  if (files.length > MAX_IMPORT_FILES) {
    throw new Error(`一次最多匯入 ${MAX_IMPORT_FILES} 個檔案，你選了 ${files.length} 個。`)
  }

  // 先依對到的照片分組，每組只留最新的那個檔
  const groups = new Map<string, File[]>()
  for (const f of files) {
    if (!PHOTO_EXT_RE.test(f.name) && !/^image\//i.test(f.type)) {
      report.ignored.push(f.name)
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

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => b.lastModified - a.lastModified)
    const [newest, ...rest] = sorted as [File, ...File[]]
    report.older.push(...rest.map((f) => f.name))
    try {
      await savePhoto(targetOf(newest.name, words)!, await preparePhoto(newest))
      report.saved.push(newest.name)
    } catch (e) {
      report.failed.push({ name: newest.name, why: (e as Error).message || '沒有存成功' })
    }
  }
  return report
}

/* ---------- 共用資料夾的網址：每台裝置各自設定，只存在這台，不進備份、不進 GitHub ---------- */

/** 只收 https 網址，其他（javascript:、http:）一律不收；回傳整理好的網址，空字串表示沒設 */
export function cleanFolderUrl(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  try {
    const u = new URL(t)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function readFolderUrl(): string {
  try {
    return cleanFolderUrl(localStorage.getItem(FOLDER_KEY) ?? '') ?? ''
  } catch {
    return ''
  }
}

export function saveFolderUrl(url: string) {
  try {
    if (url) localStorage.setItem(FOLDER_KEY, url)
    else localStorage.removeItem(FOLDER_KEY)
  } catch { /* 略過 */ }
}
