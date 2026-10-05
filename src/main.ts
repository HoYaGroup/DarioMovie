import { createApp } from 'vue'
import './assets/css/main.css'
import App from './App.vue'
import { keepOfflineData } from './composables/useOffline'

createApp(App).mount('#app')
// 出門沒網路也要能用：請瀏覽器不要在空間不夠時清掉字卡圖片
keepOfflineData()
