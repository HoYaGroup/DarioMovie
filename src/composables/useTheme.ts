import { useState } from './useState'

const STORE_KEY = 'kidtube.theme'

export type ThemeChoice = 'dark' | 'light' | 'system'

/** PWA 狀態列要用的底色，跟著主題走 */
export const THEME_COLORS = { dark: '#14122e', light: '#f4f3fa' } as const

/** 深色是預設：看影片的時候不刺眼，影片縮圖也跳得出來 */
const DEFAULT: ThemeChoice = 'dark'

/**
 * 佈景主題。
 *
 * 選 system 的話跟著 iPad 的外觀設定走，而且系統中途切換（例如自動深色）
 * 也會即時跟上。
 */
export function useTheme() {
  const choice = useState<ThemeChoice>('theme.choice', () => DEFAULT)
  const isReady = useState<boolean>('theme.ready', () => false)
  /** 實際套用的是哪一個，選 system 時由系統決定 */
  const resolved = useState<'dark' | 'light'>('theme.resolved', () => 'dark')

  function systemPrefersLight(): boolean {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  }

  function apply() {
    const theme = choice.value === 'system'
      ? (systemPrefersLight() ? 'light' : 'dark')
      : choice.value

    resolved.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    // PWA 狀態列的顏色（theme-color meta）由 App.vue 的 watchEffect 綁在 resolved 上
  }

  function init() {
    if (isReady.value) return
    try {
      const saved = localStorage.getItem(STORE_KEY)
      if (saved === 'dark' || saved === 'light' || saved === 'system') choice.value = saved
    } catch { /* 讀不到就用預設 */ }

    apply()

    // 選「跟隨系統」時，系統中途切換也要跟上
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (choice.value === 'system') apply()
    })

    isReady.value = true
  }

  function setTheme(next: ThemeChoice) {
    choice.value = next
    try { localStorage.setItem(STORE_KEY, next) } catch { /* 略過 */ }
    apply()
  }

  return { choice, resolved, init, setTheme }
}
