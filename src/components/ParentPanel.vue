<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { thumbUrl, categoryColor } from '~/utils/youtube'
import { humanMinutes, countdown, dayKey, type BreakMode, useWatchTime } from '~/composables/useWatchTime'
import { useLibrary } from '~/composables/useLibrary'
import { useDragSort } from '~/composables/useDragSort'
import { useCollapse } from '~/composables/useCollapse'
import { useParentGate } from '~/composables/useParentGate'
import { useDisplay } from '~/composables/useDisplay'
import { useTheme } from '~/composables/useTheme'
import PanelSection from '~/components/PanelSection.vue'

const emit = defineEmits<{ close: [] }>()

const {
  sections, categories, subCategories, videos, appTitle, syncStatus,
  canUndo, lastAction, undo,
  syncFromPlaylist, playlistUrl,
  categoriesIn, countInSection, subsIn, countIn, groupsIn,
  addVideo, removeVideo, renameVideo, setVideoPlace, reorderVideos,
  addSection, renameSection, removeSection, reorderSections, setCategorySection,
  addCategory, renameCategory, removeCategory, reorderCategories,
  addSubCategory, renameSubCategory, removeSubCategory, reorderSubCategories,
  setAppTitle, exportJson, importJson,
} = useLibrary()

const drag = useDragSort()
const { init: initCollapse, expandAll, collapseAll, isCollapsed, toggle: toggleCollapse } = useCollapse()

onMounted(initCollapse)

type Msg = { text: string; kind: '' | 'ok' | 'err' }
const blank: Msg = { text: '', kind: '' }

/* ============ 新增影片 ============ */

const urlInput = ref('')
const titleInput = ref('')
const targetCategory = ref(categories.value[0]?.id ?? '')
const targetSub = ref<string | null>(null)
const addMsg = ref<Msg>({ ...blank })
const busy = ref(false)

// 分區被刪掉時，選擇要跟著退回一個還在的分區
const safeTarget = computed(() =>
  categories.value.some((c) => c.id === targetCategory.value)
    ? targetCategory.value
    : categories.value[0]?.id ?? '',
)

const targetSubs = computed(() => subsIn(safeTarget.value))

/** 新增影片的分區膠囊要照大分類分組，才知道自己選的是哪一邊的 */
const chipGroups = computed(() =>
  sections.value
    .map((sec) => ({ sec, cats: categoriesIn(sec.id) }))
    .filter((g) => g.cats.length),
)

function pickCategory(id: string) {
  targetCategory.value = id
  targetSub.value = null   // 換分區就清掉細分選擇
}

async function onAddVideo() {
  if (busy.value) return
  busy.value = true
  addMsg.value = { text: '加入中…', kind: '' }

  const result = await addVideo(urlInput.value, safeTarget.value, targetSub.value, titleInput.value)
  addMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) {
    urlInput.value = ''
    titleInput.value = ''
  }
  busy.value = false
}

/* ============ 分區與細分 ============ */

/** 每個大分類底下「新增分區」的輸入值 */
const newCatName = ref<Record<string, string>>({})
const newCatEmoji = ref<Record<string, string>>({})
const newSectionName = ref('')
const newSectionEmoji = ref('')
const catMsg = ref<Msg>({ ...blank })
/** 每個分區底下「新增細分」的輸入值 */
const newSubName = ref<Record<string, string>>({})

const catListRef = ref<HTMLElement | null>(null)

const catSummary = computed(() => {
  const secPart = sections.value.length > 1 ? `${sections.value.length} 個大分類・` : ''
  return `${secPart}${categories.value.length} 個分區・${subCategories.value.length} 個細分`
})

/** 分區卡片的收合，每張卡片各自記住 */
const catKey = (id: string) => `cat:${id}`

/** 「全部展開／收起」要一併處理動態產生的分區卡片 */
const allCatKeys = computed(() => categories.value.map((c) => catKey(c.id)))

/**
 * 正在搬家的分區。
 * 「屬於哪個大分類」平常是重複資訊（卡片本來就在那個框裡），
 * 所以收起來，按了標題列的搬移鈕才顯示選單。
 */
const movingCatId = ref<string | null>(null)

function toggleMoving(id: string) {
  movingCatId.value = movingCatId.value === id ? null : id
}

function onMoveCategory(catId: string, sectionId: string) {
  setCategorySection(catId, sectionId)
  movingCatId.value = null
}

function onAddSection() {
  const result = addSection(newSectionName.value, newSectionEmoji.value)
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) {
    newSectionName.value = ''
    newSectionEmoji.value = ''
  }
}

function onRemoveSection(id: string, name: string) {
  const n = countInSection(id)
  const cats = categoriesIn(id).length
  const warn = cats
    ? `「${name}」底下有 ${cats} 個分區、${n} 部影片，全部都會被刪掉，確定嗎？`
    : `確定要刪除大分類「${name}」嗎？`
  if (!confirm(warn)) return
  const result = removeSection(id)
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

function onAddCategory(sectionId: string) {
  const result = addCategory(sectionId, newCatName.value[sectionId] ?? '', newCatEmoji.value[sectionId] ?? '')
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) {
    newCatName.value[sectionId] = ''
    newCatEmoji.value[sectionId] = ''
  }
}

function onRemoveCategory(id: string, name: string) {
  const n = countIn(id)
  const warn = n
    ? `「${name}」裡面有 ${n} 部影片，刪除分區會連影片一起刪掉，確定嗎？`
    : `確定要刪除分區「${name}」嗎？`
  if (!confirm(warn)) return
  const result = removeCategory(id)
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

function onAddSub(categoryId: string) {
  const result = addSubCategory(categoryId, newSubName.value[categoryId] ?? '')
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) newSubName.value[categoryId] = ''
}

function onRemoveSub(id: string, name: string) {
  if (!confirm(`確定要刪除「${name}」嗎？裡面的影片會退回分區底下，不會被刪掉。`)) return
  const result = removeSubCategory(id)
  catMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

function dragSection(ev: PointerEvent, index: number) {
  drag.start(ev, {
    key: 'sec',
    index,
    getRows: () => [...(catListRef.value?.querySelectorAll('[data-sec-block]') ?? [])] as HTMLElement[],
    onMove: reorderSections,
  })
}

function dragCategory(ev: PointerEvent, sectionId: string, index: number) {
  drag.start(ev, {
    key: `cat:${sectionId}`,
    index,
    getRows: () => [...(catListRef.value?.querySelectorAll(`[data-cat-block="${sectionId}"]`) ?? [])] as HTMLElement[],
    onMove: (from, to) => reorderCategories(sectionId, from, to),
  })
}

function dragSub(ev: PointerEvent, categoryId: string, index: number) {
  drag.start(ev, {
    key: `sub:${categoryId}`,
    index,
    getRows: () => [...(catListRef.value?.querySelectorAll(`[data-sub-row="${categoryId}"]`) ?? [])] as HTMLElement[],
    onMove: (from, to) => reorderSubCategories(categoryId, from, to),
  })
}

/* ============ 復原 ============ */

const undoMsg = ref<Msg>({ ...blank })

function onUndo() {
  const result = undo()
  undoMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

/* ============ 片單 ============ */

/** 片單只排有影片的分區，空的分區排進去只會占位置 */
const filledCategories = computed(() => categories.value.filter((c) => countIn(c.id) > 0))
const emptyCategories = computed(() => categories.value.filter((c) => countIn(c.id) === 0))

const listRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editingText = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

async function startEdit(uid: string, title: string) {
  editingId.value = uid
  editingText.value = title
  await nextTick()
  editInputRef.value?.focus()
  editInputRef.value?.select()
}

function commitEdit() {
  if (editingId.value) renameVideo(editingId.value, editingText.value)
  editingId.value = null
}

function onRemoveVideo(uid: string, title: string) {
  if (!confirm(`確定要移除「${title}」嗎？`)) return
  removeVideo(uid)
}

/** 搬移選單的值是「分區id|細分id」，空的細分表示直接掛在分區下 */
function placeValue(categoryId: string, subId: string | null) {
  return `${categoryId}|${subId ?? ''}`
}

function onChangePlace(uid: string, raw: string) {
  const [categoryId, subId] = raw.split('|')
  setVideoPlace(uid, categoryId!, subId || null)
}

function dragVideo(ev: PointerEvent, categoryId: string, subId: string | null, index: number) {
  const key = `vid:${categoryId}:${subId ?? '_'}`
  drag.start(ev, {
    key,
    index,
    getRows: () => [...(listRef.value?.querySelectorAll(`[data-vid-row="${key}"]`) ?? [])] as HTMLElement[],
    onMove: (from, to) => reorderVideos(categoryId, subId, from, to),
  })
}

/* ============ 觀看時間 ============ */

const {
  settings, todaySeconds, hasLimit, limitSeconds,
  isResting, restRemainingSeconds, endRest,
  setSettings, resetToday, grantExtra, recentDays,
} = useWatchTime()

const dailyInput = ref(String(settings.value.dailyLimitMin))
const modeInput = ref<BreakMode>(settings.value.breakMode)
const everyInput = ref(String(settings.value.breakEveryMin))
const restInput = ref(String(settings.value.breakRestMin))
const timeMsg = ref<Msg>({ ...blank })

const restText = computed(() => countdown(restRemainingSeconds.value))

/** 收起面板時顯示的一行摘要 */
const timeSummary = computed(() => {
  const s = settings.value
  const daily = s.dailyLimitMin > 0 ? `每天 ${s.dailyLimitMin} 分鐘` : '時間不限'
  if (s.breakMode === 'off' || s.breakRestMin <= 0) return `${daily}・不強制休息`
  const when = s.breakMode === 'video' ? '每部影片看完' : `每 ${s.breakEveryMin} 分鐘`
  return `${daily}・${when}休息 ${s.breakRestMin} 分鐘`
})

const days = computed(() => recentDays(7))
const todayK = computed(() => dayKey())

/**
 * 長條圖的高度基準：取「每日上限」「這 7 天的最高值」「10 分鐘」三者最大，
 * 這樣值很小的時候柱子不會假裝很高，設了上限時也看得出離上限多遠。
 */
const chartMax = computed(() =>
  Math.max(limitSeconds.value, ...days.value.map((d) => d.seconds), 600),
)

const barPct = (sec: number) => `${Math.min(100, (sec / chartMax.value) * 100)}%`
const limitPct = computed(() => `${Math.min(100, (limitSeconds.value / chartMax.value) * 100)}%`)
const isOver = (sec: number) => hasLimit.value && sec > limitSeconds.value

/** 圖表給讀螢幕軟體的完整描述，等同一份表格 */
const chartAria = computed(() =>
  '最近 7 天觀看時間：' +
  days.value.map((d) => `${d.label} ${Math.round(d.seconds / 60)} 分鐘`).join('、'),
)

function onSaveTime() {
  const result = setSettings({
    dailyLimitMin: Number(dailyInput.value),
    breakMode: modeInput.value,
    breakEveryMin: Number(everyInput.value),
    breakRestMin: Number(restInput.value),
  })
  timeMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

function onResetToday() {
  resetToday()
  timeMsg.value = { text: '今天的觀看時間已歸零。', kind: 'ok' }
}

function onGrantExtra() {
  grantExtra(15)
  timeMsg.value = { text: '今天多給了 15 分鐘。', kind: 'ok' }
}

function onEndRest() {
  endRest()
  timeMsg.value = { text: '已結束休息。', kind: 'ok' }
}

/* ============ App 名稱與密碼 ============ */

const { setPin, isDefaultPin } = useParentGate()

/** 收起面板時顯示片單目前是從哪裡來的 */
const sourceSummary = computed(() => {
  const s = syncStatus.value.state
  if (s === 'updated') return '剛從 playlist.txt 更新'
  if (s === 'missing') return '找不到 playlist.txt，用的是內建片單'
  if (s === 'offline') return '目前離線，用這台裝置上的片單'
  return 'playlist.txt 管全部 iPad'
})
const { settings: display, setGroupMode } = useDisplay()
const { choice: themeChoice, resolved: themeResolved, setTheme } = useTheme()

/** 分區顏色要跟著主題換，淺色底得用深一點的版本才看得清楚 */
const catColor = (id: string) =>
  categoryColor(categories.value.findIndex((c) => c.id === id), themeResolved.value)

const THEME_LABEL: Record<string, string> = {
  dark: '暗色',
  light: '亮色',
  system: '跟隨系統',
}
const appTitleInput = ref(appTitle.value)

const GROUP_MODE_LABEL: Record<string, string> = {
  all: '單元全部展開',
  accordion: '一次開一個單元',
  remember: '記住上次看的單元',
}

const displaySummary = computed(() => {
  const theme = THEME_LABEL[themeChoice.value] ?? ''
  const suffix = themeChoice.value === 'system' ? `（目前${themeResolved.value === 'light' ? '亮色' : '暗色'}）` : ''
  return `${appTitle.value}・${theme}${suffix}・${GROUP_MODE_LABEL[display.value.groupMode] ?? ''}`
})
const pinInput = ref('')
const pinMsg = ref<Msg>({ ...blank })

function onSavePin() {
  const result = setPin(pinInput.value.trim())
  pinMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
  if (result.ok) pinInput.value = ''
}

/* ============ 片單檔案同步 ============ */

const syncing = ref(false)

/** 只有「有事發生」才顯示橫幅，沒變動就不要吵家長 */
const showSyncBanner = computed(() =>
  ['syncing', 'updated', 'missing', 'offline', 'error'].includes(syncStatus.value.state),
)

async function onSync() {
  if (syncing.value) return
  syncing.value = true
  await syncFromPlaylist(true)
  syncing.value = false
}

/* ============ 備份 ============ */

const ioBox = ref('')
const ioMsg = ref<Msg>({ ...blank })

function onExport() {
  ioBox.value = exportJson()
  ioMsg.value = { text: '已輸出到下面的框，長按可以全選複製。', kind: 'ok' }
}

function onImport() {
  const result = importJson(ioBox.value)
  ioMsg.value = { text: result.message, kind: result.ok ? 'ok' : 'err' }
}

</script>

<template>
  <section class="panel-view">
    <header class="app-bar">
      <h1>家長設定</h1>

      <div class="bar-actions">
        <button class="text-btn accent" :disabled="syncing" @click="onSync">
          {{ syncing ? '同步中…' : '同步片單' }}
        </button>
        <button class="text-btn" @click="expandAll(allCatKeys)">全部展開</button>
        <button class="text-btn" @click="collapseAll(allCatKeys)">全部收起</button>
        <button class="icon-btn" aria-label="關閉設定" @click="emit('close')">
          <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
        </button>
      </div>
    </header>

    <div class="panel-body">
      <!-- 片單檔案的同步結果，沒事就不顯示 -->
      <div v-if="showSyncBanner" class="sync-banner" :class="syncStatus.state">
        <span class="sync-msg">{{ syncStatus.message }}</span>
        <button v-if="syncStatus.state !== 'syncing'" class="ghost-btn small" @click="onSync">
          重新讀取
        </button>
      </div>

      <!-- ══════ 新增影片 ══════ -->
      <PanelSection id="add" class="panel-add" title="新增影片">
        <div class="add-grid">
          <label class="field">
            <span>YouTube 網址或影片 ID</span>
            <input
              v-model="urlInput"
              type="text"
              inputmode="url"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              placeholder="https://www.youtube.com/watch?v=..."
            >
          </label>

          <label class="field">
            <span>顯示標題（留空會自動抓取）</span>
            <input v-model="titleInput" type="text" placeholder="例如：第一課 生字練習">
          </label>

          <div class="field wide">
            <span>放到哪一區</span>
            <div v-for="g in chipGroups" :key="g.sec.id" class="chip-group">
              <span v-if="chipGroups.length > 1" class="chip-group-label">
                {{ g.sec.emoji }} {{ g.sec.name }}
              </span>
              <div class="chip-row">
                <button
                  v-for="cat in g.cats"
                  :key="cat.id"
                  class="chip"
                  :style="cat.id === safeTarget
                    ? { background: catColor(cat.id), color: 'var(--on-accent)', borderColor: 'transparent' }
                    : { color: catColor(cat.id), borderColor: 'currentColor' }"
                  @click="pickCategory(cat.id)"
                >
                  {{ cat.emoji }} {{ cat.name }}
                </button>
              </div>
            </div>
          </div>

          <!-- 只有這一區真的有細分時才問 -->
          <div v-if="targetSubs.length" class="field wide">
            <span>放到哪一冊／單元</span>
            <div class="chip-row">
              <button
                class="chip chip-plain"
                :class="{ 'is-on': targetSub === null }"
                @click="targetSub = null"
              >
                不分冊
              </button>
              <button
                v-for="sub in targetSubs"
                :key="sub.id"
                class="chip chip-plain"
                :class="{ 'is-on': targetSub === sub.id }"
                @click="targetSub = sub.id"
              >
                {{ sub.name }}
              </button>
            </div>
          </div>

          <div class="wide">
            <button class="primary-btn" :disabled="busy || !categories.length" @click="onAddVideo">
              加入清單
            </button>
            <p class="msg" :class="addMsg.kind" role="status">{{ addMsg.text }}</p>
          </div>
        </div>
      </PanelSection>

      <!-- ══════ 分區管理（大分類 → 分區 → 冊）══════ -->
      <PanelSection
        id="categories"
        title="分區管理"
        span="2"
        :badge="`${categories.length} 區`"
        :summary="catSummary"
      >
        <template #header-extra>
          <span class="h2-hint">
            按住
            <svg class="inline-grip" viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
            可以拖曳排序
          </span>
        </template>

        <div ref="catListRef" class="sec-tree">
          <div
            v-for="(sec, si) in sections"
            :key="sec.id"
            data-sec-block
            class="sec-block"
            :class="{ 'is-dragging': drag.isDragging('sec', si) }"
          >
            <!-- 大分類本身 -->
            <div class="sec-row">
              <button class="grip" aria-label="拖曳排序大分類" @pointerdown="dragSection($event, si)">
                <svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
              </button>

              <input
                class="cat-emoji"
                :value="sec.emoji"
                maxlength="2"
                aria-label="大分類圖示"
                @change="renameSection(sec.id, sec.name, ($event.target as HTMLInputElement).value)"
              >
              <input
                class="sec-name"
                :value="sec.name"
                aria-label="大分類名稱"
                @change="renameSection(sec.id, ($event.target as HTMLInputElement).value)"
              >

              <span class="cat-count">{{ categoriesIn(sec.id).length }} 區・{{ countInSection(sec.id) }} 部</span>

              <button class="row-del" aria-label="刪除大分類" @click="onRemoveSection(sec.id, sec.name)">
                <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
              </button>
            </div>

            <!-- 這個大分類底下的分區 -->
            <div class="cat-list">
              <div
                v-for="(cat, ci) in categoriesIn(sec.id)"
                :key="cat.id"
                :data-cat-block="sec.id"
                class="cat-block"
                :class="{ 'is-dragging': drag.isDragging(`cat:${sec.id}`, ci) }"
              >
                <div class="cat-row">
                  <button class="grip" aria-label="拖曳排序分區" @pointerdown="dragCategory($event, sec.id, ci)">
                    <svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
                  </button>

                  <input
                    class="cat-emoji is-tinted"
                    :style="{ borderColor: catColor(cat.id) }"
                    :value="cat.emoji"
                    maxlength="2"
                    aria-label="分區圖示"
                    @change="renameCategory(cat.id, cat.name, ($event.target as HTMLInputElement).value)"
                  >
                  <input
                    class="cat-name"
                    :value="cat.name"
                    aria-label="分區名稱"
                    @change="renameCategory(cat.id, ($event.target as HTMLInputElement).value)"
                  >

                  <span class="cat-count">{{ countIn(cat.id) }} 部</span>

                  <!-- 冊很多的時候可以把整張卡片收起來 -->
                  <button
                    class="caret-btn"
                    :aria-expanded="!isCollapsed(catKey(cat.id))"
                    :aria-label="isCollapsed(catKey(cat.id)) ? '展開這一區' : '收起這一區'"
                    @click="toggleCollapse(catKey(cat.id))"
                  >
                    <svg
                      class="caret"
                      :class="{ 'is-open': !isCollapsed(catKey(cat.id)) }"
                      viewBox="0 0 24 24"
                    ><path d="M9.3 6 8 7.4l4.6 4.6L8 16.6 9.3 18l6-6z" /></svg>
                  </button>

                  <button class="row-del" aria-label="刪除分區" @click="onRemoveCategory(cat.id, cat.name)">
                    <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
                  </button>
                </div>

                <div v-show="!isCollapsed(catKey(cat.id))" class="sub-list">
                  <!-- 搬家不常用，收成一個小連結，按了才出現選單；再點一次可以收回去 -->
                  <button
                    v-if="sections.length > 1"
                    class="move-link"
                    :class="{ 'is-on': movingCatId === cat.id }"
                    @click="toggleMoving(cat.id)"
                  >
                    {{ movingCatId === cat.id ? '取消搬移' : '搬到其他大分類…' }}
                  </button>

                  <div v-if="movingCatId === cat.id" class="move-row">
                    <span class="move-label">搬到</span>
                    <select
                      class="place-select"
                      :value="cat.sectionId"
                      aria-label="搬到別的大分類"
                      @change="onMoveCategory(cat.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="x in sections" :key="x.id" :value="x.id">{{ x.emoji }} {{ x.name }}</option>
                    </select>
                  </div>

                  <div
                    v-for="(sub, sbi) in subsIn(cat.id)"
                    :key="sub.id"
                    :data-sub-row="cat.id"
                    class="sub-row"
                    :class="{ 'is-dragging': drag.isDragging(`sub:${cat.id}`, sbi) }"
                  >
                    <button class="grip grip-sm" aria-label="拖曳排序" @pointerdown="dragSub($event, cat.id, sbi)">
                      <svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
                    </button>

                    <input
                      class="sub-name"
                      :value="sub.name"
                      aria-label="冊或單元名稱"
                      @change="renameSubCategory(sub.id, ($event.target as HTMLInputElement).value)"
                    >

                    <button class="row-del row-del-sm" aria-label="刪除" @click="onRemoveSub(sub.id, sub.name)">
                      <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
                    </button>
                  </div>

                  <div class="sub-new">
                    <input
                      v-model="newSubName[cat.id]"
                      class="sub-name"
                      placeholder="新增冊／單元，例如 第 1 課"
                      @keyup.enter="onAddSub(cat.id)"
                    >
                    <button class="mini-btn" @click="onAddSub(cat.id)">＋</button>
                  </div>
                </div>
              </div>

              <!-- 新增分區到這個大分類 -->
              <div class="cat-new">
                <input
                  v-model="newCatEmoji[sec.id]"
                  class="cat-emoji"
                  maxlength="2"
                  placeholder="📁"
                  aria-label="新分區圖示"
                >
                <input
                  v-model="newCatName[sec.id]"
                  class="cat-name"
                  :placeholder="`新增分區到「${sec.name}」`"
                  aria-label="新分區名稱"
                  @keyup.enter="onAddCategory(sec.id)"
                >
                <button class="mini-btn" @click="onAddCategory(sec.id)">＋</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 新增大分類 -->
        <div class="sec-new">
          <input v-model="newSectionEmoji" class="cat-emoji" maxlength="2" placeholder="📚" aria-label="新大分類圖示">
          <input
            v-model="newSectionName"
            class="cat-name"
            placeholder="新增大分類，例如 娛樂"
            aria-label="新大分類名稱"
            @keyup.enter="onAddSection"
          >
          <button class="ghost-btn small" @click="onAddSection">新增大分類</button>
        </div>

        <p class="msg" :class="catMsg.kind" role="status">{{ catMsg.text }}</p>
        <p class="hint">
          名稱和圖示直接點就能改，離開輸入框自動儲存。
          冊很多的時候，可以用分區右邊的箭頭把整張卡片收起來。
          刪除細分時裡面的影片會退回分區底下，不會被刪掉。
        </p>
      </PanelSection>

      <!-- ══════ 片單 ══════ -->
      <PanelSection id="list" title="目前片單" span="all" :badge="`${videos.length} 部`">
        <template #header-extra>
          <button
            class="undo-btn"
            :disabled="!canUndo"
            :title="canUndo ? `復原「${lastAction}」` : '目前沒有可以復原的動作'"
            @click="onUndo"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 11c2.97 0 5.52 1.72 6.75 4.22l2.37-.78A10.5 10.5 0 0 0 12.5 8Z" /></svg>
            <span class="undo-label">{{ canUndo ? `復原「${lastAction}」` : '沒有可復原的動作' }}</span>
          </button>
        </template>

        <p v-if="undoMsg.text" class="msg" :class="undoMsg.kind" role="status">{{ undoMsg.text }}</p>

        <div ref="listRef" class="lists">
          <div v-for="cat in filledCategories" :key="cat.id" class="cat-group">
            <h3
              class="cat-group-title"
              :style="{ color: catColor(cat.id) }"
            >
              {{ cat.emoji }} {{ cat.name }}
              <span class="group-count">{{ countIn(cat.id) }}</span>
            </h3>

            <div v-for="group in groupsIn(cat.id)" :key="group.id ?? '_loose'" class="sub-group">
              <h4 v-if="group.name" class="sub-group-title">{{ group.name }}</h4>
              <h4 v-else class="sub-group-title is-loose">（未分冊）</h4>

              <ul class="video-list">
                <li
                  v-for="(video, vi) in group.videos"
                  :key="video.uid"
                  :data-vid-row="`vid:${cat.id}:${group.id ?? '_'}`"
                  class="video-item"
                  :class="{ 'is-dragging': drag.isDragging(`vid:${cat.id}:${group.id ?? '_'}`, vi) }"
                >
                  <button class="grip" aria-label="拖曳排序影片" @pointerdown="dragVideo($event, cat.id, group.id, vi)">
                    <svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" /><circle cx="3" cy="8" r="1.3" /><circle cx="7" cy="8" r="1.3" /><circle cx="3" cy="13" r="1.3" /><circle cx="7" cy="13" r="1.3" /></svg>
                  </button>

                  <!-- 網站沒有 YouTube 縮圖，別去抓空網址 -->
                  <div v-if="video.kind === 'site'" class="row-site-icon" aria-hidden="true">🔗</div>
                  <img v-else :src="thumbUrl(video.id)" alt="">

                  <input
                    v-if="editingId === video.uid"
                    ref="editInputRef"
                    v-model="editingText"
                    class="edit-input"
                    type="text"
                    @blur="commitEdit"
                    @keyup.enter="commitEdit"
                  >
                  <div v-else class="it-title" @click="startEdit(video.uid, video.title)">
                    {{ video.title || '影片' }}
                  </div>

                  <select
                    class="place-select"
                    :value="placeValue(video.categoryId, video.subId)"
                    aria-label="搬到其他分區或冊"
                    @change="onChangePlace(video.uid, ($event.target as HTMLSelectElement).value)"
                  >
                    <optgroup v-for="c in categories" :key="c.id" :label="`${c.emoji} ${c.name}`">
                      <option :value="placeValue(c.id, null)">（未分冊）</option>
                      <option v-for="s in subsIn(c.id)" :key="s.id" :value="placeValue(c.id, s.id)">
                        {{ s.name }}
                      </option>
                    </optgroup>
                  </select>

                  <button class="row-del" aria-label="刪除" @click="onRemoveVideo(video.uid, video.title)">
                    <svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p v-if="!filledCategories.length" class="hint empty">
          還沒有任何影片，先用上面的「新增影片」加一部吧。
        </p>
        <p v-if="emptyCategories.length" class="hint">
          還沒有影片的分區：{{ emptyCategories.map((c) => `${c.emoji} ${c.name}`).join('、') }}
        </p>
        <p class="hint">
          點標題可以改名字；右邊的選單可以把影片搬到別的分區或冊；按住把手可以拖曳排序。
          改錯了就按右上角的「復原」，可以連按一路退回去（最多 15 步）。
          從片單檔案同步也算一步，所以同步後發現不對也退得回來。
        </p>
      </PanelSection>

      <!-- ══════ 觀看時間 ══════ -->
      <PanelSection id="time" title="觀看時間" span="all" :summary="timeSummary">
        <div class="time-grid">
          <div class="time-settings">
            <!-- 正在休息時，家長可以直接結束 -->
            <div v-if="isResting" class="resting-now">
              <span class="resting-label">正在休息中</span>
              <span class="resting-count">{{ restText }}</span>
              <button class="ghost-btn small" @click="onEndRest">結束休息</button>
            </div>

            <label class="field">
              <span>每天最多看幾分鐘（0 = 不限制）</span>
              <input v-model="dailyInput" type="text" inputmode="numeric" placeholder="60">
            </label>

            <div class="field">
              <span>什麼時候要休息</span>
              <div class="chip-row">
                <button
                  class="chip chip-plain"
                  :class="{ 'is-on': modeInput === 'time' }"
                  @click="modeInput = 'time'"
                >
                  每看一段時間
                </button>
                <button
                  class="chip chip-plain"
                  :class="{ 'is-on': modeInput === 'video' }"
                  @click="modeInput = 'video'"
                >
                  每部影片看完
                </button>
                <button
                  class="chip chip-plain"
                  :class="{ 'is-on': modeInput === 'off' }"
                  @click="modeInput = 'off'"
                >
                  不休息
                </button>
              </div>
            </div>

            <label v-if="modeInput === 'time'" class="field">
              <span>每看幾分鐘休息一次</span>
              <input v-model="everyInput" type="text" inputmode="numeric" placeholder="15">
            </label>

            <label v-if="modeInput !== 'off'" class="field">
              <span>每次休息幾分鐘</span>
              <input v-model="restInput" type="text" inputmode="numeric" placeholder="3">
            </label>

            <button class="ghost-btn" @click="onSaveTime">儲存設定</button>
            <p class="msg" :class="timeMsg.kind" role="status">{{ timeMsg.text }}</p>

            <div class="btn-row">
              <button class="ghost-btn" @click="onGrantExtra">今天多給 15 分</button>
              <button class="ghost-btn" @click="onResetToday">今天歸零</button>
            </div>
          </div>

          <div class="time-stats">
            <div class="stat">
              <span class="stat-num">{{ humanMinutes(todaySeconds) }}</span>
              <span class="stat-label">
                今天已看<template v-if="hasLimit">，上限 {{ settings.dailyLimitMin }} 分鐘</template>
              </span>
            </div>

            <!-- 最近 7 天。單一序列，所以不需要圖例；數字直接標在柱子上 -->
            <div class="chart" role="img" :aria-label="chartAria">
              <div v-if="hasLimit" class="limit-line" :style="{ bottom: limitPct }">
                <span class="limit-tag">上限</span>
              </div>

              <div v-for="d in days" :key="d.key" class="col">
                <span v-if="d.seconds >= 30" class="col-val">{{ Math.round(d.seconds / 60) }}</span>
                <div
                  v-if="d.seconds > 0"
                  class="bar"
                  :class="{ 'is-over': isOver(d.seconds) }"
                  :style="{ height: barPct(d.seconds) }"
                  :title="`${d.label} 看了 ${humanMinutes(d.seconds)}`"
                />
                <span class="col-label" :class="{ 'is-today': d.key === todayK }">{{ d.label }}</span>
              </div>
            </div>

            <p class="hint">
              超過上限的日子會標成紅色。iPad 鎖屏或切到別的 App 的時間不會被計入；
              休息的倒數也存在裝置裡，關掉 App 再開一樣要休息完。
            </p>
          </div>
        </div>
      </PanelSection>

      <!-- ══════ 畫面設定 ══════ -->
      <PanelSection id="display" title="畫面設定" :summary="displaySummary">
        <div class="field">
          <span>背景顏色</span>
          <div class="chip-row">
            <button
              class="chip chip-plain"
              :class="{ 'is-on': themeChoice === 'dark' }"
              @click="setTheme('dark')"
            >
              🌙 暗色
            </button>
            <button
              class="chip chip-plain"
              :class="{ 'is-on': themeChoice === 'light' }"
              @click="setTheme('light')"
            >
              ☀️ 亮色
            </button>
            <button
              class="chip chip-plain"
              :class="{ 'is-on': themeChoice === 'system' }"
              @click="setTheme('system')"
            >
              📱 跟隨系統
            </button>
          </div>
        </div>

        <p class="hint">
          暗色在光線暗的地方看比較不刺眼，影片縮圖也比較跳得出來；
          白天想要清爽一點就用亮色。「跟隨系統」會照 iPad 的外觀設定自動切換。
          小朋友端右上角也有一顆 ☀️／🌙 可以直接換，換了這裡也會跟著變。
        </p>

        <label class="field" style="margin-top: 22px">
          <span>小朋友看到的標題</span>
          <input v-model="appTitleInput" type="text" placeholder="我的學習影片">
        </label>
        <button class="ghost-btn" @click="setAppTitle(appTitleInput)">儲存名稱</button>

        <div class="field" style="margin-top: 22px">
          <span>單元（冊）要怎麼展開</span>
          <div class="chip-row">
            <button
              class="chip chip-plain"
              :class="{ 'is-on': display.groupMode === 'remember' }"
              @click="setGroupMode('remember')"
            >
              記住上次看的
            </button>
            <button
              class="chip chip-plain"
              :class="{ 'is-on': display.groupMode === 'accordion' }"
              @click="setGroupMode('accordion')"
            >
              一次開一個
            </button>
            <button
              class="chip chip-plain"
              :class="{ 'is-on': display.groupMode === 'all' }"
              @click="setGroupMode('all')"
            >
              全部展開
            </button>
          </div>
        </div>

        <ul class="use-cases">
          <li><strong>記住上次看的</strong>（預設）：一次只開一個單元，而且打開 App 就回到上次那一課</li>
          <li><strong>一次開一個</strong>：一次只開一個單元，但每次都從第一課開始</li>
          <li><strong>全部展開</strong>：所有單元一次列出來，往下捲</li>
        </ul>

        <p class="hint">
          一本教材七課、每課三部影片，全部展開要捲很久。
          前兩種模式下，小朋友點單元標題就會展開那一課、收起原本那課。
          沒有分冊的影片不受影響，一直都看得到。
        </p>
      </PanelSection>

      <!-- ══════ 家長密碼 ══════ -->
      <PanelSection
        id="pin"
        title="家長密碼"
        :summary="isDefaultPin() ? '還是預設的 1234' : '已改成自己的密碼'"
      >
        <p v-if="isDefaultPin()" class="hint warn">目前還是預設密碼 1234，建議換成別的。</p>
        <label class="field">
          <span>設定新的 4 位數密碼</span>
          <input v-model="pinInput" type="text" inputmode="numeric" maxlength="4" placeholder="1234">
        </label>
        <button class="ghost-btn" @click="onSavePin">更新密碼</button>
        <p class="msg" :class="pinMsg.kind" role="status">{{ pinMsg.text }}</p>
      </PanelSection>

      <!-- ══════ 片單來源 ══════ -->
      <PanelSection id="source" title="片單來源" span="all" :summary="sourceSummary">
        <div class="source-grid">
          <!-- 主檔：改這個檔案，所有 iPad 一起更新 -->
          <div class="source-col">
            <h3 class="source-title">主檔：playlist.txt</h3>
            <p class="hint">
              網站裡有一個 <code>playlist.txt</code>，用記事本就能改。
              改完上傳，<strong>每一台 iPad 下次開啟都會自動更新</strong>，不用一台一台設定。
              長期要留著的片單都寫在這裡。
            </p>

            <pre class="format-sample"># 學習 🎓

【Little Kids (上)】🐰

《第 1 課》
https://youtu.be/xxxxxxxxxxx | 第一課
https://youtu.be/yyyyyyyyyyy | 第二課

site: https://example.com | 某個學習網站</pre>

            <ul class="use-cases">
              <li><strong># 　</strong>後面是大分類（學習／娛樂），可以不寫</li>
              <li><strong>【　】</strong>裡面是分區，後面可以加 emoji</li>
              <li><strong>《　》</strong>裡面是冊或單元，可以不寫</li>
              <li><strong>site:</strong> 開頭是網站，會在 App 裡面開，小朋友不會跳出去</li>
              <li>網址後面加 <strong>|</strong> 可以自己寫標題，不寫就自動抓</li>
              <li>行首加 <strong>//</strong> 就是註解，可以暫時停掉某一項</li>
            </ul>

            <p class="hint">
              檔案位置：<code>public/playlist.txt</code>（線上位置 <code>{{ playlistUrl() }}</code>）。
              檔案內容沒變動時會保留你在這台 iPad 上的調整；一旦檔案改過，就以檔案為準覆蓋掉。
            </p>

            <button class="ghost-btn wide" :disabled="syncing" @click="onSync">
              {{ syncing ? '同步中…' : '立即從檔案同步' }}
            </button>

            <p v-if="syncStatus.message" class="msg" :class="syncStatus.state === 'updated' ? 'ok' : ''">
              {{ syncStatus.message }}
            </p>

            <template v-if="syncStatus.warnings.length">
              <p class="hint warn">檔案裡有幾行看不懂，已經略過：</p>
              <ul class="use-cases warn-list">
                <li v-for="(w, i) in syncStatus.warnings" :key="i">{{ w }}</li>
              </ul>
            </template>
          </div>

          <!-- 這台裝置：跨機器複製用 -->
          <div class="source-col">
            <h3 class="source-title">這台裝置：匯出／匯入</h3>
            <p class="hint">
              把<strong>這台 iPad 目前的片單</strong>存成一段文字。
              用在家裡第二台 iPad 想看同一份片單，或這台要重置、送修之前先留一份。
            </p>
            <p class="hint">
              如果你的片單都寫在 playlist.txt 裡，其實用不太到這裡 ——
              GitHub 上永遠有一份，按左邊的「立即從檔案同步」就回來了。
              這裡主要是給「在 iPad 上臨時加了不少影片」的情況用的。
            </p>

            <textarea
              v-model="ioBox"
              class="io-box"
              spellcheck="false"
              rows="6"
              placeholder="按「匯出」會把片單輸出到這裡；要還原就把之前存的文字貼進來再按「匯入」"
            />
            <div class="btn-row">
              <button class="ghost-btn" @click="onExport">匯出</button>
              <button class="ghost-btn" @click="onImport">匯入</button>
            </div>
            <p class="msg" :class="ioMsg.kind" role="status">{{ ioMsg.text }}</p>

            <p class="hint">
              改錯了想退回上一步的話，用「目前片單」右上角的<strong>復原</strong>就好，
              不用從這裡還原。
            </p>
          </div>
        </div>
      </PanelSection>
    </div>
  </section>
</template>

<style scoped>
.panel-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.bar-actions { display: flex; align-items: center; gap: 8px; }

.text-btn {
  padding: 10px 14px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.text-btn:active { background: var(--bg-card); color: var(--text); }
.text-btn.accent { color: var(--accent); }
.text-btn:disabled { opacity: .5; }

/* ---------- 版面：窄螢幕單欄，越寬越多欄，並讓大面板橫跨 ---------- */
.panel-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 calc(var(--safe-r) + 22px) calc(var(--safe-b) + 40px) calc(var(--safe-l) + 22px);
  display: grid;
  gap: 18px;
  /* minmax(0, ...) 不能省：1fr 的最小寬度是 min-content，
     有一個面板裝了不能斷行的長字串就會把整欄撐開、擠出左右捲軸 */
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  align-items: start;

  /* 設定頁要打字，恢復文字選取 */
  -webkit-user-select: text;
  user-select: text;
}

@media (min-width: 700px) {
  .panel-body { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* 兩欄時大面板直接占滿整列，才不會被壓得太窄 */
  .panel-body > :deep(.span-2),
  .panel-body > :deep(.span-all) { grid-column: 1 / -1; }

  /* 兩欄時「新增影片」旁邊沒東西可放，就整列占滿並把欄位並排 */
  .panel-add { grid-column: 1 / -1; }
  .add-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .add-grid > .wide { grid-column: 1 / -1; }
}

@media (min-width: 1200px) {
  .panel-body { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .panel-body > :deep(.span-2) { grid-column: span 2; }
  .panel-body > :deep(.span-all) { grid-column: 1 / -1; }

  /* 三欄時新增影片回到一欄寬，欄位也回到單欄 */
  .panel-add { grid-column: span 1; }
  .add-grid { grid-template-columns: minmax(0, 1fr); }
}

/* ---------- 新增影片 ---------- */
.add-grid {
  display: grid;
  gap: 0 18px;
  grid-template-columns: minmax(0, 1fr);
}

.undo-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  padding: 9px 15px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease;
}
.undo-btn:not(:disabled):active {
  transform: scale(.95);
  border-color: var(--accent);
}
.undo-btn:disabled {
  opacity: .4;
  cursor: default;
}
.undo-btn svg { flex: none; width: 18px; height: 18px; fill: currentColor; }
.undo-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.h2-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
}
.inline-grip { width: 9px; height: 14px; fill: var(--text-dim); }

.warn { color: var(--accent); }

/* ---------- 選分區／選冊的膠囊 ---------- */
.chip-row { display: flex; flex-wrap: wrap; gap: 9px; }

.chip {
  padding: 10px 17px;
  border: 2px solid;
  border-radius: 999px;
  background: transparent;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .15s ease;
}
.chip:active { transform: scale(.95); }

/* 冊與模式的膠囊不帶分區顏色，避免跟上面那排搶顏色 */
.chip-plain {
  border-color: var(--line);
  color: var(--text-dim);
}
.chip-plain.is-on {
  background: var(--text);
  border-color: transparent;
  color: var(--bg);
}

/* ---------- 拖曳把手 ---------- */
.grip {
  flex: none;
  width: 30px;
  height: 38px;
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
/* 細分列的把手也要留夠寬的觸控範圍，拖曳才按得準 */
.grip-sm { width: 28px; height: 38px; }

.is-dragging {
  opacity: .55;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
}

/* ---------- 刪除鈕 ---------- */
.row-del {
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
  transition: background .15s ease, color .15s ease;
}
.row-del:active,
.row-del:hover { background: rgba(255, 95, 109, .18); color: var(--danger); }
.row-del svg { width: 18px; height: 18px; fill: currentColor; }
.row-del-sm { width: 36px; height: 36px; }
.row-del-sm svg { width: 16px; height: 16px; }

/* ---------- 同步橫幅 ---------- */
.sync-banner {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border: 2px solid var(--line);
  border-radius: 16px;
  background: var(--bg-soft);
  font-size: 15px;
}
.sync-banner .sync-msg { flex: 1; min-width: 200px; }
.sync-banner.updated { border-color: var(--ok); }
.sync-banner.error { border-color: var(--danger); }
.sync-banner.missing,
.sync-banner.offline { border-color: var(--accent); }

.format-sample {
  margin: 0 0 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-dim);
  white-space: pre-wrap;
  overflow-x: auto;
}

code {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  /* 網址沒有空格可斷，手機上會把整欄撐開 */
  overflow-wrap: anywhere;
}

.warn-list { color: var(--accent); }

/* ---------- 三層樹：大分類 → 分區 → 冊 ---------- */
.sec-tree {
  display: grid;
  /* 不寫 columns 的話預設軌道是 auto（＝max-content），
     大分類區塊會被內容撐爆容器 */
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.sec-block {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, .02);
  transition: opacity .15s ease;
}

.sec-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.sec-name {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  font-size: 16px;
  font-weight: 800;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 2px solid transparent;
  border-radius: 10px;
  outline: none;
}
.sec-name:focus { border-color: var(--accent); }

.cat-list {
  display: grid;
  /* 大裝置一行兩個、小裝置一行一個。
     400px 是實測門檻：iPad 直向的內容區約 640px，排兩欄每欄只剩 313px，
     名稱會被切掉，所以直向要掉回一欄；橫向（約 900px）才排得下兩欄。
     45% 則是「最多兩欄」的把關 —— 三個 45% 排不下，再寬也不會擠成三欄。 */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, max(400px, 45%)), 1fr));
  align-items: start;
  gap: 10px 14px;
  margin-left: 14px;
  padding-left: 12px;
  border-left: 2px solid var(--line);
}

/* 收合分區卡片的箭頭 */
.caret-btn {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.caret-btn:active { background: var(--line); }
.caret-btn.is-on { background: var(--accent); }
.caret-btn.is-on svg { fill: var(--on-accent); }
.caret-btn svg { width: 17px; height: 17px; fill: var(--text-dim); }
.caret-btn .caret {
  width: 18px;
  height: 18px;
  fill: var(--text-dim);
  transition: transform .18s ease;
}
.caret-btn .caret.is-open { transform: rotate(90deg); }

.move-link {
  grid-column: 1 / -1;
  justify-self: start;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.move-link:active,
.move-link.is-on { color: var(--accent); }

/* 把分區搬到別的大分類 */
.move-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.move-label {
  flex: none;
  font-size: 13px;
  color: var(--text-dim);
}
.move-row .place-select { flex: 1; max-width: none; }

.sec-new {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 9px 10px;
  border: 2px dashed var(--line);
  border-radius: 16px;
}
.sec-new .cat-name { background: transparent; }

/* 新增影片時，分區膠囊照大分類分組 */
.chip-group + .chip-group { margin-top: 14px; }
.chip-group-label {
  display: block;
  margin-bottom: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}

.cat-block {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 8px 14px 12px 10px;
  transition: opacity .15s ease;
}

.cat-row { display: flex; align-items: center; gap: 8px; }

.cat-emoji,
.cat-name,
.sub-name,
.edit-input {
  padding: 9px 12px;
  font-size: 15px;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 2px solid transparent;
  border-radius: 10px;
  outline: none;
}
.cat-emoji { flex: none; width: 52px; text-align: center; font-size: 19px; }
/* 分區顏色畫在 emoji 框的邊上，不用另外再放一個色點 */
.cat-emoji.is-tinted { border-width: 2px; border-style: solid; }
/* 名稱是最重要的資訊，其他元素再擠也要留給它這個寬度 */
.cat-name { flex: 1; min-width: 110px; font-weight: 700; }
.cat-emoji:focus,
.cat-name:focus,
.sub-name:focus,
.edit-input:focus { border-color: var(--accent); }

.cat-count {
  flex: none;
  /* 收起狀態下一行要塞很多東西，摘要字小一點，名稱才有空間 */
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}

/* 細分往右縮排，並用一條線表示從屬關係 */
.sub-list {
  margin: 8px 0 0 30px;
  padding-left: 10px;
  border-left: 2px solid var(--line);
  display: grid;
  /* 一本教材七課的話，排成兩欄高度直接少一半。
     同樣用 45% 把上限鎖在兩欄，冊名才不會被壓到看不清楚 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, max(170px, 45%)), 1fr));
  gap: 7px 8px;
  align-items: start;
}

/* 搬移選單與新增框橫跨整列 */
.move-row,
.sub-new { grid-column: 1 / -1; }

.sub-row,
.sub-new { display: flex; align-items: center; gap: 6px; }

.sub-name { flex: 1; min-width: 0; font-size: 14px; }
.sub-new .sub-name { background: transparent; border-color: var(--line); border-style: dashed; }

.mini-btn {
  flex: none;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9px;
  background: var(--line);
  color: var(--text);
  font-size: 17px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
}
.mini-btn:active { background: var(--accent); color: var(--on-accent); }

.cat-new {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 9px 10px;
  border: 2px dashed var(--line);
  border-radius: 16px;
}
.cat-new .cat-name { background: transparent; }

.ghost-btn.small { padding: 10px 16px; font-size: 15px; white-space: nowrap; }
.ghost-btn.wide { width: 100%; margin-top: 12px; }

/* ---------- 片單 ---------- */
.lists {
  display: grid;
  /* 分區並排：面板很寬時一列才不會只放一部影片、右邊空一大段 */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
  gap: 28px 30px;
  align-items: start;
}

.cat-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 800;
}

.group-count {
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .09);
  font-size: 13px;
  color: var(--text-dim);
}

.sub-group + .sub-group { margin-top: 14px; }

.sub-group-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-dim);
}
.sub-group-title.is-loose { font-weight: 500; opacity: .7; }

.video-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 9px;
}

.video-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 14px;
  transition: opacity .15s ease;
}

.row-site-icon {
  flex: none;
  width: 88px;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--bg);
  font-size: 26px;
}

.video-item img {
  flex: none;
  width: 88px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 8px;
  background: #0f0d24;
}

.it-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  cursor: text;
}
.edit-input { flex: 1; min-width: 0; border-color: var(--accent); }

.place-select {
  flex: none;
  max-width: 165px;
  padding: 9px 11px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  border: 2px solid var(--line);
  border-radius: 10px;
  outline: none;
}

.empty { margin: 0; font-size: 14px; }

/* ---------- 觀看時間 ---------- */
.time-grid {
  display: grid;
  gap: 26px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
}

/* 休息進行中的狀態條 */
.resting-now {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  padding: 12px 16px;
  border: 2px solid var(--accent);
  border-radius: 14px;
}
.resting-label { font-size: 15px; font-weight: 700; }
.resting-count {
  margin-left: auto;
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.stat { margin-bottom: 20px; }
.stat-num {
  display: block;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.2;
}
.stat-label {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  color: var(--text-dim);
}

.chart {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 132px;
  padding-bottom: 24px;
  /* 基線：柱子從這條線長出來 */
  border-bottom: 2px solid var(--line);
}

.col {
  position: relative;
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}

.bar {
  width: 100%;
  max-width: 34px;
  /* 有看才會有柱子，所以最小高度給 3px 讓極短的時間也看得見 */
  min-height: 3px;
  /* 只有頂端收圓角，底部貼齊基線 */
  border-radius: 4px 4px 0 0;
  background: var(--accent);
  transition: height .25s ease;
}
.bar.is-over { background: var(--danger); }

.col-val {
  position: relative;
  z-index: 1;
  margin-bottom: 5px;
  padding: 0 4px;
  border-radius: 4px;
  /* 墊上面板底色，數字才不會被上限虛線穿過去 */
  background: var(--bg-soft);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}

.col-label {
  position: absolute;
  bottom: -22px;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}
.col-label.is-today { color: var(--text); font-weight: 800; }

/* 上限參考線畫得比資料更輕，不跟柱子搶注意力 */
.limit-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--text-dim);
  opacity: .6;
  pointer-events: none;
}
.limit-tag {
  position: absolute;
  right: 0;
  top: -16px;
  font-size: 11px;
  color: var(--text-dim);
}

/* ---------- 片單來源 ---------- */
.source-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 28px 34px;
  align-items: start;
}

.source-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.use-cases {
  overflow-wrap: anywhere;
  margin: 0 0 14px;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--text-dim);
}

.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.btn-row .ghost-btn {
  flex: 1;
  min-width: 100px;
}

@media (max-width: 620px) {
  .video-item { flex-wrap: wrap; }
  .place-select { max-width: none; flex: 1; }
  .undo-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  padding: 9px 15px;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease;
}
.undo-btn:not(:disabled):active {
  transform: scale(.95);
  border-color: var(--accent);
}
.undo-btn:disabled {
  opacity: .4;
  cursor: default;
}
.undo-btn svg { flex: none; width: 18px; height: 18px; fill: currentColor; }
.undo-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.h2-hint { display: none; }
  .text-btn { padding: 10px 8px; font-size: 13px; }

  /* 手機一律一欄：兩欄的話每欄只剩一百多 px，冊名會被切掉 */
  .cat-list,
  .sub-list { grid-template-columns: minmax(0, 1fr); }

  /* 手機的可用寬度只有兩百多 px，一行放不下
     把手＋圖示＋名稱＋數量＋兩顆按鈕。
     名稱最重要，讓它獨占第一行，數量和操作鈕退到第二行靠右。 */
  .sec-row,
  .cat-row {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .sec-row > .sec-name,
  .cat-row > .cat-name {
    flex: 1 1 120px;
    min-width: 0;
  }
  .sec-row > .cat-count,
  .cat-row > .cat-count {
    order: 10;
    margin-left: auto;
  }
  .cat-row > .caret-btn,
  .sec-row > .row-del,
  .cat-row > .row-del { order: 11; }

  /* 內距收一點，把省下來的寬度讓給名稱 */
  .panel { padding: 16px 14px 18px; }
  .sec-block { padding: 10px; }
  .cat-block { padding: 8px 10px 10px; }

  /* 手機上把細分列的小按鈕放大，手指才按得準 */
  .grip-sm { width: 34px; height: 42px; }
  .row-del-sm { width: 40px; height: 40px; }
  .row-del-sm svg { width: 17px; height: 17px; }
  .mini-btn { width: 40px; height: 40px; }

  /* 縮排在窄螢幕會吃掉太多寬度 */
  .sub-list { margin-left: 16px; padding-left: 10px; }
}
</style>
