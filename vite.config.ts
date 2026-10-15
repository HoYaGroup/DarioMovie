import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * 你電腦上的 public/cards/books/（有版權的書頁圖片，不進 git）還在，npm run dev 看得到；部署出去的網站沒有。
 * npm run dev:like-deploy 讓這個資料夾回 404，跟部署之後一樣，用來看「還沒匯入素材包」的樣子。
 */
function hideIgnoredMedia(): Plugin {
  return {
    name: 'hide-ignored-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').includes('/cards/books/')) {
          res.statusCode = 404
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // 部署到 GitHub Pages 子路徑（<帳號>.github.io/<repo>/）時，
  // 由 .github/workflows/deploy.yml 帶入 VITE_BASE_PATH；本機開發用根路徑
  base: process.env.VITE_BASE_PATH || '/',

  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: '我的學習影片',
        short_name: '學習影片',
        description: '只播放家長指定的學校教學影片，沒有推薦、沒有廣告干擾',
        lang: 'zh-Hant',
        theme_color: '#14122e',
        background_color: '#14122e',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        // 安裝時只下載 App 本身的殼。public/cards/ 的字卡圖片全部加起來約 6MB（大部分是「我的書」的書頁和裁好的圖），
        // 四個班全下載太多，所以不放進預先下載：由 src/composables/useStageImages.ts 照孩子的年紀補存。
        // YouTube 影片本身無法離線快取
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,jpg,jpeg,webp,gif,avif}'],
        globIgnores: ['cards/**'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // public/cards/ 的字卡圖片：存起來之後沒網路也看得到。已經存的先用，順便在背景看有沒有改版
            // （不能用 CacheFirst：圖換了內容但檔名沒變，會一直看到舊的）。不設數量上限，孩子換班要用的都要留著
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/cards\//.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'card-images-local',
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 片單裡直接寫網址的字卡圖片（不是放在 public/cards/ 的）：看過一次就存起來
            urlPattern: /^https:\/\/(?!i\.ytimg\.com\/).+\.(?:jpe?g|png|webp|gif|avif)(?:\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'card-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 影片縮圖快取起來，清單頁第二次開啟就不用重新下載
            urlPattern: /^https:\/\/i\.ytimg\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'yt-thumbnails',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      // 開發時不要啟用 SW：改動會被舊快取蓋掉，要驗證安裝流程請用 npm run build + preview
      devOptions: { enabled: false, type: 'module' },
    }),
    ...(mode === 'like-deploy' ? [hideIgnoredMedia()] : []),
  ],
}))
