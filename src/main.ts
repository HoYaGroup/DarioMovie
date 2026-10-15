import { createApp } from 'vue'
import './assets/css/main.css'
import App from './App.vue'
import { keepOfflineData } from './composables/useOffline'
import { loadPhotos } from './utils/photos'
import { loadMedia } from './utils/media'
import { loadQuestionTexts } from './utils/questions'
import { adoptSheetFromUrl } from './composables/useSheetSource'

// 網址帶了 ?sheet=試算表連結的話先存起來（要在畫面開始讀書單之前）
adoptSheetFromUrl()
// 試算表「問句」工作表改過的問句：先用上次記下來的（試算表讀完會再換成最新的）
loadQuestionTexts()
createApp(App).mount('#app')
// 爸媽幫字卡拍的照片：讀進記憶體，字卡才換得上去（讀不到就用預設圖）
loadPhotos().catch(() => {})
// 素材包（書頁圖片、叫聲）：讀進記憶體，cards/ 的圖和聲音才換得上去（沒匯入過就什麼都沒有）
loadMedia().catch(() => {})
// 圖片載入失敗（例如素材包還沒匯入、書頁圖片不在網站上）：不要顯示破圖的小圖示，圖載入成功了再顯示
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.src.includes('/cards/')) e.target.classList.add('img-missing')
}, true)
document.addEventListener('load', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.remove('img-missing')
}, true)
// 家長設了雲端資料夾（網址＋金鑰）的話，開 App 時在背景把資料夾裡的照片同步下來；沒設就什麼都不做
// 出門沒網路也要能用：請瀏覽器不要在空間不夠時清掉字卡圖片
keepOfflineData()
