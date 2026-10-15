<script setup lang="ts">
import { computed, watch, ref, onBeforeUnmount } from 'vue'
import { categoryColor, type VideoItem } from '~/utils/youtube'
import { chineseTitle, missionCardOf, missionOf, missionTextOf, missionCover } from '~/utils/cards'
import { humanMinutes, useWatchTime } from '~/composables/useWatchTime'
import { useLibrary } from '~/composables/useLibrary'
import { useChildStage } from '~/composables/useChildStage'
import { useShelf } from '~/composables/useShelf'
import { useTheme } from '~/composables/useTheme'
import { useTvMode } from '~/composables/useTvMode'
import { useTvFocus } from '~/composables/useTvFocus'
import { useState } from '~/composables/useState'
import { useMissions, dayNumber, yesterdayKey } from '~/composables/useMissions'
import { useMissionPlan } from '~/composables/useMissionPlan'
import { pickToday, missionSeedOf } from '~/utils/missionPlan'
import ShelfBrowser from '~/components/ShelfBrowser.vue'
import LockedNotice from '~/components/LockedNotice.vue'
import EmptyHint from '~/components/EmptyHint.vue'

/**
 * 小朋友一打開看到的學習首頁：只有字卡本（認字、數數、練習、生活任務）。
 * 影片和網站在另一個畫面（FunLibrary），這裡完全不出現，要家長輸入密碼才進得去。
 */
const emit = defineEmits<{
  play: [video: VideoItem, queue: VideoItem[]]
  /** 點了「今日任務」：直接打開那本字卡的任務 */
  mission: [video: VideoItem]
  /** 點了「貼紙本」 */
  stickers: []
  /** 點了 🎬：家長輸入密碼後才會進娛樂畫面（電視沒有密碼，直接進） */
  openFun: []
  openParent: []
}>()

const { appTitle, videos, categories } = useLibrary()
const { isVideoVisible } = useChildStage()
const { sections, countInSection } = useShelf('learn')
const { hasLimit, remainingSeconds, isLimitReached, isResting } = useWatchTime()
const { resolved: themeResolved, setTheme } = useTheme()
const { isTv } = useTvMode()
const { doneToday, doneOn, countOf: missionCountOf } = useMissions()
const { plan: missionPlan, skipped: skippedMissions, today: todayPicks, saveToday, isSchool: isSchoolMission } = useMissionPlan()

const rootRef = ref<HTMLElement | null>(null)
useTvFocus(rootRef, '.mission-tile, .section-tile, .tabs .tab, .grid .card')

/** 小朋友自己就能換亮暗，光線變了不用找家長 */
function toggleTheme() {
  setTheme(themeResolved.value === 'dark' ? 'light' : 'dark')
}

/** 剩餘額度說成小朋友聽得懂的話 */
const remainText = computed(() => humanMinutes(remainingSeconds.value))

/** 額度用完或正在休息，整個畫面都收起來（字卡也算螢幕時間，見 CardDeck.vue） */
const isBlocked = computed(() => isLimitReached.value || isResting.value)

/* ---------- 今日任務 ---------- */

/**
 * 今天的任務：孩子看得到、家長沒標「不要排」的字卡本裡有「任務」的，
 * 每天輪到家長設定的個數（預設四個，見家長設定「小朋友」頁的今日任務），不同分區盡量混在一起；
 * 學校這週教的（字母進度、家長釘選的）優先佔一半的位子，昨天沒做完的優先補上。
 * 同一天不管開幾次都是同一批，不會點進去又換掉，怎麼挑見 utils/missionPlan.ts。
 */
const picked = computed(() => {
  const pool = videos.value.filter(
    (v) => v.kind === 'deck' && v.mission && isVideoVisible(v) && !skippedMissions.value.has(v.uid),
  )
  const yesterday = yesterdayKey()
  return pickToday(pool, missionPlan.value.perDay, dayNumber(), todayPicks.value, (uid) => !doneOn(uid, yesterday), isSchoolMission)
})

// 今天第一次排好（或家長改了設定）就記下來，之後同一天都照這一批放；存了之後 picked 重算會回同一批
watch(picked, (p) => {
  if (p.state && p.state !== todayPicks.value) saveToday(p.state)
}, { immediate: true })

/** 分區的顏色照它在整份片單裡的位置決定（任務磚上緣那一條） */
const colorOf = (categoryId: string) =>
  categoryColor(categories.value.findIndex((c) => c.id === categoryId), themeResolved.value)

const todayMissions = computed(() =>
  picked.value.items.map((video) => {
    // 磚上的圖和那句話都用這一次要認識的那張卡、這一次的題目，點進去就是這一張、這一題
    // （每排上來一次換一張卡、換一個題目，見 missionSeedOf、missionOf）
    const seed = missionSeedOf(picked.value.state, video.uid)
    const letter = missionPlan.value.letter
    const card = missionCardOf(video, seed, letter)
    return { video, cover: missionCover(card), text: missionTextOf(missionOf(video, seed, letter)!, card).zh }
  }),
)

/** 孩子這一班所有的任務、其中貼過幾個：貼紙本的按鈕上寫「3 / 14」 */
const stickerProgress = computed(() => {
  const all = videos.value.filter((v) => v.kind === 'deck' && v.mission && isVideoVisible(v))
  return { got: all.filter((v) => missionCountOf(v.uid) > 0).length, all: all.length }
})

/* ---------- 大分類：先選一個，再看裡面的字卡 ---------- */

// 玩完字卡返回時畫面是重新掛載的，用 useState 存在模組層級才能回到原本那個大分類；要重開 App 才回首頁
const openId = useState('learn.openSectionId', () => '')

/** 只有一個大分類就不用多一層，字卡直接排在首頁 */
const single = computed(() => sections.value.length === 1)
const openSection = computed(() =>
  single.value ? sections.value[0] : sections.value.find((s) => s.id === openId.value),
)
/** 點進某個大分類之後：首頁的任務收起來，整個畫面留給那一區 */
const drilled = computed(() => !single.value && !!openSection.value)

const sectionColor = (id: string) =>
  categoryColor(sections.value.findIndex((s) => s.id === id), themeResolved.value)

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
  <section ref="rootRef" class="library">
    <header class="app-bar">
      <div class="brand">
        <h1>{{ appTitle }}</h1>
      </div>

      <!-- 有設每日上限才顯示，沒設就不要拿時間去干擾小朋友 -->
      <span v-if="hasLimit && !isBlocked" class="quota">
        <span class="quota-icon" aria-hidden="true">⏰</span><span class="quota-label">還可以玩 </span>{{ remainText }}
      </span>

      <button
        class="icon-btn theme-btn"
        :aria-label="themeResolved === 'dark' ? '換成亮色背景' : '換成暗色背景'"
        @click="toggleTheme"
      >
        <span aria-hidden="true">{{ themeResolved === 'dark' ? '☀️' : '🌙' }}</span>
      </button>

      <!-- 影片和網站：要家長輸入密碼才進得去（電視沒有密碼鍵盤，直接進） -->
      <button
        class="icon-btn fun-btn"
        type="button"
        :aria-label="isTv ? '看影片' : '看影片（要爸爸媽媽輸入密碼）'"
        @click="emit('openFun')"
      >
        <span aria-hidden="true">🎬</span>
        <span v-if="!isTv" class="fun-lock" aria-hidden="true">🔒</span>
      </button>

      <!-- 電視版沒有家長設定入口：長按手勢在遙控器上沒有對應操作，家長改用手機/電腦開同一個網址設定 -->
      <button
        v-if="!isTv"
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

    <LockedNotice v-if="isBlocked" />

    <template v-else>
      <!--
        今日任務：每天輪到幾個字卡本的「生活任務」，點進去就是認識一個東西、再到家裡找找看。
        只是捷徑——任務就是字卡本裡的「任務」模式，不是另外一份教材。
      -->
      <section v-if="!drilled && todayMissions.length" class="missions" aria-label="今日任務">
        <h2 class="missions-title">
          <span aria-hidden="true">🔎</span>今日任務
          <small>玩完就去找找看</small>
          <button class="stickers-btn" type="button" @click="emit('stickers')">
            <span aria-hidden="true">🏅</span>貼紙本
            <strong>{{ stickerProgress.got }}/{{ stickerProgress.all }}</strong>
          </button>
        </h2>
        <div class="missions-grid">
          <button
            v-for="m in todayMissions"
            :key="m.video.uid"
            class="mission-tile"
            :class="{ 'is-done': doneToday(m.video.uid) }"
            :style="{ '--tile': colorOf(m.video.categoryId) }"
            type="button"
            @click="emit('mission', m.video)"
          >
            <span class="mission-thumb" :style="{ '--n': m.cover.n }">
              <img v-if="m.cover.src" :src="m.cover.src" alt="" loading="lazy" draggable="false">
              <span v-else class="mission-emoji" aria-hidden="true">{{ m.cover.text }}</span>
              <span v-if="doneToday(m.video.uid)" class="mission-check" aria-label="今天完成了">✓</span>
            </span>
            <span class="mission-name">{{ chineseTitle(m.video) }}</span>
            <span class="mission-desc">{{ m.text }}</span>
            <span class="mission-tag">親子<span class="mission-tag-long">共玩</span> 3 分鐘</span>
          </button>
        </div>
      </section>

      <!-- 大分類：一個一個大圖示，點進去才看分區和字卡，首頁不用同時擺好幾排標籤 -->
      <template v-if="!single && !drilled && sections.length">
        <h2 class="picks-title"><span aria-hidden="true">📚</span>想玩什麼？</h2>
        <div class="section-grid">
          <button
            v-for="sec in sections"
            :key="sec.id"
            class="section-tile"
            :style="{ '--tile': sectionColor(sec.id) }"
            type="button"
            @click="openId = sec.id"
          >
            <span class="section-emoji" aria-hidden="true">{{ sec.emoji }}</span>
            <span class="section-name">{{ sec.name }}</span>
            <span class="section-count">{{ countInSection(sec.id) }}</span>
          </button>
        </div>
      </template>

      <!-- 點進某個大分類：上面一條返回，下面是那一區的分區和字卡 -->
      <div v-if="drilled && openSection" class="shelf-head" :style="{ '--tile': sectionColor(openSection.id) }">
        <button class="back-btn" type="button" @click="openId = ''">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6 16 7.4 11.4 12l4.6 4.6-1.3 1.4-6-6z" /></svg>
          返回
        </button>
        <h2><span aria-hidden="true">{{ openSection.emoji }}</span>{{ openSection.name }}</h2>
      </div>

      <ShelfBrowser
        v-if="(drilled || single) && openSection"
        kind="learn"
        :section-id="openSection.id"
        @open="(video, list) => emit('play', video, list)"
      />

      <EmptyHint v-if="!sections.length" kind="learn" />
    </template>
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
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.theme-btn { font-size: 22px; }

/* 影片入口：看得出來是 🎬、也看得出來上了鎖，小朋友點了只會跳出密碼鍵盤 */
.fun-btn {
  position: relative;
  font-size: 26px;
}
.fun-lock {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-soft);
  border: 2px solid var(--bg-card);
  font-size: 12px;
  line-height: 1;
}

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

/* ---------- 今日任務 ---------- */
.missions {
  flex: none;
  margin: 0 calc(var(--safe-r) + 22px) 26px calc(var(--safe-l) + 22px);
}

.missions-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 900;
}
.missions-title span { font-size: 22px; }
.missions-title small { font-size: 15px; font-weight: 700; color: var(--text-dim); }

/* 貼紙本：靠右的實心小鈕，點進去看集了幾張 */
.stickers-btn {
  flex: none;
  white-space: nowrap;
  margin-left: auto;
  align-self: center;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .15s ease;
}
.stickers-btn:active { transform: scale(.94); }
.stickers-btn span { font-size: 20px; }
.stickers-btn strong { color: var(--accent); font-variant-numeric: tabular-nums; }

/* 四張並排；手機寬度放三張，每張才夠大、好點 */
.missions-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.mission-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 14px;
  border: 0;
  border-radius: var(--radius);
  background: var(--bg-card);
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 10px 26px var(--shadow);
  transition: transform .18s ease;
}
.mission-tile:active { transform: scale(.96); }

/* 照片放在奶油色的底上，上緣一條分區色；有照片放照片，沒有就放 emoji */
.mission-thumb {
  position: relative;
  container-type: size;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
  border-top: 8px solid var(--tile);
  background: #fffdf7;
  overflow: hidden;
}
.mission-thumb img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
/* 寬的螢幕（iPad 橫放）圖不用方的，不然四張並排就占掉大半個畫面 */
@media (min-width: 700px) { .mission-thumb { aspect-ratio: 4 / 3; } }
@media (min-width: 1000px) { .mission-thumb { aspect-ratio: 16 / 10; } }
.mission-emoji {
  font-size: min(calc(62cqw / max(var(--n, 1) * .62 + .38, 1)), 64cqh);
  line-height: 1.1;
  text-align: center;
}
.mission-check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 22px;
  font-weight: 900;
}
.mission-tile.is-done .mission-thumb img,
.mission-tile.is-done .mission-emoji { opacity: .55; }

.mission-name {
  padding: 0 14px;
  font-size: 19px;
  font-weight: 900;
  line-height: 1.3;
}
.mission-desc {
  padding: 0 14px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mission-tag {
  align-self: flex-start;
  margin: 2px 14px 0;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--line);
  font-size: 12px;
  font-weight: 800;
}

/* ---------- 大分類圖示 ---------- */
.picks-title {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 calc(var(--safe-r) + 22px) 14px calc(var(--safe-l) + 22px);
  font-size: 22px;
  font-weight: 900;
}

.section-grid {
  flex: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 16px;
  margin: 0 calc(var(--safe-r) + 22px) calc(var(--safe-b) + 30px) calc(var(--safe-l) + 22px);
}

/* 實心的分區色、大圖示、大字：一眼知道這是一個一個可以按的入口 */
.section-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 150px;
  padding: 18px 12px 16px;
  border: 0;
  border-radius: var(--radius);
  background: var(--tile);
  color: var(--on-accent);
  font: inherit;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 10px 26px var(--shadow);
  transition: transform .18s ease;
}
.section-tile:active { transform: scale(.95); }

.section-emoji { font-size: 56px; line-height: 1.1; }
.section-name {
  font-size: 22px;
  font-weight: 900;
  line-height: 1.25;
}
.section-count {
  position: absolute;
  top: 10px;
  right: 10px;
  min-width: 28px;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .2);
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* ---------- 點進大分類之後的標題列 ---------- */
.shelf-head {
  position: sticky;
  top: 0;
  z-index: 5;
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
  padding: 8px calc(var(--safe-r) + 22px) 12px calc(var(--safe-l) + 22px);
  background: var(--bg);
  border-bottom: 4px solid var(--tile);
}
.shelf-head h2 {
  margin: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 26px;
  font-weight: 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shelf-head h2 span { font-size: 32px; line-height: 1; }

.back-btn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 56px;
  padding: 0 22px 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .15s ease;
}
.back-btn svg { width: 28px; height: 28px; fill: currentColor; }
.back-btn:active { transform: scale(.94); }

/* 手機橫向：垂直空間極少，把上面的東西全部壓扁，留給內容 */
@media (max-height: 520px) {
  .app-bar {
    padding-top: calc(var(--safe-t) + 8px);
    padding-bottom: 8px;
  }
  .app-bar h1 { font-size: 18px; }
  .icon-btn { width: 44px; height: 44px; }
  .quota { padding: 7px 12px; font-size: 13px; }
  .section-tile { min-height: 110px; }
  .section-emoji { font-size: 40px; }
}

@media (max-width: 560px) {
  /* 手機：任務放三張，第四張先不放，每張才夠大 */
  .missions-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .mission-tile:nth-child(n + 4) { display: none; }
  .mission-name { padding: 0 10px; font-size: 16px; }
  .mission-desc { padding: 0 10px; font-size: 12px; }
  .mission-tag { margin: 2px 10px 0; font-size: 11px; }
  .mission-tag-long { display: none; }
  .missions-title { font-size: 19px; }
  /* 手機寬度放不下那句小字，標題、貼紙本各留一行 */
  .missions-title small { display: none; }

  /* 手機：大分類兩個一排 */
  .section-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .section-tile { min-height: 128px; }
  .section-name { font-size: 19px; }

  /* 手機的橫向空間要留給標題：右上角三顆鈕縮小一點，額度只留數字 */
  .app-bar { gap: 8px; }
  .icon-btn { width: 46px; height: 46px; border-radius: 15px; }
  .icon-btn svg { width: 24px; height: 24px; }
  .fun-btn { font-size: 23px; }
  .theme-btn { font-size: 20px; }
  .quota-label { display: none; }
  .quota { padding: 9px 12px; font-size: 14px; }
  .quota-icon { margin-right: 5px; }
}
</style>
