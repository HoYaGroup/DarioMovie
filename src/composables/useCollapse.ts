import { useState } from './useState'

const STORE_KEY = 'kidtube.collapsed'

/** 少用的面板預設收起來，一進設定頁就看得到重點 */
const DEFAULTS: Record<string, boolean> = {
  add: false,
  categories: false,
  list: false,
  time: false,
  display: true,
  pin: true,
  source: true,
}

/**
 * 家長設定頁的面板摺疊狀態。
 * 記在 localStorage，家長收起來的面板下次進來還是收著。
 */
export function useCollapse() {
  const state = useState<Record<string, boolean>>('panel.collapsed', () => ({ ...DEFAULTS }))
  const loaded = useState<boolean>('panel.collapsed.loaded', () => false)

  function init() {
    if (loaded.value) return
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          state.value = { ...DEFAULTS, ...parsed }
        }
      }
    } catch { /* 壞掉就用預設 */ }
    loaded.value = true
  }

  function isCollapsed(id: string): boolean {
    if (id in state.value) return state.value[id]!
    // 分區卡片預設收起來：一進設定頁先看到一排乾淨的分區標題，
    // 要編輯冊的時候才展開那一張
    return id.startsWith('cat:')
  }

  function toggle(id: string) {
    state.value[id] = !isCollapsed(id)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.value)) } catch { /* 略過 */ }
  }

  /**
   * 分區卡片的 key 是照分區動態產生的，還沒被點過就不在 state 裡，
   * 所以全部展開／收起時要由呼叫端補上目前有哪些分區。
   */
  function setAll(collapsed: boolean, extraKeys: string[] = []) {
    const keys = [...new Set([...Object.keys(state.value), ...extraKeys])]
    state.value = Object.fromEntries(keys.map((k) => [k, collapsed]))
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.value)) } catch { /* 略過 */ }
  }

  const expandAll = (extraKeys: string[] = []) => setAll(false, extraKeys)
  const collapseAll = (extraKeys: string[] = []) => setAll(true, extraKeys)

  return { state, init, isCollapsed, toggle, expandAll, collapseAll }
}
