<script setup lang="ts">
import { computed } from 'vue'
import { countdown, useWatchTime } from '~/composables/useWatchTime'

const { isLimitReached, isResting, restRemainingSeconds } = useWatchTime()

const restText = computed(() => countdown(restRemainingSeconds.value))
</script>

<template>
  <!-- 休息中：倒數完會自動解鎖，不必按任何按鈕 -->
  <div v-if="isResting" class="locked">
    <span class="locked-icon" aria-hidden="true">👀</span>
    <p class="locked-title">眼睛休息一下</p>
    <p class="locked-count">{{ restText }}</p>
    <p class="locked-sub">時間到了就可以再看囉</p>
  </div>

  <!-- 額度用完：把內容整個收起來，只留家長入口 -->
  <div v-else-if="isLimitReached" class="locked">
    <span class="locked-icon" aria-hidden="true">⏰</span>
    <p class="locked-title">今天的螢幕時間用完了</p>
    <p class="locked-sub">明天再玩喔！</p>
  </div>
</template>

<style scoped>
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
</style>
