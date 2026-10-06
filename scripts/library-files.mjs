/**
 * 學習庫的檔案：playlists/library/ 底下的 .txt，照檔名排——
 * 檔名前面的數字照大小排（10-xxx.txt 排在 9-xxx.txt 後面），就是小朋友端主題的順序。
 * build-playlist.mjs 和 sync-video-form.mjs 共用，兩邊的順序才會一樣。
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function libraryFiles(root) {
  const dir = join(root, 'playlists', 'library')
  if (!existsSync(dir)) return []
  const byNumber = new Intl.Collator('zh-Hant', { numeric: true })
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .sort(byNumber.compare)
    .map((name) => join(dir, name))
}
