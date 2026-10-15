<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useLibrary } from '~/composables/useLibrary'
import { useChildName } from '~/composables/useChildName'
import { useVoiceClips } from '~/composables/useVoiceClips'
import { cardsOf } from '~/utils/cards'
import { getClip, saveClip, removeClip, clearClips, type Clip } from '~/utils/recordings'
import { analyzeRecording, previewClip, stopSpeaking } from '~/utils/speech'
import { voiceLinesOf, appVoiceLines, lineIndexOf, lineOfFileName, type VoiceLine } from '~/utils/voiceLines'
import { CLIP_ACCEPT, clipFiles, importClipFile } from '~/utils/clipFiles'
import { shareFiles } from '~/utils/photoFiles'

/**
 * 家長設定：用自己的聲音錄音。
 * 選一本字卡（或「App 說的話」），一句一句錄；錄好之後小朋友聽到那句話就是爸媽的聲音，
 * 沒錄的還是 App 的合成語音。錄音是依「那一句話」記的，同一句出現在好幾本字卡都會用。
 */

const { sections, categories, videos } = useLibrary()
const { name: childName } = useChildName()
const { version, count, bytes } = useVoiceClips()

const APP = 'app'
/** 選了哪一本字卡（uid），或 APP（App 自己說的話）；空字串是還沒選 */
const source = ref('')
const withSentences = ref(false)
const withChinese = ref(false)
const onlyMissing = ref(false)

/* ---------- 選字卡本：照大分類 › 分區分組 ---------- */

const deckGroups = computed(() => {
  const sectionName = new Map(sections.value.map((s) => [s.id, s.name]))
  const catById = new Map(categories.value.map((c) => [c.id, c]))
  const groups = new Map<string, { label: string; decks: { uid: string; title: string }[] }>()
  for (const v of videos.value) {
    if (v.kind !== 'deck' || !v.cards?.length) continue
    const cat = catById.get(v.categoryId)
    const label = [cat ? sectionName.get(cat.sectionId) : '', cat?.name].filter(Boolean).join(' › ') || '字卡'
    if (!groups.has(label)) groups.set(label, { label, decks: [] })
    groups.get(label)!.decks.push({ uid: v.uid, title: v.title })
  }
  return [...groups.values()]
})

const deck = computed(() => videos.value.find((v) => v.uid === source.value))

/* ---------- 要錄的句子 ---------- */

const hasClip = (l: VoiceLine) => (version.value, Boolean(getClip(l.text, l.lang)))
const clipOf = (l: VoiceLine): Clip | undefined => (version.value, getClip(l.text, l.lang))
const keyOf = (l: VoiceLine) => `${l.lang}|${l.text}`

const allLines = computed<VoiceLine[]>(() => {
  if (source.value === APP) return appVoiceLines({ chinese: withChinese.value, childName: childName.value })
  if (!deck.value) return []
  return voiceLinesOf(cardsOf(deck.value), { sentences: withSentences.value, chinese: withChinese.value })
})
const lines = computed(() => (onlyMissing.value ? allLines.value.filter((l) => !hasClip(l)) : allLines.value))
const doneCount = computed(() => allLines.value.filter(hasClip).length)

/* ---------- 錄音 ---------- */

/** 麥克風最長錄多久：只是怕忘了按停止（錄音會佔記憶體），不是限制句子的長度 */
const MAX_RECORD_SECONDS = 300

const recKey = ref<string | null>(null)
const recSeconds = ref(0)
const busyKey = ref<string | null>(null)
const playingKey = ref<string | null>(null)
const error = ref('')

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let ticker: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let cancelled = false

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  // Chrome 錄 webm，iPad／Safari 錄 mp4；各用各的，同一台裝置錄、同一台放
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m))
}

function releaseMic() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  if (ticker) clearInterval(ticker)
  ticker = null
}

async function startRecord(line: VoiceLine) {
  error.value = ''
  stopSpeaking()
  playingKey.value = null
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    error.value = '這個瀏覽器沒辦法錄音。要用 https 網址，或是已經安裝成 App 的版本。'
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    error.value = '沒有麥克風的權限。到瀏覽器（或平板的「設定」）允許這個 App 使用麥克風，再按一次錄音。'
    return
  }
  const mime = pickMime()
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  chunks = []
  cancelled = false
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => { void finishRecord(line) }
  recKey.value = keyOf(line)
  recSeconds.value = 0
  startedAt = Date.now()
  recorder.start()
  ticker = setInterval(() => {
    recSeconds.value = (Date.now() - startedAt) / 1000
    if (recSeconds.value >= MAX_RECORD_SECONDS) stopRecord()
  }, 100)
}

function stopRecord() {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

async function finishRecord(line: VoiceLine) {
  const type = recorder?.mimeType || 'audio/webm'
  releaseMic()
  recKey.value = null
  if (cancelled) return
  const blob = new Blob(chunks, { type })
  busyKey.value = keyOf(line)
  try {
    const info = await analyzeRecording(blob)
    if (!info) {
      error.value = '沒有錄到聲音，靠近麥克風一點，再錄一次。'
      return
    }
    if (info.ms < 250) {
      error.value = '錄得太短了，再錄一次。'
      return
    }
    const clip = await saveClip(line.text, line.lang, blob, info.trim, info.ms)
    // 錄完馬上放一次給爸媽聽，不滿意再按重錄
    await play(line, clip)
  } finally {
    busyKey.value = null
  }
}

function toggleRecord(line: VoiceLine) {
  if (recKey.value === keyOf(line)) stopRecord()
  else if (!recKey.value && !busyKey.value) void startRecord(line)
}

async function play(line: VoiceLine, clip = clipOf(line)) {
  if (!clip) return
  playingKey.value = keyOf(line)
  try { await previewClip(clip) } finally { if (playingKey.value === keyOf(line)) playingKey.value = null }
}

async function remove(line: VoiceLine) {
  stopSpeaking()
  await removeClip(line.text, line.lang)
}

/* ---------- 匯入檔案（mp3、m4a、wav……）：複製一份進這台裝置，你電腦上的原檔不動 ---------- */

const importing = ref(false)
interface ImportReport { ok: number; unmatched: string[]; failed: { name: string; why: string }[] }
const report = ref<ImportReport | null>(null)

/** 音檔的種類和大小限制、存進裝置的檢查都在 utils/clipFiles.ts（雲端硬碟資料夾同步也用同一套） */
const ACCEPT = CLIP_ACCEPT
const importFile = importClipFile

/** 這一句旁邊的「匯入」：選一個檔案，取代這句的錄音 */
async function onPickFile(line: VoiceLine, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  report.value = null
  importing.value = true
  try {
    const r = await importFile(line, file)
    if ('why' in r) error.value = `${file.name}：${r.why}`
    else await play(line, r.clip)
  } finally {
    importing.value = false
  }
}

/**
 * 批次匯入：一次選很多檔，檔名就是那句話（`I'm hungry.mp3`、`Stand up.m4a`），不分大小寫、不管標點，
 * 自動對到句子。檔名後面的 (1)、(2)（重複下載時系統加的）會忽略。對不到的會列出來。
 */
async function onPickMany(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  error.value = ''
  importing.value = true
  const result: ImportReport = { ok: 0, unmatched: [], failed: [] }
  try {
    const index = lineIndexOf(videos.value, childName.value)
    for (const file of files) {
      const line = lineOfFileName(index, file.name)
      if (!line) { result.unmatched.push(file.name); continue }
      const r = await importFile(line, file)
      if ('why' in r) result.failed.push({ name: file.name, why: r.why })
      else result.ok++
    }
  } finally {
    importing.value = false
    report.value = result
  }
}

/* ---------- 跟其他裝置共用：存到共用資料夾（雲端硬碟）——檔名就是那句話，另一台用同樣的方式匯入或同步 ---------- */

const shareMsg = ref('')

/** 分享選單要在點擊的當下叫出來：這裡到 shareFiles 之間不能有 await */
function onShareAll() {
  const files = clipFiles()
  if (!files.length) return
  shareFiles(files, '爸媽的錄音').then((how) => {
    if (how === 'cancelled') return
    shareMsg.value = how === 'shared'
      ? `已交給分享選單（${files.length} 句）：選「雲端硬碟」，再選共用資料夾。檔名都取好了，不用改。`
      : `已下載 ${files.length} 個檔案，請全部移到共用資料夾，檔名不用改。`
  })
}

/* 全部刪除：按兩次才刪，第一次只是把按鈕變成確認 */
const confirmClear = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null
async function onClearAll() {
  if (!confirmClear.value) {
    confirmClear.value = true
    confirmTimer = setTimeout(() => { confirmClear.value = false }, 3500)
    return
  }
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmClear.value = false
  stopSpeaking()
  await clearClips()
}

// 換了字卡本、離開這一頁：錄到一半的丟掉，把麥克風還回去
watch(source, () => {
  cancelled = true
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  else releaseMic()
  recKey.value = null
})
onBeforeUnmount(() => {
  cancelled = true
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  releaseMic()
  if (confirmTimer) clearTimeout(confirmTimer)
  stopSpeaking()
})

const sizeLabel = computed(() => {
  const b = bytes.value
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
})
const secLabel = (c?: Clip) => {
  if (!c) return ''
  const s = c.ms / 1000
  return s < 60 ? `${s.toFixed(1)} 秒` : `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`
}
</script>

<template>
  <div class="voice">
    <p class="hint">
      錄一句，之後小朋友聽到那句話，就是<strong>你的聲音</strong>；沒錄的還是 App 的聲音。
      一句話錄一次就好——同一句出現在好幾本字卡、考考我、跟我說，都會用你錄的。
      錄音只存在這台裝置上，不會上傳、也不會跟著公開網站出去。每台裝置各自錄。
    </p>

    <!-- 已經有現成的音檔（手機錄音程式錄的、請老師錄的）：一次匯入很多個，檔名就是那句話 -->
    <div class="voice-import">
      <label class="voice-btn file" :class="{ 'is-disabled': importing || recKey !== null }">
        📁 批次匯入音檔
        <input
          class="file-input"
          type="file"
          multiple
          :accept="ACCEPT"
          :disabled="importing || recKey !== null"
          aria-label="批次匯入音檔"
          @change="onPickMany"
        >
      </label>
      <span class="voice-dim">
        檔名就是那句話，例如 <code>I'm hungry.mp3</code>、<code>Stand up.m4a</code>（不分大小寫、不管標點）。
        支援 mp3、m4a、wav；一個檔對一句話，長度不限（上限 30 MB）。檔案會複製進這台裝置，原檔不會動。
      </span>
    </div>

    <!-- 給其他裝置用：存到雲端硬碟的共用資料夾，檔名就是那句話；另一台用上面的「批次匯入音檔」，或設了資料夾同步就按「立即同步」 -->
    <div class="voice-import">
      <button class="voice-btn" :disabled="!count" @click="onShareAll">📤 全部存到共用資料夾（{{ count }} 句）</button>
      <span class="voice-dim">
        按下去跳出分享選單，選「雲端硬碟」再選共用資料夾，檔名已經取好（<code>I'm hungry.m4a</code>），不用改。
        另一台 iPad：「批次匯入音檔」選那個資料夾裡的檔案；或在「照片素材」設好資料夾同步，按「立即同步」就自己下載。
      </span>
    </div>
    <p v-if="shareMsg" class="voice-report-ok" role="status">{{ shareMsg }}</p>
    <p v-if="importing" class="voice-progress">匯入中…</p>
    <div v-if="report" class="voice-report" role="status">
      <p v-if="report.ok" class="voice-report-ok">✓ 匯入了 {{ report.ok }} 句</p>
      <p v-if="report.unmatched.length" class="voice-report-warn">
        ⚠ 這 {{ report.unmatched.length }} 個檔案對不到任何一句話（檔名要跟句子一樣）：{{ report.unmatched.join('、') }}
      </p>
      <p v-for="f in report.failed" :key="f.name" class="voice-report-warn">⚠ {{ f.name }}：{{ f.why }}</p>
      <p v-if="!report.ok && !report.unmatched.length && !report.failed.length" class="voice-report-warn">沒有選到檔案。</p>
    </div>

    <label class="field">
      <span>要錄哪一本</span>
      <select v-model="source" class="voice-select" aria-label="要錄哪一本">
        <option value="">請選一本…</option>
        <option :value="APP">⭐ App 說的話（Your turn!、Great job!……）</option>
        <optgroup v-for="g in deckGroups" :key="g.label" :label="g.label">
          <option v-for="d in g.decks" :key="d.uid" :value="d.uid">{{ d.title }}</option>
        </optgroup>
      </select>
    </label>

    <template v-if="source">
      <div class="voice-opts">
        <label v-if="source !== APP" class="check"><input v-model="withSentences" type="checkbox"> 連例句一起錄</label>
        <label class="check"><input v-model="withChinese" type="checkbox"> 連中文一起錄</label>
        <label class="check"><input v-model="onlyMissing" type="checkbox"> 只看還沒錄的</label>
      </div>

      <p class="voice-progress">
        <strong>{{ doneCount }} / {{ allLines.length }}</strong> 句已經錄好
        <span v-if="source === APP && !childName" class="voice-dim">（在上面「孩子的小名」填名字，這裡就能錄叫名字那一句）</span>
      </p>

      <p v-if="error" class="voice-error" role="alert">{{ error }}</p>

      <ul v-if="lines.length" class="voice-list">
        <li
          v-for="l in lines"
          :key="keyOf(l)"
          class="voice-row"
          :class="{ 'is-rec': recKey === keyOf(l), 'is-done': hasClip(l) }"
        >
          <div class="voice-text">
            <strong>{{ l.text }}</strong>
            <span v-if="l.lang === 'zh-TW'" class="voice-tag">中</span>
            <span v-if="l.note" class="voice-note">{{ l.note }}</span>
          </div>
          <span v-if="hasClip(l)" class="voice-ok">✓ {{ secLabel(clipOf(l)) }}</span>
          <button
            v-if="hasClip(l)"
            class="voice-btn"
            :aria-label="`試聽 ${l.text}`"
            :disabled="recKey !== null"
            @click="play(l)"
          >{{ playingKey === keyOf(l) ? '🔊' : '▶' }}</button>
          <button
            class="voice-btn rec"
            :class="{ 'is-rec': recKey === keyOf(l) }"
            :disabled="(recKey !== null && recKey !== keyOf(l)) || busyKey !== null || importing"
            :aria-label="recKey === keyOf(l) ? `停止錄 ${l.text}` : `錄 ${l.text}`"
            @click="toggleRecord(l)"
          >
            <template v-if="recKey === keyOf(l)">■ 停止 {{ recSeconds.toFixed(1) }}s</template>
            <template v-else-if="busyKey === keyOf(l)">處理中…</template>
            <template v-else>● {{ hasClip(l) ? '重錄' : '錄音' }}</template>
          </button>
          <label class="voice-btn file" :class="{ 'is-disabled': recKey !== null || busyKey !== null || importing }" :title="`匯入 ${l.text} 的音檔`">
            📁
            <input
              class="file-input"
              type="file"
              :accept="ACCEPT"
              :disabled="recKey !== null || busyKey !== null || importing"
              :aria-label="`匯入 ${l.text} 的音檔`"
              @change="onPickFile(l, $event)"
            >
          </label>
          <button
            v-if="hasClip(l)"
            class="voice-btn del"
            :aria-label="`刪掉 ${l.text} 的錄音`"
            :disabled="recKey !== null"
            @click="remove(l)"
          >🗑</button>
        </li>
      </ul>
      <p v-else-if="allLines.length" class="hint">這一本的句子都錄好了 🎉</p>
      <p v-else class="hint">這一本沒有英文可以錄。</p>
    </template>

    <div class="voice-foot">
      <span>這台裝置上共有 <strong>{{ count }}</strong> 句錄音（約 {{ sizeLabel }}）</span>
      <button v-if="count" class="voice-clear" :class="{ 'is-confirm': confirmClear }" @click="onClearAll">
        {{ confirmClear ? '再按一次，全部刪除' : '全部刪除' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.voice { display: flex; flex-direction: column; gap: 12px; }
.hint { margin: 0; font-size: 15px; line-height: 1.6; color: var(--text-dim); }
.hint strong { color: var(--text); }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 15px; color: var(--text-dim); }
.voice-select {
  width: 100%;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 16px;
  color: var(--text);
  background: var(--bg);
  border: 2px solid var(--line);
  border-radius: 14px;
  outline: none;
}
.voice-select:focus { border-color: var(--accent); }

.voice-opts { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 15px; cursor: pointer; }
.check input { width: 18px; height: 18px; accent-color: var(--accent); }

.voice-progress { margin: 0; font-size: 16px; }
.voice-progress strong { color: var(--accent); font-size: 18px; }
.voice-dim { color: var(--text-dim); font-size: 14px; }
.voice-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
  font-size: 15px;
  font-weight: 700;
}

.voice-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.voice-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
}
.voice-row.is-done { border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
.voice-row.is-rec { border-color: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent); }

.voice-text { flex: 1 1 200px; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.voice-text strong { font-size: 18px; overflow-wrap: anywhere; }
.voice-tag { padding: 0 6px; border-radius: 6px; background: var(--bg-card); font-size: 12px; font-weight: 800; color: var(--text-dim); }
.voice-note { font-size: 14px; color: var(--text-dim); }
.voice-ok { font-size: 14px; font-weight: 800; color: var(--ok); white-space: nowrap; }

.voice-btn {
  flex: none;
  min-width: 44px;
  height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
}
.voice-btn:active:not(:disabled) { transform: scale(.94); }
.voice-btn:disabled { opacity: .4; cursor: default; }
.voice-btn.rec { background: var(--accent); color: var(--on-accent); }
.voice-btn.rec.is-rec { background: var(--danger); color: #fff; animation: rec-pulse 1s ease-in-out infinite; }
.voice-btn.del { color: var(--danger); }
/* 匯入檔案：外面是 label 假裝成按鈕，真正的 input 藏起來 */
.voice-btn.file { display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
.voice-btn.file.is-disabled { opacity: .4; cursor: default; pointer-events: none; }
.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.voice-btn.file { position: relative; }

.voice-import { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.voice-import .voice-dim { flex: 1 1 260px; line-height: 1.5; }
.voice-dim code { padding: 1px 6px; border-radius: 6px; background: var(--bg-card); color: var(--text); font-size: 13px; }
.voice-report { display: flex; flex-direction: column; gap: 6px; }
.voice-report p { margin: 0; padding: 10px 14px; border-radius: 12px; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.voice-report-ok { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.voice-report-warn { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
@keyframes rec-pulse { 50% { opacity: .72; } }

.voice-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 15px;
  color: var(--text-dim);
}
.voice-clear {
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.voice-clear.is-confirm { border-color: var(--danger); background: var(--danger); color: #fff; }

@media (prefers-reduced-motion: reduce) {
  .voice-btn.rec.is-rec { animation: none; }
}
</style>
