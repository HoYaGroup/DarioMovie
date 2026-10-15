/**
 * 把動物（或任何東西）的叫聲音檔轉成字卡用的聲音：drive/sounds/<名字>.<ogg|mp3|wav|m4a|webm> → public/cards/sounds/<名字>.wav（舊的會被蓋掉）。
 *
 *   npm i --no-save puppeteer-core              # 只在要轉檔時裝，不放進 package.json
 *   node scripts/make-sound-cards.mjs           # drive/sounds/ 裡全部
 *   node scripts/make-sound-cards.mjs cow dog   # 只轉這幾個（名字不用寫副檔名）
 *   node scripts/make-sound-cards.mjs --src D:/聲音 --max 4
 *
 * 用法：自己錄的、或找到的免費授權叫聲，丟進 drive/sounds/（檔名用英文小寫：cow.m4a），跑上面那行，
 * 再把片單裡那張卡的最後加一欄 `聲:cards/sounds/cow.wav`。iPhone 錄的 m4a 也可以。
 *
 * 轉成 WAV 是因為 iPad 的 Safari 放不出 ogg（網路上免費的叫聲大多是 ogg），WAV 到處都放得出來：
 *   ‧ 前後的靜音剪掉（有聲音那一段前後各留一點點），最長 4 秒（--max 可改），結尾淡出 60 毫秒才不會「啪」一聲
 *   ‧ 轉成單聲道、16kHz、16 位元：一個叫聲約 60～130KB（叫聲的聲音都在 8kHz 以下，聽不出差別）
 *   ‧ 音量調到最大聲的地方是 0.9，每個叫聲一樣大聲，小朋友不會被突然的大聲嚇到；調太多的（原本很小聲）最多放大 4 倍
 * 想自己指定要哪一段（一個檔裡有好幾聲，只要其中一聲，或要把幾段接起來）：在 scripts/sound-sources.json 那個名字裡寫
 * "parts": [[開始秒, 結束秒], ...]，段和段之間會接上 0.25 秒的空檔。
 *
 * 網路找的叫聲（Wikimedia Commons 的免費授權音檔）的作者和授權也記在 scripts/sound-sources.json，
 * 轉檔時會一起產生 public/cards/sounds/CREDITS.md；自己錄的不需要寫。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/cards/sounds')
const sourcesFile = join(root, 'scripts/sound-sources.json')

const args = process.argv.slice(2)
let srcDir = join(root, 'drive/sounds')
let maxSec = 4
const only = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--src') srcDir = resolve(args[++i])
  else if (args[i] === '--max') maxSec = Number(args[++i]) || 4
  else only.push(args[i])
}

const EXT = new Set(['.ogg', '.oga', '.mp3', '.wav', '.m4a', '.webm', '.flac', '.aac', '.opus'])
if (!existsSync(srcDir)) {
  console.error(`找不到音檔資料夾：${srcDir}`)
  process.exit(1)
}
const files = readdirSync(srcDir)
  .filter((f) => EXT.has(extname(f).toLowerCase()))
  .filter((f) => !only.length || only.includes(basename(f, extname(f))))
if (!files.length) {
  console.error('沒有可以轉的音檔')
  process.exit(1)
}
const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) : {}

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
  await page.setContent('<body></body>')
  for (const f of files) {
    const name = basename(f, extname(f))
    const parts = sources[name]?.parts ?? null
    const b64 = readFileSync(join(srcDir, f)).toString('base64')
    const result = await page.evaluate(async (b64, parts, maxSec) => {
      const RATE = 16000
      const ac = new AudioContext()
      const decoded = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)
      // 轉成 16kHz 單聲道
      const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE)
      const src = off.createBufferSource()
      src.buffer = decoded
      src.connect(off.destination)
      src.start()
      const mono = (await off.startRendering()).getChannelData(0)

      // 有聲音的那一段：20 毫秒一格算音量，比最大聲的一小段小很多的當作雜音
      const win = RATE * 0.02
      const rms = []
      for (let i = 0; i + win <= mono.length; i += win) {
        let s = 0
        for (let j = i; j < i + win; j++) s += mono[j] * mono[j]
        rms.push(Math.sqrt(s / win))
      }
      const peakRms = Math.max(0, ...rms)
      const th = Math.max(0.006, peakRms * 0.1)
      const first = rms.findIndex((v) => v > th)
      let last = rms.length - 1
      while (last > first && rms[last] <= th) last--
      const auto = first < 0 ? [0, mono.length / RATE] : [Math.max(0, first * 0.02 - 0.08), Math.min(mono.length / RATE, (last + 1) * 0.02 + 0.12)]

      // 要哪幾段：指定的照指定，沒指定就用有聲音的那一段，最長 maxSec 秒
      const ranges = (parts ?? [[auto[0], Math.min(auto[1], auto[0] + maxSec)]]).map(([a, b]) => [Math.max(0, a), Math.min(mono.length / RATE, b)])
      const gap = Math.round(RATE * 0.25)
      const pieces = ranges.map(([a, b]) => mono.slice(Math.round(a * RATE), Math.round(b * RATE)))
      const total = pieces.reduce((n, p) => n + p.length, 0) + gap * (pieces.length - 1)
      const data = new Float32Array(total)
      let at = 0
      for (const p of pieces) {
        data.set(p, at)
        at += p.length + gap
      }
      // 淡入 5 毫秒、淡出 60 毫秒
      const fi = Math.round(RATE * 0.005)
      const fo = Math.round(RATE * 0.06)
      for (let i = 0; i < Math.min(fi, data.length); i++) data[i] *= i / fi
      for (let i = 0; i < Math.min(fo, data.length); i++) data[data.length - 1 - i] *= i / fo
      // 音量：最大聲的地方調到 0.9，最多放大 4 倍
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v))
      const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1
      // 16 位元 PCM 的 WAV
      const buf = new ArrayBuffer(44 + data.length * 2)
      const dv = new DataView(buf)
      const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
      str(0, 'RIFF'); dv.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
      dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
      str(36, 'data'); dv.setUint32(40, data.length * 2, true)
      for (let i = 0; i < data.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i] * gain)) * 32767, true)
      let bin = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { b64: btoa(bin), sec: data.length / RATE, gain, from: ranges[0][0], silent: peakRms < 0.004 }
    }, b64, parts, maxSec)
    const out = Buffer.from(result.b64, 'base64')
    writeFileSync(join(outDir, `${name}.wav`), out)
    console.log(`${name}.wav  ${result.sec.toFixed(1)} 秒  ${Math.round(out.length / 1024)}KB  音量×${result.gain.toFixed(1)}${result.silent ? '  ⚠️ 幾乎沒有聲音，確認一下原檔' : ''}`)
  }
} finally {
  await browser.close()
}

// 網路音檔的出處：只列 public/cards/sounds/ 裡真的有的
const rows = Object.entries(sources)
  .filter(([name, c]) => c.license && existsSync(join(outDir, `${name}.wav`)))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, c]) => `| ${name}.wav | ${c.author || '（未註明）'} | ${c.license} | ${(c.files ?? [c]).map((x) => `[${(x.title ?? c.title).replace(/\|/g, '/')}](${x.page ?? c.page})`).join('、')} |`)
if (rows.length) {
  writeFileSync(join(outDir, 'CREDITS.md'), [
    '# 叫聲的出處',
    '',
    '這個資料夾的叫聲來自 [Wikimedia Commons](https://commons.wikimedia.org/) 的免費授權音檔，剪成一小段、轉成 WAV 使用。',
    '授權為 CC BY／CC BY-SA 的，依授權要求在這裡標出作者和來源；CC0、公有領域的不需要，也一併列出。',
    '自己錄的叫聲不在這份清單裡。',
    '',
    '| 檔案 | 作者 | 授權 | 來源 |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'))
  console.log(`CREDITS.md：${rows.length} 筆`)
  // 家長設定的「圖片與聲音來源」讀這份
  const list = Object.entries(sources)
    .filter(([name, c]) => c.license && existsSync(join(outDir, `${name}.wav`)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, c]) => ({ name, author: c.author || '', license: c.license, title: c.title, page: c.page }))
  writeFileSync(join(outDir, 'credits.json'), JSON.stringify(list))
}
