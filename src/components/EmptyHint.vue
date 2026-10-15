<script setup lang="ts">
import { useLibrary } from '~/composables/useLibrary'
import { useTvMode } from '~/composables/useTvMode'
import type { ShelfKind } from '~/composables/useShelf'

defineProps<{ kind: ShelfKind }>()

const { categories } = useLibrary()
const { isTv } = useTvMode()
</script>

<template>
  <p class="empty-hint">
    <template v-if="categories.length">
      <span class="empty-emoji" aria-hidden="true">{{ kind === 'fun' ? '🎬' : '📚' }}</span><br>
      {{ kind === 'fun' ? '還沒有影片或網站。' : '還沒有字卡本。' }}<br>
      {{ isTv
        ? '請用手機或電腦開同一個網址，進入家長設定新增。'
        : kind === 'fun'
          ? '請爸爸媽媽先按「返回」，再長按首頁右上角的齒輪，進入家長設定新增。'
          : '請爸爸媽媽長按右上角的齒輪，進入家長設定新增。' }}
    </template>
    <template v-else>
      還沒有書單。<br>
      {{ isTv
        ? '電視沒有家長設定頁：請把電視 App 的啟動網址後面加上 ?sheet=試算表連結（做法見 README）。'
        : '請爸爸媽媽長按右上角的齒輪進入家長設定，在「來源備份」貼上學習單試算表的網址。' }}
    </template>
  </p>
</template>

<style scoped>
.empty-hint {
  margin: auto;
  padding: 40px 30px calc(var(--safe-b) + 60px);
  text-align: center;
  color: var(--text-dim);
  font-size: 19px;
  line-height: 1.9;
}
.empty-emoji { font-size: 56px; line-height: 1.6; }
</style>
