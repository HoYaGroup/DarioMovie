/** 排得進「今日任務」的東西：一本有任務的字卡本 */
export interface Pickable {
  uid: string
  /** 屬於哪一個分區：連續排的幾個盡量來自不同分區 */
  categoryId: string
}

/** 最近一次排出來的是哪一天、哪幾個，輪到哪裡了（存在這台裝置上，見 useMissionPlan） */
export interface PickState {
  /** 哪一天（從 1970 年起算的第幾天） */
  day: number
  /** 那一天排的字卡本 uid：前面 carried 個是從前一天補上的，後面是新輪到的 */
  uids: string[]
  carried: number
  /** 下一個新的要從散開的那一列的第幾個開始數 */
  cursor: number
  /**
   * 每個任務到目前為止新排上首頁幾次（uid → 次數），決定這一次認識字卡本裡的哪一張卡，見 missionSeedOf。
   * 補上昨天的不算新的一次，還是昨天那一張。
   */
  turns: Record<string, number>
}

/**
 * 今天排出來的：學校這週教的（字母進度、家長釘選的）和其他的各自輪、各記各的，
 * 各自有自己的「輪到哪裡」和「排過幾次」，互不干擾。
 */
export interface TodayState {
  school: PickState | null
  main: PickState | null
}

/**
 * 這個任務這一次要認識字卡本裡的哪一張卡（missionCardOf 的 seed）：第一次排上首頁是第 0 張，之後每排一次換下一張。
 * 不用日期算：任務幾天才輪到一次，日期除以張數的餘數會一直落在同幾張（六天輪一次、六張卡的字卡本永遠只認識同一張）。
 * 任務從「其他」變成「學校教的」（家長釘選）也照樣接著數，兩邊的次數加起來。
 */
export function missionSeedOf(state: TodayState | null | undefined, uid: string): number {
  const turns = (state?.school?.turns[uid] ?? 0) + (state?.main?.turns[uid] ?? 0)
  return Math.max(0, turns - 1)
}

/**
 * 把任務排成一列，同一個分區的任務平均散開，不會連在一起。
 *
 * 每個任務依它在自己分區裡的位置算一個 0～1 的比例（十個裡的第三個是 0.25），再照比例排——
 * 分區大的（十個）和小的（一個）都平均分佈在整列裡，連續取幾個就會是不同分區混在一起。
 * 分區裡原本的順序不變（片單排前面的先出現），比例一樣的，先出現的分區在前面。
 */
export function spreadByTopic<T extends Pickable>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const list = groups.get(it.categoryId)
    if (list) list.push(it)
    else groups.set(it.categoryId, [it])
  }
  const keyed: { it: T; at: number; group: number }[] = []
  let group = 0
  for (const list of groups.values()) {
    list.forEach((it, i) => keyed.push({ it, at: (i + 0.5) / list.length, group }))
    group++
  }
  return keyed.sort((a, b) => a.at - b.at || a.group - b.group).map((k) => k.it)
}

/**
 * 今天的任務，回傳要放的字卡本和更新後的狀態（跟 last 一樣就不用再存）：
 *   ‧ 今天已經排過了：照排過的放，不管開幾次、中間做完幾個都是同一批；
 *     家長中途改了個數、或把其中一個標成不排，只補或砍到剛好
 *   ‧ 今天第一次：昨天新輪到的、昨天沒做完的優先補上，最多佔一半的位子（一天只放一個的時候不補，新的優先）；
 *     其餘的從上次輪到的地方往後數新的。每個都輪過一圈才會再輪到，不會有排不到的
 *
 * 補上只補一次：昨天就是補上的，今天做不做完都不再補，不然孩子一直不做，同樣幾個會永遠釘在首頁。
 * 補上的只看「昨天」那一批——隔了一天以上沒開 App 的話，就當作沒有昨天，直接輪新的。
 *
 * @param day 今天是第幾天（從 1970 年起算）
 * @param undoneYesterday 這個任務昨天沒做完嗎
 */
export function pickMissions<T extends Pickable>(
  pool: T[],
  perDay: number,
  day: number,
  last: PickState | null,
  undoneYesterday: (uid: string) => boolean,
): { items: T[]; state: PickState | null } {
  const order = spreadByTopic(pool)
  const n = order.length
  const k = Math.min(Math.max(Math.trunc(perDay), 0), n)
  // 沒有任務可排（片單還沒載入、全部被標成不排）：什麼都不存，等有了再排
  if (!k) return { items: [], state: last }

  const byUid = new Map(order.map((it) => [it.uid, it]))
  const lookup = (uids: string[]) => uids.flatMap((u) => byUid.get(u) ?? [])

  let items: T[]
  let carried: number
  if (last && last.day === day) {
    items = lookup(last.uids).slice(0, k)
    // 排過的一個沒少、個數也沒變：維持原樣
    if (items.length === k && items.length === last.uids.length) return { items, state: last }
    const wasCarried = new Set(last.uids.slice(0, last.carried))
    carried = items.filter((it) => wasCarried.has(it.uid)).length
  } else if (last && last.day === day - 1) {
    const maxCarry = Math.floor(k / 2)
    items = lookup(last.uids.slice(last.carried)).filter((it) => undoneYesterday(it.uid)).slice(0, maxCarry)
    carried = items.length
  } else {
    items = []
    carried = 0
  }

  // 補滿：從上次輪到的地方往後數新的，略過已經有的。
  // 昨天剛排過的先不算（任務很少、數一圈就回到它的時候，不然補上的那個又被當成新的，同一個連著排三天）；
  // 數完一圈還不夠，再把昨天的也算進來
  const kept = items.length
  const from = last ? last.cursor % n : 0
  const yesterday = new Set(last && last.day === day - 1 ? last.uids : [])
  let steps = 0
  for (const skipYesterday of [true, false]) {
    for (let i = 0; i < n && items.length < k; i++) {
      const it = order[(from + i) % n]!
      if (items.includes(it) || (skipYesterday && yesterday.has(it.uid))) continue
      items.push(it)
      steps = Math.max(steps, i + 1)
    }
  }
  // 新補進來的才算新排上首頁一次；今天已經排過的、昨天補上的不算
  const turns = { ...last?.turns }
  for (const it of items.slice(kept)) turns[it.uid] = (turns[it.uid] ?? 0) + 1
  return { items, state: { day, uids: items.map((it) => it.uid), carried, cursor: (from + steps) % n, turns } }
}

/**
 * 今天的任務，學校這週教的優先：
 *   ‧ 學校教的（家長設定的字母進度、家長釘選的）佔一半的位子（一天放幾個，一半進位：4→2、3→2、2→1），
 *     其餘的位子是其他任務，照 pickMissions 輪；一天只放一個的時候，學校教的和其他的隔天輪流
 *   ‧ 學校教的和其他的各自輪、各自補上昨天沒做完的（互不影響）
 *   ‧ 某一邊任務不夠放，位子讓給另一邊：沒有學校教的就全是其他的，其他的不夠就全是學校教的
 * 學校教的排在前面。
 */
export function pickToday<T extends Pickable>(
  pool: T[],
  perDay: number,
  day: number,
  last: TodayState | null,
  undoneYesterday: (uid: string) => boolean,
  isSchool: (it: T) => boolean,
): { items: T[]; state: TodayState | null } {
  const k = Math.min(Math.max(Math.trunc(perDay), 0), pool.length)
  if (!k) return { items: [], state: last }

  const schoolPool = pool.filter(isSchool)
  const restPool = pool.filter((it) => !isSchool(it))
  const want = !schoolPool.length ? 0 : k === 1 ? (day % 2 === 0 ? 1 : 0) : Math.ceil(k / 2)

  const first = pickMissions(schoolPool, Math.min(want, schoolPool.length), day, last?.school ?? null, undoneYesterday)
  const rest = pickMissions(restPool, k - first.items.length, day, last?.main ?? null, undoneYesterday)
  let school = first
  if (first.items.length + rest.items.length < k && schoolPool.length > first.items.length) {
    school = pickMissions(schoolPool, k - rest.items.length, day, first.state, undoneYesterday)
  }

  const unchanged = school.state === (last?.school ?? null) && rest.state === (last?.main ?? null)
  return {
    items: [...school.items, ...rest.items],
    state: unchanged ? last : { school: school.state, main: rest.state },
  }
}
