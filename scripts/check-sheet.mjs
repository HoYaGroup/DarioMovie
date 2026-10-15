/**
 * 檢查家長的 Google 試算表有沒有寫錯（書單不在專案裡，所以部署時沒有東西可以檢查，要檢查就用這個）：
 *
 *   npm run check-sheet -- <試算表連結>
 *   npm run check-sheet -- 書單.xlsx        （檢查下載下來的 xlsx，上傳之前先看一遍）
 *
 * 做的事跟 App 在 iPad 上一樣：把整本試算表下載成 xlsx → 轉成書單文字 → 用 App 同一支解析器讀一遍，
 * 指出看不懂的列（哪個工作表的第幾列）；另外檢查
 *   ‧ 同一個英文字（同一個中文意思）在不同字卡本的句子要一樣
 *   ‧ 卡片寫的圖片、音檔（cards/…）在 public/ 底下真的找得到
 * 只提醒，不改任何東西；有問題時結束代碼是 1。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const link = process.argv[2] ?? process.env.SHEET_URL

if (!link) {
  console.log('用法：npm run check-sheet -- <試算表連結 或 .xlsx 檔案>')
  process.exit(2)
}

const { runnerImport } = await import('vite')
const load = async (file) => (await runnerImport(join(root, 'src', 'utils', file), { root, configFile: false, logLevel: 'silent' })).module
const { fetchSheetPlaylist, sheetsToPlaylist, sheetIdOf, locateSheetWarning } = await load('sheetSource.ts')
const { readXlsx } = await load('xlsx.ts')
const { parsePlaylist } = await load('playlist.ts')

let sheet
try {
  if (existsSync(link)) {
    sheet = sheetsToPlaylist(await readXlsx(new Uint8Array(readFileSync(link))))
  } else {
    const id = sheetIdOf(link)
    if (!id) {
      console.log('看不懂這個連結（要貼試算表的共用連結：https://docs.google.com/spreadsheets/d/…）')
      process.exit(2)
    }
    sheet = await fetchSheetPlaylist(id)
  }
} catch (err) {
  console.log(`讀不到試算表：${err.message}`)
  process.exit(2)
}

const { videos, warnings } = parsePlaylist(sheet.text)

/** 同一個英文字（同一個中文意思）在不同字卡本用同一組句子，小朋友不管在哪一本翻到 cat 都聽到一樣的話。數字卡是口訣，不比 */
function sentenceDrift() {
  const first = new Map()
  const out = []
  for (const deck of videos) {
    for (const card of deck.cards ?? []) {
      if (!card.sentences.length || /^\d+$/.test(card.word)) continue
      const key = `${card.word.toLowerCase()}｜${card.meaning}`
      const said = [...card.sentences].sort().join(' | ')
      const seen = first.get(key)
      if (!seen) first.set(key, { deck: deck.title, said })
      else if (seen.said !== said) out.push(`「${card.word}（${card.meaning}）」在「${deck.title}」的句子跟「${seen.deck}」不一樣，同一個字請用同一組句子`)
    }
  }
  return out
}

/** 卡片寫的圖片、音檔（public/ 底下的相對路徑）要真的存在：路徑打錯的話，卡片上會是一張破圖 */
function missingImages() {
  const out = []
  const seen = new Set()
  const local = (ref) => ref && !/^https?:\/\//i.test(ref) && /\.(?:png|jpe?g|webp|gif|svg|avif|wav|mp3|m4a|aac)$/i.test(ref)
  for (const deck of videos.filter((v) => v.kind === 'deck')) {
    const refs = [deck.page, ...(deck.cards ?? []).flatMap((c) => [c.image, c.backImage, c.sound])]
    for (const ref of refs) {
      if (!local(ref) || seen.has(ref)) continue
      seen.add(ref)
      if (!existsSync(join(root, 'public', ref.replace(/^\//, '')))) out.push(`「${deck.title}」的檔案 ${ref} 不在 public/ 底下，路徑可能打錯了（如果它放在素材包裡，可以不用管）`)
    }
  }
  return out
}

const problems = [
  ...sheet.warnings,
  ...warnings.map((w) => locateSheetWarning(sheet, w)),
  ...sentenceDrift(),
  ...missingImages(),
]

const decks = videos.filter((v) => v.kind === 'deck')
if (!problems.length) {
  console.log(`試算表檢查通過：${sheet.tabs} 個工作表、${decks.length} 本字卡、${decks.reduce((n, d) => n + d.cards.length, 0)} 張卡、${videos.length - decks.length} 部影片和網站`)
} else {
  console.log(`試算表檢查：有 ${problems.length} 個地方要看一下（${sheet.tabs} 個工作表、${decks.length} 本字卡、${videos.length - decks.length} 部影片和網站）`)
  for (const p of problems) console.log(`  ⚠️  ${p}`)
  process.exitCode = 1
}
