/**
 * 照 scripts/book-crops.mjs 的格子範圍，把「我的書」每一頁的原始照片裁成一張一張字卡的圖，
 * 直接寫進 public/cards/books/<書>/<頁>/<名>.webp（舊的會被蓋掉）。
 *
 *   npm i --no-save puppeteer-core            # 只在要裁圖時裝，不放進 package.json
 *   node scripts/crop-book.mjs                # 全部頁
 *   node scripts/crop-book.mjs animals/pets   # 只裁這一頁
 *   node scripts/crop-book.mjs --photos D:/原始照片   # 原始照片不在 drive/ 資料夾時
 *   node scripts/crop-book.mjs --debug D:/暫存        # 另外存每一頁偵測到的格子邊（畫在照片上）
 *
 * 用 Chrome 的畫布處理（不用另外裝影像套件）；電腦要有 Google Chrome（路徑可用環境變數 CHROME 指定）。
 *
 * 座標（book-crops.mjs）是照「public/cards/books/<書>/<頁>.webp 整頁照片」量的，只是大概的範圍。
 * 原始照片比整頁照片大 2～3 倍而且取景略有不同，所以 scripts/book-photos.json 記每一頁用哪張原始照片，
 * 以及整頁照片在原始照片裡的位置：原始座標 = x0 + 整頁座標 × k。找不到原始照片的頁，會退回用整頁照片裁（比較糊）。
 *
 * 每一格會再「找邊」：書頁拍得有點斜，格子的邊是歪的，粗略的方框會帶到旁邊格子的細條。所以每條邊
 * 沿著邊取幾個點，各自往裡找顏色變化最大的那條線，拉一條直線；四條線圍成的四邊形再拉正成長方形，
 * 最後四個角削成圓角（書上的格子就是圓角，角上會露出底色）。某一邊找不到（兩格同色）就用粗略的方框。
 *
 * 圖縮（或放大）到最長邊約 800px：放大的才銳化一次邊緣。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CIRCLES, MASKS, OVERHANG, RECTS } from './book-crops.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const books = join(root, 'public/cards/books')
const photoInfo = JSON.parse(readFileSync(join(root, 'scripts/book-photos.json'), 'utf8'))

const args = process.argv.slice(2)
let photoDir = join(root, 'drive')
let debugDir = null
const pickPages = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--photos') photoDir = resolve(args[++i])
  else if (args[i] === '--debug') debugDir = resolve(args[++i])
  else pickPages.push(args[i])
}
const pages = pickPages.length ? pickPages : Object.keys(RECTS)

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('找不到 puppeteer-core，請先執行：npm i --no-save puppeteer-core')
  process.exit(1)
}

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const dataUrl = (file) => `data:${MIME[extname(file).toLowerCase()]};base64,${readFileSync(file).toString('base64')}`

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
})

try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  for (const key of pages) {
    if (!RECTS[key]) { console.warn('沒有這一頁的格子範圍：', key); continue }
    const ref = join(books, `${key}.webp`)
    const info = photoInfo[key]
    const photoFile = info && join(photoDir, info.photo)
    const usePhoto = photoFile && existsSync(photoFile)
    if (!usePhoto) console.warn(`${key}：找不到原始照片（${info ? info.photo : '沒有設定'}），改用整頁照片裁，會比較糊`)
    // 沒有原始照片就把整頁照片當原始照片：k=1、位置 0
    const tf = usePhoto ? { k: info.k, x0: info.x0, y0: info.y0 } : { k: 1, x0: 0, y0: 0 }

    const out = await page.evaluate(async (refSrc, photoSrc, tf, rects, circles, masks, overhang, wantDebug) => {
      const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i }
      const refImg = await load(refSrc)
      const img = photoSrc ? await load(photoSrc) : refImg
      const W = img.naturalWidth, H = img.naturalHeight
      const refW = refImg.naturalWidth, refH = refImg.naturalHeight
      const { k, x0: ox, y0: oy } = tf
      const full = document.createElement('canvas')
      full.width = W
      full.height = H
      const fg = full.getContext('2d')
      fg.drawImage(img, 0, 0)
      const FD = fg.getImageData(0, 0, W, H).data

      // ---- 找邊 ----
      // 平均 (cx, cy) 為中心、寬高 (bw, bh) 的一小塊顏色
      const meanColor = (x0, y0, x1, y1) => {
        let r = 0, g = 0, b = 0, n = 0
        for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y += 2) {
          for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x += 2) {
            const i = (y * W + x) * 4
            r += FD[i]; g += FD[i + 1]; b += FD[i + 2]; n++
          }
        }
        return n ? [r / n, g / n, b / n] : null
      }
      const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
      const avg = (cs) => [0, 1, 2].map((c) => cs.reduce((s, v) => s + v[c], 0) / cs.length)

      // 一條邊（L/R/T/B）上沿邊取 5 個點，各自往裡找顏色變化最大的位置；回傳 [t, 深度] 的清單（深度＝從粗略的邊往裡幾 px，可為負）
      const SAMPLES = [0.2, 0.35, 0.5, 0.65, 0.8]
      const STEP_MIN = 45
      const detect = (side, rc) => {
        const [x0, y0, x1, y1] = rc
        const horiz = side === 'L' || side === 'R'
        const len = horiz ? y1 - y0 : x1 - x0 // 邊的長度
        const dim = horiz ? x1 - x0 : y1 - y0 // 垂直於邊的尺寸（往裡找最多佔多少）
        const outer = Math.round(dim * (side === 'B' ? 0.04 : 0.03))
        const inner = Math.round(dim * (horiz ? 0.07 : side === 'T' ? 0.04 : 0.02))
        const half = Math.max(6, len * 0.04)
        const found = []
        for (const t of SAMPLES) {
          const c = (horiz ? y0 : x0) + t * len
          const prof = []
          for (let i = -outer; i <= inner + 3; i++) {
            let col
            if (side === 'L') col = meanColor(x0 + i - 1, c - half, x0 + i + 1, c + half)
            else if (side === 'R') col = meanColor(x1 - i - 1, c - half, x1 - i + 1, c + half)
            else if (side === 'T') col = meanColor(c - half, y0 + i - 1, c + half, y0 + i + 1)
            else col = meanColor(c - half, y1 - i - 1, c + half, y1 - i + 1)
            prof.push(col)
          }
          let best = 0, at = null
          for (let j = 3; j < prof.length - 3; j++) {
            if (!prof[j - 3] || !prof[j + 2]) continue
            const s = dist(avg(prof.slice(j - 3, j)), avg(prof.slice(j, j + 3)))
            if (s > best) { best = s; at = j }
          }
          if (at !== null && best >= STEP_MIN) found.push([t, at - outer])
        }
        return { found, dim }
      }

      // 把清單拉成一條直線 depth(t)；取不到就回傳 null
      const fitLine = ({ found, dim }) => {
        if (found.length < 3) return null
        const ds = found.map((f) => f[1]).sort((a, b) => a - b)
        const m = ds[ds.length >> 1]
        const good = found.filter((f) => Math.abs(f[1] - m) <= dim * 0.03)
        if (good.length < 3) return { c0: m, c1: 0 }
        const n = good.length
        const mt = good.reduce((s, f) => s + f[0], 0) / n
        const md = good.reduce((s, f) => s + f[1], 0) / n
        let num = 0, den = 0
        for (const [t, d] of good) { num += (t - mt) * (d - md); den += (t - mt) * (t - mt) }
        const c1 = den > 1e-9 ? num / den : 0
        return { c0: md - c1 * mt, c1 }
      }

      // 一格的四邊形：回傳 [TL, TR, BR, BL]（原始照片座標）
      const findQuad = (r, free) => {
        const rc = [ox + r[0] * k, oy + r[1] * k, r[2] > refW ? W : ox + r[2] * k, r[3] > refH ? H : oy + r[3] * k]
        rc[0] = Math.max(0, rc[0]); rc[1] = Math.max(0, rc[1]); rc[2] = Math.min(W, rc[2]); rc[3] = Math.min(H, rc[3])
        const [x0, y0, x1, y1] = rc
        const lines = {}
        const sides = {}
        for (const s of ['L', 'R', 'T', 'B']) {
          // 貼著照片邊的就不找了，直接用照片邊
          // 貼著照片邊的、圖伸出格子外而特地往外擴的邊：直接用範圍的邊，不找也不留邊
          const atEdge = (s === 'R' && x1 >= W - 1) || (s === 'B' && y1 >= H - 1) || (s === 'L' && x0 <= 1) || (s === 'T' && y0 <= 1) || free.includes(s)
          const fit = atEdge ? { c0: 0, c1: 0 } : fitLine(detect(s, rc))
          sides[s] = fit ? 'ok' : '粗略'
          // 找不到的邊用粗略的方框往裡 3px；底邊底下有字，只留 0.5px
          const base = fit || { c0: (s === 'B' ? 0.5 : 3) * k, c1: 0 }
          // 找到的邊往裡多留 2px，免得帶到分界線那一條混色的邊；底邊不留（要留住底下的字）
          lines[s] = (t) => base.c0 + base.c1 * t + (atEdge || s === 'B' ? 0 : 2)
        }
        const w = x1 - x0, h = y1 - y0
        // 左右邊：x = x0 + depth(t)，t = (y - y0) / h；上下邊：y = y0 + depth(t)，t = (x - x0) / w
        const xL = (y) => x0 + lines.L((y - y0) / h)
        const xR = (y) => x1 - lines.R((y - y0) / h)
        const yT = (x) => y0 + lines.T((x - x0) / w)
        const yB = (x) => y1 - lines.B((x - x0) / w)
        const corner = (xf, yf, sx, sy) => {
          let x = sx, y = sy
          for (let i = 0; i < 4; i++) { x = xf(y); y = yf(x) }
          return [x, y]
        }
        return { quad: [corner(xL, yT, x0, y0), corner(xR, yT, x1, y0), corner(xR, yB, x1, y1), corner(xL, yB, x0, y1)], sides }
      }

      // 放大後銳化一次邊緣（很小的差當雜訊不放大）
      const sharpen = (u) => {
        const w = u.width, h = u.height
        const ug = u.getContext('2d')
        const base = ug.getImageData(0, 0, w, h)
        const b = document.createElement('canvas')
        b.width = w; b.height = h
        const bg = b.getContext('2d')
        bg.filter = 'blur(1px)'
        bg.drawImage(u, 0, 0)
        const blur = bg.getImageData(0, 0, w, h).data
        const d = base.data
        for (let i = 0; i < d.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const diff = d[i + c] - blur[i + c]
            const t = Math.abs(diff) < 3 ? 0 : diff
            const v = d[i + c] + t
            d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
          }
        }
        ug.putImageData(base, 0, 0)
      }

      const result = {}
      const report = {}
      const debugQuads = []
      for (const [name, r] of Object.entries(rects)) {
        const { quad, sides } = findQuad(r, overhang[name] || [])
        debugQuads.push(quad)
        const [TL, TR, BR, BL] = quad
        const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
        const ow = (len(TL, TR) + len(BL, BR)) / 2
        const oh = (len(TL, BL) + len(TR, BR)) / 2
        const f = Math.min(2.2, 800 / Math.max(ow, oh))
        const outW = Math.max(8, Math.round(ow * f)), outH = Math.max(8, Math.round(oh * f))

        // 四邊形外框那一塊先縮到比輸出略大一點（縮小時不要失真），紅圈、塗字也畫在這一塊上
        const bx0 = Math.floor(Math.min(...quad.map((p) => p[0])) - 2), by0 = Math.floor(Math.min(...quad.map((p) => p[1])) - 2)
        const bx1 = Math.ceil(Math.max(...quad.map((p) => p[0])) + 2), by1 = Math.ceil(Math.max(...quad.map((p) => p[1])) + 2)
        const g = Math.min(1, f * 1.3)
        const wk = document.createElement('canvas')
        wk.width = Math.max(1, Math.round((bx1 - bx0) * g))
        wk.height = Math.max(1, Math.round((by1 - by0) * g))
        const wg = wk.getContext('2d', { willReadFrequently: true })
        wg.imageSmoothingEnabled = true
        wg.imageSmoothingQuality = 'high'
        wg.drawImage(full, bx0, by0, bx1 - bx0, by1 - by0, 0, 0, wk.width, wk.height)
        const toWk = (p) => [(p[0] - bx0) * g, (p[1] - by0) * g]
        for (const [mx0, my0, mx1, my1, sx, sy] of masks[name] || []) {
          const px = fg.getImageData(Math.round(ox + sx * k) - 2, Math.round(oy + sy * k) - 2, 5, 5).data
          let R = 0, G = 0, B = 0
          for (let i = 0; i < px.length; i += 4) { R += px[i]; G += px[i + 1]; B += px[i + 2] }
          const n = px.length / 4
          wg.fillStyle = `rgb(${Math.round(R / n)},${Math.round(G / n)},${Math.round(B / n)})`
          const [ax, ay] = toWk([ox + mx0 * k, oy + my0 * k])
          wg.fillRect(ax, ay, (mx1 - mx0) * k * g, (my1 - my0) * k * g)
        }
        const ring = circles[name]
        if (ring) {
          const [cx, cy] = toWk([ox + ring[0] * k, oy + ring[1] * k])
          wg.strokeStyle = '#f0325a'
          // 線寬照最後輸出的大小算（最長邊的 1.2%），換成這一塊的單位：這一塊的 1 單位 = outW / (ow × g) 個輸出像素
          wg.lineWidth = (Math.max(4, Math.round(Math.max(outW, outH) * 0.012)) * ow * g) / outW
          wg.beginPath()
          wg.ellipse(cx, cy, ring[2] * k * g, ring[3] * k * g, 0, 0, Math.PI * 2)
          wg.stroke()
        }
        const WD = wg.getImageData(0, 0, wk.width, wk.height)
        const wd = WD.data, ww = wk.width, wh = wk.height

        // 把四邊形拉成長方形：輸出的每個點 (u, v) 對到四邊形裡的位置，雙線性取樣
        const q = quad.map(toWk)
        const u8 = document.createElement('canvas')
        u8.width = outW; u8.height = outH
        const ug = u8.getContext('2d')
        const od = ug.createImageData(outW, outH)
        const o = od.data
        for (let y = 0; y < outH; y++) {
          const v = (y + 0.5) / outH
          for (let x = 0; x < outW; x++) {
            const u = (x + 0.5) / outW
            const sx = (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0])
            const sy = (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1])
            const fx = Math.min(ww - 1.001, Math.max(0, sx - 0.5)), fy = Math.min(wh - 1.001, Math.max(0, sy - 0.5))
            const ix = fx | 0, iy = fy | 0, dx = fx - ix, dy = fy - iy
            const i00 = (iy * ww + ix) * 4, i10 = i00 + 4, i01 = i00 + ww * 4, i11 = i01 + 4
            const oi = (y * outW + x) * 4
            for (let c = 0; c < 3; c++) {
              o[oi + c] = wd[i00 + c] * (1 - dx) * (1 - dy) + wd[i10 + c] * dx * (1 - dy) + wd[i01 + c] * (1 - dx) * dy + wd[i11 + c] * dx * dy
            }
            o[oi + 3] = 255
          }
        }
        ug.putImageData(od, 0, 0)
        if (f > 1.01) sharpen(u8)

        // 四個角削成圓角（書上的格子就是圓角，角上會露出旁邊格子或底色）
        const rad = Math.round(Math.min(outW, outH) * 0.04)
        ug.globalCompositeOperation = 'destination-in'
        ug.beginPath()
        ug.roundRect(0, 0, outW, outH, rad)
        ug.fill()
        ug.globalCompositeOperation = 'source-over'

        result[name] = u8.toDataURL('image/webp', 0.85).split(',')[1]
        report[name] = Object.values(sides).join('')
      }

      let debug = null
      if (wantDebug) {
        const s = 1600 / W
        const c = document.createElement('canvas')
        c.width = 1600; c.height = Math.round(H * s)
        const g = c.getContext('2d')
        g.drawImage(full, 0, 0, c.width, c.height)
        g.strokeStyle = '#00ff40'; g.lineWidth = 1.5
        for (const q of debugQuads) {
          g.beginPath()
          q.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)))
          g.closePath(); g.stroke()
        }
        debug = c.toDataURL('image/png').split(',')[1]
      }
      return { result, report, debug }
    }, dataUrl(ref), usePhoto ? dataUrl(photoFile) : null, tf, RECTS[key], CIRCLES[key] || {}, MASKS[key] || {}, OVERHANG[key] || {}, !!debugDir)

    for (const [name, b64] of Object.entries(out.result)) {
      const file = join(books, key, `${name}.webp`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(b64, 'base64'))
    }
    if (debugDir && out.debug) {
      mkdirSync(debugDir, { recursive: true })
      writeFileSync(join(debugDir, `${key.replace('/', '-')}.png`), Buffer.from(out.debug, 'base64'))
    }
    const rough = Object.entries(out.report).filter(([, s]) => s.includes('粗略')).map(([n]) => n)
    console.log(key, Object.keys(out.result).length, '張', usePhoto ? '' : '（用整頁照片）', rough.length ? `；有邊找不到、用粗略方框：${rough.join('、')}` : '')
  }
} finally {
  await browser.close()
}
