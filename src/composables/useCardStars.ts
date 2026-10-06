import type { VideoItem } from '~/utils/youtube'
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

  function save(next: Record<string, number>) {
    stars.value = next
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* 略過 */ }
  }

  function starsOf(deckUid: string): number {
    return stars.value[deckUid] ?? 0
  }

  function addStar(deckUid: string) {
    save({ ...stars.value, [deckUid]: starsOf(deckUid) + 1 })
  }

  /**
   * 字卡本的識別碼改成用名稱組成（見 utils/playlist.ts），記在舊識別碼上的星星搬過來。
   * 搬完就把舊的刪掉，之後片單再怎麼改，也不會有別本對到這個舊識別碼、拿走它的星星。
   */
  function adoptLegacy(decks: VideoItem[]) {
    const next = { ...stars.value }
    let moved = false
    for (const deck of decks) {
      const old = deck.legacyUid
      if (!old || old === deck.uid || !(old in next)) continue
      next[deck.uid] = (next[deck.uid] ?? 0) + next[old]!
      delete next[old]
      moved = true
    }
    if (moved) save(next)
  }

  return { starsOf, addStar, adoptLegacy }
}
