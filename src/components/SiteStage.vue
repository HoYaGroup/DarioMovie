<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { VideoItem } from '~/utils/youtube'
import { useWatchTime } from '~/composables/useWatchTime'

const props = defineProps<{ item: VideoItem }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const failed = ref(false)
let timeoutId: ReturnType<typeof setTimeout> | null = null

const { addSeconds, flush, isLimitReached } = useWatchTime()

/**
 * 網站也算觀看時間 —— 不然小朋友就會發現「看網站不扣時間」。
 * 用真實時鐘每秒累計一次。
 */
let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0

onMounted(() => {
  lastTick = Date.now()
  ticker = setInterval(() => {
    const now = Date.now()
    const delta = (now - lastTick) / 1000
    lastTick = now
    // 間隔太久表示 App 被切到背景，那段不計
    if (delta > 0 && delta < 3) addSeconds(delta)
    if (isLimitReached.value) emit('close')
  }, 1000)

  // 有些網站會擋嵌入，但擋的方式不會觸發 onerror，只好用逾時判斷
  timeoutId = setTimeout(() => {
    if (loading.value) failed.value = true
  }, 8000)
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (timeoutId) clearTimeout(timeoutId)
  flush()
})

function onLoaded() {
  loading.value = false
  if (timeoutId) clearTimeout(timeoutId)
}
</script>

<template>
  <section class="site-view">
    <div class="site-stage">
      <iframe
        :src="item.url"
        class="site-frame"
        :title="item.title"
        referrerpolicy="no-referrer"
        @load="onLoaded"
      />

      <div v-if="loading && !failed" class="veil">
        <div class="spinner" />
        <p>網頁載入中…</p>
      </div>

      <div v-if="failed" class="veil">
        <span class="veil-icon" aria-hidden="true">😅</span>
        <p>這個網站沒辦法在這裡打開</p>
        <button class="veil-btn" @click="emit('close')">回到清單</button>
      </div>
    </div>

    <div class="controls">
      <button class="ctrl-btn ctrl-back" aria-label="回到影片清單" @click="emit('close')">
        <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        <span>返回</span>
      </button>
      <h2 class="site-title">{{ item.title }}</h2>
    </div>
  </section>
</template>

<style scoped>
.site-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.site-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--bg-soft);
}

.site-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: var(--bg);
  color: var(--text);
  font-size: 20px;
  font-weight: 700;
}
.veil p { margin: 0; }
.veil-icon { font-size: 64px; line-height: 1; }

.veil-btn {
  padding: 14px 28px;
  border: 0;
  border-radius: 16px;
  background: var(--accent);
  color: var(--on-accent);
  font-family: inherit;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 6px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px calc(var(--safe-r) + 20px) calc(var(--safe-b) + 12px) calc(var(--safe-l) + 20px);
  background: var(--bg);
}

.ctrl-btn {
  flex: none;
  min-width: 64px;
  height: 60px;
  padding: 0 16px;
  border: 0;
  border-radius: 18px;
  background: var(--accent-2);
  color: var(--on-accent-2);
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.ctrl-btn:active { transform: scale(.94); }
.ctrl-btn svg { width: 24px; height: 24px; fill: currentColor; }

.site-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
