import { computed, ref } from 'vue'
import { photoUrl, preparePhoto, removePhoto, savePhoto } from '~/utils/photos'

/**
 * 「一張圖」的換照片動作：選檔（或拍照）→ 縮小、轉 JPEG、存起來；還原預設圖。
 * PhotoButton（一排按鈕）和 PhotoTile（一格卡片）共用，兩邊做的事才會一模一樣。
 *
 * @param photoKey  新照片存在這個 key（見 utils/photos.ts）
 * @param legacyKey 舊版只換某一本字卡本的照片（優先於 photoKey）：顯示、還原時一起處理，重拍時會換掉它
 */
export function usePhotoSlot(photoKey: () => string, legacyKey: () => string | undefined) {
  const own = computed(() => photoUrl(legacyKey() ?? '') ?? photoUrl(photoKey()))
  const busy = ref(false)
  const msg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)

  async function pick(e: Event, doneText = '已換成你的照片。') {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    // 清掉選的檔案，下次選同一張才還會觸發 change
    input.value = ''
    if (!file || busy.value) return
    busy.value = true
    msg.value = null
    try {
      await savePhoto(photoKey(), await preparePhoto(file))
      // 舊版只換一本的照片比較優先，不拿掉的話新照片換不上去
      const legacy = legacyKey()
      if (legacy) await removePhoto(legacy)
      msg.value = { text: doneText, kind: 'ok' }
    } catch (err) {
      msg.value = { text: (err as Error).message || '照片沒有存成功。', kind: 'err' }
    } finally {
      busy.value = false
    }
  }

  async function reset() {
    if (busy.value) return
    busy.value = true
    try {
      await removePhoto(photoKey())
      const legacy = legacyKey()
      if (legacy) await removePhoto(legacy)
      msg.value = { text: '已還原成預設圖。', kind: 'ok' }
    } finally {
      busy.value = false
    }
  }

  return { own, busy, msg, pick, reset }
}
