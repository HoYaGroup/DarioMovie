import { computed } from 'vue'
import { useState } from './useState'

const SETTINGS_KEY = 'kidtube.watchSettings'
const LOG_KEY = 'kidtube.watchLog'
const REST_KEY = 'kidtube.restUntil'
const KEEP_DAYS = 30   // 只留最近 30 天的紀錄，不讓它無限長大

/** 休息的觸發方式 */
export type BreakMode = 'time' | 'video' | 'off'

export interface WatchSettings {
  /** 每天可以看幾分鐘，0 = 不限制 */
  dailyLimitMin: number
  /** 'time' 每看一段時間休息、'video' 每部影片看完休息、'off' 不休息 */
  breakMode: BreakMode
  /** breakMode 為 'time' 時，連續看幾分鐘就該休息 */
  breakEveryMin: number
  /** 休息要休息幾分鐘 */
  breakRestMin: number
}

/** 預設：一天一小時，每看 15 分鐘休息 3 分鐘 */
const DEFAULTS: WatchSettings = {
  dailyLimitMin: 60,
  breakMode: 'time',
  breakEveryMin: 15,
  breakRestMin: 3,
}

/** 本地時間的 YYYY-MM-DD，跨日會自動換一個新的 key */
export function dayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 秒數轉 3:00 這種倒數格式 */
export function countdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 把秒數說成小朋友聽得懂的話 */
export function humanMinutes(sec: number): string {
  if (!Number.isFinite(sec)) return '不限制'
  const m = Math.floor(sec / 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rest = m % 60
    return rest ? `${h} 小時 ${rest} 分` : `${h} 小時`
  }
  if (m >= 1) return `${m} 分鐘`
  return '不到 1 分鐘'
}

/** 每秒推一次的時鐘，只啟動一份 */
let ticker: ReturnType<typeof setInterval> | null = null

/**
 * 觀看時間控管。
 *
 * ‧ 每天的累計秒數記在 localStorage，隔天自動從零開始
 * ‧ 播放中每 250ms 由 VideoStage 回報一次，額度用完就停播並鎖住清單
 * ‧ 休息的結束時間也存進 localStorage，所以關掉 App 再開一樣要休息完
 * ‧ 家長可以隨時歸零、補時間或直接結束休息
 */
export function useWatchTime() {
  const settings = useState<WatchSettings>('watch.settings', () => ({ ...DEFAULTS }))
  const log = useState<Record<string, number>>('watch.log', () => ({}))
  const isReady = useState<boolean>('watch.ready', () => false)
  /** 這一次連續看了多久（按下「繼續看」或休息結束才歸零） */
  const sessionSeconds = useState<number>('watch.session', () => 0)
  /** 休息到什麼時候（毫秒時間戳），null 表示沒在休息 */
  const restUntil = useState<number | null>('watch.restUntil', () => null)
  /** 每秒更新的現在時間，讓倒數會動 */
  const nowMs = useState<number>('watch.now', () => Date.now())

  function persistSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value)) } catch { /* 略過 */ }
  }

  function persistLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.value)) } catch { /* 略過 */ }
  }

  function persistRest() {
    try {
      if (restUntil.value) localStorage.setItem(REST_KEY, String(restUntil.value))
      else localStorage.removeItem(REST_KEY)
    } catch { /* 略過 */ }
  }

  function init() {
    if (isReady.value) return

    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        // 舊版只有 breakReminderMin（單純提醒、沒有休息時長），幫它換算過來
        const legacyReminder = Number(p.breakReminderMin)
        const hasLegacy = Number.isFinite(legacyReminder) && p.breakEveryMin === undefined

        settings.value = {
          dailyLimitMin: Number(p.dailyLimitMin ?? DEFAULTS.dailyLimitMin) || 0,
          breakMode: hasLegacy
            ? (legacyReminder > 0 ? 'time' : 'off')
            : (['time', 'video', 'off'] as BreakMode[]).includes(p.breakMode) ? p.breakMode : DEFAULTS.breakMode,
          breakEveryMin: hasLegacy
            ? (legacyReminder || DEFAULTS.breakEveryMin)
            : Number(p.breakEveryMin ?? DEFAULTS.breakEveryMin) || DEFAULTS.breakEveryMin,
          breakRestMin: Number(p.breakRestMin ?? DEFAULTS.breakRestMin) || DEFAULTS.breakRestMin,
        }
      }
    } catch { /* 壞掉就用預設值 */ }

    try {
      const raw = localStorage.getItem(LOG_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object') {
        // 順手丟掉太舊的紀錄
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - KEEP_DAYS)
        const min = dayKey(cutoff)
        log.value = Object.fromEntries(
          Object.entries(parsed as Record<string, number>)
            .filter(([k, v]) => k >= min && typeof v === 'number'),
        )
      }
    } catch { /* 壞掉就從空的開始 */ }

    try {
      const saved = Number(localStorage.getItem(REST_KEY))
      // 已經過期的休息就直接清掉
      if (Number.isFinite(saved) && saved > Date.now()) restUntil.value = saved
      else localStorage.removeItem(REST_KEY)
    } catch { /* 略過 */ }

    if (!ticker) {
      ticker = setInterval(() => {
        nowMs.value = Date.now()
        // 休息倒數完就把記錄清掉，不要留一個過期的時間戳
        if (restUntil.value !== null && restUntil.value <= nowMs.value) {
          restUntil.value = null
          persistRest()
        }
      }, 1000)
    }

    isReady.value = true
  }

  /* ---------- 額度 ---------- */

  const todaySeconds = computed(() => log.value[dayKey()] ?? 0)
  const hasLimit = computed(() => settings.value.dailyLimitMin > 0)
  const limitSeconds = computed(() => settings.value.dailyLimitMin * 60)

  const remainingSeconds = computed(() =>
    hasLimit.value ? Math.max(0, limitSeconds.value - todaySeconds.value) : Infinity,
  )

  const isLimitReached = computed(() => hasLimit.value && remainingSeconds.value <= 0)

  /* ---------- 休息 ---------- */

  const isResting = computed(() =>
    restUntil.value !== null && restUntil.value > nowMs.value,
  )

  const restRemainingSeconds = computed(() =>
    restUntil.value ? Math.max(0, (restUntil.value - nowMs.value) / 1000) : 0,
  )

  /** 依「每看一段時間」的設定，該休息了嗎 */
  const needsTimeBreak = computed(() =>
    settings.value.breakMode === 'time' &&
    settings.value.breakEveryMin > 0 &&
    sessionSeconds.value >= settings.value.breakEveryMin * 60,
  )

  /** 每部影片看完就休息的模式 */
  const breaksAfterEachVideo = computed(() => settings.value.breakMode === 'video')

  function startRest() {
    const mins = settings.value.breakRestMin
    if (mins <= 0) {
      // 沒設休息時長就只是把連續觀看歸零
      sessionSeconds.value = 0
      return
    }
    restUntil.value = Date.now() + mins * 60 * 1000
    sessionSeconds.value = 0
    persistRest()
  }

  /** 休息結束（倒數完，或家長手動結束） */
  function endRest() {
    restUntil.value = null
    sessionSeconds.value = 0
    persistRest()
  }

  /* ---------- 回報 ---------- */

  let pendingWrite = 0

  /**
   * 播放中回報看了多少秒。
   * 為了不要每 250ms 就寫一次 localStorage，累積到 5 秒才落地。
   */
  function addSeconds(sec: number) {
    const key = dayKey()
    log.value[key] = (log.value[key] ?? 0) + sec
    sessionSeconds.value += sec

    pendingWrite += sec
    if (pendingWrite >= 5) {
      pendingWrite = 0
      persistLog()
    }
  }

  /** 離開播放畫面時呼叫，把還沒落地的秒數寫掉 */
  function flush() {
    if (pendingWrite > 0) {
      pendingWrite = 0
      persistLog()
    }
  }

  function resetSession() {
    sessionSeconds.value = 0
  }

  /* ---------- 設定與調整 ---------- */

  function setSettings(next: Partial<WatchSettings>): { ok: boolean; message: string } {
    const daily = next.dailyLimitMin ?? settings.value.dailyLimitMin
    const every = next.breakEveryMin ?? settings.value.breakEveryMin
    const rest = next.breakRestMin ?? settings.value.breakRestMin
    const mode = next.breakMode ?? settings.value.breakMode

    if (!Number.isFinite(daily) || daily < 0 || daily > 600) {
      return { ok: false, message: '每日上限請填 0～600 分鐘（0 表示不限制）。' }
    }
    if (!Number.isFinite(every) || every < 1 || every > 600) {
      return { ok: false, message: '「每看幾分鐘」請填 1～600。' }
    }
    if (!Number.isFinite(rest) || rest < 0 || rest > 120) {
      return { ok: false, message: '休息時間請填 0～120 分鐘（0 表示不強制休息）。' }
    }

    settings.value = {
      dailyLimitMin: Math.round(daily),
      breakMode: mode,
      breakEveryMin: Math.round(every),
      breakRestMin: Math.round(rest),
    }
    persistSettings()
    return { ok: true, message: '已儲存觀看時間設定。' }
  }

  /** 今天的紀錄歸零 */
  function resetToday() {
    log.value[dayKey()] = 0
    endRest()
    persistLog()
  }

  /** 額外多給幾分鐘（做法是把已看時間往回扣） */
  function grantExtra(minutes: number) {
    const key = dayKey()
    log.value[key] = Math.max(0, (log.value[key] ?? 0) - minutes * 60)
    resetSession()
    persistLog()
  }

  /** 最近幾天的統計，由舊到新，給設定頁畫長條圖用 */
  function recentDays(days = 7): Array<{ key: string; label: string; seconds: number }> {
    const out: Array<{ key: string; label: string; seconds: number }> = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = dayKey(d)
      out.push({
        key,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        seconds: log.value[key] ?? 0,
      })
    }
    return out
  }

  return {
    settings, isReady, init,
    todaySeconds, hasLimit, limitSeconds, remainingSeconds, isLimitReached,
    sessionSeconds, needsTimeBreak, breaksAfterEachVideo,
    isResting, restRemainingSeconds, startRest, endRest,
    addSeconds, flush, resetSession, setSettings, resetToday, grantExtra, recentDays,
  }
}
