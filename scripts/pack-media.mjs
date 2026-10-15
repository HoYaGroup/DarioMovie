/**
 * 把 public/ 底下的圖片、音檔打包成「素材包」zip，傳到自己的 Google 雲端硬碟，再到 iPad 的
 * 家長設定「照片素材 › 素材包」匯入（見 README 的「素材包」）。
 *
 *   node scripts/pack-media.mjs                          # 預設：cards/books（書頁照片和裁出來的圖）＋ cards/sounds（叫聲）
 *   node scripts/pack-media.mjs 素材包.zip cards/books    # 指定輸出檔和要打包的資料夾（相對 public/）
 *
 * zip 裡的路徑 = 試算表「圖」「聲音」欄寫的路徑（cards/books/animals/pets.webp），所以試算表不用改。
 * 只收圖片（webp、jpg、png、gif、avif）和音檔（wav、mp3、m4a、aac）；輸出預設在 private/（不進 git）。
 *
 * 為什麼有這個：書頁照片有版權，不放在公開的 GitHub，也不放在公開的網站（public/ 只留自己拍的、免費授權的）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')

const [outArg, ...dirArgs] = process.argv.slice(2)
const out = resolve(outArg ?? join(root, 'private', '素材包.zip'))
const dirs = dirArgs.length ? dirArgs : ['cards/books', 'cards/sounds']

const EXT = /\.(?:webp|jpe?g|png|gif|avif|wav|mp3|m4a|aac)$/i
/** 已經壓縮過的格式再壓一次只是白費力氣，直接存 */
const STORE = /\.(?:webp|jpe?g|png|gif|avif|mp3|m4a|aac)$/i

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

const files = []
for (const d of dirs) {
  const base = join(pub, d)
  if (!existsSync(base)) {
    console.log(`找不到 public/${d}，略過`)
    continue
  }
  for (const p of walk(base)) {
    if (!EXT.test(p)) continue
    files.push({ name: relative(pub, p).replace(/\\/g, '/'), data: readFileSync(p) })
  }
}
if (!files.length) {
  console.log('沒有找到可以打包的圖片或音檔。')
  process.exit(1)
}

function zip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const stored = STORE.test(name)
    const comp = stored ? data : deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(stored ? 0 : 8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8)
    c.writeUInt16LE(stored ? 0 : 8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, end])
}

mkdirSync(dirname(out), { recursive: true })
const buf = zip(files)
writeFileSync(out, buf)
const mb = (n) => (n / 1048576).toFixed(1)
console.log(`素材包：${out}`)
console.log(`  ${files.length} 個檔案，${mb(files.reduce((n, f) => n + f.data.length, 0))} MB → zip ${mb(buf.length)} MB`)
for (const d of dirs) console.log(`  ${d}：${files.filter((f) => f.name.startsWith(d + '/')).length} 個`)
