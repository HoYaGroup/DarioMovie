<script setup lang="ts">
import { computed, ref } from 'vue'
import { readFolderUrl } from '~/utils/photoFiles'
import { folderIdOf } from '~/utils/driveSync'
import {
  SCRIPT_VERSION, buildScript, cleanUploadKey, cleanUploadUrl, connectionCode, ensureUploadKey, pingUpload, readAutoUpload, readUploadKey,
  readUploadUrl, saveAutoUpload, saveUploadKey, saveUploadUrl, splitConnection, uploadConfigured,
} from '~/utils/driveUpload'

/**
 * 家長設定「圖片和聲音」的「上傳」（進階，選填）：貼上自己部署的 Apps Script 網址，之後換好照片就自動存進共用資料夾。
 * 網址和密碼只存在這台裝置，不進備份、不進 GitHub。上傳本身在 utils/driveUpload.ts，script 在 scripts/apps-script/drive-upload.gs。
 */
const urlInput = ref(readUploadUrl())
const keyInput = ref(readUploadKey())
const autoOn = ref(readAutoUpload())
const msg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)
const configured = computed(() => uploadConfigured())

/** 「複製 script」按下去之後才有：資料夾和密碼已經填好的整份程式；複製沒反應的時候可以在這裡長按全選 */
const scriptText = ref('')

function onSaveUrl() {
  // 另一台裝置複製來的「網址#密碼」整串貼進來也行
  const { url, key } = splitConnection(urlInput.value)
  const clean = cleanUploadUrl(url)
  if (clean === null) {
    msg.value = { text: '網址看起來不對：要是 https://script.google.com/macros/s/…/exec，結尾是 /exec。', kind: 'err' }
    return
  }
  if (key) {
    const k = cleanUploadKey(key)
    if (!k) {
      msg.value = { text: '連線代碼裡的密碼格式不對（要是 8 個以上的英文字母和數字）。', kind: 'err' }
      return
    }
    saveUploadKey(k)
    keyInput.value = k
  }
  saveUploadUrl(clean)
  urlInput.value = clean
  msg.value = clean
    ? { text: readUploadKey() ? '已記住，只存在這台裝置。按「測試連線」確認。' : '已記住網址。還要填密碼（複製 script 的時候產生的那一組）。', kind: 'ok' }
    : { text: '已清除。', kind: 'ok' }
}

function onSaveKey() {
  const key = cleanUploadKey(keyInput.value)
  if (key === null) {
    msg.value = { text: '密碼要是 8 個以上的英文字母和數字，中間不能有空白或符號。', kind: 'err' }
    return
  }
  saveUploadKey(key)
  keyInput.value = key
  msg.value = { text: key ? '已記住，只存在這台裝置，不會進備份。' : '已清除。', kind: 'ok' }
}

function onAuto() {
  saveAutoUpload(autoOn.value)
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    msg.value = { text: done, kind: 'ok' }
  } catch {
    msg.value = { text: '這台裝置不讓 App 直接複製，請在下面的方框裡長按、全選、拷貝。', kind: 'err' }
  }
}

function onCopyScript() {
  const folderId = folderIdOf(readFolderUrl())
  if (!folderId) {
    msg.value = { text: '先在上面填好「資料夾網址」（…/drive/folders/… 那串），script 才知道要存進哪個資料夾。', kind: 'err' }
    return
  }
  const key = ensureUploadKey()
  keyInput.value = key
  scriptText.value = buildScript(folderId, key)
  // 在點擊當下直接複製（iPad 要求），複製失敗才請家長自己從方框拷貝
  void copy(scriptText.value, '已複製。到 script.google.com 開新專案，把原本的程式整個刪掉，貼上這一份。')
}

function onCopyCode() {
  void copy(connectionCode(), '已複製連線代碼。在另一台裝置貼到「上傳網址」就設好了（代碼裡有密碼，不要貼給別人）。')
}

const testing = ref(false)

async function onTest() {
  if (testing.value) return
  testing.value = true
  msg.value = null
  try {
    const { folder, id, version } = await pingUpload()
    const want = folderIdOf(readFolderUrl())
    msg.value = want && id && want !== id
      ? { text: `連線成功，但 script 寫入的是「${folder}」，跟上面設定的資料夾不是同一個。請重新按「複製 script」貼過去，再部署新版本。`, kind: 'err' }
      : version < SCRIPT_VERSION
        ? { text: `連線成功，但你的 script 是舊版（照片會放在「${folder}」的最上層）。請重新按「複製 script」貼上，再「部署 › 管理部署作業 › 編輯 › 新版本」，之後照片才會集中放進 photos 資料夾。`, kind: 'err' }
        : { text: `連線成功！照片會存進「${folder}」裡的 photos 資料夾（沒有的話會自己建）。`, kind: 'ok' }
  } catch (e) {
    msg.value = { text: (e as Error).message, kind: 'err' }
  } finally {
    testing.value = false
  }
}

function onClear() {
  if (!confirm('清除這台的上傳設定嗎？（雲端硬碟上的照片和 script 都不會動）')) return
  saveUploadUrl('')
  saveUploadKey('')
  urlInput.value = ''
  keyInput.value = ''
  scriptText.value = ''
  msg.value = { text: '已清除。', kind: 'ok' }
}
</script>

<template>
  <div class="up">
    <h4 class="title">上傳（選填）：換好照片就自動存進這個資料夾</h4>
    <p class="hint">
      上面的金鑰<b>只能讀、不能寫</b>。要讓 App 直接把照片存進資料夾，需要你自己在 Google 部署一小段程式（Apps Script），
      <b>只要做一次</b>，之後不用登入、不會過期，不用再從分享選單挑位置。
    </p>
    <ol class="steps">
      <li>先在上面填好「資料夾網址」，再按下面的「📋 複製 script」（資料夾和密碼已經幫你填好，不用改）。</li>
      <li>用你的 Google 帳號打開 <b>script.google.com</b> › 「新專案」，把裡面原本的程式整個刪掉，貼上剛複製的，按存檔。</li>
      <li>
        右上「部署 › 新增部署作業」，類型選「網頁應用程式」，<b>執行身分選「我」</b>、<b>誰可以存取選「所有人」</b>，按「部署」。
        第一次會要你授權：跳出「Google 尚未驗證這個應用程式」是因為這是你自己的程式，按「進階 › 前往…（不安全）」再允許。
      </li>
      <li>複製畫面上的「網頁應用程式」網址（結尾是 <code>/exec</code>），貼到下面「上傳網址」，按「測試連線」。</li>
      <li>
        之後如果重貼或改了 script，要再「部署 › 管理部署作業 › 編輯 › 版本選『新版本』 › 部署」，網址不變，但<b>不部署新版本，網址跑的還是舊的程式</b>。
      </li>
    </ol>

    <div class="io-row">
      <button class="ghost-btn" @click="onCopyScript">📋 複製 script</button>
    </div>

    <details v-if="scriptText" class="keyhelp">
      <summary>複製沒反應？在這裡拷貝</summary>
      <textarea class="script" readonly rows="8" :value="scriptText" aria-label="要貼到 Apps Script 的程式" @focus="($event.target as HTMLTextAreaElement).select()" />
    </details>

    <label class="field">
      <span class="field-label">上傳網址</span>
      <input
        v-model="urlInput"
        type="url"
        inputmode="url"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="https://script.google.com/macros/s/…/exec"
        aria-label="上傳網址（Apps Script 網頁應用程式）"
        @change="onSaveUrl"
        @keyup.enter="onSaveUrl"
      >
    </label>
    <label class="field">
      <span class="field-label">密碼（按「複製 script」時自動產生，不用自己想）</span>
      <input
        v-model="keyInput"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        aria-label="上傳密碼"
        @change="onSaveKey"
        @keyup.enter="onSaveKey"
      >
    </label>

    <label class="auto">
      <input v-model="autoOn" type="checkbox" @change="onAuto">
      <span>選好照片就自動上傳（關掉的話，要按照片旁的「上傳到雲端硬碟」才會傳）</span>
    </label>

    <div class="io-row">
      <button class="ghost-btn primary" :disabled="!configured || testing" @click="onTest">{{ testing ? '測試中…' : '🔌 測試連線' }}</button>
      <button class="ghost-btn" :disabled="!configured" @click="onCopyCode">📋 複製連線代碼（給另一台）</button>
      <button v-if="urlInput || keyInput" class="ghost-btn" @click="onClear">清除</button>
    </div>
    <p v-if="msg" class="msg" :class="msg.kind" role="status">{{ msg.text }}</p>

    <p class="hint">
      傳上去的是縮小過、去掉位置資訊的 JPEG，檔名就是卡上的字（<code>monday.jpg</code>），<b>統一放在資料夾裡的 <code>photos</code> 資料夾</b>
      （沒有會自己建，不會弄亂最上層；<code>cards</code> 是照路徑對應的素材，兩種分開放），同名的舊檔會進垃圾桶（30 天內找得回來）。
      其他裝置按「立即同步」才會換上。知道網址和密碼的人都能把照片存進你的資料夾，<b>請不要把連線代碼貼給別人</b>；
      資料夾裡的照片知道資料夾網址的人都看得到，<b>請不要放拍得到小朋友的照片</b>。
    </p>
  </div>
</template>

<style scoped>
.up { display: flex; flex-direction: column; gap: 4px; margin-top: 18px; padding-top: 14px; border-top: 1px dashed var(--line); }
.title { margin: 0 0 6px; font-size: 16px; font-weight: 800; color: var(--text); }
.hint { margin: 0 0 8px; }
.hint b, .steps b { color: var(--text); }
.hint code, .steps code { padding: 1px 6px; border-radius: 6px; background: var(--bg-card); font-size: .92em; overflow-wrap: anywhere; }
.steps { margin: 0 0 10px; padding-left: 22px; display: grid; gap: 6px; font-size: 14px; line-height: 1.7; color: var(--text-dim); }

.io-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 8px; }
.ghost-btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
.ghost-btn.primary { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.ghost-btn:disabled { opacity: .45; pointer-events: none; }

.field { display: block; margin-top: 10px; }
.field-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); line-height: 1.6; }
.field input {
  width: 100%;
  min-height: 48px;
  padding: 10px 14px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 15px;
}
.field input:focus { border-color: var(--accent); outline: none; }

.auto { display: flex; align-items: flex-start; gap: 10px; margin: 12px 0 4px; font-size: 14px; line-height: 1.6; color: var(--text-dim); cursor: pointer; }
.auto input { flex: none; width: 24px; height: 24px; margin: 0; accent-color: var(--accent); }

.keyhelp { margin: 4px 0 8px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 14px; font-size: 14px; }
.keyhelp summary { cursor: pointer; font-weight: 700; font-size: 15px; }
.script {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.msg { margin: 8px 0 0; font-size: 14px; min-height: 0; overflow-wrap: anywhere; }
</style>
