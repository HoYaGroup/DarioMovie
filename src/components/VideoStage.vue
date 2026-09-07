<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { formatTime, type VideoItem } from '~/utils/youtube'
import { countdown, useWatchTime } from '~/composables/useWatchTime'
import { useYouTubePlayer } from '~/composables/useYouTubePlayer'

const props = defineProps<{ video: VideoItem }>()
const emit = defineEmits<{ close: [] }>()

const {
  addSeconds, flush, isLimitReached,
  needsTimeBreak, breaksAfterEachVideo, isResting, restRemainingSeconds, startRest,
} = useWatchTime()

/** 額度用完時蓋一層遮罩，'none' 表示正常觀看 */
const overlay = ref<'none' | 'limit'>('none')

/** 休息過但已經倒數完，等小朋友自己按「繼續看」 */
const restDone = ref(false)

const restText = computed(() => countdown(restRemainingSeconds.value))

/** 播放器每 250ms 回報一次實際經過的秒數 */
function onTick(deltaSec: number) {
  if (overlay.value !== 'none' || isResting.value) return
  addSeconds(deltaSec)

  if (isLimitReached.value) {
    overlay.value = 'limit'
    pause()
    return
  }
  // 連續看太久，進入強制休息
  if (needsTimeBreak.value) {
    startRest()
    pause()
  }
}

const {
  hostRef, status, isPlaying, currentTime, duration, progress,
  load, toggle, play, pause, seekBy, previewSeek, commitSeek,
} = useYouTubePlayer({
  onFinish: () => {
    // 設定成「每部影片看完休息」的話，播完就先進休息，再回清單倒數
    if (breaksAfterEachVideo.value) startRest()
    emit('close')
  },
  onTick,
})

// 休息開始就停下畫面；倒數完不自動播，讓小朋友自己決定要不要繼續
watch(isResting, (resting, was) => {
  if (resting) {
    restDone.value = false
    pause()
  } else if (was) {
    restDone.value = true
  }
})

function continueWatching() {
  restDone.value = false
  play()
}

const isFullscreen = ref(false)
/** iOS 可能擋掉自動播放；等太久就改口提示小朋友點畫面 */
const needsTap = ref(false)
let tapHintTimer: ReturnType<typeof setTimeout> | null = null

const seekValue = ref(0)
watch(progress, (p) => { seekValue.value = Math.round(p * 1000) })

onMounted(() => {
  // 額度已經用完就不要載入影片，直接顯示時間到
  if (isLimitReached.value) {
    overlay.value = 'limit'
    return
  }

  load(props.video.id)
  tapHintTimer = setTimeout(() => {
    if (status.value === 'loading') needsTap.value = true
  }, 3000)
})

onBeforeUnmount(() => {
  if (tapHintTimer) clearTimeout(tapHintTimer)
  // 把還沒落地的觀看秒數寫進 localStorage
  flush()
})

watch(status, (s) => {
  if (s !== 'loading') needsTap.value = false
})

function onSeekInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  seekValue.value = v
  previewSeek(v / 1000)
}

function onSeekChange(e: Event) {
  commitSeek(Number((e.target as HTMLInputElement).value) / 1000)
}

function toggleFullscreen() {
  // iOS Safari 不支援對一般元素用 Fullscreen API，所以主力是 CSS 假全螢幕。
  // 裝到主畫面之後本來就沒有網址列，視覺上已經等同全螢幕。
  isFullscreen.value = !isFullscreen.value

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  if (!isIos && document.documentElement.requestFullscreen) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }
}
</script>

<template>
  <section class="stage-view" :class="{ 'is-fullscreen': isFullscreen }">
    <div class="stage">
      <!-- YouTube iframe 由 API 注入到這裡 -->
      <div ref="hostRef" class="yt-host" />

      <!--
        第一道防線：透明層整片蓋住播放器。
        小朋友因此點不到 YouTube 的 logo、標題列、結束畫面推薦卡，
        點畫面只會觸發我們自己的播放／暫停。
      -->
      <div class="shield" @click="toggle" />

      <!-- 今天的額度用完了 -->
      <div v-if="overlay === 'limit'" class="veil veil-stop">
        <span class="veil-icon" aria-hidden="true">⏰</span>
        <p>今天的看片時間到了</p>
        <button class="veil-btn" @click="emit('close')">好</button>
      </div>

      <!-- 休息中：倒數完才能繼續，關掉 App 再開一樣要休息完 -->
      <div v-else-if="isResting" class="veil veil-stop">
        <span class="veil-icon" aria-hidden="true">👀</span>
        <p>眼睛休息一下</p>
        <p class="veil-count">{{ restText }}</p>
        <button class="veil-btn ghost" @click="emit('close')">回清單</button>
      </div>

      <!-- 休息完了 -->
      <div v-else-if="restDone" class="veil veil-stop">
        <span class="veil-icon" aria-hidden="true">✨</span>
        <p>休息好了！</p>
        <div class="veil-actions">
          <button class="veil-btn ghost" @click="emit('close')">回清單</button>
          <button class="veil-btn" @click="continueWatching">繼續看</button>
        </div>
      </div>

      <!-- 暫停時整面遮蔽：YouTube 在暫停狀態可能浮出 "More videos" 網格 -->
      <div v-else-if="status === 'paused'" class="veil" @click="toggle">
        <div class="veil-badge">
          <svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" /></svg>
        </div>
        <p>暫停中</p>
      </div>

      <div v-else-if="status === 'loading'" class="veil" @click="toggle">
        <div v-if="!needsTap" class="spinner" />
        <div v-else class="veil-badge">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </div>
        <p>{{ needsTap ? '點一下畫面開始播放' : '影片準備中…' }}</p>
      </div>

      <div v-else-if="status === 'error'" class="veil">
        <p>這部影片沒辦法播放</p>
        <button class="ghost-btn" @click="emit('close')">回到清單</button>
      </div>
    </div>

    <!-- 完全自製的控制列，取代 YouTube 原生控制列 -->
    <div class="controls">
      <button class="ctrl-btn ctrl-back" aria-label="回到影片清單" @click="emit('close')">
        <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        <span>返回</span>
      </button>

      <button class="ctrl-btn" aria-label="倒退 10 秒" @click="seekBy(-10)">
        <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" /></svg>
        <span>10秒</span>
      </button>

      <button class="ctrl-btn ctrl-play" aria-label="播放或暫停" @click="toggle">
        <svg v-if="isPlaying" viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" /></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
      </button>

      <div class="seek-wrap">
        <span class="time">{{ formatTime(currentTime) }}</span>
        <input
          class="seek"
          type="range"
          min="0"
          max="1000"
          step="1"
          :value="seekValue"
          aria-label="播放進度"
          @input="onSeekInput"
          @change="onSeekChange"
        >
        <span class="time">{{ formatTime(duration) }}</span>
      </div>

      <button class="ctrl-btn" aria-label="全螢幕切換" @click="toggleFullscreen">
        <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3Zm-2-4h2V7h3V5H5v5Zm12 7h-3v2h5v-5h-2v3ZM14 5v2h3v3h2V5h-5Z" /></svg>
      </button>
    </div>

    <h2 class="now-title">{{ video.title }}</h2>
  </section>
</template>

<style scoped>
.stage-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #000;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
}

.yt-host,
.yt-host :deep(iframe) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.shield {
  position: absolute;
  inset: 0;
  z-index: 3;
  background: transparent;
}

.veil {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: rgba(8, 7, 20, .93);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
}
.veil p { margin: 0; }

.veil-stop { letter-spacing: 1px; }

.veil-icon { font-size: 72px; line-height: 1; }

/* 倒數數字放大，小朋友才知道還要等多久 */
.veil-count {
  font-size: 52px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 3px;
  color: var(--accent);
}

.veil-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }

.veil-btn {
  padding: 15px 30px;
  border: 2px solid transparent;
  border-radius: 16px;
  background: var(--accent);
  color: var(--on-accent);
  font-family: inherit;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 1px;
  cursor: pointer;
  transition: transform .15s ease;
}
.veil-btn:active { transform: scale(.95); }
.veil-btn.ghost {
  background: transparent;
  border-color: var(--line);
  color: var(--text);
}

.veil-badge {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: var(--accent);
  display: grid;
  place-items: center;
}
.veil-badge svg { width: 44px; height: 44px; fill: var(--on-accent); }

.spinner {
  width: 54px;
  height: 54px;
  border: 6px solid rgba(255, 255, 255, .18);
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
  padding: 14px calc(var(--safe-r) + 20px) 10px calc(var(--safe-l) + 20px);
  background: #000;
}

.ctrl-btn {
  flex: none;
  min-width: 64px;
  height: 64px;
  padding: 0 14px;
  border: 0;
  border-radius: 20px;
  background: var(--bg-card);
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition: transform .15s ease, background .15s ease;
}
.ctrl-btn:active { transform: scale(.92); background: var(--line); }
.ctrl-btn svg { width: 26px; height: 26px; fill: currentColor; }

.ctrl-back { background: var(--accent-2); color: var(--on-accent-2); }

.ctrl-play {
  width: 78px;
  height: 78px;
  border-radius: 26px;
  background: var(--accent);
  color: var(--on-accent);
}
.ctrl-play svg { width: 36px; height: 36px; }

.seek-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.time {
  flex: none;
  min-width: 46px;
  text-align: center;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}

/* 進度條加大到 30px 高，小手才好按得準 */
.seek {
  flex: 1;
  min-width: 0;
  height: 30px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}
.seek::-webkit-slider-runnable-track {
  height: 12px;
  border-radius: 6px;
  background: var(--line);
}
.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 30px;
  height: 30px;
  margin-top: -9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .5);
}
.seek::-moz-range-track { height: 12px; border-radius: 6px; background: var(--line); }
.seek::-moz-range-thumb { width: 30px; height: 30px; border: 0; border-radius: 50%; background: var(--accent); }

.now-title {
  flex: none;
  margin: 0;
  padding: 0 calc(var(--safe-r) + 22px) calc(var(--safe-b) + 14px) calc(var(--safe-l) + 22px);
  font-size: 18px;
  font-weight: 700;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #000;
}

.is-fullscreen .now-title { display: none; }

@media (max-width: 560px) {
  .ctrl-btn span { display: none; }
  .ctrl-btn { min-width: 56px; padding: 0 10px; }
}
</style>
