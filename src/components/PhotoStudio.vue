<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLibrary } from '~/composables/useLibrary'
import { useState } from '~/composables/useState'
import { PLACES } from '~/utils/places'
import { canHavePhoto, imageSrc, isPicture } from '~/utils/cards'
import {
  allPhotos, cardPhotoKey, clearPhotos, pathPhotoKey, photosBytes, photoUrl, removePhoto, wordPhotoKey,
} from '~/utils/photos'
import { importPhotoFiles, photoFiles, shareFiles, type ImportReport } from '~/utils/photoFiles'
import { useDriveSync } from '~/composables/useDriveSync'
import PhotoTile from './PhotoTile.vue'

/**
 * 家長設定「照片」頁：選一本字卡本，每張卡一格，按一下就拍照或選照片；放哪裡的地點照片也在這裡換。
 * 跟其他裝置共用：「存到共用資料夾」把照片用卡上的字當檔名交給分享選單，另一台「從資料夾匯入照片」用檔名對卡。
 * 這裡不連雲端：存的時候在分享選單選、匯入時在「檔案」App 選。想讓 iPad 自己從雲端硬碟資料夾抓，
 * 在上面「圖片和聲音」設定雲端硬碟資料夾同步（components/DriveFolder.vue），最上層的照片一樣用檔名對卡。
 */
const { videos, sections, categories } = useLibrary()

/** 有照片的地點：客廳沒有預設照片（用 emoji），不放進來 */
const places = PLACES.filter((p) => p.image)

/* ---------- 選字卡本：照大分類 › 分區分組（跟錄音頁一樣） ---------- */

const pickedDeck = useState('photos.pickedDeck', () => '')

const deckGroups = computed(() => {
  const sectionName = new Map(sections.value.map((s) => [s.id, s.name]))
  const catById = new Map(categories.value.map((c) => [c.id, c]))
  const groups = new Map<string, { label: string; decks: { uid: string; title: string }[] }>()
  for (const v of videos.value) {
    // 數字卡是用 emoji 畫出幾個讓孩子數，整本都是數字卡的就不列
    if (v.kind !== 'deck' || !(v.cards ?? []).some(canHavePhoto)) continue
    const cat = catById.get(v.categoryId)
    const label = [cat ? sectionName.get(cat.sectionId) : '', cat?.name].filter(Boolean).join(' › ') || '字卡'
    if (!groups.has(label)) groups.set(label, { label, decks: [] })
    groups.get(label)!.decks.push({ uid: v.uid, title: v.title })
  }
  return [...groups.values()]
})

const deck = computed(() => videos.value.find((v) => v.uid === pickedDeck.value && v.kind === 'deck'))

const tiles = computed(() =>
  (deck.value?.cards ?? [])
    .filter((c) => c.word.trim() && canHavePhoto(c))
    .map((c, i) => ({
      id: `${i}-${c.word}`,
      word: c.word.trim(),
      meaning: c.meaning,
      // 原本的圖：照片路徑，或 emoji（沒換照片時顯示）
      src: isPicture(c) ? imageSrc(c.image) : '',
      text: isPicture(c) ? '' : c.image,
      photoKey: wordPhotoKey(c.word),
      legacyKey: cardPhotoKey(deck.value!.uid, c.word),
    })),
)
const tilesDone = computed(() => tiles.value.filter((t) => photoUrl(t.legacyKey) || photoUrl(t.photoKey)).length)

/* ---------- 換過的照片、對得上哪些卡 ---------- */

/** 現在所有字卡上，可以換照片的字（數字卡不行）：小寫的字 → 給匯入、同步對檔名，給列表標出對不到的 */
const { words } = useDriveSync()
const knownWords = computed(() => new Set(words.value.values()))

/** 舊版只換某一本的照片：key → 「字卡本・字」 */
const legacyLabels = computed(() => {
  const m = new Map<string, string>()
  for (const v of videos.value) {
    if (v.kind !== 'deck') continue
    for (const c of v.cards ?? []) {
      m.set(cardPhotoKey(v.uid, c.word), `${v.title}・${c.word}${c.meaning ? `（${c.meaning}）` : ''}`)
    }
  }
  return m
})

const cardPhotos = computed(() =>
  allPhotos()
    .filter((p) => p.key.startsWith('word|') || p.key.startsWith('card|'))
    .map((p) => {
      const isWord = p.key.startsWith('word|')
      const word = isWord ? p.key.slice(5) : ''
      const label = isWord
        ? (knownWords.value.has(word) ? `所有字是「${word}」的卡` : '')
        : legacyLabels.value.get(p.key) ?? ''
      return { key: p.key, url: photoUrl(p.key) ?? '', label, lostWhy: isWord ? `目前沒有字是「${word}」的卡` : '字卡本改了名字，或卡上的字改過' }
    }),
)

const total = computed(() => allPhotos().length)
const megabytes = computed(() => (photosBytes() / 1048576).toFixed(1))

async function onClearAll() {
  if (!confirm(`把 ${total.value} 張照片全部刪掉、還原成預設圖嗎？\n（刪掉之後沒辦法復原，除非之前有備份或存在共用資料夾）`)) return
  await clearPhotos()
}

async function onRemove(key: string, label: string) {
  if (label && !confirm(`把「${label}」還原成預設圖？`)) return
  await removePhoto(key)
}

const shareMsg = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)

/** 分享選單要在點擊的當下叫出來：這裡到 shareFiles 之間不能有 await */
function onShareAll() {
  const files = photoFiles()
  if (!files.length) return
  shareFiles(files, '家裡的照片').then((how) => {
    if (how === 'cancelled') return
    shareMsg.value = {
      text: how === 'shared'
        ? `已交給分享選單（${files.length} 張）：選「雲端硬碟」，再選共用資料夾。檔名都取好了，不用改。`
        : `已下載 ${files.length} 張，請全部移到共用資料夾，檔名不用改。`,
      kind: 'ok',
    }
  })
}

const importing = ref(false)
const report = ref<ImportReport | null>(null)
const importErr = ref('')

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length || importing.value) return
  importing.value = true
  report.value = null
  importErr.value = ''
  try {
    report.value = await importPhotoFiles(files, words.value)
  } catch (err) {
    importErr.value = (err as Error).message || '匯入失敗。'
  } finally {
    importing.value = false
  }
}

const SHOWN = 12
const names = (list: string[]) => (list.length > SHOWN ? `${list.slice(0, SHOWN).join('、')}…等 ${list.length} 個` : list.join('、'))
</script>

<template>
  <div class="photos">
    <div class="howto">
      <strong class="howto-title">怎麼用</strong>
      <ol>
        <li><b>換照片</b>：在下面選一本字卡本，<b>按一下卡片</b>就能拍照，或從相簿選。換好的卡會打勾。</li>
        <li><b>給其他裝置用</b>：按「存到共用資料夾」，跳出分享選單後選「雲端硬碟」，再選你的資料夾。檔名已經取好，不用改。</li>
        <li><b>另一台裝置</b>：按「從資料夾匯入照片」，在「檔案」App 裡打開那個資料夾，把照片全選。</li>
      </ol>
      <p class="howto-note">
        資料夾<b>不用在 App 裡設定</b>（存的時候在分享選單選、匯入時在「檔案」App 選）。
        這裡是「<b>依字換卡片的圖</b>」（一張照片換掉所有同一個字的卡）；整批的書頁圖片、動物叫聲請用上面的「圖片和聲音」。
        照片縮小、轉成 JPEG 後<b>只存在這台裝置</b>（位置等資訊會去掉），不會出現在公開網站；這台壞了就沒了，請定期到「來源備份」做備份。
      </p>
    </div>

    <h3 class="sub">換字卡的照片</h3>
    <label class="field">
      <span>選一本字卡本</span>
      <select v-model="pickedDeck" class="select" aria-label="選一本字卡本">
        <option value="">請選一本…</option>
        <optgroup v-for="g in deckGroups" :key="g.label" :label="g.label">
          <option v-for="d in g.decks" :key="d.uid" :value="d.uid">{{ d.title }}</option>
        </optgroup>
      </select>
    </label>

    <template v-if="deck">
      <p class="progress">
        <strong>{{ tilesDone }} / {{ tiles.length }}</strong> 張換成自己的照片
        <span class="dim">・按一下卡片拍照或選照片，右下角是相機</span>
      </p>
      <div class="grid">
        <PhotoTile
          v-for="t in tiles"
          :key="t.id"
          :photo-key="t.photoKey"
          :legacy-key="t.legacyKey"
          :word="t.word"
          :meaning="t.meaning"
          :default-src="t.src"
          :default-text="t.text"
        />
      </div>
      <p v-if="!tiles.length" class="empty">這一本都是數字卡，不能換成照片。</p>
    </template>
    <p v-else class="empty">選了字卡本，這裡就會出現這一本的每張卡。數字卡是用 emoji 畫出幾個讓孩子數，不能換成照片。</p>

    <h3 class="sub">放哪裡的地點照片</h3>
    <p class="hint">換成自己家的廚房、浴室、臥室、門口。</p>
    <div class="grid places">
      <PhotoTile
        v-for="p in places"
        :key="p.id"
        :photo-key="pathPhotoKey(p.image)"
        :word="`${p.emoji} ${p.zh}`"
        :default-src="imageSrc(p.image)"
      />
    </div>

    <h3 class="sub">跟其他裝置共用照片</h3>
    <div class="io-row">
      <button class="ghost-btn primary" :disabled="!total" @click="onShareAll">📤 全部存到共用資料夾（{{ total }} 張）</button>
      <label class="ghost-btn file" :class="{ 'is-disabled': importing }">
        {{ importing ? '匯入中…' : '📥 從資料夾匯入照片' }}
        <input
          class="file-input"
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          :disabled="importing"
          aria-label="從資料夾匯入照片"
          @change="onImport"
        >
      </label>
    </div>
    <p class="hint">
      檔名就是對應：<code>apple.jpg</code> 換掉所有字是 apple 的卡，<code>place-kitchen.jpg</code> 換廚房的地點照片。
      <b>知道資料夾網址的人都看得到裡面的照片，請不要放拍得到小朋友的照片。</b>
      想讓 iPad 自己從雲端硬碟抓：到上面「圖片和聲音」設定資料夾同步，資料夾最上層的照片（檔名＝卡上的字）也會自動換上。
    </p>
    <p v-if="shareMsg" class="msg ok" role="status">{{ shareMsg.text }}</p>
    <p v-if="importErr" class="msg err" role="alert">{{ importErr }}</p>

    <div v-if="report" class="report" role="status">
      <p v-if="report.saved.length" class="ok">✓ 換了 {{ report.saved.length }} 張：{{ names(report.saved) }}</p>
      <p v-if="report.unmatched.length" class="warn">
        ⚠ {{ report.unmatched.length }} 個檔名對不到任何卡（檔名要跟卡上的字一樣）：{{ names(report.unmatched) }}
      </p>
      <p v-if="report.older.length" class="warn">⚠ 同一個名字有好幾個檔，只用了最新的，略過 {{ report.older.length }} 個：{{ names(report.older) }}</p>
      <p v-for="f in report.failed" :key="f.name" class="warn">⚠ {{ f.name }}：{{ f.why }}</p>
      <p v-if="report.ignored.length" class="dim">略過 {{ report.ignored.length }} 個不是照片的檔</p>
      <p v-if="!report.saved.length && !report.unmatched.length && !report.failed.length && !report.older.length" class="warn">沒有選到可以匯入的照片。</p>
    </div>

    <template v-if="total">
      <h3 class="sub">換過的照片</h3>
      <ul class="card-list">
        <li v-for="c in cardPhotos" :key="c.key" class="card-row">
          <img class="thumb" :src="c.url" alt="">
          <span class="card-label" :class="{ 'is-lost': !c.label }">
            {{ c.label || `找不到對應的卡（${c.lostWhy}）` }}
          </span>
          <button class="ghost-btn small" @click="onRemove(c.key, c.label)">
            {{ c.label ? '還原預設圖' : '刪除' }}
          </button>
        </li>
      </ul>
      <div class="foot">
        <span class="count">共 {{ total }} 張，佔 {{ megabytes }} MB</span>
        <button class="ghost-btn small danger" @click="onClearAll">全部還原成預設圖</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.photos { display: flex; flex-direction: column; gap: 4px; }
.hint { margin: 0 0 8px; }
.hint code { padding: 1px 6px; border-radius: 6px; background: var(--bg-card); font-size: .92em; }
.hint b, .howto b { color: var(--text); }

.howto {
  padding: 14px 18px;
  border: 2px solid var(--accent);
  border-radius: 16px;
  background: var(--bg-card);
}
.howto-title { display: block; margin-bottom: 6px; font-size: 16px; }
.howto ol { margin: 0 0 8px; padding-left: 22px; display: grid; gap: 4px; font-size: 15px; line-height: 1.6; }
.howto-note { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-dim); }

.sub { margin: 20px 0 4px; font-size: 17px; }

.field { display: flex; flex-direction: column; gap: 6px; max-width: 460px; margin-bottom: 4px; font-size: 15px; color: var(--text-dim); }
.select {
  min-height: 48px;
  padding: 10px 14px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
}
.select:focus { border-color: var(--accent); outline: none; }

.progress { margin: 6px 0 8px; font-size: 16px; }
.progress strong { color: var(--accent); font-size: 18px; }
.dim { color: var(--text-dim); font-size: 14px; font-weight: 500; }

/* 一格一張卡：iPad mini 直放一排四格 */
.grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
.grid.places { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }

.io-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 8px; }
.ghost-btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
.ghost-btn.primary { background: var(--accent); border-color: var(--accent-edge); color: var(--on-accent); }
.ghost-btn:disabled, .ghost-btn.is-disabled { opacity: .45; pointer-events: none; }
.ghost-btn.file { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.ghost-btn.link { display: inline-flex; align-items: center; text-decoration: none; color: var(--text); }
.file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ghost-btn.small { padding: 10px 16px; font-size: 15px; white-space: nowrap; }

.msg { margin: 8px 0 0; font-size: 14px; min-height: 0; }
.report { display: grid; gap: 6px; margin: 4px 0 8px; }
.report p { margin: 0; padding: 10px 14px; border-radius: 12px; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; background: var(--bg-card); }
.report .ok { color: var(--ok); }
.report .warn { color: var(--accent-2); }
.report .dim { color: var(--text-dim); font-weight: 500; }

.card-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
}
.thumb { flex: none; width: 56px; height: 56px; object-fit: cover; border-radius: 10px; }
.card-label { flex: 1; min-width: 0; font-size: 15px; overflow-wrap: anywhere; }
.card-label.is-lost { color: var(--danger); }

.empty { margin: 4px 0 0; font-size: 15px; color: var(--text-dim); }

.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.count { font-size: 15px; color: var(--text-dim); }
.danger { color: var(--danger); }
</style>
