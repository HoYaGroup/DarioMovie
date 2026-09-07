import { ref } from 'vue'

/**
 * 觸控拖曳排序。
 *
 * 做法是「即時換位」：手指移到哪一列，就馬上把被拖的項目搬過去，
 * 所以家長看到的順序永遠等於放手後的結果，不需要放置預覽線。
 *
 * 用法：把手要加上 `touch-action: none`，否則 iPad 會判定成捲動頁面。
 */
export function useDragSort() {
  /** 正在拖哪一組（同一頁有多組清單時用來區分） */
  const activeKey = ref<string | null>(null)
  /** 被拖的項目目前在第幾位 */
  const activeIndex = ref(-1)

  function start(
    ev: PointerEvent,
    options: {
      key: string
      index: number
      /** 每次都重新查一次 DOM：順序換過之後元素位置已經不一樣了 */
      getRows: () => HTMLElement[]
      onMove: (from: number, to: number) => void
    },
  ) {
    ev.preventDefault()
    activeKey.value = options.key
    activeIndex.value = options.index

    let current = options.index

    function onPointerMove(e: PointerEvent) {
      const rows = options.getRows()
      const target = rows.findIndex((row) => {
        const box = row.getBoundingClientRect()
        return e.clientY >= box.top && e.clientY <= box.bottom
      })

      if (target >= 0 && target !== current) {
        options.onMove(current, target)
        current = target
        activeIndex.value = target
      }
    }

    function finish() {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      activeKey.value = null
      activeIndex.value = -1
    }

    // 綁在 window 上而不是把手上：換位之後把手元素會被 Vue 搬走，
    // 綁在元素上的監聽會跟著失效
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function isDragging(key: string, index: number): boolean {
    return activeKey.value === key && activeIndex.value === index
  }

  return { activeKey, activeIndex, start, isDragging }
}
