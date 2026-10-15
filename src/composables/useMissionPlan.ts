import { computed } from 'vue'
import { isAbcDeck } from '~/utils/cards'
import type { PickState, TodayState } from '~/utils/missionPlan'
import { dayNumber } from './useMissions'
import { useState } from './useState'

const STORE_KEY = 'kidtube.missionPlan'
const TODAY_KEY = 'kidtube.missionToday'

/** 首頁「今日任務」一天可以放幾個 */
export const PER_DAY_CHOICES = [1, 2, 3, 4]
export const DEFAULT_PER_DAY = 4

/** 學校可以教到哪個字母：A～Z */
export const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

interface MissionPlan {
  /** 每天放幾個 */
  perDay: number
  /** 家長標了「不要排進來」的任務（字卡本的 uid）；家裡做不到的、孩子還不適合的 */
  skipped: string[]
  /** 學校教到哪個英文字母（'A'～'Z'）；空字串是不限。字母任務只用 A～這個字母的卡，而且優先排進首頁 */
  letter: string
  /** 家長標成「學校這週教的」的任務（字卡本的 uid）：優先排進首頁 */
  pinned: string[]
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function read(): MissionPlan {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const p = raw ? JSON.parse(raw) : null
    return {
      perDay: PER_DAY_CHOICES.includes(p?.perDay) ? p.perDay : DEFAULT_PER_DAY,
      skipped: strings(p?.skipped),
      letter: LETTERS.includes(p?.letter) ? p.letter : '',
      pinned: strings(p?.pinned),
    }
  } catch {
    return { perDay: DEFAULT_PER_DAY, skipped: [], letter: '', pinned: [] }
  }
}

function readPick(p: unknown): PickState | null {
  const s = p as Partial<PickState> | null
  if (!s || !Number.isInteger(s.day) || !Number.isInteger(s.cursor) || !Array.isArray(s.uids)) return null
  return {
    day: s.day!,
    cursor: s.cursor!,
    uids: strings(s.uids),
    carried: Number.isInteger(s.carried) && s.carried! > 0 ? s.carried! : 0,
    turns: Object.fromEntries(
      Object.entries(s.turns && typeof s.turns === 'object' ? s.turns : {}).filter(([, v]) => Number.isInteger(v) && (v as number) > 0),
    ) as Record<string, number>,
  }
}

function readToday(): TodayState | null {
  try {
    const raw = localStorage.getItem(TODAY_KEY)
    const p = raw ? JSON.parse(raw) : null
    if (!p) return null
    // 以前只記一份（還沒分學校教的和其他的）：當成「其他的」
    if ('day' in p) return { school: null, main: readPick(p) }
    return { school: readPick(p.school), main: readPick(p.main) }
  } catch {
    return null
  }
}

/**
 * 家長怎麼安排首頁的「今日任務」：每天放幾個、哪些任務不要排進來、學校這週教什麼。
 * 每天換哪幾個還是自動的，見 utils/missionPlan.ts；今天排了哪幾個、輪到哪裡也記在這裡（today）。
 * 只存在這台裝置上，跟孩子的年紀一樣；用字卡本的 uid 記，片單同步後還對得到。
 */
export function useMissionPlan() {
  const plan = useState<MissionPlan>('missions.plan', read)
  const today = useState<TodayState | null>('missions.today', readToday)
  const skipped = computed(() => new Set(plan.value.skipped))
  const pinned = computed(() => new Set(plan.value.pinned))

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(plan.value)) } catch { /* 略過 */ }
  }

  /** 記下今天排了哪幾個、輪到哪裡 */
  function saveToday(state: TodayState) {
    today.value = state
    try { localStorage.setItem(TODAY_KEY, JSON.stringify(state)) } catch { /* 略過 */ }
  }

  /**
   * 這個任務算不算「學校這週教的」：家長釘選的，或是設了字母進度之後的字母任務。
   * 學校教的優先排進首頁。
   */
  function isSchool(deck: { uid: string; title: string }): boolean {
    return pinned.value.has(deck.uid) || (!!plan.value.letter && isAbcDeck(deck.title))
  }

  function setPerDay(n: number) {
    if (!PER_DAY_CHOICES.includes(n)) return
    plan.value = { ...plan.value, perDay: n }
    save()
  }

  function setLetter(letter: string) {
    plan.value = { ...plan.value, letter: LETTERS.includes(letter) ? letter : '' }
    save()
  }

  function toggleSkip(uid: string) {
    plan.value = {
      ...plan.value,
      skipped: skipped.value.has(uid) ? plan.value.skipped.filter((x) => x !== uid) : [...plan.value.skipped, uid],
    }
    save()
  }

  function togglePin(uid: string) {
    const adding = !pinned.value.has(uid)
    plan.value = {
      ...plan.value,
      pinned: adding ? [...plan.value.pinned, uid] : plan.value.pinned.filter((x) => x !== uid),
    }
    save()
    if (adding) showToday(uid)
  }

  /**
   * 家長剛釘選的任務，今天就排進首頁，不用等輪到：今天已經排好的那一批不會自己改，所以直接插進「學校教的」那一邊，
   * 排在昨天補上的後面、新輪到的前面（最後一個新的讓出位子）。取消釘選不用處理，少了它首頁自己會補別的。
   */
  function showToday(uid: string) {
    const day = dayNumber()
    const t = today.value
    const s = t?.school?.day === day ? t.school : null
    if (s?.uids.includes(uid)) return
    // 今天已經用「其他的」那一邊排上首頁過，次數已經算過了（磚上的卡不要換）
    const countedToday = t?.main?.day === day && t.main.uids.includes(uid)
    const turns = { ...(t?.school?.turns ?? {}) }
    if (!countedToday) turns[uid] = (turns[uid] ?? 0) + 1
    const at = s?.carried ?? 0
    const uids = s ? [...s.uids.slice(0, at), uid, ...s.uids.slice(at)] : [uid]
    saveToday({
      main: t?.main ?? null,
      school: { day, uids, carried: s?.carried ?? 0, cursor: t?.school?.cursor ?? 0, turns },
    })
  }

  /** 把這些任務都排回來（家長按「全部都排進來」） */
  function unskip(uids: string[]) {
    const drop = new Set(uids)
    plan.value = { ...plan.value, skipped: plan.value.skipped.filter((x) => !drop.has(x)) }
    save()
  }

  return { plan, skipped, pinned, today, saveToday, isSchool, setPerDay, setLetter, toggleSkip, togglePin, unskip }
}
