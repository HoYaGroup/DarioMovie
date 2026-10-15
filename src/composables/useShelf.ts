import { computed } from 'vue'
import type { Category, Section, VideoItem } from '~/utils/youtube'
import { useLibrary } from './useLibrary'
import { useChildStage } from './useChildStage'

/**
 * 小朋友端有兩個分開的畫面：
 *   ‧ learn（學習）：字卡本——認字、數數、練習、生活任務，首頁就看得到
 *   ‧ fun（娛樂）：YouTube 影片和網站，要家長輸入密碼才進得去
 * 用「類型」自動分，試算表不用多寫任何欄位。
 */
export type ShelfKind = 'learn' | 'fun'

/** 這一項屬於哪個畫面：字卡本是學習，影片和網站是娛樂 */
export function shelfOf(video: VideoItem): ShelfKind {
  return video.kind === 'deck' ? 'learn' : 'fun'
}

/**
 * 某一個畫面要看的片單：只留這個畫面的類型、而且適合孩子這一班的東西。
 * 一個分區裡的東西全都不合，整個分區（甚至整個大分類）也跟著收起來，小朋友不會點進一個空的畫面。
 */
export function useShelf(kind: ShelfKind) {
  const { sections, categories, videos, groupsIn: allGroupsIn } = useLibrary()
  const { isVideoVisible } = useChildStage()

  const shown = (v: VideoItem) => shelfOf(v) === kind && isVideoVisible(v)

  const countByCategory = computed(() => {
    const out = new Map<string, number>()
    for (const v of videos.value) {
      if (shown(v)) out.set(v.categoryId, (out.get(v.categoryId) ?? 0) + 1)
    }
    return out
  })

  function countIn(categoryId: string): number {
    return countByCategory.value.get(categoryId) ?? 0
  }

  function categoriesIn(sectionId: string): Category[] {
    return categories.value.filter((c) => c.sectionId === sectionId && countIn(c.id) > 0)
  }

  /** 至少有一個看得到的分區的大分類 */
  const visibleSections = computed<Section[]>(() =>
    sections.value.filter((sec) => categoriesIn(sec.id).length > 0),
  )

  function countInSection(sectionId: string): number {
    return categoriesIn(sectionId).reduce((n, c) => n + countIn(c.id), 0)
  }

  /** 分區底下的分組，只留看得到的東西；整組都看不到的單元不出現 */
  function groupsIn(categoryId: string) {
    return allGroupsIn(categoryId)
      .map((g) => ({ ...g, videos: g.videos.filter(shown) }))
      .filter((g) => g.videos.length > 0)
  }

  const total = computed(() => visibleSections.value.reduce((n, s) => n + countInSection(s.id), 0))

  return { sections: visibleSections, categoriesIn, countIn, countInSection, groupsIn, total }
}
