<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import type { VideoItem } from '~/utils/youtube'
import { useTheme, THEME_COLORS } from '~/composables/useTheme'
import { useLibrary } from '~/composables/useLibrary'
import { useWatchTime } from '~/composables/useWatchTime'
import { useDisplay } from '~/composables/useDisplay'
import { useContinueWatching } from '~/composables/useContinueWatching'
import { useParentGate } from '~/composables/useParentGate'
import { warmUpYouTubeApi } from '~/composables/useYouTubePlayer'
import VideoLibrary from '~/components/VideoLibrary.vue'
import VideoStage from '~/components/VideoStage.vue'
import SiteStage from '~/components/SiteStage.vue'
import ParentPanel from '~/components/ParentPanel.vue'
import PinLock from '~/components/PinLock.vue'

type Screen = 'library' | 'watch' | 'site' | 'parent'

const { appTitle, init } = useLibrary()
const { init: initWatchTime, resetSession } = useWatchTime()
const { init: initDisplay } = useDisplay()
const { init: initContinueWatching } = useContinueWatching()
const { init: initTheme, resolved: themeResolved } = useTheme()
const { requestAccess } = useParentGate()

const screen = ref<Screen>('library')
const playing = ref<VideoItem | null>(null)
/** 目前這部影片所屬的清單，播完（或按下一部）就照這個順序循環播放 */
const queue = ref<VideoItem[]>([])
/** 從「接續播放」進來的話，這是要跳到的秒數；一般點片單就是 0 */
const resumeAt = ref(0)

// 相當於原本 Nuxt 版 pages/index.vue 的 useHead()：同步 <title> 與 PWA 狀態列底色
watchEffect(() => {
  document.title = appTitle.value
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[themeResolved.value])
})

onMounted(() => {
  init()
  initWatchTime()
  initDisplay()
  initContinueWatching()
  initTheme()
  // 先把 YouTube 的指令碼載進來，小朋友點下去才不用等
  warmUpYouTubeApi()
  window.addEventListener('popstate', onPopState)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
})

/**
 * 電視遙控器的「返回」鍵在 TWA 裡預設會被當成瀏覽器上一頁，
 * 沒特別處理的話，在播放畫面按一下返回鍵會直接把整個 App 關掉。
 * 用 pushState 記一筆「目前不在片單畫面」，讓返回鍵第一下先回到片單。
 */
let navigatingViaPopstate = false

function pushScreen(next: Screen) {
  screen.value = next
  history.pushState({ screen: next }, '')
}

function play(video: VideoItem, list: VideoItem[] = [video]) {
  playing.value = video
  resumeAt.value = 0
  // 網站沒有「播完」這件事，清單循環只對真的影片有意義，混在同一冊裡也要濾掉
  queue.value = list.filter((v) => (v.kind ?? 'video') === 'video')
  // 網站在 App 裡面開，小朋友不會跳出去回不來
  pushScreen(video.kind === 'site' ? 'site' : 'watch')
}

/** 從片單畫面的「接續播放」點進來，額外帶一個要跳到的秒數 */
function playResume(video: VideoItem, list: VideoItem[], positionSec: number) {
  play(video, list)
  resumeAt.value = positionSec
}

/** 播完（或重複播放跳過）自動接下一部，接到清單尾端就繞回第一部 */
function advance(video: VideoItem) {
  playing.value = video
}

function backToLibrary() {
  screen.value = 'library'
  playing.value = null
  // App 內的「返回」按鈕觸發時，順手把剛剛推的那筆歷史記錄消耗掉，
  // 避免遙控器返回鍵之後還要多按一次才能真的離開
  if (!navigatingViaPopstate && history.state?.screen) {
    history.back()
  }
}

async function openParent() {
  const granted = await requestAccess()
  if (granted) {
    // 家長進來通常就是要調時間，順手把「連續觀看」歸零
    resetSession()
    pushScreen('parent')
  }
}

function onPopState() {
  if (screen.value === 'library') return
  navigatingViaPopstate = true
  backToLibrary()
  navigatingViaPopstate = false
}
</script>

<template>
  <div class="app-root">
    <VideoLibrary
      v-if="screen === 'library'"
      @play="play"
      @resume="playResume"
      @open-parent="openParent"
    />

    <!--
      用 v-if 而不是 v-show：離開播放畫面時整個元件卸載，
      播放器會被 destroy 掉，不會有 iframe 在背景偷偷活著。
    -->
    <VideoStage
      v-else-if="screen === 'watch' && playing"
      :video="playing"
      :queue="queue"
      :resume-at="resumeAt"
      @close="backToLibrary"
      @advance="advance"
    />

    <SiteStage
      v-else-if="screen === 'site' && playing"
      :item="playing"
      @close="backToLibrary"
    />

    <ParentPanel
      v-else-if="screen === 'parent'"
      @close="backToLibrary"
    />

    <!-- 密碼鍵盤放在最外層，任何畫面都能叫得出來 -->
    <PinLock />
  </div>
</template>

<style>
.app-root { height: 100%; }

/* 電視遙控器用方向鍵移動焦點時要看得見游標在哪；滑鼠/觸控點擊不會觸發 :focus-visible，不影響原本外觀 */
:focus-visible {
  outline: 4px solid var(--accent);
  outline-offset: 3px;
  border-radius: 8px;
}
</style>
