<script setup lang="ts">
import { computed } from 'vue'
import { categoryColor, type VideoItem } from '~/utils/youtube'
import { chineseTitle, missionCardOf, missionCover } from '~/utils/cards'
import { useLibrary } from '~/composables/useLibrary'
import { useChildStage } from '~/composables/useChildStage'
import { useMissions } from '~/composables/useMissions'
import { useMissionPlan } from '~/composables/useMissionPlan'
import { useTheme } from '~/composables/useTheme'

/**
 * 任務貼紙本：每完成一個生活任務就貼一張貼紙，這裡把孩子這一班所有任務排出來——
 * 完成過的貼紙是彩色的、右上角寫完成幾次；還沒做過的是一個淡淡的空圈，等他去貼。
 * 點任何一張都直接打開那個任務（再玩一次，或第一次玩）。
 * 貼紙只記在這台裝置上（useMissions），是給小朋友的鼓勵，不是成績單。
 */
const emit = defineEmits<{ close: []; mission: [video: VideoItem] }>()

const { videos, categories } = useLibrary()
const { isVideoVisible } = useChildStage()
const { countOf } = useMissions()
const { plan } = useMissionPlan()
const { resolved: themeResolved } = useTheme()

const items = computed(() =>
  videos.value
    .filter((v) => v.kind === 'deck' && v.mission && isVideoVisible(v))
    .map((video) => {
      const card = missionCardOf(video, 0, plan.value.letter)
      const idx = categories.value.findIndex((c) => c.id === video.categoryId)
      return {
        video,
        count: countOf(video.uid),
        cover: missionCover(card),
        color: categoryColor(Math.max(0, idx), themeResolved.value),
      }
    }),
)

const got = computed(() => items.value.filter((i) => i.count > 0).length)
</script>

<template>
  <section class="book">
    <header class="book-bar">
      <button class="book-back" aria-label="回到清單" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
        <span>返回</span>
      </button>
      <h2 class="book-title"><span aria-hidden="true">🏅</span>任務貼紙本</h2>
      <span class="book-count" :aria-label="`已經集到 ${got} 張，共 ${items.length} 張`">
        <strong>{{ got }}</strong> / {{ items.length }}
      </span>
    </header>

    <main class="book-scroll">
      <p v-if="!items.length" class="book-empty">還沒有任務可以貼。</p>
      <div v-else class="book-grid">
        <button
          v-for="it in items"
          :key="it.video.uid"
          class="sticker-slot"
          :class="{ 'is-got': it.count > 0 }"
          :style="{ '--tile': it.color }"
          type="button"
          :aria-label="it.count > 0 ? `${chineseTitle(it.video)}，完成 ${it.count} 次` : `${chineseTitle(it.video)}，還沒貼`"
          @click="emit('mission', it.video)"
        >
          <span class="sticker" :style="{ '--n': it.cover.n }">
            <img v-if="it.cover.src" :src="it.cover.src" alt="" loading="lazy" draggable="false">
            <span v-else class="sticker-emoji" aria-hidden="true">{{ it.cover.text }}</span>
            <span v-if="it.count > 0" class="sticker-count" aria-hidden="true">{{ it.count > 1 ? `×${it.count}` : '✓' }}</span>
          </span>
          <span class="sticker-name">{{ chineseTitle(it.video) }}</span>
        </button>
      </div>
    </main>
  </section>
</template>

<style scoped>
.book {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  overflow: hidden;
}

.book-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px 14px;
  padding: calc(var(--safe-t) + 14px) calc(var(--safe-r) + 20px) 12px calc(var(--safe-l) + 20px);
}

.book-back {
  flex: none;
  height: 52px;
  padding: 0 16px 0 10px;
  border: 0;
  border-radius: 16px;
  background: var(--accent-2);
  color: var(--on-accent-2);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.book-back:active { transform: scale(.94); }
.book-back svg { width: 26px; height: 26px; fill: currentColor; }

.book-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: clamp(20px, 3vw, 28px);
  font-weight: 900;
}

.book-count {
  flex: none;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.book-count strong { font-size: 22px; color: var(--accent); }

.book-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 6px calc(var(--safe-r) + 20px) calc(var(--safe-b) + 28px) calc(var(--safe-l) + 20px);
}

.book-empty { margin: 60px 0; text-align: center; color: var(--text-dim); font-size: 19px; }

/* 貼紙一格一格排：手機三顆、iPad 四到六顆，每一顆都夠大、好點 */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 112px), 1fr));
  gap: 22px 14px;
}
@media (min-width: 700px) {
  .book-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 30px 20px; }
}

.sticker-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: transform .15s ease;
}
.sticker-slot:active { transform: scale(.94); }

/* 貼紙：圓形，白底、分區顏色的粗框，跟任務完成時貼的那張一樣 */
.sticker {
  position: relative;
  container-type: size;
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 6px solid var(--tile);
  background: #fffdf7;
  box-shadow: 0 8px 20px var(--shadow);
  overflow: visible;
}
.sticker img {
  /* 照片填滿整個圓，像貼紙 */
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  pointer-events: none;
}
.sticker-emoji {
  font-size: min(calc(60cqw / max(var(--n, 1) * .62 + .38, 1)), 58cqh);
  line-height: 1.1;
  text-align: center;
  pointer-events: none;
}

.sticker-count {
  position: absolute;
  top: -8px;
  right: -8px;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 18px;
  font-weight: 900;
  box-shadow: 0 4px 10px var(--shadow);
}

/* 還沒貼過：淡淡的空圈，圖片變成剪影，等他去貼 */
.sticker-slot:not(.is-got) .sticker {
  border-style: dashed;
  border-color: var(--line);
  background: var(--bg-card);
  box-shadow: none;
}
.sticker-slot:not(.is-got) .sticker img,
.sticker-slot:not(.is-got) .sticker-emoji {
  opacity: .28;
  filter: grayscale(1);
}

.sticker-name {
  max-width: 100%;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sticker-slot:not(.is-got) .sticker-name { color: var(--text-dim); }
</style>
