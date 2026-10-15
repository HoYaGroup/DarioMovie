/**
 * 把「真實照片」轉成字卡用的圖：drive/real/<名字>.jpg → public/cards/real/<名字>.webp（舊的會被蓋掉）。
 *
 *   npm i --no-save puppeteer-core            # 只在要轉圖時裝，不放進 package.json
 *   node scripts/make-real-cards.mjs          # drive/real/ 裡全部
 *   node scripts/make-real-cards.mjs apple bus   # 只轉這幾張（名字不用寫副檔名）
 *   node scripts/make-real-cards.mjs --src D:/家裡的照片 --size 720
 *
 * 用法：自己拍的照片（家裡的碗、積木、動物積木、形狀玩具……）丟進 drive/real/，檔名用英文小寫（bowl.jpg、blocks.jpg），
 * 跑上面那行，再把片單裡那張卡的圖欄位改成 cards/real/bowl.webp。拍照小撇步：
 *   ‧ 東西放在素色的桌面或牆前面，只拍一個，佔畫面一半以上；光線亮一點，不要糊
 *   ‧ 不要拍到人臉（網站是公開的）；iPhone 的 HEIC 照片先轉成 JPEG（設定 → 相機 → 格式 → 最相容）
 *
 * 用 Chrome 的畫布處理（不用另外裝影像套件）；電腦要有 Google Chrome（路徑可用環境變數 CHROME 指定）。
 * 圖縮到最長邊 720px（不放大）、webp 品質 0.8，每張約 25～130KB；EXIF 轉向 Chrome 會自己處理。
 *
 * 從網路找的照片（Wikimedia Commons 的免費授權照片）的作者和授權寫在 scripts/real-credits.json，
 * 轉圖時會一起產生 public/cards/real/CREDITS.md；自己拍的不需要寫。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/cards/real')

const args = process.argv.slice(2)
let srcDir = join(root, 'drive/real')
let size = 720
const only = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--src') srcDir = resolve(args[++i])
  else if (args[i] === '--size') size = Number(args[++i]) || 720
  else only.push(args[i])
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
if (!existsSync(srcDir)) {
  console.error(`找不到照片資料夾：${srcDir}`)
  process.exit(1)
}
const files = readdirSync(srcDir)
  .filter((f) => MIME[extname(f).toLowerCase()])
  .filter((f) => !only.length || only.includes(basename(f, extname(f))))
if (!files.length) {
  console.error('沒有可以轉的照片（要 jpg、png 或 webp）')
  process.exit(1)
}

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('找不到 puppeteer-core，請先執行：npm i --no-save puppeteer-core')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  const page = await browser.newPage()
  for (const f of files) {
    const name = basename(f, extname(f))
    const url = `data:${MIME[extname(f).toLowerCase()]};base64,${readFileSync(join(srcDir, f)).toString('base64')}`
    const result = await page.evaluate(async (src, max) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k)
      c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      return { data: c.toDataURL('image/webp', 0.8).split(',')[1], w: c.width, h: c.height }
    }, url, size)
    const buf = Buffer.from(result.data, 'base64')
    writeFileSync(join(outDir, `${name}.webp`), buf)
    console.log(`${name}.webp  ${result.w}×${result.h}  ${Math.round(buf.length / 1024)}KB`)
  }
} finally {
  await browser.close()
}

// 網路照片的出處：只列 public/cards/real/ 裡真的有的
const creditsFile = join(root, 'scripts/real-credits.json')
if (existsSync(creditsFile)) {
  const credits = JSON.parse(readFileSync(creditsFile, 'utf8'))
  const rows = Object.entries(credits)
    .filter(([name]) => existsSync(join(outDir, `${name}.webp`)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, c]) => `| ${name}.webp | ${c.author || '（未註明）'} | ${c.license} | [${c.title.replace(/\|/g, '/')}](${c.page}) |`)
  writeFileSync(join(outDir, 'CREDITS.md'), [
    '# 真實照片的出處',
    '',
    '這個資料夾的照片來自 [Wikimedia Commons](https://commons.wikimedia.org/) 的免費授權照片，縮小後轉成 webp 使用。',
    '授權為 CC BY／CC BY-SA 的照片，依授權要求在這裡標出作者和來源；CC0、公有領域的不需要，也一併列出。',
    '自己拍的照片不在這份清單裡。',
    '',
    '| 檔案 | 作者 | 授權 | 來源 |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'))
  console.log(`CREDITS.md：${rows.length} 筆`)
  // 家長設定的「圖片與聲音來源」讀這份（同一份資料，App 裡也看得到作者和授權）
  const list = Object.entries(credits)
    .filter(([name]) => existsSync(join(outDir, `${name}.webp`)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, c]) => ({ name, author: c.author || '', license: c.license, title: c.title, page: c.page }))
  writeFileSync(join(outDir, 'credits.json'), JSON.stringify(list))
}
