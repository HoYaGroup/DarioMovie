import type { Card, VideoItem } from './youtube'
import { cardsOf, enNumber, isNumberCard, isZhCard, speechOf, zhNumber, zhReading } from './cards'
import { appLines } from './cheers'
import { clipKey, type ClipLang } from './recordings'
import { FILE_NAME_MAX, fileSafeName } from './photoFiles'

/**
 * 家長設定「錄音」要錄哪些句子。每一句就是 App 之後會唸的那一段文字——
 * 錄音是依「那一句話」記的（見 recordings.ts），所以這裡列出來的文字要跟 CardDeck 實際唸的一樣。
 */
export interface VoiceLine {
  text: string
  lang: ClipLang
  /** 寫在旁邊給家長看：這是哪個詞的中文／例句 */
  note: string
  /** word 詞句本身、sentence 例句、meaning 中文、app App 自己說的話 */
  kind: 'word' | 'sentence' | 'meaning' | 'app'
}

export interface VoiceLineOptions {
  /** 連例句一起錄（每張卡三句） */
  sentences: boolean
  /** 連中文一起錄 */
  chinese: boolean
}

/** 一本字卡要錄的句子：每張卡的詞句（English 模式翻面唸的字），可以選連例句、連中文 */
export function voiceLinesOf(cards: Card[], opts: VoiceLineOptions): VoiceLine[] {
  const seen = new Set<string>()
  const out: VoiceLine[] = []
  const add = (text: string, lang: ClipLang, kind: VoiceLine['kind'], note: string) => {
    const key = clipKey(text, lang)
    if (!text.trim() || seen.has(key)) return
    seen.add(key)
    out.push({ text: text.trim(), lang, kind, note })
  }

  for (const c of cards) {
    if (isZhCard(c)) {
      // 識字卡：唸字（注音唸同音字）再唸說明，一律中文
      add(zhReading(c), 'zh-TW', 'word', c.meaning)
      continue
    }
    if (isNumberCard(c)) {
      const n = Number(c.word)
      add(enNumber(n), 'en-US', 'word', c.word)
      if (opts.chinese) add(zhNumber(n), 'zh-TW', 'meaning', c.word)
      if (opts.sentences) for (const s of c.sentences) add(s, 'en-US', 'sentence', c.word)
      continue
    }
    const name = speechOf(c)
    const en = name.en || c.word
    add(en, 'en-US', 'word', c.meaning)
    if (opts.sentences) for (const s of c.sentences) add(s, 'en-US', 'sentence', en)
    if (opts.chinese && name.zh) add(name.zh, 'zh-TW', 'meaning', en)
  }
  return out
}

/** 全部字卡、App 說的話裡每一句（含例句、中文）：用檔名去對句子時查（clipKey → 那一句） */
export function lineIndexOf(videos: VideoItem[], childName: string): Map<string, VoiceLine> {
  const map = new Map<string, VoiceLine>()
  const add = (l: VoiceLine) => {
    const k = clipKey(l.text, l.lang)
    if (!map.has(k)) map.set(k, l)
  }
  for (const v of videos) {
    if (v.kind !== 'deck' || !v.cards?.length) continue
    voiceLinesOf(cardsOf(v), { sentences: true, chinese: true }).forEach(add)
  }
  appVoiceLines({ chinese: true, childName }).forEach(add)
  return map
}

/**
 * 音檔的檔名 → 那一句話；對不到回 undefined。檔名就是那句話（`I'm hungry.mp3`、`我餓了.m4a`），
 * 不分大小寫、不管標點，檔名後面的 (1)、(2)（重複下載時系統加的）忽略；有中文字的是中文，不然是英文。
 * 句子太長、檔名被截短（FILE_NAME_MAX）的，改用開頭對，只有一句符合才算。
 */
export function lineOfFileName(index: Map<string, VoiceLine>, fileName: string): VoiceLine | undefined {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '')
  const lang: ClipLang = /\p{Script=Han}/u.test(base) ? 'zh-TW' : 'en-US'
  const key = clipKey(base, lang)
  const hit = index.get(key)
  if (hit) return hit
  if (fileSafeName(base).length < FILE_NAME_MAX) return undefined
  const prefix = [...index.entries()].filter(([k]) => k.startsWith(key))
  return prefix.length === 1 ? prefix[0]![1] : undefined
}

/** App 自己說的話（Your turn!、Great job!……）；有填孩子的小名的話，叫名字那一段也列進來 */
export function appVoiceLines(opts: { chinese: boolean; childName: string }): VoiceLine[] {
  const out: VoiceLine[] = []
  for (const c of appLines()) {
    out.push({ text: c.en, lang: 'en-US', kind: 'app', note: c.zh })
    if (opts.chinese) out.push({ text: c.zh, lang: 'zh-TW', kind: 'app', note: c.en })
  }
  const name = opts.childName.trim()
  if (name) {
    out.unshift({
      text: name,
      lang: /\p{Script=Han}/u.test(name) ? 'zh-TW' : 'en-US',
      kind: 'app',
      note: '孩子的小名（讚美的時候偶爾叫一下）',
    })
  }
  return out
}
