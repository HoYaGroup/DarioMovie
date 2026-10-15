<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import type { VideoItem } from '~/utils/youtube'
import { useTheme, THEME_COLORS } from '~/composables/useTheme'
import { useLibrary } from '~/composables/useLibrary'
import { useWatchTime } from '~/composables/useWatchTime'
import { useDisplay } from '~/composables/useDisplay'
import { useChildStage } from '~/composables/useChildStage'
import { useContinueWatching } from '~/composables/useContinueWatching'
import { useParentGate } from '~/composables/useParentGate'
import { useTvMode } from '~/composables/useTvMode'
import { warmUpYouTubeApi } from '~/composables/useYouTubePlayer'
import { useStageImageSync } from '~/composables/useStageImages'
import LearnHome from '~/components/LearnHome.vue'
import FunLibrary from '~/components/FunLibrary.vue'
import VideoStage from '~/components/VideoStage.vue'
import SiteStage from '~/components/SiteStage.vue'
import CardDeck from '~/components/CardDeck.vue'
import StickerBook from '~/components/StickerBook.vue'
import ParentPanel from '~/components/ParentPanel.vue'
import PinLock from '~/components/PinLock.vue'

/**
 * library 是小朋友一打開看到的學習首頁（字卡本、今日任務）；
 * fun 是影片和網站，要家長輸入密碼才進得去。
 */
type Screen = 'library' | 'fun' | 'watch' | 'site' | 'cards' | 'parent' | 'stickers'

const { appTitle, init } = useLibrary()
const { init: initWatchTime, resetSession } = useWatchTime()
const { init: initDisplay } = useDisplay()
const { init: initChild } = useChildStage()
const { init: initContinueWatching } = useContinueWatching()
const { init: initTheme, resolved: themeResolved } = useTheme()
const { requestAccess } = useParentGate()
const { isTv } = useTvMode()

const screen = ref<Screen>('library')
const playing = ref<VideoItem | null>(null)
/** 目前這部影片所屬的清單，播完（或按下一部）就照這個順序循環播放 */
const queue = ref<VideoItem[]>([])
/** 從「接續播放」進來的話，這是要跳到的秒數；一般點片單就是 0 */
const resumeAt = ref(0)
/** 字卡本要怎麼打開：從首頁「今日任務」點進來的直接開任務，其他先看卡片 */
const deckStart = ref<'mission' | ''>('')

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
  initChild()
  initContinueWatching()
  initTheme()
  // 先把 YouTube 的指令碼載進來，小朋友點下去才不用等
  warmUpYouTubeApi()
  // 有網路時在背景把孩子這幾班的字卡圖片存下來（要等 initChild 讀完年紀，才知道是哪幾班）
  useStageImageSync()
  window.addEventListener('popstate', onPopState)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
})

/**
 * 電視遙控器的「返回」鍵在 TWA 裡預設會被當成瀏覽器上一頁，
 * 沒特別處理的話，在播放畫面按一下返回鍵會直接把整個 App 關掉。
 * 每進一個畫面就 pushState 記一筆，返回鍵一次退一層（影片 → 影片時間 → 首頁），
 * trail 記的是「現在這個畫面底下是哪幾個畫面」，App 內的返回鈕照它退。
 */
const trail: Screen[] = []
let navigatingViaPopstate = false
/** App 內的返回鈕自己呼叫了 history.back()，等一下 popstate 進來時要略過，不然會多退一層 */
let pendingPops = 0

function pushScreen(next: Screen) {
  const from = screen.value
  const inCardFlow = (from === 'cards' || from === 'stickers') && (next === 'cards' || next === 'stickers')
  screen.value = next
  // 在字卡和貼紙本之間來回，只換掉那一筆歷史記錄、不另外堆一筆，遙控器的返回鍵才不用多按
  if (inCardFlow && history.state?.screen) {
    history.replaceState({ screen: next }, '')
  } else {
    trail.push(from)
    history.pushState({ screen: next }, '')
  }
}

/** 任務貼紙本：首頁和任務完成的畫面都開得到 */
function openStickers() {
  pushScreen('stickers')
}

function play(video: VideoItem, list: VideoItem[] = [video], start: 'mission' | '' = '') {
  playing.value = video
  resumeAt.value = 0
  deckStart.value = start
  // 網站沒有「播完」這件事，清單循環只對真的影片有意義，混在同一冊裡也要濾掉
  queue.value = list.filter((v) => (v.kind ?? 'video') === 'video')
  // 網站在 App 裡面開，小朋友不會跳出去回不來；字卡有自己的畫面
  pushScreen(video.kind === 'site' ? 'site' : video.kind === 'deck' ? 'cards' : 'watch')
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

/** 退回上一層：看完影片回影片時間，離開影片時間、字卡、貼紙本、家長設定回首頁 */
function goBack() {
  screen.value = trail.pop() ?? 'library'
  if (screen.value === 'library' || screen.value === 'fun') playing.value = null
  // App 內的「返回」按鈕觸發時，順手把剛剛推的那筆歷史記錄消耗掉，
  // 避免遙控器返回鍵之後還要多按一次才能真的離開
  if (!navigatingViaPopstate && history.state?.screen) {
    pendingPops++
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

/** 影片和網站：家長輸入密碼才打得開；電視沒有密碼鍵盤，直接開放 */
async function openFun() {
  const granted = isTv || await requestAccess('fun')
  if (granted) pushScreen('fun')
}

function onPopState() {
  if (pendingPops > 0) {
    pendingPops--
    return
  }
  if (screen.value === 'library') return
  navigatingViaPopstate = true
  goBack()
  navigatingViaPopstate = false
}
</script>

<template>
  <div class="app-root">
    <LearnHome
      v-if="screen === 'library'"
      @play="play"
      @mission="(video) => play(video, [video], 'mission')"
      @stickers="openStickers"
      @open-fun="openFun"
      @open-parent="openParent"
    />

    <FunLibrary
      v-else-if="screen === 'fun'"
      @close="goBack"
      @play="play"
      @resume="playResume"
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
      @close="goBack"
      @advance="advance"
    />

    <SiteStage
      v-else-if="screen === 'site' && playing"
      :item="playing"
      @close="goBack"
    />

    <CardDeck
      v-else-if="screen === 'cards' && playing"
      :deck="playing"
      :start="deckStart"
      @close="goBack"
      @stickers="openStickers"
    />

    <StickerBook
      v-else-if="screen === 'stickers'"
      @close="goBack"
      @mission="(video) => play(video, [video], 'mission')"
    />

    <ParentPanel
      v-else-if="screen === 'parent'"
      @close="goBack"
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
