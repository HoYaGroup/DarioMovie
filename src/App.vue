<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import type { VideoItem } from '~/utils/youtube'
import { useTheme, THEME_COLORS } from '~/composables/useTheme'
import { useLibrary } from '~/composables/useLibrary'
import { useWatchTime } from '~/composables/useWatchTime'
import { useDisplay } from '~/composables/useDisplay'
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
const { init: initTheme, resolved: themeResolved } = useTheme()
const { requestAccess } = useParentGate()

const screen = ref<Screen>('library')
const playing = ref<VideoItem | null>(null)

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

function play(video: VideoItem) {
  playing.value = video
  // 網站在 App 裡面開，小朋友不會跳出去回不來
  pushScreen(video.kind === 'site' ? 'site' : 'watch')
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
      @open-parent="openParent"
    />

    <!--
      用 v-if 而不是 v-show：離開播放畫面時整個元件卸載，
      播放器會被 destroy 掉，不會有 iframe 在背景偷偷活著。
    -->
    <VideoStage
      v-else-if="screen === 'watch' && playing"
      :video="playing"
      @close="backToLibrary"
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
