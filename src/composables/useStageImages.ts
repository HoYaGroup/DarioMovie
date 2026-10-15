import { computed, watch } from 'vue'
import { isPicture, isEmojiOnly, imageSrc } from '~/utils/cards'
import { placeById } from '~/utils/places'
import { useLibrary } from './useLibrary'
import { useChildStage } from './useChildStage'
import { useOnline, isOfflineCapable, findUncached, downloadForOffline } from './useOffline'

/**
 * 這台裝置要存起來的字卡圖片：只算小朋友端現在看得到的那幾班（孩子這一班，加上家長另外開放的）。
 *
 * 字卡圖片全部加起來約 6MB，四個班都下載太多，也沒必要：小班的孩子看不到大班的卡。
 * 所以 Service Worker 安裝時不再整批下載 public/cards/（見 vite.config.ts），改由這裡照年紀補：
 *   ‧ 還沒設定出生年度：四個班都開放，等於全部都存
 *   ‧ 設了出生年度：只存這一班（和另外開放的班）用到的；沒標年紀的一直算
 *   ‧ 換了年紀、另外開放別班，自動補存新的那幾班
 * 沒存到的圖，看到時會從網路抓、順手存起來，所以最糟只是離線時看不到。
 */
export function useStageImages() {
  const { videos } = useLibrary()
  const { isVideoVisible } = useChildStage()

  /** 這幾班的字卡用到的圖片網址（emoji 是裝置自己的字型，不用網路） */
  const urls = computed(() => {
    const out = new Set<string>()
    // 素材包的檔案已經在這台裝置上（blob: 網址），不用再下載
    const add = (url: string) => { if (!url.startsWith('blob:')) out.add(url) }
    for (const v of videos.value) {
      if (!isVideoVisible(v)) continue
      // 「我的書」那一頁的照片：清單上的封面、打開字卡本時先秀的整頁
      if (v.page) add(imageSrc(v.page))
      for (const c of v.cards ?? []) {
        if (isPicture(c)) add(imageSrc(c.image))
        if (c.backImage && !isEmojiOnly(c.backImage)) add(imageSrc(c.backImage))
        // 動物真正的叫聲（音檔），放哪裡的地點照片也一起存
        if (c.sound) add(imageSrc(c.sound))
        // 「放哪裡」的地點照片（廚房、浴室……）
        const place = placeById(c.place)
        if (place?.image) add(imageSrc(place.image))
      }
    }
    return [...out]
  })

  return { urls }
}

/**
 * 有網路的時候，在背景把這幾班還沒存的圖片補存起來。App 啟動時呼叫一次。
 * 片單剛同步完、家長剛換了孩子的年紀，名單一變就重算，不會每張圖變動都立刻開跑。
 */
export function useStageImageSync() {
  const { urls } = useStageImages()
  const { online } = useOnline()

  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false

  async function run() {
    // 正在下載時名單又變了：這輪跑完再補一輪
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        // 沒被 Service Worker 接管的話，抓了也不會存起來
        if (!online.value || !isOfflineCapable()) break
        const todo = await findUncached(urls.value)
        if (todo.length) await downloadForOffline(todo)
      } while (again)
    } finally {
      running = false
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(run, 3000)
  }

  watch([urls, online], schedule, { immediate: true })
  // 第一次安裝時，Service Worker 要等一下才接管這一頁
  navigator.serviceWorker?.addEventListener('controllerchange', schedule)
}
