import { allClips, saveClip, type Clip } from './recordings'
import { fileSafeName } from './photoFiles'
import { analyzeRecording } from './speech'

/**
 * 爸媽的錄音和「共用資料夾」（Google 雲端硬碟、iCloud、隨便哪個資料夾）之間搬來搬去，做法跟照片一樣（utils/photoFiles.ts）：
 * **檔名就是那句話**（`I'm hungry.m4a`、`我餓了.m4a`），不用另外記錄；對句子的規則在 utils/voiceLines.ts 的 lineOfFileName。
 *
 * ‧ 分享出去：每一句錄音一個檔案，檔名由程式照那句話取好（不能用的符號換成底線），原樣的音檔，不重新編碼
 * ‧ 匯入：音檔當不可信的——解得開、有聲音才收（跟批次匯入音檔同一套，importClipFile），錄音前後的靜音重新算
 * ‧ 錄音只存在這台裝置；資料夾是你自己的雲端硬碟，程式不連雲端（分享靠 iPad 的分享選單，抓下來靠「檔案」App 或資料夾同步）
 */

/** 收的音檔副檔名（ogg 在 iPad 放不出來，但別台裝置錄的 webm、ogg 先收進來，放不出來會說） */
export const CLIP_EXT_RE = /\.(?:mp3|m4a|aac|wav|ogg|webm)$/i

/** 匯入的檔案沒有長度限制（一段兒歌、一小段故事都可以）。只擋太大的檔：播放時整段要解碼進記憶體，幾十分鐘的檔在 iPad 上會很吃力，也多半是選錯檔 */
export const MAX_CLIP_FILE_BYTES = 30 * 1024 * 1024

/** <input type=file> 的 accept */
export const CLIP_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.webm'

const MIME_OF_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm',
}
const EXT_OF_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
}

/** 把一個音檔存成某一句的錄音；失敗回傳原因（給家長看） */
export async function importClipFile(target: { text: string; lang: Clip['lang'] }, file: File): Promise<{ clip: Clip } | { why: string }> {
  if (file.size > MAX_CLIP_FILE_BYTES) return { why: '檔案太大了（上限 30 MB）' }
  const info = await analyzeRecording(file)
  if (!info) return { why: '解不開，或是裡面沒有聲音（支援 mp3、m4a、wav）' }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  // 雲端硬碟有時把音檔標成 application/octet-stream：不是 audio/ 開頭的，改用副檔名猜
  const blob = file.slice(0, file.size, /^audio\//i.test(file.type) ? file.type : (MIME_OF_EXT[ext] || 'audio/mpeg'))
  return { clip: await saveClip(target.text, target.lang, blob, info.trim, info.ms) }
}

/** 這段錄音分享出去的檔名（含副檔名）；句子是空的回 null */
export function clipFileName(clip: Clip): string | null {
  const base = fileSafeName(clip.text)
  if (!base) return null
  const type = clip.blob.type.split(';')[0]!.trim().toLowerCase()
  return `${base}.${EXT_OF_MIME[type] ?? 'm4a'}`
}

/**
 * 要分享的錄音 → 檔案（檔名已經取好）。同一個檔名有好幾段（標點不同的同一句）取最新的。
 * 全部是同步做完的：iPad 的分享選單要在按鈕剛按下去的那一刻叫出來，中間不能等。
 */
export function clipFiles(clips: Clip[] = allClips()): File[] {
  const byName = new Map<string, Clip>()
  for (const c of clips) {
    const name = clipFileName(c)
    if (!name) continue
    const seen = byName.get(name.toLowerCase())
    if (seen && seen.at >= c.at) continue
    byName.set(name.toLowerCase(), c)
  }
  return [...byName.values()].map((c) => new File([c.blob], clipFileName(c)!, { type: c.blob.type || 'audio/mp4', lastModified: c.at }))
}
