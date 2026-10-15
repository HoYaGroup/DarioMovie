<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { imageSrc } from '~/utils/cards'

/**
 * 家長設定「圖片與聲音來源」：字卡上的真實照片和動物叫聲，有一部分是 Wikimedia Commons 的免費授權檔案。
 * CC BY、CC BY-SA 的授權要求標出作者和來源，所以這裡列出每一張、每一個的作者、授權和連結。
 * 資料是 public/cards/real/credits.json、public/cards/sounds/credits.json（轉檔腳本產生，跟 CREDITS.md 同一份）。
 * 自己拍的照片、自己錄的叫聲不在清單裡。
 */
interface Credit {
  name: string
  author: string
  license: string
  title: string
  page: string
}

const photos = ref<Credit[]>([])
const sounds = ref<Credit[]>([])
const state = ref<'loading' | 'ok' | 'error'>('loading')

async function load(path: string): Promise<Credit[]> {
  const res = await fetch(imageSrc(path))
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<Credit[]>
}

onMounted(async () => {
  try {
    ;[photos.value, sounds.value] = await Promise.all([load('cards/real/credits.json'), load('cards/sounds/credits.json')])
    state.value = 'ok'
  } catch {
    // 沒網路、檔案還沒下載過：下次有網路再開就看得到
    state.value = 'error'
  }
})

/** 要標作者的授權（CC BY、CC BY-SA）：寫在列上用醒目一點的標籤 */
const needsCredit = (c: Credit) => /CC BY/i.test(c.license)

</script>

<template>
  <div class="credits">
    <p class="hint">
      字卡上的真實照片和動物叫聲，有一部分來自 <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a>
      的免費授權檔案，縮小、剪短後使用。<strong>CC BY、CC BY-SA 要標出作者和來源</strong>，所以列在這裡；CC0、公有領域不需要，也一併列出。
      自己拍的照片、自己錄的叫聲不在清單裡。
    </p>

    <p v-if="state === 'loading'" class="hint">讀取中…</p>
    <p v-else-if="state === 'error'" class="hint warn">這台裝置還沒存到來源清單，連上網路再打開一次就看得到。</p>

    <template v-else>
      <h3 class="credits-title">照片（{{ photos.length }}）</h3>
      <ul class="credit-list">
        <li v-for="c in photos" :key="`p-${c.name}`">
          <strong class="credit-name">{{ c.name }}</strong>
          <span class="credit-author">{{ c.author || '（未註明作者）' }}</span>
          <span class="credit-license" :class="{ 'is-by': needsCredit(c) }">{{ c.license }}</span>
          <a :href="c.page" target="_blank" rel="noopener">來源</a>
        </li>
      </ul>

      <h3 class="credits-title">叫聲（{{ sounds.length }}）</h3>
      <ul class="credit-list">
        <li v-for="c in sounds" :key="`s-${c.name}`">
          <strong class="credit-name">{{ c.name }}</strong>
          <span class="credit-author">{{ c.author || '（未註明作者）' }}</span>
          <span class="credit-license" :class="{ 'is-by': needsCredit(c) }">{{ c.license }}</span>
          <a :href="c.page" target="_blank" rel="noopener">來源</a>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.hint { margin: 0 0 12px; font-size: 14px; line-height: 1.7; color: var(--text-dim); }
.hint.warn { color: var(--warn, var(--text)); }
.hint a { color: var(--accent); }

.credits-title { margin: 18px 0 8px; font-size: 16px; font-weight: 800; }

.credit-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.credit-list li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--bg-card);
  font-size: 13px;
  line-height: 1.5;
}

.credit-name { min-width: 84px; font-size: 14px; }
.credit-author {
  flex: 1 1 120px;
  min-width: 0;
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.credit-license {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--line);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.credit-license.is-by { background: var(--accent); color: var(--on-accent); }
.credit-list a { color: var(--accent); font-weight: 700; }
</style>
