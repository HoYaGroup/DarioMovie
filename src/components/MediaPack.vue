<script setup lang="ts">
import { ref, computed } from 'vue'
import { importMediaZip, clearMedia, mediaCount, mediaBytes, type MediaReport } from '~/utils/media'
import { driveConfigured } from '~/utils/driveSync'
import DriveFolder from './DriveFolder.vue'

/**
 * 家長設定「圖片和聲音」：書頁的圖片、動物的叫聲這類不放在公開 GitHub 的檔案，放在家長自己的雲端硬碟，抓到這台 iPad，
 * 之後沒網路也看得到、聽得到。兩種抓法擇一：
 *   ‧ 素材包：做成一個 zip，在這台選一次（不連 Google：選檔靠 iPad「檔案」App，裡面可以直接選雲端硬碟上的 zip）
 *   ‧ 雲端硬碟資料夾：改了雲端硬碟，按同步就更新（要自己申請 Google API 金鑰，DriveFolder.vue）
 */
const count = computed(() => mediaCount())
/** 已經設好資料夾同步的話，進階那一塊直接展開 */
const driveOn = driveConfigured()
const sizeText = computed(() => `${(mediaBytes() / 1048576).toFixed(1)} MB`)

const busy = ref(false)
const progress = ref({ done: 0, total: 0 })
const report = ref<MediaReport | null>(null)
const msg = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' })

async function onPick(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  busy.value = true
  report.value = null
  msg.value = { text: '匯入中…', kind: '' }
  progress.value = { done: 0, total: 0 }
  try {
    const r = await importMediaZip(file, (done, total) => { progress.value = { done, total } })
    report.value = r
    if (r.saved) {
      msg.value = {
        text: `匯入好了：存了 ${r.saved} 個檔案（${(r.bytes / 1048576).toFixed(1)} MB）。`
          + (r.failed.length || r.skipped.length ? `另外有 ${r.failed.length + r.skipped.length} 個沒有收，看下面。` : ''),
        kind: 'ok',
      }
    } else {
      msg.value = { text: '這個素材包裡沒有可以用的圖片或音檔。', kind: 'err' }
    }
  } catch (e) {
    msg.value = { text: (e as Error).message || '匯入失敗。', kind: 'err' }
  } finally {
    busy.value = false
  }
}

async function onClear() {
  if (busy.value || !count.value) return
  if (!confirm(`把這台 iPad 上的 ${count.value} 個素材檔案清掉？（雲端硬碟上的素材包不會動，要用再匯入就好）`)) return
  await clearMedia()
  report.value = null
  msg.value = { text: '已清掉。cards/ 的圖片和聲音會改用網站上的（網站上沒有的就顯示空白）。', kind: 'ok' }
}
</script>

<template>
  <div class="media">
    <p class="hint">
      書頁的圖片、動物的叫聲這類<strong>不放在公開的 GitHub</strong>（有版權），放在你自己的雲端硬碟，抓到這台 iPad，
      <strong>之後沒有網路也看得到、聽得到</strong>。檔案的路徑跟試算表「圖」「背面圖」「聲音」欄寫的一樣
      （例如 <code>cards/books/animals/pets.webp</code>），試算表不用改。兩種抓法擇一：
      <strong>素材包</strong>（zip，簡單、不用金鑰，改了要重新匯入）、<strong>雲端硬碟資料夾</strong>（改了雲端硬碟，按同步就更新，要自己申請 Google API 金鑰）。
    </p>

    <div class="status">
      <span>這台裝置上的素材</span>
      <strong>{{ count }} 個檔案</strong>
      <span v-if="count" class="dim">（{{ sizeText }}）</span>
      <button class="ghost-btn small clear" :disabled="busy || !count" @click="onClear">清掉這台的素材</button>
    </div>

    <h4 class="way">做法一：素材包（zip）</h4>
    <ol class="steps">
      <li>
        把素材包 zip 傳到你的 Google 雲端硬碟。zip 自己做也可以（電腦、iPad 的「檔案」App 都能把資料夾壓縮成 zip，
        資料夾裡的路徑要跟試算表寫的一樣）；有電腦的話，<code>node scripts/pack-media.mjs</code> 會從專案打包好
      </li>
      <li>在 iPad 按下面的「選擇素材包」→ 在「檔案」App 裡打開雲端硬碟 → 點那個 zip</li>
      <li>等進度跑完。每台要看的 iPad 各匯入一次；換 iPad 也要重新匯入（素材包不放進備份）</li>
    </ol>

    <div class="btn-row">
      <label class="ghost-btn primary file" :class="{ 'is-disabled': busy }">
        {{ busy ? `匯入中 ${progress.done}/${progress.total}` : '選擇素材包（.zip）' }}
        <input class="file-input" type="file" accept=".zip,application/zip" :disabled="busy" @change="onPick">
      </label>
    </div>

    <p v-if="msg.text" class="msg" :class="msg.kind" role="status">{{ msg.text }}</p>

    <template v-if="report && (report.failed.length || report.skipped.length)">
      <p class="hint warn">這些沒有收進來：</p>
      <ul class="list">
        <li v-for="f in report.failed.slice(0, 20)" :key="'f' + f.name">{{ f.name }}：{{ f.why }}</li>
        <li v-for="s in report.skipped.slice(0, 20)" :key="'s' + s.name">{{ s.name }}：{{ s.why }}</li>
        <li v-if="report.failed.length + report.skipped.length > 40">…還有更多</li>
      </ul>
    </template>

    <details class="adv" :open="driveOn">
      <summary class="way">做法二：雲端硬碟資料夾自動同步（進階，要自己申請 Google API 金鑰）</summary>
      <DriveFolder />
    </details>

    <p class="hint small">
      這是<b>整批、照路徑對應的原檔</b>（書頁圖片、叫聲）；一張一張依字換成自己拍的照片，在下面「換成家裡的照片」。
      素材只存在這台裝置，不會上傳。優先順序：你自己拍的照片 → 素材（素材包或資料夾同步）→ 網站上的。
      都沒有、網站上也沒有這張圖的話，字卡上那一塊就是空白，其他照常能用。
    </p>
  </div>
</template>

<style scoped>
.media { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.media > * { max-width: 100%; }
.hint { margin: 0 0 8px; }
.hint.small { font-size: 13px; margin-top: 12px; }
.way { margin: 14px 0 6px; font-size: 16px; font-weight: 700; color: var(--text); }
.adv { align-self: stretch; margin: 18px 0 0; padding: 12px 14px; border: 1px dashed var(--line); border-radius: 12px; }
.adv > summary { cursor: pointer; margin: 0; line-height: 1.6; }
.adv[open] > summary { margin-bottom: 10px; }
.clear { margin-left: auto; min-height: 40px; padding: 6px 14px; font-size: 14px; }
.hint.warn { color: var(--accent-2); font-weight: 700; margin: 12px 0 4px; }
.hint strong { color: var(--text); }
.hint code, .steps code { padding: 1px 6px; border-radius: 6px; background: var(--bg-card); font-size: .92em; overflow-wrap: anywhere; }

.steps { margin: 0 0 10px; padding-left: 22px; font-size: 14px; line-height: 1.9; color: var(--text-dim); }

.status {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  align-self: stretch;
  margin-bottom: 10px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  font-size: 15px;
}
.dim { color: var(--text-dim); }

.btn-row { display: flex; flex-wrap: wrap; gap: 10px; }
.ghost-btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
.ghost-btn.primary { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.ghost-btn:disabled, .ghost-btn.is-disabled { opacity: .45; pointer-events: none; }
.ghost-btn.file { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.list { margin: 0 0 8px; padding-left: 20px; font-size: 13px; line-height: 1.7; color: var(--text-dim); overflow-wrap: anywhere; }
</style>
