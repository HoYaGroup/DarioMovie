import { useState } from './useState'

const STORE_KEY = 'kidtube.continueWatching'

/** 少於這個秒數就當作看完了，不值得再跳出來問要不要接續 */
const MIN_REMAINING_SEC = 15

export interface ContinueEntry {
  uid: string
  positionSec: number
  durationSec: number
  updatedAt: number
}

/**
 * 記住上次看到哪一支影片、看到第幾秒，重開 App 時清單畫面可以問小朋友要不要接續播放。
 * 只記最近一支——多支同時記反而讓小朋友選不完，也不是「接續」的語意。
 */
export function useContinueWatching() {
  const entry = useState<ContinueEntry | null>('continueWatching.entry', () => null)
  const isReady = useState<boolean>('continueWatching.ready', () => false)

  function init() {
    if (isReady.value) return
    try {
      const raw = localStorage.getItem(STORE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (
        parsed && typeof parsed.uid === 'string'
        && Number.isFinite(parsed.positionSec) && Number.isFinite(parsed.durationSec)
      ) {
        entry.value = parsed
      }
    } catch { /* 壞掉就當作沒有紀錄 */ }
    isReady.value = true
  }

  function save(uid: string, positionSec: number, durationSec: number) {
    if (!uid || positionSec < 0 || !durationSec) return
    entry.value = { uid, positionSec, durationSec, updatedAt: Date.now() }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(entry.value)) } catch { /* 略過 */ }
  }

  function clear() {
    entry.value = null
    try { localStorage.removeItem(STORE_KEY) } catch { /* 略過 */ }
  }

  /** 值得跳出來問的那種「還沒看完」，不是快看完或已經看完的 */
  function isResumable(e: ContinueEntry): boolean {
    return e.durationSec - e.positionSec >= MIN_REMAINING_SEC
  }

  return { entry, init, save, clear, isResumable }
}
