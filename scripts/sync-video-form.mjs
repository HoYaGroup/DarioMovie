/**
 * 把「新增影片」Action 表單裡的分區下拉選單，跟片單上現有的分區同步。
 *
 * GitHub 的下拉選單選項只能寫死在 workflow 檔裡，而且 GitHub 不允許 Action 自己改 workflow 檔，
 * 所以由這支腳本在電腦上更新：npm run dev 之前會自動跑，也可以手動 npm run sync-form。
 *
 * 選單內容：
 *   ‧ playlists/videos.txt 的每一個分區（學習 › Little Kids (上)、娛樂 › 英文故事……）
 *   ‧ 學習庫裡名字是「影片」的分區（數字 › 影片、英文單字 › 影片）——加在 videos.txt 的影片會自動併進去
 *   ‧ 最後一個「新的分區」，選它再自己填名稱
 *
 * --check：只檢查不修改，選單跟片單不一致時印出警告（部署時用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = join(root, '.github', 'workflows', 'add-video.yml')
export const NEW_PLACE = '（新的分區，名稱填在下面）'
const BEGIN = '# >>> 分區選單：scripts/sync-video-form.mjs 自動產生，不要手動改'
const END = '# <<< 分區選單'

const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/gu
const clean = (s) => s.replace(EMOJI, '').replace(/\s+/g, ' ').trim()
const sectionName = (l) => (l.trim().match(/^#(?!#)\s*(.+)$/) || l.trim().match(/^〖\s*(.+?)\s*〗/))?.[1]
const categoryName = (l) => (
  l.trim().match(/^【\s*(.+?)\s*】/) || l.trim().match(/^\[\s*(.+?)\s*\]/) || l.trim().match(/^##(?!#)\s*(.+)$/)
)?.[1]

/** 一個片單檔裡的「大分類 › 分區」，照出現順序 */
function placesIn(file, keep = () => true) {
  const out = []
  let section = ''
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().startsWith('//')) continue
    const s = sectionName(line)
    if (s) { section = clean(s); continue }
    const c = categoryName(line)
    if (c && section && keep(clean(c))) out.push(`${section} › ${clean(c)}`)
  }
  return out
}

const places = [...new Set([
  ...placesIn(join(root, 'playlists', 'videos.txt')),
  ...placesIn(join(root, 'playlists', 'library.txt'), (name) => name === '影片'),
])]

/** YAML 單引號字串：裡面的單引號要寫兩次 */
const q = (s) => `'${s.replace(/'/g, "''")}'`
const indent = '        '
const block = [
  `${indent}${BEGIN}`,
  `${indent}default: ${q(places[0] ?? NEW_PLACE)}`,
  `${indent}options:`,
  ...[...places, NEW_PLACE].map((p) => `${indent}  - ${q(p)}`),
  `${indent}${END}`,
].join('\n')

const yml = readFileSync(WORKFLOW, 'utf8')
const re = new RegExp(`^[ \\t]*${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`, 'm')
if (!re.test(yml)) {
  console.error(`::error::${WORKFLOW} 裡找不到分區選單的標記`)
  process.exit(1)
}
const next = yml.replace(re, block)

if (process.argv.includes('--check')) {
  if (next !== yml) {
    console.log('::warning::「新增影片」表單的分區選單跟片單不一致，請在電腦上跑 npm run sync-form 後 commit。')
  } else {
    console.log('分區選單跟片單一致')
  }
} else if (next !== yml) {
  writeFileSync(WORKFLOW, next)
  console.log(`已更新「新增影片」的分區選單：${places.length} 個分區`)
} else {
  console.log('分區選單已經是最新的')
}
