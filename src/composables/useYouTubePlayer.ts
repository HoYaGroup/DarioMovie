import { ref, computed, onBeforeUnmount, type Ref } from 'vue'

/* ── YouTube IFrame API 的最小型別（不必額外安裝 @types/youtube） ── */
interface YTPlayer {
  loadVideoById: (id: string) => void
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (sec: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  setPlaybackRate: (rate: number) => void
  destroy: () => void
}
declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer
      PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

/**
 * 距離片尾多少秒就主動收手。
 *
 * 這是全案最重要的一個數字：YouTube 的「結束畫面」推薦網格會在影片真正播完的
 * 瞬間蓋滿播放器。提早 0.8 秒停掉並跳回自家清單，小朋友就完全不會看到它。
 */
const END_GUARD_SEC = 0.8

/** IFrame API 全域只載入一次 */
let apiPromise: Promise<void> | null = null
function loadIframeApi(): Promise<void> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    document.head.appendChild(s)
  })
  return apiPromise
}

/** 讓其他頁面可以先預熱，小朋友點下去時就不用等指令碼下載 */
export function warmUpYouTubeApi() {
  loadIframeApi().catch(() => {})
}

export type PlaybackStatus = 'loading' | 'playing' | 'paused' | 'error'

export function useYouTubePlayer(options: {
  onFinish: () => void
  /**
   * 播放中每隔 250ms 回報實際經過的秒數，用來累計觀看時間。
   * 只在真的在播的時候呼叫，暫停與緩衝都不算。
   */
  onTick?: (deltaSec: number) => void
}) {
  const hostRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>
  const status = ref<PlaybackStatus>('loading')
  const currentTime = ref(0)
  const duration = ref(0)
  const isSeeking = ref(false)

  let player: YTPlayer | null = null
  let ready = false
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let lastTickAt = 0
  let finished = false
  /** 目前載入的影片 ID；切字幕要整個重建播放器時要知道重建誰 */
  let currentVideoId = ''

  /** 播放速度、字幕開關、單片重複，三者都要在每次換片後重新套用到新的播放器實例 */
  const playbackRate = ref(1)
  const captionsOn = ref(false)
  const repeat = ref(false)

  const isPlaying = computed(() => status.value === 'playing')
  const progress = computed(() => (duration.value ? currentTime.value / duration.value : 0))

  function startTick() {
    stopTick()
    lastTickAt = 0
    tickTimer = setInterval(() => {
      if (!player || !ready) return

      // 用真實時鐘算經過多久，才是「小朋友盯著螢幕的時間」。
      // 間隔超過 2 秒表示 App 被切到背景或 iPad 鎖屏了，那段不該計入。
      const now = Date.now()
      const delta = lastTickAt ? (now - lastTickAt) / 1000 : 0
      lastTickAt = now
      if (delta > 0 && delta < 2) options.onTick?.(delta)

      const cur = player.getCurrentTime() || 0
      const dur = player.getDuration() || 0
      if (!dur) return

      duration.value = dur

      // ★ 結束守衛：趕在 YouTube 推薦網格出現之前離場
      if (dur - cur <= END_GUARD_SEC) {
        finish()
        return
      }

      if (!isSeeking.value) currentTime.value = cur
    }, 250)
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }

  function finish() {
    if (finished) return
    // 重複播放：跳回開頭繼續放，不當成「真的播完」，也就不會觸發關閉或換下一部
    if (repeat.value) {
      try { player?.seekTo(0, true) } catch { /* 播放器可能已被卸載 */ }
      return
    }
    finished = true
    stopTick()
    try { player?.stopVideo() } catch { /* 播放器可能已被卸載 */ }
    options.onFinish()
  }

  /** 換片之後，把播放速度重新套用到新的播放器狀態上 */
  function applySettings() {
    if (!player) return
    try { player.setPlaybackRate(playbackRate.value) } catch { /* 略過 */ }
  }

  function setPlaybackRate(rate: number) {
    playbackRate.value = rate
    if (player && ready) {
      try { player.setPlaybackRate(rate) } catch { /* 略過 */ }
    }
  }

  /**
   * 字幕開關。
   *
   * YouTube 那組沒有官方文件的 loadModule/setOption('captions',...) 實測完全失效
   * （tracklist 永遠是空的，設什麼語言都沒用）——唯一真的有效的是建立播放器當下的
   * cc_load_policy 參數，但它只能在「新建」播放器時生效，播到一半改不了。
   * 所以切字幕的唯一辦法是把播放器整個砍掉重建，重建時記住目前播到哪，蓋回去繼續播。
   */
  function setCaptionsOn(flag: boolean) {
    if (captionsOn.value === flag) return
    captionsOn.value = flag
    if (!player || !currentVideoId) return
    const resumeSec = player.getCurrentTime() || 0
    try { player.destroy() } catch { /* 已經沒了就算了 */ }
    player = null
    ready = false
    status.value = 'loading'
    createPlayer(currentVideoId, resumeSec)
  }

  function toggleRepeat() {
    repeat.value = !repeat.value
  }

  function onStateChange(e: { data: number }) {
    const S = window.YT!.PlayerState
    if (e.data === S.PLAYING) {
      status.value = 'playing'
      duration.value = player?.getDuration() || 0
      startTick()
    } else if (e.data === S.PAUSED) {
      status.value = 'paused'
      stopTick()
    } else if (e.data === S.ENDED) {
      // 守衛沒攔到時的保險（例如影片極短、或 seek 直接跳到最後）
      finish()
    }
  }

  /** 真正建立播放器實例；resumeSec > 0 表示是切字幕重建的，就緒後要先跳到原本播到的位置 */
  function createPlayer(videoId: string, resumeSec: number) {
    if (!hostRef.value) return

    // 自建掛載點：YT 會把它整個換成 iframe，這樣 Vue 就不會去碰被換掉的節點
    const mountPoint = document.createElement('div')
    hostRef.value.innerHTML = ''
    hostRef.value.appendChild(mountPoint)

    player = new window.YT!.Player(mountPoint, {
      videoId,
      // 走隱私加強模式網域：不讀寫 youtube.com 的任何 cookie，字幕開關才不會被
      // 「這台裝置曾經在 youtube.com 打開過字幕」這種殘留偏好蓋過去
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
        controls: 0,        // 不載入 YouTube 原生控制列 → 沒有 logo、標題、分享、稍後觀看
        disablekb: 1,       // 停用鍵盤快捷鍵
        fs: 0,              // 停用原生全螢幕鈕（iOS 全螢幕會被系統播放器接管，那裡有推薦）
        iv_load_policy: 3,  // 關閉影片註解卡
        modestbranding: 1,
        playsinline: 1,     // iOS 必須：不讓原生播放器接管畫面
        rel: 0,             // 相關影片限制在同頻道（2018 年後的語意，仍值得帶上）
        // 字幕唯一真正有效的開關只有這個，而且只能在建立當下生效（見 setCaptionsOn 說明）
        cc_load_policy: captionsOn.value ? 1 : 0,
        cc_lang_pref: 'en',
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          ready = true
          applySettings()
          if (resumeSec > 0) {
            try { player?.seekTo(resumeSec, true) } catch { /* 略過 */ }
          }
          // iOS 可能擋掉自動播放；擋掉也無妨，小朋友點畫面就會開始
          try { player?.playVideo() } catch { /* 使用者手勢不足，等他點畫面 */ }
        },
        onStateChange,
        onError: () => { status.value = 'error' },
      },
    })
  }

  /** 建立播放器並開始播放指定影片 */
  async function load(videoId: string) {
    currentVideoId = videoId
    finished = false
    status.value = 'loading'
    currentTime.value = 0
    duration.value = 0

    await loadIframeApi()
    if (!hostRef.value) return

    if (player && ready) {
      player.loadVideoById(videoId)
      applySettings()
      return
    }

    createPlayer(videoId, 0)
  }

  function play() {
    if (!player || !ready) return
    try { player.playVideo() } catch { /* 使用者手勢不足，等他點畫面 */ }
  }

  function pause() {
    if (!player || !ready) return
    try { player.pauseVideo() } catch { /* 播放器可能已被卸載 */ }
  }

  function toggle() {
    if (!player || !ready) return
    const S = window.YT!.PlayerState
    const st = player.getPlayerState()
    if (st === S.PLAYING || st === S.BUFFERING) player.pauseVideo()
    else player.playVideo()
  }

  function seekBy(delta: number) {
    if (!player || !ready) return
    const next = Math.max(0, (player.getCurrentTime() || 0) + delta)
    player.seekTo(next, true)
  }

  /** 進度條拖曳中：先更新顯示，放開才真的跳 */
  function previewSeek(ratio: number) {
    isSeeking.value = true
    currentTime.value = ratio * duration.value
  }

  function commitSeek(ratio: number) {
    if (player && ready && duration.value) {
      const target = ratio * duration.value
      // 別讓小朋友把進度拉進守衛區，否則一放手就直接跳出去了
      player.seekTo(Math.min(target, Math.max(0, duration.value - END_GUARD_SEC - 1)), true)
    }
    isSeeking.value = false
  }

  function teardown() {
    stopTick()
    try { player?.destroy() } catch { /* 已經沒了就算了 */ }
    if (hostRef.value) hostRef.value.innerHTML = ''
    player = null
    ready = false
  }

  onBeforeUnmount(teardown)

  return {
    hostRef, status, isPlaying, currentTime, duration, progress,
    load, toggle, play, pause, seekBy, previewSeek, commitSeek, finish, teardown,
    playbackRate, setPlaybackRate, captionsOn, setCaptionsOn, repeat, toggleRepeat,
  }
}
