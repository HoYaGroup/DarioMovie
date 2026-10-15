<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLibrary, type LocalEdit } from '~/composables/useLibrary'
import { useDragSort } from '~/composables/useDragSort'
import { parseVideoId, thumbUrl, MISSION_MAX, type VideoItem, type Card, type Mission, type MissionAct, type AskKind } from '~/utils/youtube'
import { isPicture, imageSrc, canHavePhoto, missionsOf, askKindOf, isZhCard, frontQuestion, customQuestionNames } from '~/utils/cards'
import { cardPhotoKey, cardPhotoUrl, wordPhotoKey } from '~/utils/photos'
import PhotoButton from './PhotoButton.vue'

/**
 * 家長設定頁「目前片單」裡展開的編輯區：改標題、影片或網站的網址，字卡本可以一張一張改卡片。
 * 先改草稿，按「儲存」才寫進片單（算一步復原）；改的只存在這台裝置，試算表更新之後會再套回去。
 */
const props = defineProps<{ item: VideoItem; edit?: LocalEdit }>()
const emit = defineEmits<{ close: [] }>()

const { editItem, revertItem } = useLibrary()

/** 草稿裡的卡：key 給 v-for 用（卡片會排序、刪除，用位置當 key 會對錯），句子改成一行一句的文字 */
type DraftCard = Card & { key: number; sentencesText: string }

let nextKey = 0
function toDraft(c: Card): DraftCard {
  return { ...JSON.parse(JSON.stringify(c)), key: nextKey++, sentencesText: c.sentences.join('\n') }
}
function fromDraft({ key: _key, sentencesText, ...card }: DraftCard): Card {
  return { ...card, sentences: sentencesText.split('\n').map((s) => s.trim()).filter(Boolean) }
}

/** 草稿裡的任務題目：key 給 v-for 用；片單上寫的 {zh}、{en}、{abc} 記號照原樣留著 */
type DraftMission = Mission & { key: number }

function toDraftMission(m: Mission): DraftMission {
  return { ...JSON.parse(JSON.stringify(m)), key: nextKey++ }
}
function fromDraftMission({ key: _key, ...m }: DraftMission): Mission {
  return m
}

const isDeck = computed(() => props.item.kind === 'deck')
const isSite = computed(() => props.item.kind === 'site')

const title = ref('')
const url = ref('')
const cards = ref<DraftCard[]>([])
const missions = ref<DraftMission[]>([])
/** 正在改的那一張；一次只攤開一張，一百張的字卡本才不會長到捲不完 */
const openKey = ref<number | null>(null)
const msg = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' })

/** 草稿換成片單上現在的樣子（打開時、儲存或還原之後） */
function load() {
  const it = props.item
  title.value = it.title
  url.value = it.kind === 'site' ? it.url ?? '' : it.kind === 'deck' ? '' : `https://youtu.be/${it.id}`
  cards.value = (it.cards ?? []).map(toDraft)
  missions.value = missionsOf(it).map(toDraftMission)
  openKey.value = null
}
load()

/** 網址改了之後的縮圖，貼對了馬上看得到是哪一部 */
const previewId = computed(() => (isDeck.value || isSite.value ? null : parseVideoId(url.value.trim())))

const dirty = computed(() => {
  const it = props.item
  if (title.value.trim() !== it.title) return true
  if (isSite.value && url.value.trim() !== (it.url ?? '')) return true
  if (!isDeck.value && !isSite.value && previewId.value !== it.id) return true
  return isDeck.value && (
    JSON.stringify(cards.value.map(fromDraft)) !== JSON.stringify(it.cards ?? [])
    || JSON.stringify(missions.value.map(fromDraftMission)) !== JSON.stringify(missionsOf(it))
  )
})

function toggleCard(key: number) {
  openKey.value = openKey.value === key ? null : key
}

function addCard() {
  const card = toDraft({ word: '', meaning: '', sentences: [], image: '', backImage: '', clip: null })
  cards.value.push(card)
  openKey.value = card.key
}

function removeCard(i: number) {
  const c = cards.value[i]
  if (c?.word && !confirm(`確定要刪除「${c.word}」這張卡嗎？`)) return
  cards.value.splice(i, 1)
}

/** 新增一個題目：先給一句通用的，讓家長照著改 */
function addMission() {
  missions.value.push(toDraftMission({
    card: '', zh: '家裡找找看，有沒有{zh}？', en: 'Can you find the {en}?', goal: 2, tip: '',
  }))
}

function removeMission(i: number) {
  missions.value.splice(i, 1)
}

/** 「小朋友要做什麼」：空的是自動（找；話裡有 {place} 的是放） */
function setAct(m: DraftMission, ev: Event) {
  const v = (ev.target as HTMLSelectElement).value as MissionAct | ''
  if (v) m.act = v
  else delete m.act
}

/** 縮圖列上的圖：換過照片的話顯示照片（照片是依卡上的字存的，所有字一樣的卡都會換） */
function ownPhoto(c: Card): string | undefined {
  return canHavePhoto(c) && c.word.trim() ? cardPhotoUrl(props.item.uid, c.word) : undefined
}

/** 這裡改不到的設定（影片片段、唸法、相反詞…）照原樣保留，說一聲讓家長放心 */
const hasExtras = (c: Card) => Boolean(c.clip || c.backImage || c.say || c.pair || c.place)

/**
 * 正面問的問句：預設看字卡本的名稱（utils/cards.ts 的 askKindOf），每張卡也可以自己指定（片單的「問:」）。
 * 能選的是內建的 19 種，加上試算表「問句」工作表自己加的；問句的字（英文和中文）都在那個工作表改，這裡只選名字。
 * 識字卡（中文字、注音）問「這個字怎麼唸？」、相反詞問「Is it big or small?」，不看這個設定，就不列出來。
 */
const BUILTIN_ASKS = ['thing', 'color', 'shape', 'feeling', 'action', 'should', 'say', 'quote', 'like', 'who', 'where', 'weather', 'season', 'day', 'month', 'time', 'daypart', 'sense', 'sound'] as const satisfies readonly AskKind[]
const askOptions = computed<string[]>(() => [...BUILTIN_ASKS, ...customQuestionNames()])
const deckAsk = computed(() => props.item.ask ?? askKindOf(props.item.title))
const askable = (c: Card) => !isZhCard(c) && !c.pair
const askLabel = (k: string) => `${frontQuestion(k).en}　${frontQuestion(k).zh}`

function setAsk(c: DraftCard, ev: Event) {
  const v = (ev.target as HTMLSelectElement).value
  if (v) c.ask = v
  else delete c.ask
}

/** 一次改整本：選一種問法，每張卡都改成它；「照字卡本」是把每張卡自己指定的清掉 */
function setAllAsk(ev: Event) {
  const sel = ev.target as HTMLSelectElement
  const v = sel.value
  sel.value = ''
  if (!v) return
  const kind = v === 'auto' ? undefined : v
  for (const c of cards.value) {
    if (!askable(c)) continue
    if (kind) c.ask = kind
    else delete c.ask
  }
}

const cardListRef = ref<HTMLElement | null>(null)
const drag = useDragSort()

function dragCard(ev: PointerEvent, index: number) {
  drag.start(ev, {
    key: 'cards',
    index,
    getRows: () => [...(cardListRef.value?.querySelectorAll('[data-card-row]') ?? [])] as HTMLElement[],
    onMove: (from, to) => {
      const [moved] = cards.value.splice(from, 1)
      cards.value.splice(to, 0, moved!)
    },
  })
}

function onSave() {
  const result = editItem(props.item.uid, {
    title: title.value,
    ...(isDeck.value
      ? { cards: cards.value.map(fromDraft), missions: missions.value.map(fromDraftMission) }
      : { url: url.value }),
  })
  msg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) load()
}

function onClose() {
  if (dirty.value && !confirm('還有沒儲存的修改，確定不要了嗎？')) return
  emit('close')
}

function onRevert() {
  if (!confirm(`把「${props.item.title}」在這台裝置上改的全部還原成試算表的內容？`)) return
  revertItem(props.item.uid)
  load()
  msg.value = { text: '已還原成試算表的內容，弄錯了可以按「目前片單」的復原。', kind: 'ok' }
}
</script>

<template>
  <div class="item-editor">
    <label class="field">
      <span>標題</span>
      <input v-model="title" type="text">
    </label>

    <label v-if="isSite" class="field">
      <span>網站網址</span>
      <input
        v-model="url"
        type="text"
        inputmode="url"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="https://"
      >
    </label>

    <div v-else-if="!isDeck" class="url-row">
      <label class="field">
        <span>YouTube 網址或影片 ID</span>
        <input
          v-model="url"
          type="text"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="https://www.youtube.com/watch?v=..."
        >
      </label>
      <img v-if="previewId" class="url-thumb" :src="thumbUrl(previewId)" alt="">
    </div>

    <template v-if="isDeck">
      <div class="cards-head">
        <span>卡片 {{ cards.length }} 張</span>
        <span class="cards-tip">點卡片打開來改，按住左邊的把手可以拖曳排序</span>
      </div>

      <label v-if="cards.some(askable)" class="field deck-ask">
        <span>整本字卡正面問的問題（現在是「{{ frontQuestion(deckAsk).zh }}」）：一次全部換掉</span>
        <select class="mission-select" value="" @change="setAllAsk">
          <option value="">要換的話在這裡選…</option>
          <option value="auto">全部照字卡本的名稱（自動）</option>
          <option v-for="k in askOptions" :key="k" :value="k">{{ askLabel(k) }}</option>
        </select>
      </label>

      <ol ref="cardListRef" class="card-list">
        <li
          v-for="(card, i) in cards"
          :key="card.key"
          data-card-row
          class="card-row"
          :class="{ 'is-open': openKey === card.key, 'is-dragging': drag.isDragging('cards', i) }"
        >
          <div class="card-head">
            <button class="grip" aria-label="拖曳排序卡片" @pointerdown="dragCard($event, i)">
              <svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
            </button>

            <button class="card-sum" :aria-expanded="openKey === card.key" @click="toggleCard(card.key)">
              <span class="card-pic" aria-hidden="true">
                <img v-if="ownPhoto(card)" :src="ownPhoto(card)" alt="">
                <img v-else-if="isPicture(card)" :src="imageSrc(card.image)" alt="">
                <template v-else>{{ card.image }}</template>
              </span>
              <span class="card-word" :class="{ 'is-empty': !card.word.trim() }">{{ card.word.trim() || '還沒寫字' }}</span>
              <span class="card-meaning">{{ card.meaning }}</span>
            </button>

            <button class="card-del" :aria-label="`刪除「${card.word}」`" @click="removeCard(i)">
              <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
            </button>
          </div>

          <div v-if="openKey === card.key" class="card-fields">
            <label class="field">
              <span>字（卡片上最大的那個字，例如 cat、3、山）</span>
              <input v-model="card.word" type="text" autocapitalize="off">
            </label>
            <label class="field">
              <span>中文／說明</span>
              <input v-model="card.meaning" type="text">
            </label>
            <label class="field">
              <span>圖：emoji，或 cards/ 開頭的圖片路徑</span>
              <input v-model="card.image" type="text" autocapitalize="off" autocorrect="off" spellcheck="false">
            </label>
            <div v-if="canHavePhoto(card)" class="photo-field">
              <p class="photo-label">
                換成自己拍的照片：所有字是「{{ card.word.trim() || '…' }}」的卡一起換。只存在這台裝置，不會上傳，也不會出現在公開網站
              </p>
              <PhotoButton
                v-if="card.word.trim()"
                :photo-key="wordPhotoKey(card.word)"
                :legacy-key="cardPhotoKey(item.uid, card.word)"
                :default-src="isPicture(card) ? imageSrc(card.image) : ''"
                :default-text="isPicture(card) ? '' : card.image"
              />
              <p v-else class="hint">先在上面寫好這張卡的字，再換照片。</p>
            </div>
            <label class="field">
              <span>英文句子：一行一句，翻面時輪流唸（例如 Yum, delicious apple!）</span>
              <textarea v-model="card.sentencesText" rows="3" autocapitalize="sentences" />
            </label>
            <label v-if="askable(card)" class="field">
              <span>正面問的問題（問錯的話在這裡改，例如把「這是什麼？」改成「這是誰？」。問句的字在試算表的「問句」工作表改）</span>
              <select class="mission-select" :value="card.ask ?? ''" @change="setAsk(card, $event)">
                <option value="">照這本字卡：{{ askLabel(deckAsk) }}</option>
                <option v-for="k in askOptions" :key="k" :value="k">{{ askLabel(k) }}</option>
              </select>
            </label>
            <p v-if="hasExtras(card)" class="hint">
              這張卡還有影片片段、唸法這些設定，這裡改不到，會照原樣保留。
            </p>
          </div>
        </li>
      </ol>

      <button class="ghost-btn small add-card" @click="addCard">＋ 新增一張卡</button>

      <div class="cards-head missions-head">
        <span>任務題目 {{ missions.length }} 個</span>
        <span class="cards-tip">有題目的字卡本會排進首頁的「今日任務」；寫幾個題目，每次排上去就換一個</span>
      </div>

      <ol class="mission-list">
        <li v-for="(m, i) in missions" :key="m.key" class="mission-row">
          <div class="mission-row-head">
            <strong>題目 {{ i + 1 }}</strong>
            <button class="card-del" :aria-label="`刪除題目 ${i + 1}`" @click="removeMission(i)">
              <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
            </button>
          </div>
          <label class="field">
            <span>中文那一句（小朋友會聽到）</span>
            <input v-model="m.zh" type="text">
          </label>
          <label class="field">
            <span>英文那一句（English 模式用英文語音唸，不能夾中文）</span>
            <input v-model="m.en" type="text" autocapitalize="sentences">
          </label>
          <div class="mission-two">
            <label class="field">
              <span>小朋友要做什麼</span>
              <select class="mission-select" :value="m.act ?? ''" @change="setAct(m, $event)">
                <option value="">找（按「我找到了」）</option>
                <option value="put">放（按「我放好了」）</option>
                <option value="do">做（按「我做到了」）</option>
              </select>
            </label>
            <label class="field">
              <span>要按幾次</span>
              <select v-model.number="m.goal" class="mission-select">
                <option v-for="n in MISSION_MAX" :key="n" :value="n">{{ n }} 次</option>
              </select>
            </label>
          </div>
          <label class="field">
            <span>給爸爸媽媽看的提示（選填，小朋友看不到）</span>
            <input v-model="m.tip" type="text">
          </label>
        </li>
      </ol>
      <p class="hint">
        句子裡可以放 {zh}、{en}（換成這一次認識的那張卡的中文、英文名字）和 {abc}（那張卡開頭的字母）。
        一個題目都沒有的字卡本，不會排進「今日任務」。
      </p>
      <button class="ghost-btn small add-card" @click="addMission">＋ 新增一個題目</button>
    </template>

    <p class="msg" :class="msg.kind" role="status">{{ msg.text }}</p>

    <div class="editor-actions">
      <button class="ghost-btn small save-btn" :disabled="!dirty" @click="onSave">儲存</button>
      <button class="ghost-btn small" @click="onClose">{{ dirty ? '取消' : '完成' }}</button>
    </div>

    <div v-if="edit" class="edited-note">
      <p class="hint">
        這一筆在這台裝置上改過。只有這台看得到，試算表更新之後也會保留；要每台裝置都一樣，請改試算表。
        <strong v-if="edit.fileChanged" class="warn">試算表後來也改了這一筆，現在用的是這台裝置改的版本。</strong>
      </p>
      <button class="revert-link" @click="onRevert">還原成試算表的內容</button>
    </div>
  </div>
</template>

<style scoped>
/* 自己占一行，接在把手後面，跟上面的標題對齊 */
.item-editor {
  flex-basis: 100%;
  min-width: 0;
  margin-left: 41px;
  padding: 10px 4px 6px;
  border-top: 1px solid var(--line);
}

.photo-field { margin: 4px 0 16px; }
.photo-label { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--text-dim); }

.url-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.url-row .field { flex: 1; min-width: 0; }
.url-thumb {
  flex: none;
  width: 96px;
  aspect-ratio: 16 / 9;
  margin-bottom: 14px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--bg);
}

.cards-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 4px 0 8px;
  font-size: 14px;
  font-weight: 700;
}
.cards-tip { font-size: 12px; font-weight: 500; color: var(--text-dim); }
.missions-head { margin-top: 18px; }

.mission-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: grid;
  gap: 8px;
}
.mission-row {
  padding: 8px 12px 2px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
}
.mission-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 14px;
}
.mission-two { display: flex; flex-wrap: wrap; gap: 0 14px; }
.mission-two .field { flex: 1 1 180px; min-width: 0; }
.mission-select {
  width: 100%;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 16px;
  color: var(--text);
  background: var(--bg-soft);
  border: 2px solid var(--line);
  border-radius: 14px;
  outline: none;
}
.mission-select:focus { border-color: var(--accent); }
.deck-ask { margin-bottom: 10px; }

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.card-row {
  border: 2px solid transparent;
  border-radius: 12px;
  background: var(--bg);
  transition: opacity .15s ease;
}
.card-row.is-open { border-color: var(--accent); }
.card-row.is-dragging {
  opacity: .55;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
}

.grip {
  flex: none;
  width: 30px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-dim);
  display: grid;
  place-items: center;
  cursor: grab;
  /* 一定要關掉，否則 iPad 會判定成捲動頁面 */
  touch-action: none;
}
.grip:active { background: var(--line); cursor: grabbing; }
.grip svg { width: 10px; height: 16px; fill: currentColor; }

.card-sum {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.card-sum:active { background: var(--bg-card); }

.card-pic {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 22px;
  line-height: 1;
}
.card-pic img { width: 100%; height: 100%; object-fit: cover; }

.card-word {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 800;
}
.card-word.is-empty { color: var(--danger); font-weight: 600; }

.card-meaning {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  color: var(--text-dim);
}

.card-del {
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-dim);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.card-del:active,
.card-del:hover { background: rgba(255, 95, 109, .18); color: var(--danger); }
.card-del svg { width: 16px; height: 16px; fill: currentColor; }

.card-fields { padding: 6px 12px 4px 38px; }

/* 全域的 .field input 沒有管到 textarea，樣式照著它 */
.card-fields textarea {
  width: 100%;
  padding: 12px 14px;
  /* 小於 16px 的話 iPad 一點進去就會放大畫面 */
  font-size: 16px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg-soft);
  border: 2px solid var(--line);
  border-radius: 14px;
  outline: none;
  resize: vertical;
}
.card-fields textarea:focus { border-color: var(--accent); }
.card-fields .field input { background: var(--bg-soft); }

.ghost-btn.small { padding: 10px 16px; font-size: 15px; white-space: nowrap; }
.add-card { margin-top: 10px; }

.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}
.save-btn {
  background: var(--accent);
  border-color: var(--accent-edge);
  color: var(--on-accent);
}
.save-btn:disabled {
  opacity: .4;
  cursor: default;
}

.edited-note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.edited-note .hint { margin-bottom: 6px; }
.edited-note .warn { display: block; margin-top: 4px; color: var(--accent); }

.revert-link {
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 14px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.revert-link:active { color: var(--accent); }

@media (max-width: 620px) {
  .item-editor { margin-left: 0; }
  .card-fields { padding-left: 12px; }
}
</style>
