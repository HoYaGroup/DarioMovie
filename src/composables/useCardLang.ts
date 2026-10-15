import { useState } from './useState'

const STORE_KEY = 'kidtube.cardLang'

/**
 * 字卡的語言：
 *   en  全英文（預設）：Apple. Yum, delicious apple! —— 卡片、語音、按鈕都不出現中文
 *   zh  全中文：蘋果。—— 卡片、語音都不出現英文
 *   mix 中英對照：蘋果。Apple. Yum, delicious apple!
 */
export type CardLang = 'zh' | 'mix' | 'en'

function read(): CardLang {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    return saved === 'zh' || saved === 'mix' ? saved : 'en'
  } catch {
    return 'en'
  }
}

/** 記在這台裝置上，每一本字卡都照這個設定；小朋友在字卡畫面上方就能切換 */
export function useCardLang() {
  const lang = useState<CardLang>('cards.lang', read)

  function setLang(next: CardLang) {
    lang.value = next
    try { localStorage.setItem(STORE_KEY, next) } catch { /* 略過 */ }
  }

  return { lang, setLang }
}
