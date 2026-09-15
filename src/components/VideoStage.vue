<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { formatTime, type VideoItem } from '~/utils/youtube'
import { countdown, useWatchTime } from '~/composables/useWatchTime'
import { useYouTubePlayer } from '~/composables/useYouTubePlayer'
import { useDisplay, PLAYBACK_RATES } from '~/composables/useDisplay'
import { useContinueWatching } from '~/composables/useContinueWatching'
import { useTvMode } from '~/composables/useTvMode'

const props = defineProps<{ video: VideoItem; queue: VideoItem[]; resumeAt?: number }>()
const emit = defineEmits<{ close: []; advance: [video: VideoItem] }>()

const { isTv } = useTvMode()
const playBtnRef = ref<HTMLButtonElement | null>(null)

const { settings: display, setPlaybackRate: persistRate } = useDisplay()
const { save: saveContinue } = useContinueWatching()

/** 目前這部影片在清單裡的位置，播完（或重複播放跳過）要接下一部，接到尾端就繞回第一部 */
const queueIndex = computed(() => props.queue.findIndex((v) => v.uid === props.video.uid))

function playNext() {
  if (props.queue.length === 0) {
    emit('close')
    return
  }
  const idx = queueIndex.value
  const next = props.queue[(idx + 1) % props.queue.length] ?? props.queue[0]!
  // 清單只有一部（或繞了一圈拿回同一部）：video prop 沒變，watch 不會觸發，這裡直接重播
  if (next.uid === props.video.uid) {
    loadVideo(props.video.id)
    return
  }
  emit('advance', next)
}

/** 手動按「上一首」：跟自動接下一部同一份清單，往回繞一圈到最後一部 */
function playPrev() {
  if (props.queue.length === 0) return
  const idx = queueIndex.value
  const prev = props.queue[(idx - 1 + props.queue.length) % props.queue.length] ?? props.queue[0]!
  if (prev.uid === props.video.uid) {
    loadVideo(props.video.id)
    return
  }
  emit('advance', prev)
}

const {
  addSeconds, flush, isLimitReached,
  needsTimeBreak, breaksAfterEachVideo, isResting, restRemainingSeconds, startRest,
} = useWatchTime()

/** 額度用完時蓋一層遮罩，'none' 表示正常觀看 */
const overlay = ref<'none' | 'limit'>('none')

/** 休息過但已經倒數完，等小朋友自己按「繼續看」 */
const restDone = ref(false)

const restText = computed(() => countdown(restRemainingSeconds.value))

/** 記住看到哪裡，重開 App 時片單畫面才能問要不要接續播放；節流到每 5 秒存一次，離開時再補存一次 */
let lastSavedAt = 0
function saveProgress() {
  if (!duration.value) return
  saveContinue(props.video.uid, currentTime.value, duration.value)
}

/** 播放器每 250ms 回報一次實際經過的秒數 */
function onTick(deltaSec: number) {
  const now = Date.now()
  if (now - lastSavedAt >= 5000) {
    lastSavedAt = now
    saveProgress()
  }

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
  playbackRate, setPlaybackRate, repeat, toggleRepeat,
} = useYouTubePlayer({
  onFinish: () => {
    // 影片播完那一刻剛好額度也用完的極少數情況，直接回清單顯示「時間到了」，不要還接下一部
    if (isLimitReached.value) {
      emit('close')
      return
    }
    // 設定成「每部影片看完休息」的話，播完就先進休息，回清單倒數，不自動接下一部
    if (breaksAfterEachVideo.value) {
      startRest()
      emit('close')
      return
    }
    // 否則自動接清單裡的下一部，放到最後一部就繞回第一部，一直循環下去
    playNext()
  },
  onTick,
})

// 播放速度沿用上次設定，換片時 useYouTubePlayer 內部會自動重新套用
setPlaybackRate(display.value.playbackRate)

/** 點一下往慢遞減：1× → 0.9× → 0.75× → 0.5× → 繞回 2× 再往下減 */
function cycleSpeed() {
  const idx = PLAYBACK_RATES.indexOf(playbackRate.value)
  const next = PLAYBACK_RATES[(idx - 1 + PLAYBACK_RATES.length) % PLAYBACK_RATES.length] ?? 1
  setPlaybackRate(next)
  persistRate(next)
}

const speedLabel = computed(() => `${playbackRate.value}×`)

/** 從「接續播放」點進來的話，第一次拿到 duration 就跳到這個位置；一般播放是 0，不用做任何事 */
let pendingResumeSec = props.resumeAt && props.resumeAt > 0 ? props.resumeAt : 0

watch(duration, (d) => {
  if (pendingResumeSec > 0 && d > 0) {
    commitSeek(Math.min(pendingResumeSec, Math.max(0, d - 1)) / d)
    pendingResumeSec = 0
  }
})

/**
 * YouTube 每次「真的開始播放」的頭幾秒，會在右下角浮出一張帶縮圖的「更多影片」推薦卡
 * （比常駐的小浮水印大很多，實測約 9 秒後自動收合）。實測發現手動拖曳進度條（seek）
 * 也會讓它重新浮出來，不是只有換片那一刻才會。watermark-cover 平常只需要蓋住小浮水印，
 * 這幾種時機都要暫時放大蓋住整張推薦卡，秒數到了再縮回去。
 */
const showBigCover = ref(true)
let bigCoverTimer: ReturnType<typeof setTimeout> | null = null

function flashBigCover() {
  showBigCover.value = true
  if (bigCoverTimer) clearTimeout(bigCoverTimer)
  bigCoverTimer = setTimeout(() => { showBigCover.value = false }, 9000)
}

function loadVideo(id: string) {
  flashBigCover()
  armTapHint()
  page.value = 0
  load(id)
}

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

/**
 * 手機、平板這種窄螢幕（見底部 900px 斷點）容不下全部按鈕，仿 YouTube 的做法：固定單行
 * 高度，用左右頁籤切換兩組按鈕，而不是往下展開第二行（那樣會讓影片顯示區塊忽大忽小）。
 * 0 = 常用控制（返回／上下一首／播放／全螢幕），1 = 較少用到的設定（倒退10秒／速度／重複）。
 */
const page = ref<0 | 1>(0)

/** iOS 可能擋掉自動播放；等太久就改口提示小朋友點畫面。換片都算一次新的自動播放，要重新武裝這個計時器 */
const needsTap = ref(false)
let tapHintTimer: ReturnType<typeof setTimeout> | null = null

function armTapHint() {
  needsTap.value = false
  if (tapHintTimer) clearTimeout(tapHintTimer)
  tapHintTimer = setTimeout(() => {
    if (status.value === 'loading') needsTap.value = true
  }, 3000)
}

const seekValue = ref(0)
watch(progress, (p) => { seekValue.value = Math.round(p * 1000) })

// 清單自動接下一部：video prop 換了（同一個 VideoStage 實例接著播），换片即可，不必整個畫面重載
watch(() => props.video.uid, () => {
  if (isLimitReached.value) {
    overlay.value = 'limit'
    return
  }
  loadVideo(props.video.id)
})

onMounted(() => {
  // 額度已經用完就不要載入影片，直接顯示時間到
  if (isLimitReached.value) {
    overlay.value = 'limit'
    return
  }

  loadVideo(props.video.id)

  // 電視遙控器沒有滑鼠可以點畫面，把焦點放到看得見的播放/暫停鈕上
  if (isTv) {
    nextTick(() => playBtnRef.value?.focus())
  }
})

onBeforeUnmount(() => {
  if (tapHintTimer) clearTimeout(tapHintTimer)
  if (bigCoverTimer) clearTimeout(bigCoverTimer)
  // 把還沒落地的觀看秒數、接續播放的進度都寫進 localStorage
  flush()
  saveProgress()
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
  flashBigCover()
  commitSeek(Number((e.target as HTMLInputElement).value) / 1000)
}

function onSeekBack() {
  flashBigCover()
  seekBy(-10)
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

      <!--
        YouTube 自己的浮水印固定在右下角，modestbranding 也擋不掉；剛開始播放的頭幾秒
        還會浮出一張帶縮圖的「更多影片」推薦卡，比浮水印大很多，過一陣子才會自動收合。
        兩種都只能自己蓋一塊底色蓋住；pointer-events:none 讓點擊繼續穿透給上面的 shield。
      -->
      <div class="watermark-cover" :class="{ 'is-wide': showBigCover }" aria-hidden="true" />

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
    <div class="controls" :class="{ 'page-b': page === 1 }">
      <button class="ctrl-btn ctrl-back ctrl-page-a" aria-label="回到影片清單" @click="emit('close')">
        <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        <span>返回</span>
      </button>

      <!-- 窄螢幕比較少用，跟播放速度／重複放同一頁；夠寬的桌面視窗仍維持原本位置 -->
      <button class="ctrl-btn ctrl-page-b" aria-label="倒退 10 秒" @click="onSeekBack">
        <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" /></svg>
        <span>10秒</span>
      </button>

      <button v-if="queue.length > 1" class="ctrl-btn ctrl-page-a" aria-label="上一首" @click="playPrev">
        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
      </button>

      <!--
        觸控／滑鼠使用者點畫面（shield／暫停遮罩）就能切換播放，這顆按鈕對他們是多的，
        拿掉能讓控制列更寬鬆。電視遙控器沒有「點畫面」這個手勢，一定要留一個看得到、
        能被遙控器移入焦點的播放鈕，所以只在電視模式才顯示。
      -->
      <button v-if="isTv" ref="playBtnRef" class="ctrl-btn ctrl-play ctrl-page-a" aria-label="播放或暫停" @click="toggle">
        <svg v-if="isPlaying" viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" /></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
      </button>

      <button v-if="queue.length > 1" class="ctrl-btn ctrl-page-a" aria-label="下一首" @click="playNext">
        <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
      </button>

      <!-- 窄螢幕才會顯示：切到「其他設定」那一頁（見底部樣式），夠寬的桌面視窗就整排一起顯示 -->
      <button class="ctrl-btn ctrl-page-nav ctrl-page-next" type="button" aria-label="更多控制項" @click="page = 1">
        <svg viewBox="0 0 24 24"><path d="M8.6 5.4 7.2 6.8 13.4 13l-6.2 6.2 1.4 1.4L16.2 13z" /></svg>
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

      <button class="ctrl-btn ctrl-page-nav ctrl-page-prev" type="button" aria-label="返回播放控制" @click="page = 0">
        <svg viewBox="0 0 24 24"><path d="M15.4 5.4 16.8 6.8 10.6 13l6.2 6.2-1.4 1.4L7.8 13z" /></svg>
      </button>

      <button class="ctrl-btn ctrl-speed ctrl-page-b" aria-label="播放速度" @click="cycleSpeed">
        <span class="rate-label">{{ speedLabel }}</span>
      </button>

      <button
        class="ctrl-btn ctrl-page-b"
        :class="{ 'is-active': repeat }"
        aria-label="重複播放這一部"
        :aria-pressed="repeat"
        @click="toggleRepeat"
      >
        <svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4V6H7a4 4 0 0 0-4 4v1H1v-1a6 6 0 0 1 6-6h10V1zM7 23l-4-4 4-4v3h10a4 4 0 0 0 4-4v-1h2v1a6 6 0 0 1-6 6H7v3z" /></svg>
        <span>重複</span>
      </button>

      <!--
        故意放在整排最後：DOM 順序決定桌面／平板單行版的視覺順序（全螢幕最常用、排最後
        一顆方便單手觸及右側）；手機分頁版靠 order 決定順序，DOM 位置只影響同一頁內排序，
        所以放在這裡仍然會排在「常用」那一頁的最後一顆、緊接在 › 箭頭之前。
      -->
      <button class="ctrl-btn ctrl-page-a" aria-label="全螢幕切換" @click="toggleFullscreen">
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

.watermark-cover {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 3;
  width: clamp(96px, 20%, 190px);
  height: clamp(56px, 14%, 100px);
  background: #000;
  pointer-events: none;
  transition: width .4s ease, height .4s ease;
}

/* 剛開始播放那幾秒，「更多影片」推薦卡連縮圖帶文字，範圍比常駐浮水印大得多 */
.watermark-cover.is-wide {
  width: clamp(220px, 42%, 460px);
  height: clamp(64px, 15%, 120px);
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

/* 重複播放開啟時反白，小朋友一眼看出目前是開的 */
.ctrl-btn.is-active { background: var(--accent); color: var(--on-accent); }

/* 播放速度這顆按鈕本身就是文字（1×），不像其他按鈕的 span 只是輔助說明，窄螢幕也不能被下面的規則藏起來 */
.rate-label {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: .5px;
}

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

/* 分頁切換鈕只在下面窄螢幕斷點以下才用得到，其餘寬度一次顯示全部按鈕，直接不顯示 */
.ctrl-page-nav { display: none; }

/*
 * 900px 這個斷點不是隨便抓的：桌面版全部按鈕＋進度條攤開成一整排，實測大約要 900px 寬
 * 才放得下（見下面 .ctrl-btn 的桌面版尺寸）。手機當然不夠，但 iPad 這種平板直向（768px）
 * 也不夠，塞不下就會變成進度條被擠到只剩一小截、按鈕互相疊到的慘況，所以斷點要抓到能
 * 涵蓋平板直向寬度，不能只想著手機。
 *
 * 這裡只縮小按鈕尺寸，不強制換行：進度條 flex:1 會自動跟縮小後的按鈕擠在同一排，
 * 放得下就是一排（大部分平板／手機橫向都放得下）。真的窄到下面那個斷點、縮小後還是
 * 放不下整排，才會強制把進度條獨立成一整排、按鈕分頁。
 */
@media (max-width: 900px) {
  /* 播放速度這顆按鈕的文字就是內容本身（1×），不像其他按鈕的 span 只是輔助說明，窄螢幕也要留著 */
  .ctrl-btn span:not(.rate-label) { display: none; }
  .ctrl-btn { min-width: 44px; padding: 0 6px; }
  /*
   * 按鈕縮小後常常填不滿整排寬度，預設靠左排會在右邊留一大塊難看的空白。改成
   * space-between，讓按鈕依裝置寬度平均撐開；進度條那排只有它自己一個 100% 寬的項目，
   * 不受影響。進度條還跟按鈕擠在同一排的寬度（900~620px）則是進度條自己 flex:1
   * 撐滿剩餘空間，這條規則在那邊本來就不會有東西可以分散，不影響原本外觀。
   */
  .controls { gap: 8px; justify-content: space-between; }
  .ctrl-play { width: 56px; height: 56px; border-radius: 20px; }
  .ctrl-play svg { width: 28px; height: 28px; }

  /*
   * 播放速度按鈕的寬度會隨標籤長短變（1× 40px、0.75×／1.25× 要到 65px），如果拿最長的
   * 當斷點基準，會讓最常見的 1× 狀態平白浪費快 25px 的可用寬度。改成固定寬度＋縮小字級，
   * 讓最長的標籤也能塞進同一個固定寬度，斷點就能用同一個數字放心涵蓋所有速度檔位。
   */
  .ctrl-speed { width: 52px; }
  .ctrl-speed .rate-label { font-size: 14px; letter-spacing: 0; }
}

/*
 * 縮小尺寸後，手機直向這種寬度還是放不下整排（進度條會被擠到不能用）。實測過：進度條
 * 靠 flex:1 自動縮小，620px 左右滑桿還有約 96px 堪用，560px 只剩 36px，520px 以下直接
 * 縮到 0（完全看不到、按不到）——所以斷點要抓在還沒明顯壞掉的 620px，不能等到肉眼看到
 * 進度條消失才處理。進度條在這層先獨立成一整排；按鈕再縮小一點之後，實測全部擠在
 * 「同一排」其實還放得下（不用分頁），見下面 420px 那層才是真的要分頁的斷點。
 */
@media (max-width: 620px) {
  .controls {
    flex-wrap: wrap;
    padding-bottom: 14px;
    gap: 6px;
  }

  .ctrl-btn { min-width: 40px; padding: 0 4px; }

  .seek-wrap { order: 1; flex-basis: 100%; }
  .ctrl-page-a, .ctrl-page-b { order: 2; }
}

/*
 * 370px 這個斷點也是實測出來的：播放速度按鈕改成固定寬度＋縮小字級之後（見上面），
 * 全部按鈕（不含進度條，進度條已經獨立一整排）擠在同一排只需要約 348px，用瀏覽器
 * 實際的 scrollWidth／clientWidth 量過，350px 還放得下、340px 才會真的溢出，370px
 * 已經留了緩衝——只有比這更窄的螢幕才需要仿 YouTube 用左右箭頭分頁：常用的（返回、
 * 上/下一首、全螢幕）一頁，較少用的（倒退10秒、速度、重複）另一頁，而不是往下展開
 * 新的一排。
 */
@media (max-width: 370px) {
  .ctrl-page-nav {
    display: flex;
    min-width: 36px;
    padding: 0;
  }

  .ctrl-page-a, .ctrl-page-prev { order: 2; }
  .ctrl-page-next, .ctrl-page-b { order: 3; }

  .controls.page-b .ctrl-page-a,
  .controls.page-b .ctrl-page-next {
    display: none;
  }

  .controls:not(.page-b) .ctrl-page-b,
  .controls:not(.page-b) .ctrl-page-prev {
    display: none;
  }
}
</style>
