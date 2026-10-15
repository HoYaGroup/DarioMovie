/**
 * 寫書單試算表（.xlsx）：說明＋每個分區一個工作表（分區自己的設定寫在工作表的「分區」那一列），格式見 src/utils/sheetSource.ts。
 * make-template.mjs（給其他家長的範本）和一次性的 txt → 試算表轉換都用它。
 *
 * 試算表的樣子：標題列凍結、類型欄和問句欄有下拉選單（問句欄的選項來自「問句」工作表第一欄）、字卡本／單元／設定／備註各有底色，
 * 所有格子都是純文字格式（卡片上的字是 3 的時候不會被當成數字）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import { dirname } from 'node:path'

/** 列的底色：一般、標題、字卡本、單元、設定、備註、分區 */
export const ST = { normal: 0, header: 1, deck: 2, sub: 3, setting: 4, note: 5, cat: 6 }

const COLS = [
  ['類型', 'type', 8], ['名稱', 'name', 30], ['大分類', 'section', 16], ['網址', 'url', 42], ['說明', 'meaning', 24], ['圖', 'image', 22],
  ['句子', 'sentences', 38], ['問句', 'ask', 12], ['階段', 'stage', 12], ['背面圖', 'back', 22], ['影片片段', 'clip', 30],
  ['唸法', 'say', 10], ['相反詞', 'pair', 10], ['放哪裡', 'place', 10], ['聲音', 'sound', 26],
]

const styleOf = (type) => ({ 分區: ST.cat, 字卡本: ST.deck, 單元: ST.sub, 設定: ST.setting, 備註: ST.note })[type] ?? ST.normal

/**
 * 一個分區的工作表。rows 是物件：{ type, name, url, meaning, image, sentences: [], ask, stage, back, clip, say, pair, place, sound }；
 * 沒有資料的欄不會出現（類型、名稱一定有）。
 */
export function tabSheet(name, rows) {
  // 有字卡本的工作表，問句欄一定留著（沒填也看得到在哪裡填）
  const hasDeck = rows.some((r) => r.type === '字卡本')
  const ALWAYS_WITH_DECK = new Set(['ask'])
  const maxSent = Math.max(0, ...rows.map((r) => r.sentences?.length ?? 0))
  const cols = []
  for (const [title, key, width] of COLS) {
    if (key === 'type' || key === 'name') { cols.push({ title, key, get: (r) => r[key] ?? '', width }); continue }
    if (key === 'sentences') {
      for (let i = 0; i < maxSent; i++) cols.push({ title: `句子${i + 1}`, get: (r) => r.sentences?.[i] ?? '', width })
      continue
    }
    if ((hasDeck && ALWAYS_WITH_DECK.has(key)) || rows.some((r) => r[key])) cols.push({ title, key, get: (r) => r[key] ?? '', width })
  }
  return {
    name,
    cols,
    rows: [
      { style: ST.header, cells: cols.map((c) => c.title) },
      ...rows.map((r) => ({ style: styleOf(r.type), cells: cols.map((c) => c.get(r)) })),
    ],
  }
}

export const GUIDE_LINES = [
  '這份試算表就是 App 的書單：影片、網站、字卡都在這裡。改完存檔，iPad 下次開 App（或在家長設定按「立即同步」）就更新，不用改程式。',
  '',
  '【怎麼讓 App 讀到】共用 →「知道連結的任何人」→ 檢視者（不要關掉「檢視者可以下載」），複製連結，貼到 App 的 家長設定 →「來源備份」→「學習單（Google 試算表）」。App 只讀、不會改這份試算表。',
  '',
  '【一個工作表就是一個分區】工作表的順序就是小朋友看到的順序（直接拖曳工作表分頁就能排）。不想讓某一區出現：把那個工作表「隱藏」就好（不用刪）。新增一區：加一個工作表。',
  '  「說明」和「問句」這兩個工作表不是分區（App 不會把它們當成分區）。分區的名稱、圖示、屬於哪個大分類、適合哪幾班，所有裝置一起同步，寫在每個工作表自己的「分區」那一列（下面第一個類型）。',
  '',
  '【每個工作表】第一列是欄位名稱，欄的順序可以調，用不到的欄可以刪掉。每一列用第一欄「類型」說明是什麼：',
  '  分區　　這個工作表自己的設定（寫一列就好，通常放在最上面）：名稱＝小朋友看到的分區名稱（空白就用工作表的名字），大分類（例如 數字 🔢，空白就跟上一個工作表一樣），圖＝圖示，階段＝這一整區適合哪幾班',
  '  單元　　名稱＝單元名稱（影片上方的小標題），階段＝這個單元適合哪幾班',
  '  字卡本　名稱＝字卡本的中文名，說明＝英文名稱，階段；問句＝這一本每張卡正面問的那一句（見下面）；它下面的「卡」都是這一本的',
  '  卡　　　名稱＝卡片上最大的字，說明＝中文，圖＝emoji 或圖片路徑，句子1～N＝翻面時輪流唸的英文句子，問句＝正面問的那一句（見下面）',
  '  影片　　名稱＝標題（可以空白，會自動抓 YouTube 的片名），網址，階段',
  '  網站　　名稱＝標題，網址（在 App 裡面開，小朋友不會跳出去）',
  '  設定　　名稱＝一行設定：任務: …、順序: 是、書頁: …、數字卡: 0～100（寫法見專案的 README）',
  '  備註　　給人看的，App 不讀',
  '',
  '【階段】寫 幼幼班、小班、中班、大班（可以寫 小班～中班、幼幼班、小班），空白＝每一班都顯示。階段寫在哪一列就管那一層：「分區」那一列管整個工作表，單元、字卡本、影片那一列管自己；',
  '  底下沒寫的沿用上一層，都沒寫就每一班都顯示。所以整個工作表同一班的，只要在「分區」那一列寫一次；不一樣的再在那幾列各寫各的。',
  '',
  '【卡片正面問的問題】每張卡正面會問一句（這是什麼？、這是誰？…）。每一句問句有一個名字（東西、顏色、誰、哪裡……），',
  '  它的英文和中文寫在「問句」工作表的同一列（問句｜英文｜中文），統一在那裡管，英文和中文不會對不起來。問哪一句，由近到遠：',
  '  1. 卡片自己的「問句」欄（下拉選單選名字）：只有這一張卡。',
  '  2. 「字卡本」那一列的「問句」欄：這一本每張卡預設問這一句（匯入的書單，每一本都已經填好目前用的是哪一句）。',
  '  3. 都沒寫：照字卡本的名稱自動決定（名稱有「顏色」就問顏色）。',
  '  改某一句的字：到「問句」工作表改那一列的英文、中文，用到這一句的所有卡一起改（例如把「東西」改成 What is it?／這是什麼東西？）；整列留空或刪掉＝用程式內建的。',
  '  要新的問句（例如 What animal is this?／這是什麼動物？）：在「問句」工作表最下面加一列，名字自己取（例如 動物），英文和中文都要寫；之後字卡本、卡片的「問句」欄就能選它。',
  '  最後三列「數字」「識字」「注音」是數字卡、中文字卡、注音卡正面問的固定的話（它們不看「問句」欄），也在這個工作表改。',
  '',
  '【其他欄】背面圖（翻面換成這張圖）、影片片段（網址 開始-結束，例如 https://youtu.be/xxx 0:35-0:42）、唸法（注音用同音字代替）、相反詞（對方那個字）、放哪裡（廚房、浴室、臥室、門口、客廳）、聲音（動物叫聲的音檔路徑）。',
  '',
  '【圖片和聲音】「圖」「背面圖」「聲音」可以寫：emoji；https 開頭的圖片網址；或 cards/ 開頭的路徑。',
  '  cards/ 開頭的檔案先看這台裝置有沒有素材（素材包或資料夾同步抓來的），沒有才用網站上的。有版權的（書頁照片）、自己的錄音不要放進公開的 GitHub，',
  '  放在自己的雲端硬碟：做成素材包（zip，裡面的路徑跟這裡寫的一樣）在 iPad「家長設定 › 照片素材 › 圖片和聲音」匯入一次，或放一個結構一樣的資料夾、按「立即同步」（做法見專案 README 的「素材」）。',
  '',
  '【注意】',
  '  ‧ 整份試算表的格子都是純文字格式，新增時也請維持純文字（卡片上的字是 3 不會被當成數字）；3/4 這種日期樣子的字，Google 會自動改成日期，要改回純文字。',
  '  ‧ 同一支 YouTube 影片可以出現在不同單元，同一個單元貼兩次會被略過。',
  '  ‧ 看不懂的列，App 的家長設定會列出是哪個工作表的第幾列。',
  '  ‧ 學校給的教材、照片和不想公開的內容放在這裡就好，不要放進公開的 GitHub。',
]

/**
 * 「問句」工作表：一個問句一列，名字、英文、中文在同一列，統一在這裡管（改字、新增）。
 * rows：{ name: '東西', en: 'What is this?', zh: '這是什麼？' }
 */
export function questionSheet(rows) {
  return {
    name: '問句',
    cols: [{ title: '問句', width: 14 }, { title: '英文', width: 36 }, { title: '中文', width: 30 }],
    rows: [
      { style: ST.header, cells: ['問句', '英文', '中文'] },
      ...rows.map((r) => ({ style: ST.normal, cells: [r.name, r.en ?? '', r.zh ?? ''] })),
    ],
  }
}

export function guideSheet() {
  return { name: '說明', cols: [{ title: '', width: 150 }], rows: GUIDE_LINES.map((t) => ({ style: ST.normal, cells: [t] })), noHeader: true }
}

/* ---------- xlsx ---------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (n) => (n >= 26 ? colName(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26))

const LISTS = {
  type: '分區,單元,字卡本,卡,影片,網站,設定,備註',
  place: '廚房,浴室,臥室,門口,客廳',
}
/** 問句欄的下拉選單：照「問句」工作表第一欄現在有的名字（自己加的也會出現） */
const RANGES = {
  ask: "'問句'!$A$2:$A$100",
}

function sheetXml(s) {
  const colsXml = s.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1" style="0"/>`).join('')
  const rowsXml = s.rows.map((r, i) => `<row r="${i + 1}">${r.cells.map((v, j) => {
    const ref = `${colName(j)}${i + 1}`
    return v === '' ? `<c r="${ref}" s="${r.style}"/>` : `<c r="${ref}" s="${r.style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  }).join('')}</row>`).join('')
  const dv = []
  s.cols.forEach((c, i) => {
    const list = c.key && LISTS[c.key]
    const range = c.key && RANGES[c.key]
    const sqref = `${colName(i)}2:${colName(i)}${Math.max(s.rows.length + 300, 1000)}`
    if (list && !s.noHeader) dv.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${sqref}"><formula1>"${esc(list)}"</formula1></dataValidation>`)
    else if (range && !s.noHeader) dv.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${sqref}"><formula1>${esc(range)}</formula1></dataValidation>`)
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${s.noHeader ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${colsXml}</cols><sheetData>${rowsXml}</sheetData>${dv.length ? `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>` : ''}</worksheet>`
}

const font = (extra = '') => `<font>${extra}<sz val="11"/><name val="Arial"/></font>`
const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`
const xf = (fontId, fillId) => `<xf numFmtId="49" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4">${font()}${font('<b/>')}${font('<color rgb="FF6B7280"/>')}${font('<i/><color rgb="FF6B7280"/>')}</fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('D9E2F3')}${fill('FFF2CC')}${fill('E2EFDA')}${fill('EDEDED')}${fill('E4DFF5')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">${xf(0, 0)}${xf(1, 2)}${xf(1, 3)}${xf(1, 4)}${xf(2, 5)}${xf(3, 0)}${xf(1, 6)}</cellXfs></styleSheet>`

function zip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const comp = deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10)
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20)
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, end])
}

/** 寫出 xlsx：sheets 是 guideSheet()、tabSheet() 做出來的工作表，照順序排 */
export function writeWorkbook(out, sheets) {
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, zip(files))
}
