import { computed, ref } from 'vue'
import { getPhoto, photoUrl, preparePhoto, removePhoto, savePhoto } from '~/utils/photos'
import { photoFiles } from '~/utils/photoFiles'
import { readAutoUpload, uploadConfigured, uploadFiles, whereText } from '~/utils/driveUpload'

/**
 * 「一張圖」的換照片動作：選檔（或拍照）→ 縮小、轉 JPEG、存起來；還原預設圖。
 * 設好雲端硬碟上傳（utils/driveUpload.ts）的話，換好照片就直接傳進共用資料夾，另一台按「立即同步」就會抓到。
 * PhotoButton（一排按鈕）和 PhotoTile（一格卡片）共用，兩邊做的事才會一模一樣。
 *
 * @param photoKey  新照片存在這個 key（見 utils/photos.ts）
 * @param legacyKey 舊版只換某一本字卡本的照片（優先於 photoKey）：顯示、還原時一起處理，重拍時會換掉它
 */
export function usePhotoSlot(photoKey: () => string, legacyKey: () => string | undefined) {
  const own = computed(() => photoUrl(legacyKey() ?? '') ?? photoUrl(photoKey()))
  const busy = ref(false)
  const msg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)
  /** 上傳到雲端硬碟的狀況：照片已經換好了，上傳失敗不影響這台 */
  const cloud = ref<{ text: string; kind: 'busy' | 'ok' | 'err' } | null>(null)

  /** 把這一格現在的照片傳進共用資料夾（檔名＝卡上的字，同名蓋掉）；呼叫前 busy 要是 true */
  async function upload() {
    const rec = getPhoto(legacyKey() ?? '') ?? getPhoto(photoKey())
    const files = rec ? photoFiles([rec]) : []
    if (!files.length) return
    cloud.value = { text: '上傳到雲端硬碟…', kind: 'busy' }
    try {
      const r = await uploadFiles(files)
      cloud.value = r.failed.length
        ? { text: `${r.failed[0]!.name}：${r.failed[0]!.why}`, kind: 'err' }
        : { text: `已上傳到${whereText(r.paths)}（${files[0]!.name}）。其他裝置按「立即同步」就會換上。`, kind: 'ok' }
    } catch (err) {
      cloud.value = { text: `沒有上傳成功：${(err as Error).message}`, kind: 'err' }
    }
  }

  /** 按鈕用：自己管 busy */
  async function uploadNow() {
    if (busy.value) return
    busy.value = true
    try {
      await upload()
    } finally {
      busy.value = false
    }
  }

  async function pick(e: Event, doneText = '已換成你的照片。') {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    // 清掉選的檔案，下次選同一張才還會觸發 change
    input.value = ''
    if (!file || busy.value) return
    busy.value = true
    msg.value = null
    cloud.value = null
    try {
      await savePhoto(photoKey(), await preparePhoto(file))
      // 舊版只換一本的照片比較優先，不拿掉的話新照片換不上去
      const legacy = legacyKey()
      if (legacy) await removePhoto(legacy)
      msg.value = { text: doneText, kind: 'ok' }
      if (uploadConfigured() && readAutoUpload()) await upload()
    } catch (err) {
      msg.value = { text: (err as Error).message || '照片沒有存成功。', kind: 'err' }
    } finally {
      busy.value = false
    }
  }

  async function reset() {
    if (busy.value) return
    busy.value = true
    cloud.value = null
    try {
      await removePhoto(photoKey())
      const legacy = legacyKey()
      if (legacy) await removePhoto(legacy)
      msg.value = { text: '已還原成預設圖。', kind: 'ok' }
    } finally {
      busy.value = false
    }
  }

  return { own, busy, msg, cloud, pick, reset, uploadNow }
}
