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
家長要調整片單，一樣照下面「片單放在 `playlists/`」的方式改（或用 GitHub Actions 的「新增影片」），電視下次開啟會自動套用新片單；
手機/電腦的一般瀏覽器開同一個網址，家長設定頁（長按齒輪、PIN、線上加影片等）完全不受影響、照常可用。

---

## 分區、細分與片單

三層結構：**分區 → 細分（冊／單元） → 影片**，外面還可以再包一層可省略的大分類。

### 片單放在 `playlists/`（推薦，一個地方管全部裝置）

| 檔案 | 內容 |
|---|---|
| [`playlists/videos.txt`](playlists/videos.txt) | **家長自己的影片**（學習、娛樂……），加影片改這個 |
| [`playlists/library.txt`](playlists/library.txt) | 學習庫：數字、英文單字的字卡和相關兒歌 |

`npm run dev`／`npm run build` 之前會自動把兩個檔合併成 App 讀的 `public/playlist.txt`
（學習庫在前面）。`public/playlist.txt` 是產生出來的，不要直接改它。

#### 用 GitHub Actions 新增影片（不用電腦、手機也可以）

1. 打開 repo 的 **Actions** 頁面 → 左邊選 **新增影片** → 右邊按 **Run workflow**
   （手機用 GitHub App：repo → Actions → 新增影片 → Run workflow）
2. 貼 **YouTube 網址**，從下拉選單選**要放在哪個分區**（學習 › Little Kids (上)、娛樂 › 英文故事、
   數字 › 影片……），單元、標題可以不填（標題會自動抓 YouTube 的片名）
3. 按 **Run workflow**。它會把影片加進 `playlists/videos.txt`、commit，接著自動重新部署，
   一兩分鐘後每台裝置下次打開 App 就會看到

選單最後一項是「新的分區」：選它，再在下面兩格填大分類和分區名稱，就會自動建立。
單元填不存在的名字也會自動建立。影片網址看不懂、影片不存在或不允許嵌入播放、
同一個地方已經有這支，都會擋下來並在執行結果裡說明原因。

**分區選單怎麼更新**：GitHub 的下拉選單只能寫死在 workflow 檔裡，而且 Action 不能改自己的 workflow 檔，
所以選單由 `scripts/sync-video-form.mjs` 在電腦上更新——`npm run dev` 之前會自動跑，也可以手動
`npm run sync-form`，跑完把 `.github/workflows/add-video.yml` 一起 commit。
用「新的分區」建立的分區，在下次同步之前不會出現在選單裡，這段時間再選「新的分區」、填同一個名字就好，
會加進已經存在的那個分區，不會重複建立。部署時如果發現選單跟片單不一致，執行結果會跳出提醒。

> 以前把片單放在 `PLAYLIST` secret 的做法已經不用了（secret 讀不回來，沒辦法用 Actions 加影片），
> 片單已經搬到 `playlists/videos.txt`，那個 secret 可以到 Settings → Secrets 刪掉。

#### 直接編輯

在 GitHub 網頁上打開 `playlists/videos.txt` 按鉛筆圖示編輯，存檔（commit）後會自動部署。寫法：

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
| `卡: cat \| 貓 \| 🐱` | 字卡，同一個單元的卡集成一本（見下面「字卡」） | 也可以寫 `字卡:`、`card:` |
| `數字卡: 0～100 \| 中文` | 一行產生一串數字卡（零～一百），也可以寫 `英文` | 也可以寫 `numbers:` |
| `字卡本: 數字像什麼` | 開一本新的字卡，不另外分一層；同一區的好幾本直接排在同一個畫面 | 也可以寫 `deck:` |
| `// 這行不算` | 註解 | `;` 開頭也可以 |

改完檔案 → `git push` → 每台裝置下次開啟時會自動比對、套用新片單，不用一台一台重新設定。

### 字卡：把學過的數字、單字做成一本卡片

在片單裡寫 `卡:` 開頭的行，同一個單元（《》）裡的卡會集成一本字卡，跟影片排在一起：

```
【認數字】🔢

《English 1～10》
卡: 1 | one | 🍎
卡: 3 | three | 🚗 | https://youtu.be/xxxxxxxxxxx 0:35-0:42
https://youtu.be/yyyyyyyyyyy | 數數歌

【英文單字】🔤

《動物 ABC》
卡: cat | 貓 | 🐱
卡: dog | 狗 | cards/dog.jpg
```

第一欄是卡片上最大的字，後面的欄位**看內容自動判斷**，順序寫錯、少寫都沒關係：

| 欄位 | 怎麼判斷 | 例子 |
|---|---|---|
| 說明 | 不是圖、不是影片的就是說明，英文中文可以寫在一起 | `three`、`貓`、`鉛筆1` |
| 圖 | emoji，或圖片網址、`public/` 底下的圖片路徑；寫兩張的話，第一張是正面、第二張是背面 | `🐱`、`cards/dog.jpg` |
| 影片片段 | 有 `youtu` 字樣，後面可以接「開始-結束」 | `https://youtu.be/xxx 0:35-0:42` |

小朋友端有兩種玩法：

- **看卡片**：正面只有圖，先猜再點一下翻面；翻面時把答案唸出來。
  數字卡（1～20）有放 emoji 的話，正面會畫出那麼多個東西，小朋友一個一個點著數，數完自動翻面；
  超過 10 的前 10 個排成兩排，看得出 13 是 10 再加 3。
  數字卡沒放 emoji，正面就直接顯示數字，讓小朋友認數字的樣子（`卡: 13 | 十三`）；
  說明只是中文唸法（十三）的，畫面上只顯示數字，「十三」翻面時唸出來。
  有影片片段的卡多一顆「看影片」，只播老師教這個字的那幾秒，播完自動關掉。
- **考考我**：唸一個字，從三張卡裡點出對的。一次答對拿一顆星（星星記在這台裝置上）；
  答錯的字會在這一輪最後再考一次。
  數字卡有自己的圖的話（例如下面的數字形狀卡），會改成「看圖選數字」，題目不唸出來，答對才唸口訣。
  題目只唸單字本身（cat、七），不唸口訣、不給提示，讓小朋友自己認；答對之後才把口訣唸一遍當複習。
  答對說「Yes!」，點錯說「No!」，小朋友一聽就知道對不對。點錯之後告訴他點的是什麼，再把題目唸一次，
  那張圖也貼上名字。「Yes／No／This is／Listen again」固定講英文，順便練聽力；卡片內容照這本的語言：
  英文卡「No! This is a horse. Listen again. …… Frog.」，中文卡「No! This is 大肚6. Listen again. …… 八.」
  「Listen again.」後面會停將近一秒，題目才不會跟前一句黏在一起；答對的口訣唸完才換下一題。
  點錯的那張會貼上「🔊 horse 馬」，再點一次只唸它的名字（This is a horse.），不再說 No、不再扣分，
  小朋友可以自己比較；想再聽題目就按上面的 🔊。
  英文的「This is」會自動分 a／an（an apple、a unicorn），複數說 These are（glasses）；
  數字和顏色不加 a——顏色卡的說明寫成「紅色」這種「…色」結尾，就會說 This is red。
  數字形狀卡兩種題目混著出：看圖選數字，以及聽數字（「七」）從形狀圖裡找出拐杖。

**一次產生一串數字卡**：`數字卡: 0～100 | 中文` 會產生 0 零、31 三十一……100 一百；
寫 `英文` 就是 zero、thirty-one、one hundred。最多到 999（101 一百零一、200 兩百、125 one hundred twenty-five）。
數字題的考考我會挑容易搞混的數字當選項：31 配 13（左右顛倒）或 30、41（差一點點）。

**說明寫哪種語言就唸哪種**：只寫中文（`鉛筆1`）就只唸中文「鉛筆一」，只寫英文（`three`）就只唸英文，
兩種都寫（`three 三`）才兩種都唸。一本卡固定一種語言，小朋友比較不會搞混——
所以數字分成中文版（數字像什麼）和英文版（English 1～10）兩本，不要混在同一本。

**ABC 字母卡**：單元名稱裡有 `ABC`（半形、全形都可以），這本就會變成字母卡：

- 自動照 A～Z 排好，同一個字母可以放好幾張；新加的卡寫在哪裡都行，會自己排到對的字母去
- 卡片左上角標出開頭字母（`Pp`），背面把單字的開頭字母上色
- 照口訣唸：「P、P、puh、puh、panda」，再接中文「熊貓」，全部用英文語音唸
- 上面多一排 A～Z，點字母直接跳過去；沒有卡的字母會淡掉

```
《動物 ABC》
卡: ant | 螞蟻 | 🐜
卡: alligator | 鱷魚 | 🐊
卡: bear | 熊 | 🐻
```

**口訣**

- 數字：說明寫成「1、1、鉛筆1」的格式（開頭兩次要跟卡片上的字一樣），翻面和考考我答對之後就照口訣唸；
  畫面上和點錯時只寫、只說後半「鉛筆1」
- 字母：每個字母開頭的音用 KK 音標記在 `src/utils/cards.ts` 的 `LETTER_SOUNDS`（A /æ/、B /b/、C /k/……）。
  瀏覽器的語音不能直接唸音標，所以會換成英文語音唸得出來的拼法（/p/ → puh），每個拼法都實測過不會被拆成字母拼。
  /æ/（apple）、/ɪ/（it）找不到唸得準的拼法，A、I 的口訣就只唸字母兩次；X 開頭的音跟字母唸法一樣，也只唸字母。
- 單字開頭的音跟字母平常的音不一樣時（例如 unicorn 唸 /ju/），在說明前面用 KK 音標指定：

```
卡: unicorn | /ju/ 獨角獸 | 🦄
```

**數字形狀卡**（鉛筆1、鴨子2……）放在 `public/cards/shapes/`，每個數字兩張圖：
`3-q.webp` 是正面（只有形狀，數字用「?」貼紙蓋住），`3.webp` 是背面（完整的卡）：

```
《數字像什麼》
卡: 3 | 3、3、蝴蝶3 | cards/shapes/3-q.webp | cards/shapes/3.webp
```

唸單字用的是瀏覽器內建語音，不用錄音檔。電視上如果沒有語音，考考我會改成把題目寫出來。
自己拍的照片放進 `public/cards/`，片單裡寫 `cards/檔名.jpg` 就好——不過網站是公開的，
**不要放課本掃描圖，也不要放拍得到小朋友的照片**。

### 方法二：直接在裝置上的「家長設定」增減

長按齒輪 1.5 秒，輸入 4 位數密碼（預設 `1234`，可在設定頁改），
進去之後可以線上加影片、拖曳排序、新增/刪除分區，改錯還能用「復原」一步步退回去。

---

## 功能一覽

| 功能 | 說明 |
|---|---|
| 無干擾播放 | 自製控制列取代 YouTube 原生介面，看不到推薦影片 |
| 一個地方管全部裝置 | 改 `playlists/` 或用 Actions「新增影片」，每台裝置下次開啟自動更新 |
| 三層分類 | 大分類 → 分區 → 冊／單元，名稱圖示順序都能自訂 |
| 線上加影片 | 直接在裝置上貼 YouTube 網址就能加，不用重新部署 |
| 也能放網站 | 片單裡可以放學習網站，在 App 內開啟，小朋友不會跳出去 |
| 字卡 | 把學過的數字、單字做成卡片：翻卡、點著數、聽發音、看影片片段、考考我集星星 |
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
  components/           VideoLibrary / VideoStage / SiteStage / CardDeck / ParentPanel / PinLock / PanelSection
  composables/           狀態邏輯：片單、觀看時間、主題、家長門禁、拖曳排序…
  utils/                 YouTube 網址解析、playlist.txt 純文字解析器、字卡、語音
playlists/
  library.txt            學習庫：數字、英文單字的字卡和兒歌
  videos.txt             家長自己的影片（Actions「新增影片」寫進這裡）
scripts/
  build-playlist.mjs     把 playlists/ 合併成 public/playlist.txt
  add-video.mjs          「新增影片」Action 用的腳本
public/
  playlist.txt           App 讀的片單（自動產生，不進 repo）
  cards/                 字卡用的圖片
  icons/                 PWA 圖示
```
