import { useState } from './useState'

const STORE_KEY = 'kidtube.display'
const LAST_GROUP_KEY = 'kidtube.lastGroup'

/** 小朋友端的單元怎麼展開 */
export type GroupMode =
  | 'all'         // 全部展開，一頁往下捲
  | 'accordion'   // 一次只開一個，每次都從第一個單元開始
  | 'remember'    // 一次只開一個，而且記住上次看的那個

export interface DisplaySettings {
  groupMode: GroupMode
}

/**
 * 預設「記住上次看的」：
 * 小朋友這週在上第 3 課，打開 App 就直接是第 3 課，不用每次重點一遍。
 */
const DEFAULTS: DisplaySettings = { groupMode: 'remember' }

const MODES: GroupMode[] = ['all', 'accordion', 'remember']

/**
 * 畫面顯示設定。
 * 單元很多的時候（例如一本教材七課），全部展開會捲很久，
 * 這時可以改成一次只開一個單元。
 */
export function useDisplay() {
  const settings = useState<DisplaySettings>('display.settings', () => ({ ...DEFAULTS }))
  const isReady = useState<boolean>('display.ready', () => false)

  function init() {
    if (isReady.value) return
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        settings.value = {
          groupMode: MODES.includes(parsed.groupMode) ? parsed.groupMode : DEFAULTS.groupMode,
        }
      }
    } catch { /* 壞掉就用預設 */ }
    isReady.value = true
  }

  function setGroupMode(mode: GroupMode) {
    settings.value = { ...settings.value, groupMode: mode }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings.value)) } catch { /* 略過 */ }
  }

  /* ---------- 記住每個分區上次開的單元 ---------- */

  function readMap(): Record<string, string> {
    try {
      const raw = localStorage.getItem(LAST_GROUP_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  /** 這個分區上次開的是哪一個單元 */
  function lastGroupOf(categoryId: string): string | null {
    return readMap()[categoryId] ?? null
  }

  function rememberGroup(categoryId: string, subId: string | null) {
    if (settings.value.groupMode !== 'remember') return
    const map = readMap()
    if (subId) map[categoryId] = subId
    else delete map[categoryId]
    try { localStorage.setItem(LAST_GROUP_KEY, JSON.stringify(map)) } catch { /* 略過 */ }
  }

  return { settings, init, setGroupMode, lastGroupOf, rememberGroup }
}
