/**
 * 字卡用的聲音：唸單字（瀏覽器內建語音），以及答對、答錯的提示音。
 *
 * 唸單字用 speechSynthesis，不必另外錄音檔；iPad、手機、電腦都內建。
 * 電視（TWA）上不一定有語音引擎，所以 canSpeak 為 false 時畫面要改成顯示文字。
 *
 * 爸媽在家長設定錄過的句子（utils/recordings.ts）優先放錄音，沒錄的才用合成語音：
 * 每一段文字唸之前先查有沒有人錄過同一句，所以字卡的其他地方都不用改。
 */
import { getClip, loadClips, type Clip, type ClipLang } from './recordings'

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

let voices: SpeechSynthesisVoice[] = []

function loadVoices() {
  try { voices = window.speechSynthesis.getVoices() } catch { voices = [] }
}

if (canSpeak) {
  loadVoices()
  // Chrome 的語音清單是非同步載入的，一開始常常是空的
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}

/** 品質比較好的內建語音：iOS／macOS 的 Samantha、美佳，Chrome 的 Google 語音 */
const PREFERRED = /samantha|google us english|meijia|mei-jia|美佳|google 國語/i

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const norm = (s: string) => s.toLowerCase().replace('_', '-')
  const want = norm(lang)
  const exact = voices.filter((v) => norm(v.lang) === want)
  const sameLang = voices.filter((v) => norm(v.lang).startsWith(want.split('-')[0]!))
  const all = exact.length ? exact : sameLang
  // 沒網路時只挑裝置內建的語音：電腦版 Chrome 的 Google 語音要連網，離線會整句不出聲
  const local = all.filter((v) => v.localService)
  const pool = navigator.onLine === false && local.length ? local : all
  return pool.find((v) => PREFERRED.test(v.name)) ?? pool.find((v) => v.localService) ?? pool[0] ?? null
}

export type SpeechText = { text: string; lang: ClipLang }
/** 停頓幾毫秒：「Listen again.」跟題目中間要停一下，小朋友才分得出是兩句 */
export type SpeechPause = { pause: number }
/** 放一段音檔（動物真正的叫聲）：sound 是音檔的網址（要先用 imageSrc 接上部署的子目錄） */
export type SpeechSound = { sound: string }
export type SpeechPart = SpeechText | SpeechPause | SpeechSound

/** 每次 speak 都換一個編號，舊的那串發現編號變了就自己停下來 */
let chain = 0
/** 唸到一半的那句要抓著：Chrome 的 utterance 被回收的話，onend 就不會觸發 */
let current: SpeechSynthesisUtterance | null = null
/** 正在放的那段錄音：被打斷時要叫它停下來（AudioBufferSource 停了不會自己觸發 onended） */
let stopClip: (() => void) | null = null

/**
 * 依序唸出幾段文字（例如先唸英文、再唸中文），中間可以插停頓。
 * 每一段先看有沒有爸媽錄過同一句：有就放錄音，沒有才用合成語音。
 * 每次呼叫都會先打斷上一次，小朋友連按也不會疊在一起。
 * 回傳的 Promise 在整串唸完（或被打斷）時完成，答對的回饋唸完才換下一題就靠它。
 */
export function speak(parts: SpeechPart[], rate = 0.8): Promise<void> {
  const id = ++chain
  stopClip?.()
  const synth = canSpeak ? window.speechSynthesis : null
  synth?.cancel()
  const queue = parts.filter((p) => 'pause' in p || 'sound' in p || p.text.trim())
  // 沒有語音引擎、這串話也沒有錄音和音檔（例如部分電視）：沒東西可唸
  if (!synth && !queue.some((p) => 'sound' in p || ('text' in p && getClip(p.text, p.lang)))) return Promise.resolve()

  return new Promise((resolve) => {
    /** 合成語音唸這一段 */
    const tts = (p: SpeechText): void => {
      if (!synth) return next()
      const u = new SpeechSynthesisUtterance(p.text)
      u.lang = p.lang
      u.rate = rate
      const v = pickVoice(p.lang)
      if (v) u.voice = v

      // 有些瀏覽器偶爾不觸發 onend，等太久就自己往下走，不要整串卡住
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(guard)
        if (current === u) current = null
        next()
      }
      const guard = setTimeout(finish, 3000 + p.text.length * 250)
      u.onend = finish
      u.onerror = finish
      current = u
      synth.speak(u)
    }

    const next = (): void => {
      if (id !== chain) return resolve()
      const p = queue.shift()
      if (!p) return resolve()
      if ('pause' in p) {
        setTimeout(next, p.pause)
        return
      }
      // 動物的叫聲：抓音檔來放；抓不到、放不出來就跳過這一段，不要整串卡住
      if ('sound' in p) {
        soundClip(p.sound).then((sc) => {
          if (id !== chain) return resolve()
          if (!sc) return next()
          startClip(sc, () => { if (id === chain) next(); else resolve() }, id).then((ok) => {
            if (ok) return
            if (id === chain) next()
            else resolve()
          })
        })
        return
      }
      const clip = getClip(p.text, p.lang)
      if (!clip) return tts(p)
      // 錄音放不出來（解碼失敗、瀏覽器不支援）就退回合成語音，不要整串卡住
      startClip(clip, () => { if (id === chain) next(); else resolve() }, id).then((ok) => {
        if (ok) return
        if (id === chain) tts(p)
        else resolve()
      })
    }
    next()
  })
}

export function stopSpeaking() {
  chain++
  current = null
  stopClip?.()
  if (canSpeak) window.speechSynthesis.cancel()
}

/* ---------- 放錄音：用 Web Audio，在 iPad 上點過一次畫面之後，計時器觸發的也放得出聲音 ---------- */

/**
 * 解碼過的錄音留在記憶體，同一句不用每次重新解碼。解碼後很佔記憶體（一分鐘約 20 MB），
 * 所以照「總長度」算：最多留 5 分鐘的量，超過就丟最舊的；單一段超過 2 分鐘的不留，每次播放時再解碼。
 */
const decoded = new Map<string, AudioBuffer>()
const DECODED_BUDGET_SEC = 300
const DECODED_KEEP_MAX_SEC = 120
let decodedSec = 0

async function bufferFor(clip: Clip): Promise<AudioBuffer | null> {
  const key = `${clip.key}@${clip.at}`
  const hit = decoded.get(key)
  if (hit) return hit
  const ac = audio()
  if (!ac) return null
  try {
    const buf = await ac.decodeAudioData(await clip.blob.arrayBuffer())
    if (buf.duration <= DECODED_KEEP_MAX_SEC) {
      decoded.set(key, buf)
      decodedSec += buf.duration
      while (decodedSec > DECODED_BUDGET_SEC && decoded.size > 1) {
        const [oldKey, old] = decoded.entries().next().value!
        decoded.delete(oldKey)
        decodedSec -= old.duration
      }
    }
    return buf
  } catch {
    return null
  }
}

/**
 * 放一段錄音，放完（或被 stopClip 打斷）呼叫 onEnd。放不出來回傳 false，由呼叫的人退回合成語音。
 * 跳過錄音前後的靜音（clip.trim）。
 */
async function startClip(clip: Clip, onEnd: () => void, id: number): Promise<boolean> {
  const ac = audio()
  if (!ac) return false
  const buf = await bufferFor(clip)
  if (!buf) return false
  // 解碼的時候已經被打斷了：不放，直接結束
  if (id !== chain) { onEnd(); return true }

  const [from, to] = clip.trim ?? [0, buf.duration]
  const length = Math.max(0.05, Math.min(to, buf.duration) - from)
  const src = ac.createBufferSource()
  src.buffer = buf
  src.connect(ac.destination)

  let done = false
  let guard: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    if (done) return
    done = true
    clearTimeout(guard)
    if (stopClip === stop) stopClip = null
    onEnd()
  }
  const stop = () => {
    try { src.onended = null; src.stop() } catch { /* 還沒開始放 */ }
    finish()
  }
  src.onended = finish
  // iPad 還沒點過畫面的話 AudioContext 是暫停的，onended 永遠不會來：放得太久就自己往下走
  guard = setTimeout(finish, length * 1000 + 1500)
  stopClip = stop
  src.start(0, from, length)
  return true
}

/** 抓過的音檔留著（每個一百多 KB），同一個叫聲再放不用重新抓；解碼過的由 bufferFor 另外留 */
const soundBlobs = new Map<string, Blob>()

/** 把音檔網址包成一段「錄音」，交給 startClip 用 Web Audio 放（iPad 點過畫面之後計時器觸發的也放得出聲音） */
async function soundClip(url: string): Promise<Clip | null> {
  let blob = soundBlobs.get(url)
  if (!blob) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      blob = await res.blob()
      soundBlobs.set(url, blob)
    } catch {
      return null
    }
  }
  return { key: url, text: '', lang: 'en-US', blob, trim: null, ms: 0, at: 0 }
}

/** 家長設定頁的「試聽」：放這段錄音一次，放完才完成 */
export function previewClip(clip: Clip): Promise<boolean> {
  stopSpeaking()
  const id = chain
  return new Promise((resolve) => {
    startClip(clip, () => resolve(true), id).then((ok) => { if (!ok) resolve(false) })
  })
}

/**
 * 錄完之後看一下這段錄音：多長、哪一段有聲音（前後的靜音要剪掉）。
 * 完全沒錄到聲音、或解不開回傳 null。
 */
export async function analyzeRecording(blob: Blob): Promise<{ trim: [number, number]; ms: number } | null> {
  const ac = audio()
  if (!ac) return null
  let buf: AudioBuffer
  try { buf = await ac.decodeAudioData(await blob.arrayBuffer()) } catch { return null }

  const data = buf.getChannelData(0)
  const win = Math.max(1, Math.floor(buf.sampleRate * 0.02))
  const rms: number[] = []
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += data[j]! * data[j]!
    rms.push(Math.sqrt(sum / win))
  }
  const peak = Math.max(0, ...rms)
  if (peak < 0.01) return null
  // 比最大聲的一小段小很多的，當作是背景雜音
  const threshold = Math.max(0.008, peak * 0.08)
  const first = rms.findIndex((v) => v > threshold)
  let last = rms.length - 1
  while (last > first && rms[last]! <= threshold) last--
  if (first < 0) return null
  const sec = 0.02
  const from = Math.max(0, first * sec - 0.12)
  const to = Math.min(buf.duration, (last + 1) * sec + 0.2)
  return { trim: [from, to], ms: Math.round((to - from) * 1000) }
}

if (typeof window !== 'undefined') {
  // 把裝置上的錄音讀進記憶體，speak 才查得到
  loadClips().catch(() => {})
  // iPad 要在使用者點過畫面之後才放得出聲音：第一次點的時候先把 AudioContext 叫醒
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

/* ---------- 提示音：用 Web Audio 現場合成，不必放音效檔 ---------- */

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    // iOS 要在使用者點擊之後才放得出聲音，被暫停的話叫醒它
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** 一串音符，每個音都是短短的、尾巴淡出的「叮」 */
function notes(freqs: number[], gap: number, type: OscillatorType, volume: number) {
  const ac = audio()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    const at = t0 + i * gap
    osc.type = type
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
    osc.connect(gain).connect(ac.destination)
    osc.start(at)
    osc.stop(at + 0.4)
  })
}

/** 答對：往上爬的三個音（Do Mi Sol） */
export function chimeRight() {
  notes([523.25, 659.25, 783.99], 0.09, 'triangle', 0.25)
}

/** 答錯：輕輕往下的兩個音，不要嚇到小朋友 */
export function chimeWrong() {
  notes([311.13, 261.63], 0.12, 'sine', 0.18)
}

/** 點東西：一個短短的「咚」 */
export function chimeTap() {
  notes([880], 0, 'sine', 0.12)
}
