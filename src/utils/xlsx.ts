/**
 * 讀 .xlsx（Google 試算表「下載成 Excel」的檔案）：一個 zip，裡面是 XML。
 *
 * 為什麼不用 CSV：Google 的 CSV 端點一次只給一個工作表、要先知道有哪些工作表，
 * 而且數字和文字混在同一欄時，少數的那一種會被當成空白。xlsx 一次拿到整本、有每個工作表的名字，
 * 每一格都是原本的字，所以讀字卡這種資料才不會漏。
 *
 * 只做讀的，只認 Google 和一般工具產生的 xlsx（zip 內容用 deflate 壓縮，字串在 sharedStrings 或直接寫在格子裡）。
 * 沒有 DOM 依賴（用正規表示式讀 XML），Node 裡也能測；zip 的部分在 zip.ts。
 */

import { listZip, readZipEntry, ZipError, type ZipEntry } from './zip'

export interface XlsxSheet {
  name: string
  /** 隱藏的工作表（家長把整區暫停的做法） */
  hidden: boolean
  /** 每一列的每一格（都是字串，空格是 ''）；第一列是 rows[0] */
  rows: string[][]
}

export class XlsxError extends Error {}

const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b)

/* ---------- XML ---------- */

function unescapeXml(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e]!
    })
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]!] = unescapeXml(m[2]!)
  return out
}

/** 一段 XML 裡所有 <t>…</t> 的字接起來（注音標註 <rPh> 不算） */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? ''
  return unescapeXml(out)
}

/** A→0、B→1、AA→26 */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(textOf(m[1] ?? ''))
  return out
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let seq = 0
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]!)
    const rowNo = ra.r ? Number(ra.r) - 1 : seq
    seq = rowNo + 1
    const cells: string[] = []
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]!)
      const body = cm[2] ?? ''
      const col = ca.r ? colIndex(ca.r) : cells.length
      let value = ''
      const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
      switch (ca.t) {
        case 's': value = shared[Number(v?.[1])] ?? ''; break
        case 'inlineStr': value = textOf(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? ''); break
        case 'str': value = unescapeXml(v?.[1] ?? ''); break
        case 'b': value = v?.[1] === '1' ? 'TRUE' : 'FALSE'; break
        case 'e': value = ''; break
        default: value = unescapeXml(v?.[1] ?? '')
      }
      while (cells.length < col) cells.push('')
      cells[col] = value
    }
    while (rows.length < rowNo) rows.push([])
    rows[rowNo] = cells
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop()
  return rows
}

/** 讀整本 xlsx：每個工作表的名字和每一格，順序就是工作表在試算表裡的順序 */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  try {
    return await readWorkbook(bytes)
  } catch (err) {
    if (err instanceof ZipError) throw new XlsxError(err.message.replace('zip', 'xlsx'))
    throw err
  }
}

async function readWorkbook(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const dir = new Map<string, ZipEntry>(listZip(bytes).map((e) => [e.name, e]))
  const get = async (name: string): Promise<string | null> => {
    const e = dir.get(name)
    return e ? decode(await readZipEntry(bytes, e)) : null
  }

  const workbook = await get('xl/workbook.xml')
  const rels = await get('xl/_rels/workbook.xml.rels')
  if (!workbook || !rels) throw new XlsxError('不是試算表檔（xlsx 裡找不到工作表清單）')

  const target = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!)
    if (a.Id && a.Target) target.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`)
  }

  const shared = parseSharedStrings((await get('xl/sharedStrings.xml')) ?? '')

  const sheets: XlsxSheet[] = []
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!)
    const rid = Object.entries(a).find(([k]) => k === 'id' || k.endsWith(':id'))?.[1]
    const path = rid ? target.get(rid) : undefined
    const xml = path ? await get(path) : null
    if (!a.name || xml === null) continue
    sheets.push({ name: a.name, hidden: a.state === 'hidden' || a.state === 'veryHidden', rows: parseSheet(xml, shared) })
  }
  return sheets
}
