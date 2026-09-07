/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  備援片單（平常不用改這裡）                                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 要改片單請改 public/playlist.txt —— 那個檔案才是主要來源，
 * 而且改完所有 iPad 都會自動更新。
 * 這裡只有在 playlist.txt 讀不到（檔案不存在、或第一次開啟時剛好沒網路）
 * 才會用到。
 *
 * 三層結構：分區 → 細分 → 影片
 *   分區（categories）  例如「學校教學」「故事影片」，小朋友端是上方的標籤
 *   細分（subCategories）例如「Little Kids (上)」「第一單元」，是影片上方的小標題
 *   影片（videos）      用 category 指定分區、sub 指定細分
 *
 * ‧ sub 可以省略，影片就直接掛在分區底下、不帶小標題
 * ‧ url 可以貼任何形式的 YouTube 連結（watch / youtu.be / shorts / embed）
 * ‧ title 留空的話，App 會自動去 YouTube 抓正式片名回來
 * ‧ 改完存檔後重新部署即可；也可以直接在 iPad 上進「家長設定」增減
 */
export default {
  appTitle: '我的學習影片',

  categories: [
    { id: 'school', name: '學校教學', emoji: '🏫' },
    { id: 'story', name: '故事影片', emoji: '📖' },
    { id: 'other', name: '其他', emoji: '⭐' },
  ] as Array<{ id: string; name: string; emoji: string }>,

  subCategories: [
    { id: 'little-kids-1', category: 'school', name: 'Little Kids (上)' },
  ] as Array<{ id: string; category: string; name: string }>,

  videos: [
    {
      url: 'https://www.youtube.com/watch?v=bOx1NrfSjts',
      title: '',
      category: 'school',
      sub: 'little-kids-1',
    },
  ] as Array<{ url: string; title?: string; category?: string; sub?: string }>,
}
