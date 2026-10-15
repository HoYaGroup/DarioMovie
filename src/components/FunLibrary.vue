<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatTime, type VideoItem } from '~/utils/youtube'
import { humanMinutes, useWatchTime } from '~/composables/useWatchTime'
import { useLibrary } from '~/composables/useLibrary'
import { useChildStage } from '~/composables/useChildStage'
import { useShelf } from '~/composables/useShelf'
import { useContinueWatching } from '~/composables/useContinueWatching'
import { useTheme } from '~/composables/useTheme'
import { useTvFocus } from '~/composables/useTvFocus'
import { useOnline } from '~/composables/useOffline'
import ShelfBrowser from '~/components/ShelfBrowser.vue'
import LockedNotice from '~/components/LockedNotice.vue'
import EmptyHint from '~/components/EmptyHint.vue'

/**
 * 娛樂畫面：影片和網站。家長輸入密碼才會進來，小朋友按返回就回到學習首頁，
 * 想再看要家長再輸入一次密碼。
 */
const emit = defineEmits<{
  close: []
  play: [video: VideoItem, queue: VideoItem[]]
  resume: [video: VideoItem, queue: VideoItem[], positionSec: number]
}>()

const { videos, looseVideosIn, videosInSub } = useLibrary()
const { isVideoVisible } = useChildStage()
const { sections } = useShelf('fun')
const { hasLimit, remainingSeconds, isLimitReached, isResting } = useWatchTime()
const { entry: continueEntry, isResumable, clear: clearContinue } = useContinueWatching()
const { resolved: themeResolved, setTheme } = useTheme()
const { online } = useOnline()

const rootRef = ref<HTMLElement | null>(null)
useTvFocus(rootRef, '.continue-bar, .tabs .tab, .grid .card')

/** 小朋友自己就能換亮暗，光線變了不用找家長 */
function toggleTheme() {
  setTheme(themeResolved.value === 'dark' ? 'light' : 'dark')
}

/** 剩餘額度說成小朋友聽得懂的話 */
const remainText = computed(() => humanMinutes(remainingSeconds.value))

/** 額度用完或正在休息，片單都要收起來 */
const isBlocked = computed(() => isLimitReached.value || isResting.value)

/* ---------- 接續播放 ---------- */

/** 上次看到一半、值得問要不要接續的那支影片；找不到（可能被刪了）或已經快看完就不問 */
const continueVideo = computed(() => {
  const e = continueEntry.value
  if (!e || !isResumable(e)) return null
  const video = videos.value.find((v) => v.uid === e.uid)
  // 家長把那一班收起來了，就不用再問要不要接著看
  return video && isVideoVisible(video) ? video : null
})

const continueTimeLabel = computed(() => (continueEntry.value ? formatTime(continueEntry.value.positionSec) : ''))

/** 重建這支影片當初所在的那份清單，接續播放也一樣照這份清單循環 */
function queueFor(video: VideoItem): VideoItem[] {
  return (video.subId ? videosInSub(video.subId) : looseVideosIn(video.categoryId)).filter(isVideoVisible)
}

function resumeContinueWatching() {
  const video = continueVideo.value
  const e = continueEntry.value
  if (!video || !e) return
  emit('resume', video, queueFor(video), e.positionSec)
}
</script>

<template>
  <section ref="rootRef" class="library">
    <header class="app-bar">
      <button class="back-btn" type="button" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6 16 7.4 11.4 12l4.6 4.6-1.3 1.4-6-6z" /></svg>
        返回
      </button>

      <div class="brand">
        <h1><span aria-hidden="true">🎬</span> 影片時間</h1>
      </div>

      <!-- 有設每日上限才顯示，沒設就不要拿時間去干擾小朋友 -->
      <span v-if="hasLimit && !isBlocked" class="quota">
        <span class="quota-icon" aria-hidden="true">⏰</span><span class="quota-label">還可以看 </span>{{ remainText }}
      </span>

      <button
        class="icon-btn theme-btn"
        :aria-label="themeResolved === 'dark' ? '換成亮色背景' : '換成暗色背景'"
        @click="toggleTheme"
      >
        <span aria-hidden="true">{{ themeResolved === 'dark' ? '☀️' : '🌙' }}</span>
      </button>
    </header>

    <!-- 沒網路：給家長看的一行說明，影片和網站要等有網路 -->
    <p v-if="!online && !isBlocked" class="offline-bar" role="status">
      <span aria-hidden="true">📴</span> 沒有網路：影片和網站要連上網路才能看
    </p>

    <LockedNotice v-if="isBlocked" />

    <template v-else>
      <!-- 接續播放：小朋友自己點才會跳回去繼續看，不會一進來就自動跳進播放畫面；沒網路時播不了，先不問 -->
      <div v-if="continueVideo && online" class="continue-bar">
        <button class="continue-main" type="button" @click="resumeContinueWatching">
          <span class="continue-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
          <span class="continue-text">
            接續播放：<strong>{{ continueVideo.title || '影片' }}</strong>
          </span>
          <span class="continue-time">{{ continueTimeLabel }}</span>
        </button>
        <button class="continue-dismiss" aria-label="不用了，關掉這個提示" @click="clearContinue">
          <svg viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z" /></svg>
        </button>
      </div>

      <ShelfBrowser
        v-if="sections.length"
        kind="fun"
        @open="(video, list) => emit('play', video, list)"
      />
      <EmptyHint v-else kind="fun" />
    </template>
  </section>
</template>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.brand {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.theme-btn { font-size: 22px; }

.back-btn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 56px;
  padding: 0 22px 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .15s ease;
}
.back-btn svg { width: 28px; height: 28px; fill: currentColor; }
.back-btn:active { transform: scale(.94); }

/* ---------- 剩餘額度 ---------- */
.quota-icon { margin-right: 7px; }

.quota {
  flex: none;
  margin-right: 4px;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}

/* ---------- 接續播放 ---------- */
.continue-bar {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 10px;
  margin: 0 calc(var(--safe-r) + 22px) 18px calc(var(--safe-l) + 22px);
}

.continue-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--on-accent);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform .15s ease;
}
.continue-main:active { transform: scale(.98); }

.continue-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .25);
  display: grid;
  place-items: center;
}
.continue-icon svg { width: 20px; height: 20px; fill: currentColor; }

.continue-text {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.continue-text strong { font-weight: 800; }

.continue-time {
  flex: none;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  opacity: .9;
}

.continue-dismiss {
  flex: none;
  width: 48px;
  border: 0;
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text-dim);
  cursor: pointer;
}
.continue-dismiss svg { width: 20px; height: 20px; fill: currentColor; }
.continue-dismiss:active { transform: scale(.94); }

.offline-bar {
  flex: none;
  margin: 0 calc(var(--safe-r) + 22px) 14px calc(var(--safe-l) + 22px);
  padding: 10px 16px;
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 700;
}

/* 手機橫向：垂直空間極少，把上面的東西全部壓扁，留給內容 */
@media (max-height: 520px) {
  .app-bar {
    padding-top: calc(var(--safe-t) + 8px);
    padding-bottom: 8px;
  }
  .app-bar h1 { font-size: 18px; }
  .icon-btn { width: 44px; height: 44px; }
  .back-btn { height: 44px; font-size: 16px; }
  .quota { padding: 7px 12px; font-size: 13px; }
}

@media (max-width: 560px) {
  /* 手機的橫向空間要留給標題：額度只留數字 */
  .quota-label { display: none; }
  .quota { padding: 9px 12px; font-size: 14px; }
  .quota-icon { margin-right: 5px; }
  .back-btn { padding-right: 16px; }
}
</style>
