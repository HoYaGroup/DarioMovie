import { fetchSheetPlaylist, sheetIdOf, SheetError, type SheetPlaylist } from '~/utils/sheetSource'
import { setQuestionTexts } from '~/utils/questions'
import { useState } from './useState'

/**
 * 學習單（Google 試算表）的連結和讀取結果（轉換規則見 utils/sheetSource.ts）。
 *
 * 書單只在試算表裡，專案裡沒有任何 txt。連結只存在這台裝置（localStorage），不進 GitHub；備份檔有帶，
 * 換 iPad 還原後不用再貼一次。
 * 讀到的內容也留一份在這台裝置上：下一次連不上（斷線、試算表暫時打不開）還有上一次的內容可以用，
 * 不然同步的時候書單會整批不見。這份比較大（幾百 KB），放在 Cache Storage，不佔 localStorage 的空間。
 */
export const SHEET_URL_KEY = 'kidtube.sheetUrl'
const CACHE_NAME = 'kidtube-sheet'

export interface SheetStatus {
  /** off 沒設定；ok 剛讀到；cached 讀不到、用上次留下來的；error 讀不到又沒有留下來的 */
  state: 'off' | 'ok' | 'cached' | 'error'
  message: string
  warnings: string[]
  /** 上一次成功讀到的時間 */
  at: number | null
  tabs: number
  items: number
  cards: number
}

interface Cached extends SheetPlaylist {
  at: number
}

function readLink(): string {
  try { return localStorage.getItem(SHEET_URL_KEY) ?? '' } catch { return '' }
}

/** Cache Storage 要一個網址當鑰匙，這個網址不會真的被請求 */
const cacheKey = (id: string) => new Request(`./__sheet__/${id}`)

async function readCache(id: string): Promise<Cached | null> {
  try {
    if (typeof caches === 'undefined') return null
    const res = await (await caches.open(CACHE_NAME)).match(cacheKey(id))
    const data = res ? await res.json() : null
    if (data && typeof data.text === 'string' && Array.isArray(data.origins)) return { cards: 0, questions: {}, ...data } as Cached
  } catch { /* 壞了就當作沒有 */ }
  return null
}

async function writeCache(id: string, data: Cached) {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(CACHE_NAME)
    await cache.put(cacheKey(id), new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }))
  } catch { /* 空間不夠就算了，只是離線時沒有備份可用 */ }
}

async function clearCache() {
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME) } catch { /* 略過 */ }
}

/**
 * 網址後面帶 ?sheet=試算表連結，而且這台還沒設定過，就存起來，再把網址列清乾淨。
 * 電視沒有家長設定頁（把這個網址設成電視 App 的啟動網址就好），或要用一個連結替另一台裝置設定好。
 * 已經設定過的不會被換掉：不然誰傳來的連結，就能把孩子的 App 換成他的書單。
 */
export function adoptSheetFromUrl() {
  try {
    const url = new URL(location.href)
    const value = url.searchParams.get('sheet')
    if (value === null) return
    url.searchParams.delete('sheet')
    history.replaceState(null, '', url.toString())
    if (readLink() || !sheetIdOf(value)) return
    localStorage.setItem(SHEET_URL_KEY, value.trim())
  } catch { /* 沒有網址列或不能存就算了 */ }
}

const off = (): SheetStatus => ({ state: 'off', message: '', warnings: [], at: null, tabs: 0, items: 0, cards: 0 })

export function useSheetSource() {
  const link = useState<string>('sheet.link', readLink)
  const status = useState<SheetStatus>('sheet.status', off)

  const sheetId = () => sheetIdOf(link.value)

  /** 存連結。空白表示不用試算表；看不懂的連結不存 */
  function setLink(input: string): { ok: boolean; message: string } {
    const text = input.trim()
    if (!text) {
      clearLink()
      return { ok: true, message: '已移除試算表連結。' }
    }
    const id = sheetIdOf(text)
    if (!id) {
      return {
        ok: false,
        message: '看不懂這個連結。請在試算表按右上角「共用」→ 複製連結，貼上網址（長得像 https://docs.google.com/spreadsheets/d/…）。'
          + '「發布到網路」的連結不能用。',
      }
    }
    link.value = text
    try { localStorage.setItem(SHEET_URL_KEY, text) } catch { /* 略過 */ }
    return { ok: true, message: '' }
  }

  function clearLink() {
    link.value = ''
    status.value = off()
    try { localStorage.removeItem(SHEET_URL_KEY) } catch { /* 略過 */ }
    setQuestionTexts({})   // 試算表「問句」工作表改過的問句也不留
    void clearCache()
  }

  /**
   * 讀試算表轉成書單文字。沒設定回 null；讀不到就用上次留下來的，連那個都沒有也回 null
   * （呼叫端就不更新，已經有的書單不會被清掉：沒有留下來的，就表示從來沒有套用過）。
   */
  async function load(): Promise<SheetPlaylist | null> {
    const id = sheetId()
    if (!id) {
      status.value = off()
      return null
    }
    try {
      const data = await fetchSheetPlaylist(id)
      const at = Date.now()
      await writeCache(id, { ...data, at })
      status.value = {
        state: 'ok',
        message: `讀到 ${data.tabs} 個工作表：${data.items} 筆影片和網站、${data.cards} 張卡。`,
        warnings: data.warnings,
        at,
        tabs: data.tabs,
        items: data.items,
        cards: data.cards,
      }
      return data
    } catch (err) {
      const message = err instanceof SheetError ? err.message : '讀試算表時出了點問題，請稍後再試。'
      const cached = await readCache(id)
      if (cached) {
        status.value = {
          state: 'cached',
          message: `${message} 先用 ${new Date(cached.at).toLocaleString('zh-TW', { hour12: false })} 讀到的內容。`,
          warnings: cached.warnings,
          at: cached.at,
          tabs: cached.tabs,
          items: cached.items,
          cards: cached.cards,
        }
        return cached
      }
      status.value = { ...off(), state: 'error', message }
      return null
    }
  }

  return { link, status, setLink, clearLink, load }
}
