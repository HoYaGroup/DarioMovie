import { watch, nextTick, onMounted, type Ref } from 'vue'
import { useLibrary } from './useLibrary'
import { useTvMode } from './useTvMode'

/**
 * 電視遙控器沒有滑鼠可以點，進畫面先把焦點放到內容上
 * （優先 selector 指到的東西，略過右上角的亮暗切換這種裝飾性按鈕，小朋友才不用先按一堆方向鍵才碰得到真正的內容）。
 * 要等試算表同步完成（syncStatus 脫離 idle/syncing）才能對焦，
 * 不然畫面初次渲染用的是備援片單，同步完成後整批 DOM 會被換掉，焦點也就跟著不見了。
 */
export function useTvFocus(root: Ref<HTMLElement | null>, selector: string) {
  const { isTv } = useTvMode()
  const { syncStatus } = useLibrary()

  onMounted(() => {
    if (!isTv) return

    const focusFirstInteractive = () => {
      nextTick(() => {
        const target = root.value?.querySelector<HTMLElement>(selector)
          ?? root.value?.querySelector<HTMLElement>('button, [href], input, select, [tabindex]')
        target?.focus()
      })
    }

    // 再次進到畫面時（例如看完影片返回），同步早就結束了，不用等，直接對焦
    if (syncStatus.value.state === 'idle' || syncStatus.value.state === 'syncing') {
      const stop = watch(syncStatus, (status) => {
        if (status.state === 'idle' || status.state === 'syncing') return
        stop()
        focusFirstInteractive()
      })
    } else {
      focusFirstInteractive()
    }
  })
}
