import { computed } from 'vue'
import type { Category, Section, VideoItem } from '~/utils/youtube'
import { STAGES, stageOf, type StageId, type StageResult } from '~/utils/stage'
import { useLibrary } from './useLibrary'
import { useState } from './useState'

const STORE_KEY = 'kidtube.child'

/** 家長設定的孩子資料：用來決定小朋友端顯示哪些階段的教材 */
export interface ChildProfile {
  /** 出生年（西元）；null 表示還沒設定，四個階段都顯示 */
  birthYear: number | null
  /** 出生月份 1～12，9～12 月出生的算下一屆（9/1 是入學分界） */
  birthMonth: number
  /** 除了孩子這一班，家長另外開放的階段 */
  extraStages: StageId[]
}

const DEFAULTS: ChildProfile = { birthYear: null, birthMonth: 1, extraStages: [] }

function read(): ChildProfile {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw)
    const year = Number(p.birthYear)
    const month = Number(p.birthMonth)
    return {
      birthYear: Number.isInteger(year) && year > 1990 && year < 2100 ? year : null,
      birthMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1,
      extraStages: Array.isArray(p.extraStages)
        ? STAGES.map((s) => s.id).filter((id) => p.extraStages.includes(id))
        : [],
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * 孩子現在幾班，小朋友端只顯示適合這一班的教材。
 *
 * 每一本字卡、每支影片在片單裡可以標「階段: 小班～中班」（見 utils/playlist.ts）：
 *   ‧ 標了的：適合的班有一個是開放的才顯示（孩子這一班，加上家長另外開放的）
 *   ‧ 沒標的（自己加的影片、娛樂）：一直顯示
 * 還沒設定出生年度時，四個階段都開放，等於不篩選。
 * 數字、英文單字這些主題原本怎麼分就怎麼分，只是年紀不合的字卡本和影片不出現；
 * 一個分區裡的東西全都不合，整個分區（甚至整個大分類）也跟著收起來。
 */
export function useChildStage() {
  const profile = useState<ChildProfile>('child.profile', () => ({ ...DEFAULTS }))
  const isReady = useState<boolean>('child.ready', () => false)
  const { sections, categories, subCategories, videos, groupsIn } = useLibrary()

  function init() {
    if (isReady.value) return
    profile.value = read()
    isReady.value = true
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(profile.value)) } catch { /* 略過 */ }
  }

  /** 孩子這一班；還沒設定出生年度就是 null */
  const current = computed<StageResult | null>(() =>
    profile.value.birthYear === null ? null : stageOf(profile.value.birthYear, profile.value.birthMonth),
  )

  /** 現在開放哪些階段 */
  const openStages = computed<Set<StageId>>(() => {
    const open = new Set<StageId>(profile.value.extraStages)
    if (current.value) open.add(current.value.stage)
    else STAGES.forEach((s) => open.add(s.id))
    return open
  })

  function setBirth(year: number | null, month = profile.value.birthMonth) {
    profile.value = { ...profile.value, birthYear: year, birthMonth: month }
    save()
  }

  function toggleStage(id: StageId) {
    // 孩子自己這一班一直開著，不能關
    if (current.value?.stage === id) return
    const has = profile.value.extraStages.includes(id)
    profile.value = {
      ...profile.value,
      extraStages: has ? profile.value.extraStages.filter((x) => x !== id) : [...profile.value.extraStages, id],
    }
    save()
  }

  /* ---------- 小朋友端要看的片單 ---------- */

  const sectionById = computed(() => new Map(sections.value.map((s) => [s.id, s])))
  const categoryById = computed(() => new Map(categories.value.map((c) => [c.id, c])))
  const subById = computed(() => new Map(subCategories.value.map((s) => [s.id, s])))

  /** 這一項適合哪幾班：自己有寫就用自己的，沒有就一層層往上找；全都沒寫回 undefined（不分年齡） */
  function stagesOf(v: VideoItem): StageId[] | undefined {
    if (v.stages) return v.stages
    const sub = v.subId ? subById.value.get(v.subId) : undefined
    if (sub?.stages) return sub.stages
    const cat = categoryById.value.get(v.categoryId)
    if (cat?.stages) return cat.stages
    return cat ? sectionById.value.get(cat.sectionId)?.stages : undefined
  }

  const visibleUids = computed(() => {
    const open = openStages.value
    const out = new Set<string>()
    for (const v of videos.value) {
      const st = stagesOf(v)
      if (!st || st.some((s) => open.has(s))) out.add(v.uid)
    }
    return out
  })

  /** 這支影片（字卡本）現在看得到嗎 */
  function isVideoVisible(video: VideoItem): boolean {
    return visibleUids.value.has(video.uid)
  }

  /**
   * 分區看不看得到：裡面有看得到的東西，或是本來就空的（家長剛建好、還沒放東西）。
   * 裡面的東西全都因為年紀不合被收起來的，分區也收起來，小朋友不會點進一個空的畫面。
   */
  const visibleCategoryIds = computed(() => {
    const total = new Map<string, number>()
    const shown = new Map<string, number>()
    for (const v of videos.value) {
      total.set(v.categoryId, (total.get(v.categoryId) ?? 0) + 1)
      if (visibleUids.value.has(v.uid)) shown.set(v.categoryId, (shown.get(v.categoryId) ?? 0) + 1)
    }
    return new Set(categories.value.filter((c) => !total.get(c.id) || shown.get(c.id)).map((c) => c.id))
  })

  function visibleCategoriesIn(sectionId: string): Category[] {
    return categories.value.filter((c) => c.sectionId === sectionId && visibleCategoryIds.value.has(c.id))
  }

  /** 至少有一個看得到的分區的大分類 */
  const visibleSections = computed<Section[]>(() =>
    sections.value.filter((sec) => visibleCategoriesIn(sec.id).length > 0),
  )

  function visibleCountIn(categoryId: string): number {
    return videos.value.filter((v) => v.categoryId === categoryId && visibleUids.value.has(v.uid)).length
  }

  function visibleCountInSection(sectionId: string): number {
    return visibleCategoriesIn(sectionId).reduce((n, c) => n + visibleCountIn(c.id), 0)
  }

  /** 分區底下的分組，只留看得到的東西；整組都看不到的單元不出現 */
  function visibleGroupsIn(categoryId: string) {
    return groupsIn(categoryId)
      .map((g) => ({ ...g, videos: g.videos.filter(isVideoVisible) }))
      .filter((g) => g.videos.length > 0)
  }

  return {
    profile, current, openStages, init,
    setBirth, toggleStage,
    isVideoVisible,
    visibleSections, visibleCategoriesIn, visibleCountIn, visibleCountInSection, visibleGroupsIn,
  }
}
