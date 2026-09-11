# 我的學習影片 — 兒童專注觀影 PWA（Vue 3 + Vite 版）

給小朋友看學校教學影片用的網站。**只播放家長指定的影片，看不到 YouTube 的推薦、相關影片與結束畫面。**
影片分三層管理，也可以放學習網站；家長能設定每天看多久、多久休息一次，改錯了還能一步步復原。
可以「加入主畫面」變成 iPad 上的獨立 App。

技術：**Vue 3 + Vite**（純前端 SPA，無 SSR）+ YouTube IFrame Player API + `vite-plugin-pwa`。

> 這是原本 [Nuxt 4 版本](../DarioMovie) 的重寫版，功能完全相同，只是換成不依賴 Nuxt 特有 API 的一般 Vue 寫法，
> 兩個專案是各自獨立的 git repo，互不影響。

---

## 快速開始（本機開發）

```bash
npm install
npm run dev       # 開發，預設 http://localhost:5173
npm run build      # 產出靜態網站到 dist/
npm run preview    # 預覽 build 出來的正式版（PWA 安裝/離線只有這個模式才會生效）
```

## 部署到 GitHub Pages

**不用自己手動建置。** 這個 repo 已經附上 `.github/workflows/deploy.yml`：

1. 把整個資料夾推到 GitHub 上一個新的 repo（`main` 分支）
2. 到 repo 的 **Settings → Pages**，Source 選 **GitHub Actions**
3. 之後每次 `git push` 到 `main`，GitHub Actions 都會自動 `npm run build` 並部署到 GitHub Pages

網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`（如果 repo 剛好叫 `<帳號>.github.io`，網址就是根網域）——
workflow 會自動判斷是哪一種、幫 Vite 帶對 base path，不用手動設定。

---

## 裝到小米電視（打包成 Android App）

網站本身已經支援用電視遙控器操作（方向鍵在片單/播放畫面移動、確定鍵選取、返回鍵回到片單），
不用另外裝 App 才能用——但直接開瀏覽器每次要打網址不方便，可以打包成一個可以側載安裝的 Android APK：

1. 網站照上面「部署到 GitHub Pages」的方式部署好，記下網址（例如 `https://你的帳號.github.io/DarioMovie/`）。
2. 到 [pwabuilder.com](https://www.pwabuilder.com/) 貼上這個網址，讓它掃描確認 PWA 條件都過關。
3. 選 **Android** → 產生 TWA（Trusted Web Activity）套件，下載簽名好的 `.apk`。
   **請把 PWABuilder 產生的簽名金鑰保存好**——以後要更新版本必須用同一把金鑰重新打包，換了金鑰電視會當成完全不同的 App，舊的要先移除。
4. 側載安裝到小米電視，兩種方式擇一：
   - **USB 隨身碟**：把 `.apk` 複製進隨身碟，插上電視，用電視內建的檔案管理員打開安裝（第一次要在電視設定裡開啟「允許安裝未知來源」）。
   - **ADB（免隨身碟）**：電視「設定 → 關於本機」連點版本號開發者選項，開啟「網路除錯」，然後在電腦上 `adb connect <電視IP>:5555 && adb install app.apk`。

**目前沒有另外設定網域驗證（Digital Asset Links）**，所以電視上開啟時螢幕最上方會有一條細細的網址列，
不影響操作，之後想要完全全螢幕，需要一個自己能控制根目錄的網域，把 PWABuilder 產生的 `assetlinks.json` 放到
`https://你的網域/.well-known/assetlinks.json` 下才能拿掉。

**電視版沒有家長設定頁**——遙控器沒辦法做長按、拖曳排序這些操作，所以電視上直接看不到齒輪設定入口。
家長要調整片單，一樣照最上面「改 `public/playlist.txt`」的方式編輯、`git push`，電視下次開啟會自動套用新片單；
手機/電腦的一般瀏覽器開同一個網址，家長設定頁（長按齒輪、PIN、線上加影片等）完全不受影響、照常可用。

---

## 分區、細分與片單

三層結構：**分區 → 細分（冊／單元） → 影片**，外面還可以再包一層可省略的大分類。

### 改 `public/playlist.txt`（推薦，一個檔案管全部裝置）

編輯 [`public/playlist.txt`](public/playlist.txt) —— 用記事本、備忘錄，任何文字編輯器都可以：

```
# 學習 🎓

【Little Kids (上)】🐰

《第 1 課》
https://youtu.be/xxxxxxxxxxx | LK01 1-1 主本
https://youtu.be/yyyyyyyyyyy | LK01 1-2 複習+習作

【每日英文】🔤
site: https://embrs.github.io/learn-en/ | 每日英文・家庭生活

# 娛樂 🎮

【故事影片】📖
https://youtu.be/aaaaaaaaaaa | 三隻小豬
```

| 寫法 | 意思 | 其他可用寫法 |
|---|---|---|
| `# 學習 🎓` | 大分類，可省略（省略時小朋友端不顯示這排） | `〖學習〗` |
| `【Little Kids (上)】🐰` | 分區，emoji 可省略 | `## Little Kids`、`[Little Kids]` |
| `《第 1 課》` | 冊／單元，可省略 | `### 第 1 課`、`-- 第 1 課` |
| `網址 \| 標題` | 影片，標題可省略（會自動抓） | 網址什麼格式都收 |
| `site: 網址 \| 標題` | 網站，會在 App 內開啟 | 也可以寫 `網站:` |
| `// 這行不算` | 註解 | `;` 開頭也可以 |

改完檔案 → `git push` → 每台裝置下次開啟時會自動比對、套用新片單，不用一台一台重新設定。

### 方法二：直接在裝置上的「家長設定」增減

長按齒輪 1.5 秒，輸入 4 位數密碼（預設 `1234`，可在設定頁改），
進去之後可以線上加影片、拖曳排序、新增/刪除分區，改錯還能用「復原」一步步退回去。

---

## 功能一覽

| 功能 | 說明 |
|---|---|
| 無干擾播放 | 自製控制列取代 YouTube 原生介面，看不到推薦影片 |
| 一個檔案管全部裝置 | 改 `playlist.txt` 上傳，每台裝置下次開啟自動更新 |
| 三層分類 | 大分類 → 分區 → 冊／單元，名稱圖示順序都能自訂 |
| 線上加影片 | 直接在裝置上貼 YouTube 網址就能加，不用重新部署 |
| 也能放網站 | 片單裡可以放學習網站，在 App 內開啟，小朋友不會跳出去 |
| 改錯可復原 | 家長設定頁的「復原」可以連按一路退回去（最多 15 步） |
| 亮色／暗色 | 小朋友端一鍵切換，也可以跟隨系統設定 |
| 每日時間上限 | 預設一小時，用完自動停播並鎖住片單，隔天自動重置 |
| 強制休息 | 預設每看 15 分鐘休息 3 分鐘，倒數完才能繼續 |
| 家長門禁 | 長按齒輪 1.5 秒 + 4 位數密碼才進得去設定 |
| PWA | 加到主畫面後全螢幕執行，沒有網址列與分頁 |

## 專案結構

```
src/
  App.vue              主畫面（library / watch / site / parent 四個畫面切換）
  app.config.ts         備援片單（playlist.txt 讀不到時才用）
  components/           VideoLibrary / VideoStage / SiteStage / ParentPanel / PinLock / PanelSection
  composables/           狀態邏輯：片單、觀看時間、主題、家長門禁、拖曳排序…
  utils/                 YouTube 網址解析、playlist.txt 純文字解析器
public/
  playlist.txt           主要片單來源
  icons/                 PWA 圖示
```
