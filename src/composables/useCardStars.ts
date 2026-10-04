import { useState } from './useState'

const STORE_KEY = 'kidtube.cardStars'

function read(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 字卡「考考我」拿到的星星，每一本分開累計。
 * 只存在這台裝置上：星星是給小朋友的鼓勵，不是成績單，不必跨裝置同步。
 */
export function useCardStars() {
  const stars = useState<Record<string, number>>('cards.stars', read)

  function starsOf(deckUid: string): number {
    return stars.value[deckUid] ?? 0
  }

  function addStar(deckUid: string) {
    stars.value = { ...stars.value, [deckUid]: starsOf(deckUid) + 1 }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stars.value)) } catch { /* 略過 */ }
  }

  return { starsOf, addStar }
}
