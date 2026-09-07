import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
        // App 本身的殼可以離線使用（YouTube 影片本身無法離線快取）
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
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
  ],
})
