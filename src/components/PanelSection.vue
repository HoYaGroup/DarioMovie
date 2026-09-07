<script setup lang="ts">
import { computed } from 'vue'
import { useCollapse } from '~/composables/useCollapse'

/**
 * 家長設定頁的可摺疊面板。
 * 標題整條都能點，收起後只留一行，方便一次看到全部設定項目。
 */
const props = defineProps<{
  id: string
  title: string
  /** 標題右邊的小圓標，例如「4 區」 */
  badge?: string
  /** 收起時顯示的一行摘要，讓家長不用展開就知道現在的設定 */
  summary?: string
  /** 版面寬度：'2' 佔兩欄、'all' 佔整列 */
  span?: '2' | 'all'
}>()

const { isCollapsed, toggle } = useCollapse()
const collapsed = computed(() => isCollapsed(props.id))
</script>

<template>
  <div class="panel" :class="[span === '2' && 'span-2', span === 'all' && 'span-all']">
    <h2>
      <button
        class="panel-toggle"
        :aria-expanded="!collapsed"
        @click="toggle(id)"
      >
        <svg class="caret" :class="{ 'is-open': !collapsed }" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.3 6 8 7.4l4.6 4.6L8 16.6 9.3 18l6-6z" />
        </svg>
        <span class="panel-title">{{ title }}</span>
        <span v-if="badge" class="badge">{{ badge }}</span>
        <span v-if="collapsed && summary" class="panel-summary">{{ summary }}</span>
      </button>

      <slot name="header-extra" />
    </h2>

    <div v-show="!collapsed" class="panel-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px 22px 22px;
}

h2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}

.panel-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -6px -8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.panel-toggle:active { background: var(--bg-card); }

.caret {
  flex: none;
  width: 20px;
  height: 20px;
  fill: var(--text-dim);
  transition: transform .18s ease;
}
.caret.is-open { transform: rotate(90deg); }

.panel-title { flex: none; }

.badge {
  flex: none;
  padding: 3px 11px;
  border-radius: 999px;
  background: var(--line);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-dim);
}

/* 收起時顯示現在的設定，家長不用展開就知道狀態 */
.panel-summary {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-content { margin-top: 18px; }
</style>
