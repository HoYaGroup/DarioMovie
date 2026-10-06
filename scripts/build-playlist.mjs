/**
 * 把 playlists/ 底下的片單合併成 App 讀的 public/playlist.txt，再檢查一遍有沒有寫錯。
 *
 *   library/*.txt  學習庫：一個主題一個檔（1-數字.txt、2-英文單字.txt……），照檔名前面的數字排
 *   videos.txt     家長自己的影片（GitHub Actions 的「新增影片」會寫進這裡）
 *
 * 學習庫放前面，小朋友打開 App 先看到的是數字和英文單字；娛樂放在最後。
 * npm run dev／build 之前會自動執行，不用手動跑。
 *
 * 檢查用的是 App 同一支解析器（src/utils/playlist.ts）：看不懂的行會指出是哪個檔的第幾行，
 * 不用等部署完打開家長設定頁才發現。只提醒，不擋建置。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { libraryFiles } from './library-files.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const parts = [...libraryFiles(root), join(root, 'playlists', 'videos.txt')]
  .filter((file) => existsSync(file))
  .map((file) => ({ file: relative(root, file), text: readFileSync(file, 'utf8').trimEnd() }))
const merged = parts.map((p) => p.text).join('\n\n') + '\n'

writeFileSync(join(root, 'public', 'playlist.txt'), merged)
console.log(`已合併 ${parts.length} 個片單 → public/playlist.txt`)

await check()

/** 合併後的第幾行 → 哪個檔的第幾行（檔案之間接了一行空白） */
function whereIs(lineNo) {
  let start = 1
  for (const p of parts) {
    const count = p.text.split('\n').length
    if (lineNo < start + count) return `${p.file} 第 ${lineNo - start + 1} 行`
    start += count + 1
  }
  return `第 ${lineNo} 行`
}

/**
 * 學習庫的約定：同一個英文字（同一個中文意思）在不同字卡本用同一組句子，
 * 小朋友不管在哪一本翻到 cat 都聽到一樣的話。數字卡的句子是口訣（Two, four, six!），每本本來就不一樣，不比。
 */
function sentenceDrift(videos) {
  const first = new Map()
  const out = []
  for (const deck of videos) {
    for (const card of deck.cards ?? []) {
      if (!card.sentences.length || /^\d+$/.test(card.word)) continue
      const key = `${card.word.toLowerCase()}｜${card.meaning}`
      const said = [...card.sentences].sort().join(' | ')
      const seen = first.get(key)
      if (!seen) first.set(key, { deck: deck.title, said })
      else if (seen.said !== said) {
        out.push(`「${card.word}（${card.meaning}）」在「${deck.title}」的句子跟「${seen.deck}」不一樣，同一個字請用同一組句子`)
      }
    }
  }
  return out
}

async function check() {
  let parsePlaylist
  try {
    const { runnerImport } = await import('vite')
    const loaded = await runnerImport(join(root, 'src', 'utils', 'playlist.ts'), { root, configFile: false, logLevel: 'silent' })
    parsePlaylist = loaded.module.parsePlaylist
  } catch (err) {
    console.log(`（這次沒有檢查片單：${err.message}）`)
    return
  }

  const { videos, warnings } = parsePlaylist(merged)
  const problems = [
    ...warnings.map((w) => w.replace(/^第 (\d+) 行/, (_, n) => whereIs(Number(n)))),
    ...sentenceDrift(videos),
  ]
  if (!problems.length) {
    const decks = videos.filter((v) => v.kind === 'deck')
    const cards = decks.reduce((n, d) => n + d.cards.length, 0)
    console.log(`片單檢查通過：${decks.length} 本字卡、${cards} 張卡、${videos.length - decks.length} 部影片和網站`)
    return
  }
  // 在 GitHub Actions 上用 ::warning:: 標出來，執行結果的摘要頁看得到
  const ci = process.env.GITHUB_ACTIONS === 'true'
  console.log(`片單檢查：有 ${problems.length} 個地方要看一下（不影響建置）`)
  for (const p of problems) console.log(ci ? `::warning::${p}` : `  ⚠️  ${p}`)
}
