import { ref, readonly } from 'vue'

/**
 * 出門沒網路時也要能用：網路狀態、讓瀏覽器不要清掉離線資料、檢查字卡圖片存好了沒。
 *
 * App 本身和 public/cards/ 的圖片由 Service Worker 在安裝時就下載好（見 vite.config.ts），
 * 這裡只負責「看得到狀態」和「補下載」。YouTube 影片本身沒辦法離線。
 */

const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
let listening = false

/** 現在有沒有網路；斷線、恢復都會即時更新 */
export function useOnline() {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('online', () => { online.value = true })
    window.addEventListener('offline', () => { online.value = false })
  }
  return { online: readonly(online) }
}

/**
 * 請瀏覽器把這個 App 的資料當成「要保留的」：
 * 沒申請的話，平板空間不夠時 Chrome 可能會自己清掉快取，出門才發現字卡圖片不見了。
 * 已經安裝成 App 的通常會直接同意，不會跳出詢問。
 */
export function keepOfflineData() {
  try {
    navigator.storage?.persist?.().catch(() => {})
  } catch { /* 不支援就算了 */ }
}

/** App 是不是已經由 Service Worker 接管：沒接管的話，斷網時連畫面都打不開 */
export function isOfflineCapable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller)
}

const absolute = (url: string) => new URL(url, window.location.href).href

/** 這幾張圖有幾張已經存在這台裝置上（Service Worker 的快取） */
export async function countCached(urls: string[]): Promise<number> {
  if (typeof caches === 'undefined') return 0
  // 安裝時預先下載的檔案，網址後面會多一段版本號，比對時要忽略
  const hits = await Promise.all(
    urls.map((u) => caches.match(absolute(u), { ignoreSearch: true }).then(Boolean).catch(() => false)),
  )
  return hits.filter(Boolean).length
}

/** 把還沒存好的圖抓一次，Service Worker 會順手存起來；一次抓幾張就好，不要塞爆網路 */
export async function downloadForOffline(urls: string[], onProgress?: (done: number) => void): Promise<void> {
  let done = 0
  const queue = [...urls]
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { await fetch(absolute(url)) } catch { /* 抓不到的下次再補 */ }
      onProgress?.(++done)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}
