import { useState } from './useState'

const STORE_KEY = 'kidtube.missions'

/**
 * 一本字卡的生活任務完成過幾次、最近一次是哪一天（當地日期 YYYY-MM-DD）。
 * prev 是再前一次完成的日子：今天又做了一次，還看得出昨天有沒有做（首頁決定要不要補上昨天沒做完的）
 */
interface Entry { count: number; last: string; prev?: string }

function read(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 當地今天的日期，跨日（半夜 12 點）就換一個 */
export function todayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** 當地昨天的日期 */
export function yesterdayKey(date = new Date()): string {
  const d = new Date(date)
  d.setDate(d.getDate() - 1)
  return todayKey(d)
}

/** 從 1970 年 1 月 1 日起算的第幾天（當地日期），首頁「今日任務」每天輪到不同的幾個 */
export function dayNumber(date = new Date()): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000)
}

/**
 * 生活任務的完成紀錄，每一本字卡分開記（跟星星一樣用字卡本的 uid）。
 * 只存在這台裝置上：這是給小朋友的貼紙，不是成績單，不必跨裝置同步。
 */
export function useMissions() {
  const done = useState<Record<string, Entry>>('missions.done', read)

  function countOf(deckUid: string): number {
    return done.value[deckUid]?.count ?? 0
  }

  /** 那一天（YYYY-MM-DD）完成過嗎 */
  function doneOn(deckUid: string, day: string): boolean {
    const e = done.value[deckUid]
    return !!e && (e.last === day || e.prev === day)
  }

  /** 今天已經完成過了嗎：首頁的任務磚打勾用 */
  function doneToday(deckUid: string): boolean {
    return done.value[deckUid]?.last === todayKey()
  }

  /** 完成一次任務，貼一張貼紙 */
  function complete(deckUid: string) {
    const today = todayKey()
    const cur = done.value[deckUid]
    // 今天做第二次以後，prev 維持原本那個（今天以前最近一次）
    const prev = cur && cur.last !== today ? cur.last : cur?.prev
    const next = { ...done.value, [deckUid]: { count: countOf(deckUid) + 1, last: today, ...(prev ? { prev } : {}) } }
    done.value = next
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* 略過 */ }
  }

  return { countOf, doneOn, doneToday, complete }
}
