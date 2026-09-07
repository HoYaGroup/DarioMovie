<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { thumbUrl, categoryColor, type VideoItem } from '~/utils/youtube'
import { humanMinutes, countdown, useWatchTime } from '~/composables/useWatchTime'
import { useLibrary } from '~/composables/useLibrary'
import { useDisplay } from '~/composables/useDisplay'
import { useTheme } from '~/composables/useTheme'

const emit = defineEmits<{ play: [video: VideoItem]; openParent: [] }>()

const {
  sections, categories, appTitle, groupsIn, countIn, categoriesIn, countInSection,
} = useLibrary()
const { hasLimit, remainingSeconds, isLimitReached, isResting, restRemainingSeconds } = useWatchTime()
const { settings: display, lastGroupOf, rememberGroup } = useDisplay()
const { resolved: themeResolved, setTheme } = useTheme()

/** 小朋友自己就能換亮暗，光線變了不用找家長 */
function toggleTheme() {
  setTheme(themeResolved.value === 'dark' ? 'light' : 'dark')
}

/**
 * 小螢幕或手機橫向：垂直空間不夠，只能用下拉。
 * 空間夠的時候一律用膠囊按鈕 —— 小朋友點按鈕比拉下拉容易得多，
 * 數量多就讓它換行，不換成下拉。
 */
const isCompact = ref(false)
let mq: MediaQueryList | null = null
const onMqChange = (e: MediaQueryListEvent) => { isCompact.value = e.matches }

onMounted(() => {
  mq = window.matchMedia('(max-width: 560px), (max-height: 520px)')
  isCompact.value = mq.matches
  mq.addEventListener('change', onMqChange)
})

onBeforeUnmount(() => mq?.removeEventListener('change', onMqChange))

/** 剩餘額度說成小朋友聽得懂的話 */
const remainText = computed(() => humanMinutes(remainingSeconds.value))
const restText = computed(() => countdown(restRemainingSeconds.value))

/** 額度用完或正在休息，片單都要收起來 */
const isBlocked = computed(() => isLimitReached.value || isResting.value)

/* ---------- 大分類與分區切換 ---------- */

const pickedSectionId = ref('')
const pickedId = ref('')

// 家長可能把當前的分類或分區刪掉，所以一律用 computed 求一次有效的值
const activeSection = computed(() =>
  sections.value.find((x) => x.id === pickedSectionId.value) ?? sections.value[0],
)

/** 只有一個大分類時不用顯示那一排，畫面留給影片 */
const showSections = computed(() => sections.value.length > 1)

const activeCategories = computed(() =>
  activeSection.value ? categoriesIn(activeSection.value.id) : [],
)

const activeCategory = computed(() =>
  activeCategories.value.find((c) => c.id === pickedId.value) ?? activeCategories.value[0],
)

/** 分區的顏色照它在整份片單裡的位置決定，切換大分類時顏色才不會跳動 */
const colorOf = (id: string) =>
  categoryColor(categories.value.findIndex((c) => c.id === id), themeResolved.value)

/** 分區底下的分組：先是沒分冊的影片，再依序是各個細分 */
const groups = computed(() =>
  activeCategory.value ? groupsIn(activeCategory.value.id) : [],
)

const hasVideos = computed(() => groups.value.length > 0)

/* ---------- 單元展開 ---------- */

/** 'accordion' 和 'remember' 都是一次只開一個，差別在要不要記住上次那個 */
const isAccordion = computed(() => display.value.groupMode !== 'all')

/** 手風琴模式下，目前開著的是哪一個單元 */
const openGroupId = ref<string | null>(null)

// 換分區時決定要開哪一個單元：
// 記憶模式就回到上次看的那個，否則一律從第一個開始
watch(activeCategory, (cat) => {
  const first = groups.value.find((g) => g.id)?.id ?? null
  if (!cat) {
    openGroupId.value = first
    return
  }
  if (display.value.groupMode === 'remember') {
    const last = lastGroupOf(cat.id)
    // 上次那個單元可能已經被家長刪掉了，找不到就退回第一個
    openGroupId.value = groups.value.some((g) => g.id === last) ? last : first
  } else {
    openGroupId.value = first
  }
}, { immediate: true })

function isOpen(groupId: string | null): boolean {
  // 沒有標題的那組（未分冊的影片）沒東西可以點，一律展開
  if (!isAccordion.value || groupId === null) return true
  return openGroupId.value === groupId
}

function pickCategoryFromSelect(ev: Event) {
  pickedId.value = (ev.target as HTMLSelectElement).value
}

/** 有名字的冊：下拉選單就是選這些 */
const namedGroups = computed(() => groups.value.filter((g) => g.id))

/** 分區：空間夠就用膠囊按鈕，擠不下才用下拉 */
const catAsPicker = computed(() => isCompact.value)

/** 冊：同上 */
const groupAsPicker = computed(() => isAccordion.value && isCompact.value)

/** 冊要用膠囊按鈕列（一次開一個模式、且空間夠） */
const showGroupTabs = computed(() =>
  isAccordion.value && !isCompact.value && namedGroups.value.length > 1,
)

function pickGroup(ev: Event) {
  const id = (ev.target as HTMLSelectElement).value || null
  openGroupId.value = id
  if (activeCategory.value) rememberGroup(activeCategory.value.id, id)
}

function toggleGroup(groupId: string | null) {
  if (!isAccordion.value || groupId === null) return
  openGroupId.value = openGroupId.value === groupId ? null : groupId
  if (activeCategory.value) rememberGroup(activeCategory.value.id, openGroupId.value)
}

const activeColor = computed(() =>
  activeCategory.value ? colorOf(activeCategory.value.id) : categoryColor(0, themeResolved.value),
)

/* ---------- 家長入口：齒輪要按滿 1.5 秒才算數 ---------- */

const HOLD_MS = 1500
const isHolding = ref(false)
let holdTimer: ReturnType<typeof setTimeout> | null = null

function startHold() {
  isHolding.value = true
  holdTimer = setTimeout(() => {
    isHolding.value = false
    emit('openParent')
  }, HOLD_MS)
}

function cancelHold() {
  isHolding.value = false
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
}

onBeforeUnmount(cancelHold)
</script>

<template>
  <section class="library" :class="{ 'is-accordion': isAccordion }">
    <header class="app-bar">
      <div class="brand">
        <h1>{{ appTitle }}</h1>
      </div>

      <!-- 有設每日上限才顯示，沒設就不要拿時間去干擾小朋友 -->
      <span v-if="hasLimit && !isBlocked" class="quota">
        <span class="quota-icon" aria-hidden="true">⏰</span><span class="quota-label">還可以看 </span>{{ remainText }}
      </span>

      <button
        class="icon-btn theme-btn"
        :aria-label="themeResolved === 'dark' ? '換成亮色背景' : '換成暗色背景'"
        @click="toggleTheme"
      >
        <span aria-hidden="true">{{ themeResolved === 'dark' ? '☀️' : '🌙' }}</span>
      </button>

      <button
        class="icon-btn"
        :class="{ 'is-holding': isHolding }"
        aria-label="家長設定（長按）"
        @pointerdown="startHold"
        @pointerup="cancelHold"
        @pointerleave="cancelHold"
        @pointercancel="cancelHold"
        @contextmenu.prevent
      >
        <svg viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.4-2.6.1-.9-.1-.9 1.9-1.5a.5.5 0 0 0 .1-.6l-1.8-3.1a.5.5 0 0 0-.6-.2l-2.2.9a7.3 7.3 0 0 0-1.6-.9l-.3-2.4a.5.5 0 0 0-.5-.4h-3.6a.5.5 0 0 0-.5.4l-.3 2.4c-.6.2-1.1.5-1.6.9l-2.2-.9a.5.5 0 0 0-.6.2L3.7 9a.5.5 0 0 0 .1.6l1.9 1.5-.1.9.1.9-1.9 1.5a.5.5 0 0 0-.1.6l1.8 3.1c.1.2.4.3.6.2l2.2-.9c.5.4 1 .7 1.6.9l.3 2.4c0 .3.3.4.5.4h3.6c.2 0 .5-.1.5-.4l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.2.9c.2.1.5 0 .6-.2l1.8-3.1a.5.5 0 0 0-.1-.6l-1.9-1.5Z" /></svg>
      </button>
    </header>

    <!-- 休息中：倒數完會自動解鎖，不必按任何按鈕 -->
    <div v-if="isResting" class="locked">
      <span class="locked-icon" aria-hidden="true">👀</span>
      <p class="locked-title">眼睛休息一下</p>
      <p class="locked-count">{{ restText }}</p>
      <p class="locked-sub">時間到了就可以再看囉</p>
    </div>

    <!-- 額度用完：把片單整個收起來，只留家長入口 -->
    <div v-else-if="isLimitReached" class="locked">
      <span class="locked-icon" aria-hidden="true">⏰</span>
      <p class="locked-title">今天的看片時間用完了</p>
      <p class="locked-sub">明天再看喔！</p>
    </div>

    <!-- 大分類（學習／娛樂）：只有一個的時候整排藏起來 -->
    <nav v-else-if="showSections" class="tabs tabs-section" aria-label="大分類">
      <button
        v-for="sec in sections"
        :key="sec.id"
        class="tab tab-section"
        :class="{ 'is-active': sec.id === activeSection?.id }"
        :aria-current="sec.id === activeSection?.id ? 'true' : undefined"
        @click="pickedSectionId = sec.id"
      >
        <span class="tab-emoji" aria-hidden="true">{{ sec.emoji }}</span>
        <span class="tab-name">{{ sec.name }}</span>
        <span class="tab-count">{{ countInSection(sec.id) }}</span>
      </button>
    </nav>

    <!-- 分區標籤：四個以內用膠囊，再多就換成下拉 -->
    <nav
      v-if="!isBlocked && activeCategories.length > 1 && !catAsPicker"
      class="tabs"
      aria-label="影片分區"
    >
      <button
        v-for="cat in activeCategories"
        :key="cat.id"
        class="tab"
        :class="{ 'is-active': cat.id === activeCategory?.id }"
        :style="cat.id === activeCategory?.id
          ? { background: colorOf(cat.id), color: 'var(--on-accent)' }
          : { color: colorOf(cat.id) }"
        :aria-current="cat.id === activeCategory?.id ? 'true' : undefined"
        @click="pickedId = cat.id"
      >
        <span class="tab-emoji" aria-hidden="true">{{ cat.emoji }}</span>
        <span class="tab-name">{{ cat.name }}</span>
        <span class="tab-count">{{ countIn(cat.id) }}</span>
      </button>
    </nav>

    <!-- 冊（單元）：一次開一個模式下用膠囊按鈕選，小朋友點按鈕比拉下拉容易 -->
    <nav v-if="!isBlocked && showGroupTabs" class="tabs tabs-group" aria-label="單元">
      <button
        v-for="g in namedGroups"
        :key="g.id ?? ''"
        class="tab tab-group"
        :class="{ 'is-active': openGroupId === g.id }"
        :style="openGroupId === g.id
          ? { background: activeColor, color: 'var(--on-accent)', borderColor: 'transparent' }
          : { color: activeColor }"
        :aria-current="openGroupId === g.id ? 'true' : undefined"
        @click="toggleGroup(g.id)"
      >
        <span class="tab-name">{{ g.name }}</span>
        <span class="tab-count">{{ g.videos.length }}</span>
      </button>
    </nav>

    <!--
      小螢幕與手機橫向：按鈕列放不下（橫向捲又看不出來可以捲），改用下拉。
      橫向時兩個下拉並排，省下一行的高度留給影片。
    -->
    <div v-if="!isBlocked && (catAsPicker || groupAsPicker)" class="pickers">
      <div v-if="activeCategories.length > 1 && catAsPicker" class="picker cat-picker">
        <select
          class="picker-select"
          :style="{ borderColor: activeColor }"
          :value="activeCategory?.id"
          aria-label="選擇分區"
          @change="pickCategoryFromSelect"
        >
          <option v-for="cat in activeCategories" :key="cat.id" :value="cat.id">
            {{ cat.emoji }} {{ cat.name }}（{{ countIn(cat.id) }} 部）
          </option>
        </select>
      </div>

      <div v-if="namedGroups.length > 1 && groupAsPicker" class="picker group-picker">
        <select class="picker-select" :value="openGroupId ?? ''" aria-label="選擇單元" @change="pickGroup">
          <option
            v-for="g in namedGroups"
            :key="g.id ?? ''"
            :value="g.id ?? ''"
          >
            {{ g.name }}（{{ g.videos.length }} 部）
          </option>
        </select>
      </div>
    </div>

    <main v-if="!isBlocked && hasVideos" class="scroll">
      <section
        v-for="group in groups"
        :key="group.id ?? '_loose'"
        class="group"
      >
        <!-- 沒分冊的影片不帶小標題，直接排在最前面 -->
        <component
          :is="isAccordion ? 'button' : 'h2'"
          v-if="group.name && !groupAsPicker && !showGroupTabs"
          class="group-title"
          :class="{ 'is-tappable': isAccordion }"
          :style="{ borderColor: activeColor }"
          :aria-expanded="isAccordion ? isOpen(group.id) : undefined"
          @click="toggleGroup(group.id)"
        >
          <svg
            v-if="isAccordion"
            class="group-caret"
            :class="{ 'is-open': isOpen(group.id) }"
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="M9.3 6 8 7.4l4.6 4.6L8 16.6 9.3 18l6-6z" /></svg>

          <span class="group-name">{{ group.name }}</span>
          <span class="group-count">{{ group.videos.length }}</span>
        </component>

        <div v-show="isOpen(group.id)" class="grid">
          <button
            v-for="video in group.videos"
            :key="video.uid"
            class="card"
            type="button"
            @click="emit('play', video)"
          >
            <!-- 網站沒有縮圖，用一個看得懂的圖示，也順便跟影片區分開 -->
            <div
              v-if="video.kind === 'site'"
              class="card-thumb card-site"
              :style="{ background: activeColor }"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.9a15.6 15.6 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.4 2.5 1.8 4h-3.6c.4-1.5 1-2.8 1.8-4ZM4.3 14a8 8 0 0 1 0-4h3.3a16.6 16.6 0 0 0 0 4Zm.8 2h2.9c.3 1.2.7 2.3 1.3 3.4A8 8 0 0 1 5.1 16Zm2.9-8H5.1a8 8 0 0 1 4.2-3.4A15.6 15.6 0 0 0 8 8Zm4 12c-.8-1.2-1.4-2.5-1.8-4h3.6c-.4 1.5-1 2.8-1.8 4Zm2.2-6H9.8a14.6 14.6 0 0 1 0-4h4.4a14.6 14.6 0 0 1 0 4Zm.5 5.4c.6-1.1 1-2.2 1.3-3.4h2.9a8 8 0 0 1-4.2 3.4ZM16.4 14a16.6 16.6 0 0 0 0-4h3.3a8 8 0 0 1 0 4Z" /></svg>
            </div>
            <div v-else class="card-thumb" :style="{ backgroundImage: `url(${thumbUrl(video.id)})` }" />

            <div class="card-title">
              <span v-if="video.kind === 'site'" class="site-tag">網站</span>{{ video.title || '影片' }}
            </div>
          </button>
        </div>
      </section>
    </main>

    <p v-else-if="!isBlocked" class="empty-hint">
      <template v-if="categories.length">
        <span class="empty-emoji" aria-hidden="true">{{ activeCategory?.emoji }}</span><br>
        「{{ activeCategory?.name }}」還沒有影片。<br>
        長按右上角的齒輪，進入家長設定新增。
      </template>
      <template v-else>
        還沒有分區。<br>
        長按右上角的齒輪，進入家長設定建立。
      </template>
    </p>

    <!-- 底部細線用當前分區的顏色，小朋友一眼知道自己在哪一區 -->
    <div class="active-bar" :style="{ background: activeColor }" />
  </section>
</template>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.theme-btn { font-size: 22px; }

/* 長按進行中給個顏色回饋，家長才知道按住有效 */
.icon-btn.is-holding {
  background: var(--accent);
  color: var(--on-accent);
}

/* ---------- 剩餘額度 ---------- */
.quota-icon { margin-right: 7px; }

.quota {
  margin-left: auto;
  margin-right: 4px;
  flex: none;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}

/* ---------- 額度用完的鎖定畫面 ---------- */
.locked {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 30px calc(var(--safe-b) + 40px);
  text-align: center;
}
.locked-icon { font-size: 88px; line-height: 1.4; }
.locked-title { margin: 0; font-size: 26px; font-weight: 800; }

.locked-count {
  margin: 10px 0 4px;
  font-size: 60px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 3px;
  color: var(--accent);
}
.locked-sub { margin: 0; font-size: 19px; color: var(--text-dim); }

/* ---------- 分區標籤 ---------- */
.tabs {
  flex: none;
  display: flex;
  /* 放不下就換行。橫向捲雖然省高度，但小朋友看不出來那一列可以捲，
     被切掉一半的標籤看起來就只是壞掉。 */
  flex-wrap: wrap;
  gap: 12px;
  padding: 2px calc(var(--safe-r) + 22px) 16px calc(var(--safe-l) + 22px);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }

.tab {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 60px;
  padding: 0 22px;
  border: 2px solid currentColor;
  border-radius: 999px;
  background: transparent;
  font-family: inherit;
  font-size: 19px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .15s ease;
}
.tab:active { transform: scale(.95); }
.tab.is-active { border-color: transparent; }

/* 大分類那排刻意不上彩色，視覺層級才分得出來 */
.tabs-section { padding-bottom: 10px; }

.tab-section {
  height: 52px;
  padding: 0 20px;
  font-size: 17px;
  border-color: var(--line);
  color: var(--text-dim);
}
.tab-section.is-active {
  background: var(--text);
  border-color: transparent;
  color: var(--bg);
}

.tab-emoji { font-size: 24px; line-height: 1; }
.tab-section .tab-emoji { font-size: 20px; }

/* 冊的膠囊比分區小一號，視覺上分得出層級 */
.tabs-group { padding-top: 0; padding-bottom: 14px; }

.tab-group {
  height: 52px;
  padding: 0 20px;
  font-size: 17px;
  border-color: currentColor;
}

.tab-count {
  min-width: 26px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .22);
  font-size: 14px;
  font-weight: 700;
}
.tab:not(.is-active) .tab-count {
  background: rgba(255, 255, 255, .1);
}

/* ---------- 影片格子 ---------- */
.scroll {
  padding: 4px calc(var(--safe-r) + 22px) calc(var(--safe-b) + 30px) calc(var(--safe-l) + 22px);
}

.group + .group { margin-top: 30px; }

/* 冊／單元的小標題，左邊用當前分區的顏色帶一條 */
.group-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
  padding-left: 13px;
  border-left: 5px solid;
  font-size: 21px;
  font-weight: 800;
  color: var(--text);
  font-family: inherit;
  text-align: left;
}

/* 手風琴模式下整條標題都能點，觸控範圍要夠大 */
.group-title.is-tappable {
  width: 100%;
  padding: 10px 14px 10px 13px;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0 14px 14px 0;
  background: var(--bg-soft);
  cursor: pointer;
  transition: background .15s ease;
}
.group-title.is-tappable:active { background: var(--bg-card); }

.group-caret {
  flex: none;
  width: 22px;
  height: 22px;
  fill: var(--text-dim);
  transition: transform .18s ease;
}
.group-caret.is-open { transform: rotate(90deg); }

.group-name { flex: none; }

/* ---------- 下拉（分區與單元共用），要不要出現由 v-if 決定 ---------- */
.pickers {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 calc(var(--safe-r) + 22px) 12px calc(var(--safe-l) + 22px);
}
.picker { flex: 1; min-width: 0; }

/* 空間夠的時候兩個下拉並排，省一行高度 */
@media (min-width: 620px) {
  .pickers { flex-direction: row; }
}

.picker-select {
  width: 100%;
  padding: 15px 44px 15px 18px;
  font-family: inherit;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  background-color: var(--bg-card);
  border: 2px solid var(--line);
  border-radius: 16px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  /* iOS 原生的箭頭在深色底幾乎看不見，自己畫一個 */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23a9a3d8'%3E%3Cpath d='M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 22px;
}

.cat-picker .picker-select {
  /* 邊框用當前分區的顏色，接續標籤的視覺語言 */
  border-width: 3px;
}

/* 手機橫向：垂直空間極少，把上面的東西全部壓扁，留給影片 */
@media (max-height: 520px) {
  .app-bar {
    padding-top: calc(var(--safe-t) + 8px);
    padding-bottom: 8px;
  }
  .app-bar h1 { font-size: 18px; }
  .icon-btn { width: 44px; height: 44px; }

  .tabs-section { padding-bottom: 8px; }
  .tab-section { height: 40px; padding: 0 14px; font-size: 14px; }
  .tab-section .tab-emoji { font-size: 16px; }

  .pickers { padding-bottom: 8px; }
  .picker-select {
    padding: 9px 38px 9px 14px;
    font-size: 15px;
    border-radius: 12px;
    background-size: 18px;
  }

  .quota { padding: 7px 12px; font-size: 13px; }
  .scroll { padding-bottom: calc(var(--safe-b) + 16px); }
}

.group-count {
  padding: 3px 11px;
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-dim);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  /* 影片少的時候，卡片要維持原本高度，不要被拉長填滿整頁 */
  align-content: start;
  gap: 22px;
}

.card {
  display: flex;
  flex-direction: column;
  border: 0;
  padding: 0;
  background: var(--bg-card);
  border-radius: var(--radius);
  overflow: hidden;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  box-shadow: 0 10px 26px var(--shadow);
  transition: transform .18s ease;
}
.card:active { transform: scale(.96); }

.card-thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #0f0d24 center / cover no-repeat;
}

/* 縮圖中央放一顆播放鈕，小朋友一眼就知道可以按 */
.card-thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: rgba(20, 18, 46, .72)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffc93c'%3E%3Cpath d='M8 5v14l11-7z'/%3E%3C/svg%3E")
    center / 30px no-repeat;
  backdrop-filter: blur(4px);
}

/* 網站卡片：用分區色鋪底 + 地球圖示，一眼跟影片分得開 */
.card-site {
  display: grid;
  place-items: center;
}
.card-site::after { content: none; }
.card-site svg {
  width: 64px;
  height: 64px;
  fill: var(--on-accent);
  opacity: .85;
}

.site-tag {
  display: inline-block;
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--bg);
  font-size: 12px;
  font-weight: 800;
  color: var(--text-dim);
  vertical-align: 2px;
}

.card-title {
  padding: 15px 18px 18px;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.empty-hint {
  margin: auto;
  padding: 0 30px calc(var(--safe-b) + 60px);
  text-align: center;
  color: var(--text-dim);
  font-size: 19px;
  line-height: 1.9;
}
.empty-emoji { font-size: 56px; line-height: 1.6; }

.active-bar {
  flex: none;
  height: 4px;
  transition: background .2s ease;
}

@media (max-width: 560px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
    gap: 16px;
  }
  .tab { height: 52px; padding: 0 16px; font-size: 16px; }
  .tab-section { height: 44px; padding: 0 14px; font-size: 15px; }
  .tab-emoji { font-size: 20px; }

  /* 手機的橫向空間要留給標題：額度只留數字 */
  .quota-label { display: none; }
  .quota { padding: 9px 12px; font-size: 14px; }
  .quota-icon { margin-right: 5px; }
}
</style>
