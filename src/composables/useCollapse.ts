import { useState } from './useState'

/** 以前會把哪些面板打開記在這裡，現在每次都從全部收起開始，只用來清掉舊資料 */
const LEGACY_KEY = 'kidtube.collapsed'

/**
 * 家長設定頁的面板摺疊狀態（分區管理裡的分區卡片也算）。
 *
 * 每次進設定頁全部收起來：一眼看完有哪些設定（收起時標題旁有一行摘要），
 * 要用哪個再打開哪個。刻意不記住上次開了哪些 —— 記住的話開過一次就一直攤著，
 * 設定頁又會變回長長一串。
 */
export function useCollapse() {
  /** 單獨點過的面板 */
  const state = useState<Record<string, boolean>>('panel.collapsed', () => ({}))
  /** 沒單獨點過的照這個；「全部展開／收起」就是改它，動態產生的分區卡片也一起算進去 */
  const allCollapsed = useState<boolean>('panel.collapsed.all', () => true)

  /** 進設定頁時呼叫：全部收回去 */
  function init() {
    state.value = {}
    allCollapsed.value = true
    try { localStorage.removeItem(LEGACY_KEY) } catch { /* 略過 */ }
  }

  function isCollapsed(id: string): boolean {
    return state.value[id] ?? allCollapsed.value
  }

  function toggle(id: string) {
    state.value[id] = !isCollapsed(id)
  }

  function setAll(collapsed: boolean) {
    state.value = {}
    allCollapsed.value = collapsed
  }

  const expandAll = () => setAll(false)
  const collapseAll = () => setAll(true)

  return { init, isCollapsed, toggle, expandAll, collapseAll }
}
