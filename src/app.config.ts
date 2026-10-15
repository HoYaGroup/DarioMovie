/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  備援片單：沒有任何書單（平常不用改這裡）                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 書單（影片、網站、字卡）都放在家長自己的 Google 試算表，專案和 GitHub 上沒有任何書單。
 * 家長設定 →「來源備份」貼上試算表網址，App 就會讀進來（見 utils/sheetSource.ts）。
 *
 * 這裡是「還沒設定試算表、這台裝置上也還沒有書單」時用的起點，所以故意是空的：
 * 小朋友端會顯示「還沒有書單，請爸爸媽媽到家長設定貼上試算表網址」。
 *
 * 要放備援內容的話，照下面的形狀寫（category、sub 用 id 指定；url 貼任何形式的 YouTube 連結）：
 *   categories:    { id: 'story', name: '故事影片', emoji: '📖' }
 *   subCategories: { id: 'unit-1', category: 'story', name: '第一單元' }
 *   videos:        { url: 'https://youtu.be/xxxxxxxxxxx', title: '', category: 'story', sub: 'unit-1' }
 */
export default {
  appTitle: '我的學習影片',

  categories: [] as Array<{ id: string; name: string; emoji: string }>,

  subCategories: [] as Array<{ id: string; category: string; name: string }>,

  videos: [] as Array<{ url: string; title?: string; category?: string; sub?: string }>,
}
