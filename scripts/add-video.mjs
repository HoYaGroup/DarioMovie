/**
 * GitHub Actions「新增影片」用：把一支影片加進 playlists/videos.txt 指定的位置。
 *
 * 參數一律從環境變數拿——workflow 裡不要用 ${{ }} 把網址、標題直接塞進指令，
 * 不然標題裡的引號、分號會被當成指令執行。
 *   VIDEO_URL           YouTube 網址（必填，watch／youtu.be／shorts 都可以）
 *   VIDEO_TITLE         標題（可省略，會自動抓 YouTube 的片名）
 *   VIDEO_PLACE         表單下拉選單選的「大分類 › 分區」，例如「學習 › Little Kids (上)」
 *   VIDEO_NEW_SECTION   選「新的分區」時填的大分類
 *   VIDEO_NEW_CATEGORY  選「新的分區」時填的分區名稱（沒有的話自動建立）
 *   VIDEO_SECTION／VIDEO_CATEGORY  不用選單、直接指定（本機測試用）
 *   VIDEO_UNIT          單元（可省略，例如「動物故事1」；沒有的話自動建立）
 *   PLAYLIST_FILE   要改的檔案（測試用，預設 playlists/videos.txt）
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = process.env.PLAYLIST_FILE || join(root, 'playlists', 'videos.txt')

/** 一行一個值，去掉換行（workflow 的輸入本來就是單行，保險起見） */
const input = (name) => (process.env[name] || '').replace(/[\r\n]+/g, ' ').trim()

function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
}

function fail(msg) {
  console.error(`::error::${msg}`)
  summary(`### ❌ 沒有加進去\n\n${msg}`)
  process.exit(1)
}

/** 跟 src/utils/youtube.ts 的 parseVideoId 同一套規則 */
function parseVideoId(raw) {
  const s = (raw || '').trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  for (const re of [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ]) {
    const m = s.match(re)
    if (m) return m[1]
  }
  return null
}

/** 名稱比對時不管 emoji 和多餘空白：「恐龍 & 挖土機 🦒」跟「恐龍 & 挖土機」算同一個 */
const EMOJI = /\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu
const clean = (s) => s.replace(EMOJI, '').replace(/\s+/g, ' ').trim()

/* 三層標題的寫法，跟 src/utils/playlist.ts 一致 */
const sectionName = (l) => (l.trim().match(/^#(?!#)\s*(.+)$/) || l.trim().match(/^〖\s*(.+?)\s*〗/))?.[1]
const categoryName = (l) => (
  l.trim().match(/^【\s*(.+?)\s*】/) || l.trim().match(/^\[\s*(.+?)\s*\]/) || l.trim().match(/^##(?!#)\s*(.+)$/)
)?.[1]
const unitName = (l) => (
  l.trim().match(/^《\s*(.+?)\s*》\s*$/) || l.trim().match(/^###\s*(.+)$/) || l.trim().match(/^--\s*(.+)$/)
)?.[1]

const url = input('VIDEO_URL')
const place = input('VIDEO_PLACE')
// 選單選的是現有分區：「學習 › Little Kids (上)」拆成大分類和分區；選「新的分區」就用下面兩格填的
const [placeSection = '', placeCategory = ''] = place && !place.startsWith('（') ? place.split(' › ') : []
const section = placeSection || input('VIDEO_NEW_SECTION') || input('VIDEO_SECTION')
const category = placeCategory || input('VIDEO_NEW_CATEGORY') || input('VIDEO_CATEGORY')
const unit = input('VIDEO_UNIT')
let title = input('VIDEO_TITLE')

const id = parseVideoId(url)
if (!id) fail(`看不懂這個網址：${url || '（空白）'}。請貼 YouTube 影片的網址。`)
if (!section) fail('選了「新的分區」的話，請在下面填大分類，例如「娛樂」。')
if (!category) fail('選了「新的分區」的話，請在下面填分區名稱，例如「恐龍故事」。')

// 先問 YouTube：影片不存在、是私人影片、或不允許嵌入的，加了也播不了
try {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    fail(`YouTube 說這支影片不存在、是私人影片，或不允許在其他網站播放（${res.status}），加了也播不了。`)
  }
  // 沒填標題就用 YouTube 的片名，只取第一個「|」前面那段：「Walking In The Jungle | Kids Song | …」太長
  if (res.ok && !title) title = ((await res.json()).title || '').split(/\s+\|\s+/)[0].trim()
} catch {
  console.log('::warning::連不上 YouTube 確認影片，先照樣加進去')
}

const lines = readFileSync(FILE, 'utf8').replace(/\s+$/, '').split('\n')

const findIn = (from, to, test) => {
  for (let i = from; i < to; i++) if (test(lines[i])) return i
  return -1
}
/** 從 start 的下一行往下找，直到 stop 成立（或檔尾），回傳那一行的位置 */
const blockEnd = (start, stop) => {
  let i = start + 1
  while (i < lines.length && !stop(lines[i])) i++
  return i
}
/** [from, to) 裡最後一行有內容的位置，新的東西接在它後面 */
const lastContent = (from, to) => {
  let i = to - 1
  while (i > from && !lines[i].trim()) i--
  return i
}
const created = []

// 1. 大分類：沒有就加在檔尾
let s = findIn(0, lines.length, (l) => sectionName(l) && clean(sectionName(l)) === clean(section))
if (s < 0) {
  lines.push('', `# ${section}`)
  s = lines.length - 1
  created.push(`大分類「${section}」`)
}
const sEnd = blockEnd(s, (l) => sectionName(l))

// 2. 分區：沒有就加在這個大分類最後
let c = findIn(s + 1, sEnd, (l) => categoryName(l) && clean(categoryName(l)) === clean(category))
if (c < 0) {
  const at = lastContent(s, sEnd) + 1
  lines.splice(at, 0, '', `【${category}】`)
  c = at + 1
  created.push(`分區「${category}」`)
}
const cEnd = blockEnd(c, (l) => sectionName(l) || categoryName(l))

// 3. 要放進哪一段
let from, to
if (unit) {
  let u = findIn(c + 1, cEnd, (l) => unitName(l) && clean(unitName(l)) === clean(unit))
  if (u < 0) {
    const at = lastContent(c, cEnd) + 1
    lines.splice(at, 0, '', `《${unit}》`)
    u = at + 1
    created.push(`單元「${unit}」`)
  }
  from = u
  to = blockEnd(u, (l) => sectionName(l) || categoryName(l) || unitName(l))
} else {
  // 沒指定單元：要放在這個分區第一個單元「之前」，放在後面會被算進最後一個單元
  const firstUnit = findIn(c + 1, cEnd, (l) => unitName(l))
  from = c
  to = firstUnit < 0 ? cEnd : firstUnit
}

// 4. 同一段裡已經有這支就不重複加
for (let i = from; i < to; i++) {
  if (lines[i].trim().startsWith('//')) continue
  if (parseVideoId(lines[i].split('|')[0]) === id) fail(`這支影片已經在「${[section, category, unit].filter(Boolean).join(' › ')}」裡了。`)
}

const entry = title ? `https://youtu.be/${id} | ${title}` : `https://youtu.be/${id}`
lines.splice(lastContent(from, to) + 1, 0, entry)
writeFileSync(FILE, lines.join('\n') + '\n')

const where = [section, category, unit].filter(Boolean).join(' › ')
console.log(`已加入「${where}」：${entry}`)
summary(`### ✅ 已加入「${where}」\n\n- ${title || '（沒有標題，App 會自動抓）'}\n- https://youtu.be/${id}` +
  (created.length ? `\n\n新建立了：${created.join('、')}` : '') +
  '\n\n部署完成後（大約一兩分鐘），每台裝置下次打開 App 就會看到。')
