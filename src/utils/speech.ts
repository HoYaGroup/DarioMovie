/**
 * 字卡用的聲音：唸單字（瀏覽器內建語音），以及答對、答錯的提示音。
 *
 * 唸單字用 speechSynthesis，不必另外錄音檔；iPad、手機、電腦都內建。
 * 電視（TWA）上不一定有語音引擎，所以 canSpeak 為 false 時畫面要改成顯示文字。
 */

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
  const pool = exact.length ? exact : sameLang
  return pool.find((v) => PREFERRED.test(v.name)) ?? pool.find((v) => v.localService) ?? pool[0] ?? null
}

export type SpeechText = { text: string; lang: 'en-US' | 'zh-TW' }
/** 停頓幾毫秒：「Listen again.」跟題目中間要停一下，小朋友才分得出是兩句 */
export type SpeechPause = { pause: number }
export type SpeechPart = SpeechText | SpeechPause

/** 每次 speak 都換一個編號，舊的那串發現編號變了就自己停下來 */
let chain = 0
/** 唸到一半的那句要抓著：Chrome 的 utterance 被回收的話，onend 就不會觸發 */
let current: SpeechSynthesisUtterance | null = null

/**
 * 依序唸出幾段文字（例如先唸英文、再唸中文），中間可以插停頓。
 * 每次呼叫都會先打斷上一次，小朋友連按也不會疊在一起。
 * 回傳的 Promise 在整串唸完（或被打斷）時完成，答對的回饋唸完才換下一題就靠它。
 */
export function speak(parts: SpeechPart[], rate = 0.8): Promise<void> {
  if (!canSpeak) return Promise.resolve()
  const synth = window.speechSynthesis
  synth.cancel()
  const id = ++chain
  const queue = parts.filter((p) => 'pause' in p || p.text.trim())

  return new Promise((resolve) => {
    const next = () => {
      if (id !== chain) return resolve()
      const p = queue.shift()
      if (!p) return resolve()
      if ('pause' in p) {
        setTimeout(next, p.pause)
        return
      }

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
    next()
  })
}

export function stopSpeaking() {
  chain++
  current = null
  if (canSpeak) window.speechSynthesis.cancel()
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
