<script setup lang="ts">
import { usePhotoSlot } from '~/composables/usePhotoSlot'

/**
 * 「家裡的照片」裡的一格：一張字卡的圖加上卡上的字，整格按下去就是「拍照或選照片」。
 * 換過照片的會打勾，旁邊有「還原」。
 */
const props = defineProps<{
  photoKey: string
  legacyKey?: string
  word: string
  meaning?: string
  /** 沒換照片時顯示的預設圖：圖片網址，或 emoji */
  defaultSrc?: string
  defaultText?: string
}>()

const { own, busy, msg, cloud, pick, reset } = usePhotoSlot(() => props.photoKey, () => props.legacyKey)
</script>

<template>
  <div class="tile" :class="{ 'has-own': !!own, 'is-err': msg?.kind === 'err' }">
    <label class="pic" :class="{ 'is-busy': busy }" :title="`幫「${word}」拍照或選照片`">
      <img v-if="own" :src="own" alt="">
      <img v-else-if="defaultSrc" :src="defaultSrc" alt="" loading="lazy">
      <span v-else class="emoji">{{ defaultText || '🖼️' }}</span>
      <span class="cam" aria-hidden="true">{{ busy ? '…' : '📷' }}</span>
      <span v-if="own" class="tick" aria-hidden="true">✓</span>
      <input
        class="file-input"
        type="file"
        accept="image/*"
        :disabled="busy"
        :aria-label="`幫「${word}」拍照或選照片`"
        @change="pick($event)"
      >
    </label>
    <span class="word">{{ word }}</span>
    <span v-if="meaning" class="meaning">{{ meaning }}</span>
    <button v-if="own" class="undo" :disabled="busy" @click="reset">還原</button>
    <span v-if="msg?.kind === 'err'" class="err" role="alert">{{ msg.text }}</span>
    <!-- 上傳到雲端硬碟的結果：成功只要一個小標記，失敗要講原因（照片已經換好了，只是還沒傳上去） -->
    <span v-if="cloud?.kind === 'err'" class="err" role="alert">{{ cloud.text }}</span>
    <span v-else-if="cloud" class="cloud" role="status">{{ cloud.kind === 'busy' ? '☁️ 上傳中…' : '☁️ 已上傳' }}</span>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 6px 10px;
  border: 2px solid var(--line);
  border-radius: 16px;
  background: var(--bg-card);
}
.tile.has-own { border-color: var(--ok); }
.tile.is-err { border-color: var(--danger); }

.pic {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 12px;
  background: var(--bg-soft);
  cursor: pointer;
}
.pic.is-busy { opacity: .6; pointer-events: none; }
.pic img { width: 100%; height: 100%; object-fit: cover; }
.emoji { font-size: 44px; line-height: 1; }

/* 右下角的相機：告訴孩子的家長「按這格就能拍照」 */
.cam {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--accent-edge);
  font-size: 16px;
  line-height: 1;
}
.tick {
  position: absolute;
  left: 6px;
  top: 6px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--ok);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
}

.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.word { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 800; }
.meaning { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text-dim); }

.undo {
  min-height: 36px;
  padding: 4px 14px;
  border: 2px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.undo:active:not(:disabled) { transform: scale(.95); }
.undo:disabled { opacity: .45; }
.err { font-size: 12px; line-height: 1.4; color: var(--danger); text-align: center; overflow-wrap: anywhere; }
.cloud { font-size: 12px; font-weight: 700; color: var(--text-dim); }
</style>
