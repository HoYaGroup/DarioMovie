/**
 * 讀 zip（試算表下載下來的 xlsx、家長的「素材包」都是 zip）。
 * 只做讀的，不接受 zip64；解壓縮用瀏覽器內建的 DecompressionStream（iPadOS 16.4 起有）。
 * 沒有 DOM 依賴，Node 裡也能測。
 */

export class ZipError extends Error {}

export interface ZipEntry {
  /** zip 裡的路徑，斜線分隔（資料夾本身不列） */
  name: string
  method: number
  csize: number
  usize: number
  offset: number
}

const MAX_ENTRIES = 5000
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0

/** zip 的目錄：每個檔案的位置（資料夾不列） */
export function listZip(b: Uint8Array): ZipEntry[] {
  // 目錄結尾記錄在檔案最後面（後面可能有最多 64KB 的註解）
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new ZipError('不是 zip 檔（找不到目錄）')

  const count = u16(b, end + 10)
  let p = u32(b, end + 16)
  if (count > MAX_ENTRIES) throw new ZipError('zip 裡的檔案太多')

  const out: ZipEntry[] = []
  const decoder = new TextDecoder('utf-8')
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new ZipError('zip 的目錄壞掉了')
    const method = u16(b, p + 10)
    const csize = u32(b, p + 20)
    const usize = u32(b, p + 24)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const offset = u32(b, p + 42)
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/')
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw new ZipError('zip 太大了（不支援 zip64）')
    if (usize > MAX_ENTRY_BYTES) throw new ZipError(`zip 裡有太大的檔案：${name}`)
    if (!name.endsWith('/')) out.push({ name, method, csize, usize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('這台裝置的瀏覽器太舊，解不開壓縮檔（要 iPadOS 16.4 以上）')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 取出一個檔案的內容 */
export async function readZipEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (u32(b, e.offset) !== 0x04034b50) throw new ZipError('zip 的檔案壞掉了')
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28)
  const data = b.subarray(start, start + e.csize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateRaw(data)
  throw new ZipError('zip 用了不認得的壓縮方式')
}
