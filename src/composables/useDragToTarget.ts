import { ref, shallowRef, type Ref } from 'vue'

/** 手指要按住不動多久才開始拖；比這短就滑動，當作是在捲動清單 */
const HOLD_MS = 350
/** 還沒開始拖之前，手指滑超過這個距離就當作捲動 */
const SCROLL_SLOP = 10
/** 滑鼠沒有捲動的問題，按下去移動這麼多就開始拖 */
const MOUSE_SLOP = 6

/**
 * 按住一個東西，拖到另一個地方放開（片單：把影片拖到上面的班級膠囊）。
 *
 * 跟 useDragSort 不一樣：這裡是從清單本身拖，清單還要能正常捲動，
 * 所以手指要先按住不動一下才開始拖，按下去馬上滑動就當作捲動。
 *
 * 可以放的地方標 data-drop="值"，放開時把那個值交給 onDrop；放在別的地方就當作取消。
 */
export function useDragToTarget<T>(onDrop: (item: T, target: string) => void) {
  /** 正在拖的東西；沒在拖是 null */
  const dragging = shallowRef<T | null>(null) as Ref<T | null>
  /** 手指（滑鼠）現在的位置，拖曳中的小卡跟著它 */
  const pos = ref({ x: 0, y: 0 })
  /** 現在停在哪個可以放的地方上面 */
  const overTarget = ref<string | null>(null)

  function targetAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
    return el?.dataset.drop ?? null
  }

  /** 放開之後瀏覽器還會補一個 click（例如點標題會進入改名），拖過了就把它吃掉 */
  function swallowNextClick() {
    const stop = (e: Event) => { e.stopPropagation(); e.preventDefault() }
    window.addEventListener('click', stop, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400)
  }

  function start(ev: PointerEvent, item: T) {
    if (ev.button !== 0 || dragging.value !== null) return
    const isMouse = ev.pointerType === 'mouse'
    const x0 = ev.clientX
    const y0 = ev.clientY
    let active = false
    let timer = 0

    function activate(x: number, y: number) {
      active = true
      dragging.value = item
      pos.value = { x, y }
      overTarget.value = targetAt(x, y)
      window.getSelection()?.removeAllRanges()
    }

    function onMove(e: PointerEvent) {
      if (!active) {
        const moved = Math.hypot(e.clientX - x0, e.clientY - y0)
        if (isMouse) {
          if (moved > MOUSE_SLOP) activate(e.clientX, e.clientY)
        } else if (moved > SCROLL_SLOP) {
          finish()   // 還沒按穩就滑動：是在捲動，不是要拖
        }
        return
      }
      pos.value = { x: e.clientX, y: e.clientY }
      overTarget.value = targetAt(e.clientX, e.clientY)
    }

    /**
     * 拖曳中不讓畫面跟著捲。Pointer Events 擋不住捲動，iPad 要在 touchmove 上 preventDefault，
     * 而且一定要 passive: false（掛在 window 上的 touchmove 預設是 passive，preventDefault 會被忽略）
     */
    function blockScroll(e: TouchEvent) {
      if (active && e.cancelable) e.preventDefault()
    }

    function onUp(e: PointerEvent) {
      if (active) {
        const target = targetAt(e.clientX, e.clientY)
        swallowNextClick()
        finish()
        if (target !== null) onDrop(item, target)
        return
      }
      finish()
    }

    function finish() {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('touchmove', blockScroll)
      dragging.value = null
      overTarget.value = null
    }

    if (!isMouse) timer = window.setTimeout(() => activate(x0, y0), HOLD_MS)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('touchmove', blockScroll, { passive: false })
  }

  return { dragging, pos, overTarget, start }
}
