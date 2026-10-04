/**
 * 把 playlists/ 底下的片單合併成 App 讀的 public/playlist.txt。
 *
 *   library.txt  學習庫：數字、英文單字的字卡和相關兒歌
 *   videos.txt   家長自己的影片（GitHub Actions 的「新增影片」會寫進這裡）
 *
 * 學習庫放前面，小朋友打開 App 先看到的是數字和英文單字；娛樂放在最後。
 * npm run dev／build 之前會自動執行，不用手動跑。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORDER = ['library.txt', 'videos.txt']

const parts = ORDER
  .map((name) => join(root, 'playlists', name))
  .filter((file) => existsSync(file))
  .map((file) => readFileSync(file, 'utf8').trimEnd())

const out = join(root, 'public', 'playlist.txt')
writeFileSync(out, parts.join('\n\n') + '\n')
console.log(`已合併 ${parts.length} 個片單 → public/playlist.txt`)
