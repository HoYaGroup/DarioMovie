<script setup lang="ts">
import { computed } from 'vue'
import { getPhoto } from '~/utils/photos'
import { photoFiles, readFolderUrl, shareFiles } from '~/utils/photoFiles'
import { readAutoUpload, uploadConfigured } from '~/utils/driveUpload'
import { usePhotoSlot } from '~/composables/usePhotoSlot'

/**
 * 「拍照或選照片」＋「存到共用資料夾」＋「還原預設圖」：換掉某一張圖（photoKey 見 utils/photos.ts）。
 * 手機和 iPad 按下去會問要拍照還是從相簿選；照片縮小、去掉位置資訊、一律轉成 JPEG，只存在這台裝置。
 * 要給其他裝置用：設好雲端硬碟上傳（家長設定「圖片和聲音」）的話，換好照片就自動傳進共用資料夾，按鈕是重傳；
 * 沒設的話，分享出去的檔案檔名程式自己取好（apple.jpg），丟進雲端的共用資料夾，另一台就能匯入。
 */
const props = defineProps<{
  /** 新照片存在這個 key */
  photoKey: string
  /** 舊版只換某一本字卡本的照片（優先於 photoKey）：顯示、還原時一起處理，重拍時會換掉它 */
  legacyKey?: string
  /** 沒換照片時顯示的預設圖：圖片網址，或 emoji */
  defaultSrc?: string
  defaultText?: string
  disabled?: boolean
}>()

const { own, busy, msg, cloud, pick, reset: onReset, uploadNow } = usePhotoSlot(() => props.photoKey, () => props.legacyKey)

/** 設好上傳：按鈕直接傳到雲端硬碟；沒設：叫出分享選單 */
const canUpload = computed(() => uploadConfigured())
/** 上傳成功後給一個連結，家長看得到傳到哪（跟 script 寫入的是同一個資料夾，測試連線會比對） */
const folderUrl = computed(() => (cloud.value?.kind === 'ok' ? readFolderUrl() : ''))

function onPick(e: Event) {
  return pick(e, canUpload.value && readAutoUpload()
    ? '已換成你的照片。'
    : canUpload.value
      ? '已換成你的照片。要給其他裝置用，按「上傳到雲端硬碟」。'
      : '已換成你的照片。要給其他裝置用，按「存到共用資料夾」。')
}

/** 分享選單要在點擊的當下叫出來：這裡到 shareFiles 之間不能有 await */
function onShare() {
  if (canUpload.value) {
    void uploadNow()
    return
  }
  const rec = getPhoto(props.legacyKey ?? '') ?? getPhoto(props.photoKey)
  const files = rec ? photoFiles([rec]) : []
  if (!files.length) return
  const name = files[0]!.name
  shareFiles(files, name).then((how) => {
    if (how === 'cancelled') return
    msg.value = {
      text: how === 'shared'
        ? `已交給分享選單：選「雲端硬碟」，再選共用資料夾。檔名是 ${name}，不用改。`
        : `已下載 ${name}，請把它移到共用資料夾，檔名不用改。`,
      kind: 'ok',
    }
  })
}
</script>

<template>
  <div class="photo-btn">
    <span class="pic" aria-hidden="true">
      <img v-if="own" :src="own" alt="">
      <img v-else-if="defaultSrc" :src="defaultSrc" alt="">
      <template v-else>{{ defaultText || '🖼️' }}</template>
    </span>

    <div class="photo-actions">
      <label class="pb" :class="{ 'is-disabled': disabled || busy }">
        {{ busy ? '處理中…' : own ? '📷 重拍／換一張' : '📷 拍照或選照片' }}
        <input
          class="file-input"
          type="file"
          accept="image/*"
          :disabled="disabled || busy"
          aria-label="拍照或選照片"
          @change="onPick"
        >
      </label>
      <button v-if="own" class="pb" :disabled="busy" @click="onShare">{{ canUpload ? '☁️ 上傳到雲端硬碟' : '📤 存到共用資料夾' }}</button>
      <button v-if="own" class="pb" :disabled="busy" @click="onReset">還原預設圖</button>
    </div>

    <p v-if="msg" class="msg" :class="msg.kind" role="status">{{ msg.text }}</p>
    <p v-if="cloud" class="msg" :class="cloud.kind" role="status">
      {{ cloud.text }}
      <a v-if="cloud.kind === 'ok' && folderUrl" class="folder-link" :href="folderUrl" target="_blank" rel="noopener noreferrer">開啟資料夾</a>
    </p>
  </div>
</template>

<style scoped>
.photo-btn {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.pic {
  flex: none;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-card);
  font-size: 38px;
  line-height: 1;
}
.pic img { width: 100%; height: 100%; object-fit: cover; }

.photo-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.pb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 10px 16px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.pb:first-child { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.pb:active:not(:disabled) { transform: scale(.96); }
.pb:disabled, .pb.is-disabled { opacity: .45; cursor: default; pointer-events: none; }

/* 真正的 <input type="file"> 藏在按鈕裡，整顆按鈕都按得到 */
.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.msg { flex-basis: 100%; margin: 0; min-height: 0; font-size: 14px; }
.folder-link { margin-left: 6px; font-weight: 700; color: var(--text); white-space: nowrap; }
</style>
