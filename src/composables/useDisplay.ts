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
  /** 播放速度，換一部影片後會沿用同一個設定，不用每次重調 */
  playbackRate: number
  /** 字幕是否預設開啟 */
  captionsOn: boolean
}

/**
 * 預設「記住上次看的」：
 * 小朋友這週在上第 3 課，打開 App 就直接是第 3 課，不用每次重點一遍。
 */
const DEFAULTS: DisplaySettings = { groupMode: 'remember', playbackRate: 1, captionsOn: false }

const MODES: GroupMode[] = ['all', 'accordion', 'remember']

/**
 * 播放速度可選的檔位。
 * 0.9 不是 YouTube 選單上原本就有的檔位，但實測 setPlaybackRate(0.9) 真的會生效
 * （不會被吃掉或就近吸附到 1），所以慢速區間多切一格給需要慢慢跟讀的小朋友用。
 */
export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

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
          playbackRate: PLAYBACK_RATES.includes(parsed.playbackRate)
            ? parsed.playbackRate
            : DEFAULTS.playbackRate,
          captionsOn: typeof parsed.captionsOn === 'boolean' ? parsed.captionsOn : DEFAULTS.captionsOn,
        }
      }
    } catch { /* 壞掉就用預設 */ }
    isReady.value = true
  }

  function setGroupMode(mode: GroupMode) {
    settings.value = { ...settings.value, groupMode: mode }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings.value)) } catch { /* 略過 */ }
  }

  function setPlaybackRate(rate: number) {
    settings.value = { ...settings.value, playbackRate: rate }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings.value)) } catch { /* 略過 */ }
  }

  function setCaptionsOn(flag: boolean) {
    settings.value = { ...settings.value, captionsOn: flag }
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

  return { settings, init, setGroupMode, setPlaybackRate, setCaptionsOn, lastGroupOf, rememberGroup }
}
