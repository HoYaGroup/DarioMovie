<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { thumbUrl, categoryColor, type Card, type VideoItem } from '~/utils/youtube'
import { countOf, isPicture, imageSrc, cardsOf, isZhCard } from '~/utils/cards'
import { useLibrary } from '~/composables/useLibrary'
import { useShelf, type ShelfKind } from '~/composables/useShelf'
import { useDisplay } from '~/composables/useDisplay'
import { useTheme } from '~/composables/useTheme'
import { useState } from '~/composables/useState'
import { useCardStars } from '~/composables/useCardStars'
import { useOnline } from '~/composables/useOffline'
import { speak } from '~/utils/speech'

/**
 * 一個畫面的「書架」：分區、單元和下面一格一格的字卡本（學習）或影片、網站（娛樂）。
 * 學習首頁點進一個大分類之後給 sectionId，只看那一個大分類；
 * 娛樂畫面不給，有好幾個大分類時最上面多一排大分類標籤。
 */
const props = defineProps<{
  kind: ShelfKind
  sectionId?: string
}>()

const emit = defineEmits<{
  open: [video: VideoItem, queue: VideoItem[]]
}>()

const { categories } = useLibrary()
const { sections, categoriesIn, countIn, countInSection, groupsIn } = useShelf(props.kind)
const { settings: display, lastGroupOf, rememberGroup } = useDisplay()
const { resolved: themeResolved } = useTheme()
const { starsOf } = useCardStars()
const { online } = useOnline()

/* ---------- 沒網路的時候：字卡照玩，影片、網站先等等 ---------- */

/** 要網路才能開的：影片和網站（字卡的圖已經存在裝置上了） */
function needsNet(video: VideoItem): boolean {
  return video.kind !== 'deck'
}

/** 點了沒網路打不開的東西：跳一個提示，也唸出來（小朋友還不太會看字） */
const offlineNotice = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function open(video: VideoItem, list: VideoItem[]) {
  if (!online.value && needsNet(video)) {
    offlineNotice.value = true
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { offlineNotice.value = false }, 3500)
    speak([{ text: '現在沒有網路，影片不能看。先玩字卡吧！', lang: 'zh-TW' }], 0.95)
    return
  }
  emit('open', video, list)
}

/** 字卡本的封面：前三張卡攤開成扇形，數字卡露出數字、其他卡露出圖 */
function deckPeek(video: VideoItem): Card[] {
  return cardsOf(video).slice(0, 3)
}

/** 封面小卡上寫的字（數字卡、識字卡露出字，其他卡露出圖；沒有圖的卡寫字） */
function peekText(c: Card): string {
  return countOf(c) !== null || isZhCard(c) ? c.word : (c.image || c.word)
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

onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMqChange)
  if (noticeTimer) clearTimeout(noticeTimer)
})

/* ---------- 大分類與分區切換 ---------- */

// 看影片、玩字卡時畫面會被 v-if 整個卸載，返回是重新掛載的新實例，
// 一般 ref 會歸零回到預設分類；用 useState 存在模組層級，卸載重掛都拿得回同一份，
// 才能讓「返回」停在原本瀏覽的分區，而不是跳回第一個。學習、娛樂各記各的。
const pickedSectionId = useState(`shelf.${props.kind}.pickedSectionId`, () => '')
const pickedId = useState(`shelf.${props.kind}.pickedId`, () => '')

// 家長可能把當前的分類或分區刪掉，所以一律用 computed 求一次有效的值
const activeSection = computed(() =>
  props.sectionId
    ? sections.value.find((x) => x.id === props.sectionId)
    : sections.value.find((x) => x.id === pickedSectionId.value) ?? sections.value[0],
)

/** 指定了大分類就不用那一排；只有一個大分類時也藏起來，畫面留給內容 */
const showSections = computed(() => !props.sectionId && sections.value.length > 1)

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
</script>

<template>
  <div class="shelf">
    <!-- 大分類：娛樂畫面才有，只有一個的時候整排藏起來 -->
    <nav v-if="showSections" class="tabs tabs-section" aria-label="大分類">
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

    <!-- 分區標籤：空間夠用膠囊，擠不下換成下拉 -->
    <nav
      v-if="activeCategories.length > 1 && !catAsPicker"
      class="tabs"
      aria-label="分區"
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
    <nav v-if="showGroupTabs" class="tabs tabs-group" aria-label="單元">
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
      橫向時兩個下拉並排，省下一行的高度留給內容。
    -->
    <div v-if="catAsPicker || groupAsPicker" class="pickers">
      <div v-if="activeCategories.length > 1 && catAsPicker" class="picker cat-picker">
        <select
          class="picker-select"
          :style="{ borderColor: activeColor }"
          :value="activeCategory?.id"
          aria-label="選擇分區"
          @change="pickCategoryFromSelect"
        >
          <option v-for="cat in activeCategories" :key="cat.id" :value="cat.id">
            {{ cat.emoji }} {{ cat.name }}（{{ countIn(cat.id) }}）
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
            {{ g.name }}（{{ g.videos.length }}）
          </option>
        </select>
      </div>
    </div>

    <main v-if="hasVideos" class="scroll">
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
            :class="{ 'is-offline': !online && needsNet(video) }"
            type="button"
            @click="open(video, group.videos)"
          >
            <!-- 網站沒有縮圖，用一個看得懂的圖示，也順便跟影片區分開 -->
            <div
              v-if="video.kind === 'site'"
              class="card-thumb card-site"
              :style="{ background: activeColor }"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.9a15.6 15.6 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.4 2.5 1.8 4h-3.6c.4-1.5 1-2.8 1.8-4ZM4.3 14a8 8 0 0 1 0-4h3.3a16.6 16.6 0 0 0 0 4Zm.8 2h2.9c.3 1.2.7 2.3 1.3 3.4A8 8 0 0 1 5.1 16Zm2.9-8H5.1a8 8 0 0 1 4.2-3.4A15.6 15.6 0 0 0 8 8Zm4 12c-.8-1.2-1.4-2.5-1.8-4h3.6c-.4 1.5-1 2.8-1.8 4Zm2.2-6H9.8a14.6 14.6 0 0 1 0-4h4.4a14.6 14.6 0 0 1 0 4Zm.5 5.4c.6-1.1 1-2.2 1.3-3.4h2.9a8 8 0 0 1-4.2 3.4ZM16.4 14a16.6 16.6 0 0 0 0-4h3.3a8 8 0 0 1 0 4Z" /></svg>
            </div>
            <div
              v-else-if="video.kind === 'deck'"
              class="card-thumb card-deck"
              :style="{ background: activeColor }"
            >
              <!-- 照家裡的書做的：封面就是書上那一頁，小朋友看了就知道要翻到哪裡 -->
              <img v-if="video.page" class="deck-page" :src="imageSrc(video.page)" alt="" loading="lazy">
              <template v-else>
                <span
                  v-for="(c, ci) in deckPeek(video)"
                  :key="ci"
                  class="deck-peek"
                  :style="{ '--o': ci - (deckPeek(video).length - 1) / 2, '--plen': [...peekText(c)].length }"
                >
                  <img v-if="isPicture(c) && !isZhCard(c)" :src="imageSrc(c.image)" alt="">
                  <template v-else>{{ peekText(c) }}</template>
                </span>
              </template>
              <span v-if="starsOf(video.uid)" class="deck-stars">⭐ {{ starsOf(video.uid) }}</span>
            </div>
            <div v-else class="card-thumb" :style="{ backgroundImage: `url(${thumbUrl(video.id)})` }" />

            <div class="card-title">
              <span v-if="video.kind === 'site'" class="site-tag">網站</span>
              <span v-else-if="video.kind === 'deck'" class="site-tag">字卡 {{ video.cards?.length ?? 0 }} 張</span>{{ video.title || '影片' }}
            </div>
          </button>
        </div>
      </section>
    </main>

    <!-- 點了沒網路打不開的影片 -->
    <div v-if="offlineNotice" class="offline-toast" role="alert" @click="offlineNotice = false">
      <span class="offline-toast-icon" aria-hidden="true">📴</span>
      <strong>現在沒有網路</strong>
      <span>影片要有網路才能看，先玩字卡吧！</span>
    </div>
  </div>
</template>

<style scoped>
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

/* ---------- 格子 ---------- */
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

.group-count {
  padding: 3px 11px;
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-dim);
}

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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  /* 東西少的時候，卡片要維持原本高度，不要被拉長填滿整頁 */
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

/* 沒網路打不開的影片、網站：淡掉，右上角貼一個「要網路」 */
.card.is-offline { opacity: .45; filter: grayscale(.7); }
.card.is-offline .card-thumb::before {
  content: '📴';
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .55);
  font-size: 16px;
}
.card.is-offline .card-thumb::after { display: none; }

.offline-toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-b) + 28px);
  z-index: 30;
  translate: -50% 0;
  width: min(92vw, 420px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 22px;
  border-radius: 22px;
  background: var(--bg-card);
  color: var(--text);
  font-size: 17px;
  text-align: center;
  box-shadow: 0 16px 40px var(--shadow);
  animation: toast-in .25s ease-out;
}
.offline-toast strong { font-size: 21px; }
.offline-toast-icon { font-size: 40px; line-height: 1.2; }

@keyframes toast-in {
  from { opacity: 0; translate: -50% 20px; }
  to { opacity: 1; translate: -50% 0; }
}

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

/* 字卡本：分區色鋪底，前三張卡攤成扇形，一眼看得出是「卡片」不是影片 */
.card-deck {
  display: block;
  overflow: hidden;
}
.card-deck::after { content: none; }

.deck-peek {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24%;
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #fffdf7;
  color: #221d45;
  /* 兩、三位數（10、100）字要縮小，小卡才擺得下 */
  font-size: calc(clamp(26px, 3.4vw, 46px) * min(1, 1.5 / var(--plen, 1)));
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 6px 14px rgba(0, 0, 0, .22);
  translate: calc(-50% + var(--o) * 92%) -46%;
  rotate: calc(var(--o) * 9deg);
}
.deck-peek img {
  width: 90%;
  height: 90%;
  object-fit: cover;
  border-radius: 8px;
}

.deck-page {
  position: absolute;
  inset: 8px;
  width: calc(100% - 16px);
  height: calc(100% - 16px);
  object-fit: cover;
  border-radius: 10px;
  box-shadow: 0 6px 14px rgba(0, 0, 0, .22);
}

.deck-stars {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(20, 18, 46, .72);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
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

/* 手機橫向：垂直空間極少，把上面的東西壓扁，留給內容 */
@media (max-height: 520px) {
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

  .scroll { padding-bottom: calc(var(--safe-b) + 16px); }
}

@media (max-width: 560px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
    gap: 16px;
  }
  .tab { height: 52px; padding: 0 16px; font-size: 16px; }
  .tab-section { height: 44px; padding: 0 14px; font-size: 15px; }
  .tab-emoji { font-size: 20px; }
}
</style>
