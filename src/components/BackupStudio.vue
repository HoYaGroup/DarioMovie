<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  BackupError, applyBackup, backupFileName, buildBackup, markBackedUp, openBackup, saveBackupFile,
  BACKUP_EXT, type BackupSummary, type OpenedBackup,
} from '~/utils/backup'
import { photosBytes } from '~/utils/photos'
import { useBackupStatus } from '~/composables/useBackupStatus'
import { useVoiceClips } from '~/composables/useVoiceClips'

/**
 * 家長設定「備份與還原」：照片、錄音、設定包成一個檔案，由家長自己存到「檔案」App 或 Google 雲端硬碟。
 * 程式不連 Google，沒有帳號、金鑰，也沒有東西放在 GitHub。iPad 壞了、換新的，把檔案匯入就回來。
 */
const { lastBackupAt, total, unbacked } = useBackupStatus()
const { bytes: clipBytes } = useVoiceClips()

const mb = (n: number) => (n / 1048576).toFixed(1)
const when = (at: number) => new Date(at).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
const lastText = computed(() => (lastBackupAt.value ? when(lastBackupAt.value) : '從來沒有備份過'))
const sizeText = computed(() => `${mb(photosBytes() + clipBytes.value)} MB`)

/* ---------- 備份 ---------- */

const pw = ref('')
const pw2 = ref('')
const making = ref(false)
const made = ref<{ blob: Blob; name: string; summary: BackupSummary } | null>(null)
const makeMsg = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' })
const saveMsg = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' })

const canShare = computed(() => {
  try {
    return !!made.value && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File([], made.value.name, { type: 'application/octet-stream' })] })
  } catch {
    return false
  }
})

async function onMake() {
  if (making.value) return
  made.value = null
  saveMsg.value = { text: '', kind: '' }
  if (pw.value && pw.value.length < 6) {
    makeMsg.value = { text: '備份密碼至少 6 個字。', kind: 'err' }
    return
  }
  if (pw.value !== pw2.value) {
    makeMsg.value = { text: '兩次輸入的備份密碼不一樣。', kind: 'err' }
    return
  }
  making.value = true
  makeMsg.value = { text: '製作中…（有加密會多等幾秒）', kind: '' }
  try {
    const { blob, summary } = await buildBackup(pw.value)
    // 做完馬上自己打開驗證一次：壞掉的備份比沒有備份更危險，家長會以為自己有備份
    await openBackup(blob, pw.value)
    made.value = { blob, name: backupFileName(summary.at), summary }
    makeMsg.value = { text: '備份檔做好了，接著按下面的按鈕存起來。', kind: 'ok' }
  } catch (e) {
    makeMsg.value = { text: (e as Error).message || '備份失敗。', kind: 'err' }
  } finally {
    making.value = false
  }
}

async function onSave(mode: 'share' | 'download') {
  const m = made.value
  if (!m) return
  try {
    const how = await saveBackupFile(m.blob, m.name, mode)
    if (how === 'cancelled') {
      saveMsg.value = { text: '沒有存。需要的話再按一次。', kind: '' }
      return
    }
    markBackedUp(m.summary.at)
    saveMsg.value = {
      text: how === 'shared'
        ? '已經交給分享選單。請確認檔案真的出現在「檔案」或雲端硬碟裡。'
        : '已下載。請把檔案移到「檔案」App 的 Google 雲端硬碟資料夾（在「下載項目」裡找 .kidtube 檔）。',
      kind: 'ok',
    }
  } catch (e) {
    saveMsg.value = { text: (e as Error).message || '存檔失敗。', kind: 'err' }
  }
}

/* ---------- 還原 ---------- */

const picked = ref<File | null>(null)
const opened = ref<OpenedBackup | null>(null)
const needPw = ref(false)
const restorePw = ref('')
const restoring = ref(false)
const restoreMsg = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' })

function resetRestore() {
  picked.value = null
  opened.value = null
  needPw.value = false
  restorePw.value = ''
}

async function tryOpen() {
  const file = picked.value
  if (!file) return
  restoring.value = true
  restoreMsg.value = { text: '檢查備份檔…', kind: '' }
  try {
    opened.value = await openBackup(file, restorePw.value)
    needPw.value = false
    restoreMsg.value = { text: '', kind: '' }
  } catch (e) {
    opened.value = null
    if (e instanceof BackupError && e.code === 'password-needed') {
      needPw.value = true
      restoreMsg.value = { text: e.message, kind: '' }
    } else {
      needPw.value = e instanceof BackupError && e.code === 'bad-password'
      restoreMsg.value = { text: (e as Error).message || '打不開這個檔案。', kind: 'err' }
    }
  } finally {
    restoring.value = false
  }
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  resetRestore()
  restoreMsg.value = { text: '', kind: '' }
  if (!file) return
  picked.value = file
  await tryOpen()
}

async function onRestore() {
  const o = opened.value
  if (!o || restoring.value) return
  const s = o.summary
  if (!confirm(
    `用 ${when(s.at)} 的備份還原這台裝置？\n\n`
    + `‧ 照片 ${s.photos} 張、錄音 ${s.clips} 句：加進這台裝置（同一張、同一句用備份的）\n`
    + `‧ ${s.settings} 項設定：換成備份裡的（目前這台的會被蓋掉）\n`
    + '‧ 家長密碼不會變\n\n'
    + '只還原自己做的備份檔。',
  )) return
  restoring.value = true
  restoreMsg.value = { text: '還原中…請不要關掉頁面。', kind: '' }
  try {
    const r = await applyBackup(o)
    restoreMsg.value = { text: `已還原：照片 ${r.photos} 張、錄音 ${r.clips} 句、設定 ${r.settings} 項。重新載入中…`, kind: 'ok' }
    setTimeout(() => location.reload(), 1500)
  } catch (e) {
    restoring.value = false
    restoreMsg.value = { text: (e as Error).message || '還原失敗。', kind: 'err' }
  }
}
</script>

<template>
  <div class="backup">
    <p class="hint">
      照片、你錄的聲音，還有在這台裝置上改的字卡、孩子的年紀、任務貼紙、觀看時間設定，<strong>只存在這台 iPad</strong>。
      iPad 壞掉、被清空或換新的，沒有備份就全部不見。備份檔由你自己存到「檔案」App 或 Google 雲端硬碟，
      這個 App 不會連 Google，也不需要登入。
    </p>

    <div class="status" :class="{ 'is-warn': unbacked > 0 }">
      <div class="status-line">
        <span>這台裝置上有</span>
        <strong>{{ total }} 個照片／錄音</strong>
        <span v-if="total" class="dim">（{{ sizeText }}）</span>
      </div>
      <div class="status-line">
        <span>上次備份</span>
        <strong>{{ lastText }}</strong>
        <span v-if="unbacked > 0" class="warn">・有 {{ unbacked }} 個是備份之後才新增的</span>
      </div>
    </div>

    <h3 class="sub">備份</h3>
    <label class="field">
      <span>備份密碼（選填，至少 6 個字）</span>
      <input v-model="pw" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false">
    </label>
    <label v-if="pw" class="field">
      <span>再輸入一次</span>
      <input v-model="pw2" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false">
    </label>
    <p class="hint small">
      設了密碼，檔案裡的照片和聲音都會加密，放在雲端也看不到。<strong>忘記密碼就永遠打不開，沒有任何辦法找回。</strong>
      沒設密碼的檔案，誰拿到都看得到家裡的照片和孩子的聲音，請只放在自己的雲端硬碟。
      家長密碼不會放進備份。
    </p>

    <button class="ghost-btn primary" :disabled="making" @click="onMake">
      {{ making ? '製作中…' : '建立備份檔' }}
    </button>
    <p v-if="makeMsg.text" class="msg" :class="makeMsg.kind" role="status">{{ makeMsg.text }}</p>

    <div v-if="made" class="made">
      <p class="made-info">
        <strong>{{ made.name }}</strong><br>
        {{ mb(made.summary.bytes) }} MB・照片 {{ made.summary.photos }} 張・錄音 {{ made.summary.clips }} 句・設定 {{ made.summary.settings }} 項
        <template v-if="made.summary.encrypted">・已加密</template>
      </p>
      <div class="btn-row">
        <button v-if="canShare" class="ghost-btn primary" @click="onSave('share')">📤 存到「檔案」／雲端硬碟</button>
        <button class="ghost-btn" @click="onSave('download')">⬇ 下載檔案</button>
      </div>
      <p v-if="saveMsg.text" class="msg" :class="saveMsg.kind" role="status">{{ saveMsg.text }}</p>
    </div>

    <h3 class="sub">還原</h3>
    <p class="hint">
      換新 iPad、或這台被清空之後，打開家長設定到這裡，選之前存的 .{{ BACKUP_EXT }} 檔。
      選好會先檢查檔案，確認後才會動到這台裝置。
    </p>
    <label class="ghost-btn file" :class="{ 'is-disabled': restoring }">
      📁 選擇備份檔
      <input class="file-input" type="file" :disabled="restoring" aria-label="選擇備份檔" @change="onPickFile">
    </label>

    <div v-if="needPw" class="unlock">
      <label class="field">
        <span>備份密碼</span>
        <input v-model="restorePw" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" @keyup.enter="tryOpen">
      </label>
      <button class="ghost-btn" :disabled="restoring || !restorePw" @click="tryOpen">解鎖</button>
    </div>

    <div v-if="opened" class="made">
      <p class="made-info">
        <strong>{{ when(opened.summary.at) }} 的備份</strong><br>
        照片 {{ opened.summary.photos }} 張・錄音 {{ opened.summary.clips }} 句・設定 {{ opened.summary.settings }} 項・{{ mb(opened.summary.bytes) }} MB
        <template v-if="opened.summary.encrypted">・已加密</template>
      </p>
      <button class="ghost-btn primary" :disabled="restoring" @click="onRestore">還原到這台裝置</button>
    </div>
    <p v-if="restoreMsg.text" class="msg" :class="restoreMsg.kind" role="status">{{ restoreMsg.text }}</p>
  </div>
</template>

<style scoped>
.backup { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.backup > * { max-width: 100%; }
.hint { margin: 0 0 8px; }
.hint.small { font-size: 13px; }
.hint strong { color: var(--text); }
.sub { margin: 18px 0 4px; font-size: 16px; }

.field { align-self: stretch; max-width: 420px; margin-bottom: 8px; }

.status {
  align-self: stretch;
  display: grid;
  gap: 4px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  font-size: 15px;
}
.status.is-warn { border-color: var(--accent); }
.status-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.dim { color: var(--text-dim); }
.warn { color: var(--accent-2); font-weight: 700; }

.ghost-btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
.ghost-btn.primary { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.ghost-btn:disabled, .ghost-btn.is-disabled { opacity: .45; pointer-events: none; }
.ghost-btn.file { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.made {
  align-self: stretch;
  display: grid;
  gap: 10px;
  margin-top: 10px;
  padding: 12px 16px;
  border: 1px solid var(--ok);
  border-radius: 14px;
}
.made-info { margin: 0; font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; }
.btn-row { display: flex; flex-wrap: wrap; gap: 10px; }

.unlock { align-self: stretch; margin-top: 10px; display: grid; gap: 4px; justify-items: start; }
</style>
