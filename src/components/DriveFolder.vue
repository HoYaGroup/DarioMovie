<script setup lang="ts">
import { computed, ref } from 'vue'
import { cleanFolderUrl, readFolderUrl, saveFolderUrl } from '~/utils/photoFiles'
import { cleanApiKey, folderIdOf, forgetSynced, readApiKey, saveApiKey } from '~/utils/driveSync'
import { useDriveSync } from '~/composables/useDriveSync'

/**
 * 家長設定「圖片和聲音」的「雲端硬碟資料夾同步」（進階，選填）：填好資料夾網址和自己的 Google API 金鑰，按「立即同步」就把
 * 資料夾裡的素材（子資料夾裡的圖片、聲音）、照片（最上層，檔名＝卡上的字）和錄音（最上層的音檔，檔名＝那句話）抓下來。
 * 只有按了才會下載。同步本身在 utils/driveSync.ts。
 */
const { syncing, report: syncReport, last: syncLast, error: syncError, progress, sync } = useDriveSync()

/* ---------- 資料夾網址（只存在這台，不進備份、不進 GitHub） ---------- */

const folderInput = ref(readFolderUrl())
const folderUrl = ref(readFolderUrl())
const folderMsg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)

function onSaveFolder() {
  const url = cleanFolderUrl(folderInput.value)
  if (url === null) {
    folderMsg.value = { text: '網址要是 https:// 開頭的。', kind: 'err' }
    return
  }
  // 換了一個資料夾：上一個資料夾的檔案記錄不能再用
  if (url !== folderUrl.value) forgetSynced()
  saveFolderUrl(url)
  folderUrl.value = url
  folderInput.value = url
  folderMsg.value = url
    ? { text: folderIdOf(url) ? '已記住，只存在這台裝置。' : '已記住，但看不出資料夾 id，要同步的話請貼 …/drive/folders/… 那串網址。', kind: folderIdOf(url) ? 'ok' : 'err' }
    : { text: '已清除。', kind: 'ok' }
}

/* ---------- Google API 金鑰（只存在這台，不進備份） ---------- */

const keyInput = ref(readApiKey())
const hasKey = ref(!!readApiKey())
const keyMsg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)
const origin = location.origin

function onSaveKey() {
  const key = cleanApiKey(keyInput.value)
  if (key === null) {
    keyMsg.value = { text: '金鑰看起來不對：要是一長串英文字母和數字（AIza 開頭），中間不能有空白。', kind: 'err' }
    return
  }
  saveApiKey(key)
  hasKey.value = !!key
  keyInput.value = key
  keyMsg.value = { text: key ? '已記住，只存在這台裝置，不會進備份。' : '已清除。', kind: 'ok' }
}

/* ---------- 同步 ---------- */

const canSync = computed(() => hasKey.value && !!folderIdOf(folderUrl.value))
const when = (at: number) => new Date(at).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

const lastText = computed(() => {
  const l = syncLast.value
  if (!l) return '還沒同步過'
  if (l.error) return `${when(l.at)} 失敗：${l.error}`
  const did: string[] = []
  if (l.media) did.push(`下載了 ${l.media} 個素材`)
  if (l.saved) did.push(`換了 ${l.saved} 張照片`)
  if (l.clips) did.push(`收到 ${l.clips} 句錄音`)
  if (l.removed) did.push(`刪掉 ${l.removed} 個雲端硬碟上已經沒有的素材`)
  const same = (l.mediaUnchanged ?? 0) + l.unchanged
  return `${when(l.at)}・${did.length ? did.join('、') : '沒有新的'}${same ? `（${same} 個早就是最新的）` : ''}`
})

const buttonText = computed(() => {
  if (!syncing.value) return '🔄 立即同步'
  return progress.value.total ? `同步中 ${progress.value.done}/${progress.value.total}` : '同步中…'
})

const SHOWN = 12
const names = (list: string[]) => (list.length > SHOWN ? `${list.slice(0, SHOWN).join('、')}…等 ${list.length} 個` : list.join('、'))
</script>

<template>
  <div class="drive">
    <p class="hint">
      把素材放在雲端硬碟的資料夾裡，<b>要用的時候在這台按「立即同步」，才會把有變的檔案下載下來</b>（不會自己偷偷跑），
      不用重做 zip、不用重新匯入。抓下來之後<b>沒有網路也能用</b>；雲端硬碟上刪掉的素材，這台也會跟著刪。
    </p>
    <p class="hint">資料夾裡放三種東西：</p>
    <ul class="what">
      <li>
        <b>子資料夾裡的圖片和聲音</b>：結構跟素材包一樣，路徑就是試算表「圖」「背面圖」「聲音」欄寫的
        （<code>cards/books/animals/pets.webp</code>）。有素材包 zip 的話，解壓縮後把整個 <code>cards</code> 資料夾丟進去就好
      </li>
      <li><b>最上層的照片</b>：檔名就是卡上的字（<code>apple.jpg</code>），會換掉所有字是 apple 的卡（見下面「換成家裡的照片」）</li>
      <li>
        <b>最上層的音檔</b>：檔名就是那句話（<code>I'm hungry.m4a</code>、<code>我餓了.m4a</code>），變成爸媽的錄音。
        在「小朋友 › 用自己的聲音錄音」按「📤 全部存到共用資料夾」就會做好這些檔案；錄音只會加進來，不會因為資料夾裡沒有就被刪
      </li>
    </ul>
    <p class="hint">
      只讀資料夾，不會上傳、不會改、不會刪。資料夾要設成「知道連結的人都能檢視」；
      網址和金鑰<b>只存在這台裝置</b>，不進備份、不進 GitHub。
    </p>

    <label class="folder">
      <span class="folder-label">資料夾網址</span>
      <span class="folder-row">
        <input
          v-model="folderInput"
          type="url"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="https://drive.google.com/drive/folders/…"
          aria-label="雲端硬碟資料夾網址"
          @change="onSaveFolder"
          @keyup.enter="onSaveFolder"
        >
        <a v-if="folderUrl" class="ghost-btn small link" :href="folderUrl" target="_blank" rel="noopener noreferrer">開啟資料夾</a>
      </span>
    </label>
    <p v-if="folderMsg" class="msg" :class="folderMsg.kind" role="status">{{ folderMsg.text }}</p>

    <label class="folder">
      <span class="folder-label">Google API 金鑰</span>
      <span class="folder-row">
        <input
          v-model="keyInput"
          type="password"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="AIza…"
          aria-label="Google API 金鑰"
          @change="onSaveKey"
          @keyup.enter="onSaveKey"
        >
      </span>
    </label>
    <p v-if="keyMsg" class="msg" :class="keyMsg.kind" role="status">{{ keyMsg.text }}</p>

    <details class="keyhelp">
      <summary>怎麼拿 Google API 金鑰？（免費，只要做一次）</summary>
      <ol>
        <li>用你的 Google 帳號打開 <b>console.cloud.google.com</b>，上方「選取專案 › 新增專案」，取個名字（例如 kid-photos）建立。</li>
        <li>左邊選單「API 和服務 › 程式庫」，搜尋 <b>Google Drive API</b>，按「啟用」。</li>
        <li>「API 和服務 › 憑證 › 建立憑證 › API 金鑰」，複製那一串（AIza 開頭），貼到上面。</li>
        <li>
          建議：按金鑰旁的「編輯」，「API 限制」選「限制金鑰」只勾 Google Drive API；「應用程式限制」選「網站」，加上
          <code>{{ origin }}/*</code>。這樣金鑰就算被別人看到，也只能讀 Drive、只能從這個網站用。
        </li>
        <li>回到這裡，把資料夾網址和金鑰都填好，按「立即同步」。</li>
      </ol>
    </details>

    <div class="io-row">
      <button class="ghost-btn primary" :disabled="!canSync || syncing" @click="sync">{{ buttonText }}</button>
    </div>
    <p class="sync-last" :class="{ 'is-err': syncLast?.error }">上次同步：{{ lastText }}</p>
    <p v-if="syncError && !syncLast?.error" class="msg err" role="alert">{{ syncError }}</p>

    <div v-if="syncReport" class="report" role="status">
      <p v-if="syncReport.media.saved" class="ok">✓ 下載了 {{ syncReport.media.saved }} 個素材（圖片和聲音）</p>
      <p v-if="syncReport.media.unchanged" class="dim">素材 {{ syncReport.media.unchanged }} 個早就是最新的，沒有重新下載</p>
      <p v-if="syncReport.media.removed" class="warn">雲端硬碟上已經沒有的 {{ syncReport.media.removed }} 個素材，這台也刪掉了</p>
      <p v-if="syncReport.media.partial" class="warn">
        ⚠ 有的資料夾太多、太深（最多 300 個資料夾、8 層），或名稱不能用，沒有讀完。沒讀完的時候不會刪這台的素材
      </p>
      <p v-for="f in syncReport.media.failed.slice(0, 20)" :key="'m' + f.name" class="warn">⚠ {{ f.name }}：{{ f.why }}</p>
      <p v-if="syncReport.media.failed.length > 20" class="dim">…還有 {{ syncReport.media.failed.length - 20 }} 個沒有存成功</p>
      <p v-if="syncReport.media.older.length" class="warn">
        ⚠ 同一個路徑有好幾個檔，只用了最新的，略過 {{ syncReport.media.older.length }} 個：{{ names(syncReport.media.older) }}
      </p>

      <p v-if="syncReport.clips.saved.length" class="ok">✓ 收到 {{ syncReport.clips.saved.length }} 句錄音：{{ names(syncReport.clips.saved) }}</p>
      <p v-if="syncReport.clips.unchanged" class="dim">錄音 {{ syncReport.clips.unchanged }} 句這台已經有了，沒有重新下載</p>
      <p v-if="syncReport.clips.localNewer.length" class="warn">這台自己錄的比資料夾裡的新，沒有蓋掉：{{ names(syncReport.clips.localNewer) }}</p>
      <p v-if="syncReport.clips.unmatched.length" class="warn">
        ⚠ {{ syncReport.clips.unmatched.length }} 個最上層的音檔對不到任何一句話（檔名要跟句子一樣）：{{ names(syncReport.clips.unmatched) }}
      </p>
      <p v-if="syncReport.clips.older.length" class="warn">⚠ 同一句有好幾個檔，只用了最新的，略過 {{ syncReport.clips.older.length }} 個：{{ names(syncReport.clips.older) }}</p>
      <p v-for="f in syncReport.clips.failed" :key="'c' + f.name" class="warn">⚠ {{ f.name }}：{{ f.why }}</p>

      <p v-if="syncReport.saved.length" class="ok">✓ 換了 {{ syncReport.saved.length }} 張照片：{{ names(syncReport.saved) }}</p>
      <p v-if="syncReport.unchanged" class="dim">{{ syncReport.unchanged }} 張照片早就是最新的，沒有重新下載</p>
      <p v-if="syncReport.localNewer.length" class="warn">這台自己拍的比資料夾裡的新，沒有蓋掉：{{ names(syncReport.localNewer) }}</p>
      <p v-if="syncReport.unmatched.length" class="warn">
        ⚠ {{ syncReport.unmatched.length }} 個最上層的檔名對不到任何卡（檔名要跟卡上的字一樣）：{{ names(syncReport.unmatched) }}
      </p>
      <p v-if="syncReport.older.length" class="warn">⚠ 同一個名字有好幾個檔，只用了最新的，略過 {{ syncReport.older.length }} 個：{{ names(syncReport.older) }}</p>
      <p v-for="f in syncReport.failed" :key="'p' + f.name" class="warn">⚠ {{ f.name }}：{{ f.why }}</p>
      <p v-if="syncReport.ignored" class="dim">最上層略過 {{ syncReport.ignored }} 個不是照片也不是音檔的檔</p>
      <p v-if="!syncReport.total && !syncReport.media.total" class="warn">資料夾裡沒有檔案（或這把金鑰看不到）。</p>
    </div>
  </div>
</template>

<style scoped>
.drive { display: flex; flex-direction: column; gap: 4px; }
.hint { margin: 0 0 8px; }
.hint b, .what b { color: var(--text); }
.hint code, .what code, .keyhelp code { padding: 1px 6px; border-radius: 6px; background: var(--bg-card); font-size: .92em; overflow-wrap: anywhere; }
.what { margin: 0 0 8px; padding-left: 22px; display: grid; gap: 6px; font-size: 14px; line-height: 1.7; color: var(--text-dim); }

.io-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 8px; }
.ghost-btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
.ghost-btn.primary { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.ghost-btn:disabled { opacity: .45; pointer-events: none; }
.ghost-btn.link { display: inline-flex; align-items: center; text-decoration: none; color: var(--text); }
.ghost-btn.small { padding: 10px 16px; font-size: 15px; white-space: nowrap; }

.msg { margin: 8px 0 0; font-size: 14px; min-height: 0; }
.report { display: grid; gap: 6px; margin: 4px 0 8px; }
.report p { margin: 0; padding: 10px 14px; border-radius: 12px; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; background: var(--bg-card); }
.report .ok { color: var(--ok); }
.report .warn { color: var(--accent-2); }
.report .dim { color: var(--text-dim); font-weight: 500; }

.folder { display: block; margin-top: 10px; }
.folder-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); line-height: 1.6; }
.folder-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.folder-row input {
  flex: 1;
  min-width: 220px;
  min-height: 48px;
  padding: 10px 14px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 15px;
}
.folder-row input:focus { border-color: var(--accent); outline: none; }

.keyhelp { margin: 4px 0 8px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 14px; font-size: 14px; }
.keyhelp summary { cursor: pointer; font-weight: 700; font-size: 15px; }
.keyhelp ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; line-height: 1.7; }
.sync-last { margin: 4px 0 8px; font-size: 14px; color: var(--text-dim); overflow-wrap: anywhere; }
.sync-last.is-err { color: var(--danger); }
</style>
