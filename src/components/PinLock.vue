<script setup lang="ts">
import { ref, watch } from 'vue'
import { useParentGate } from '~/composables/useParentGate'

const { isAsking, errorText, submit, cancel } = useParentGate()
const buffer = ref('')

// 每次重新開啟都從空白開始
watch(isAsking, (open) => { if (open) buffer.value = '' })

function press(key: string) {
  if (key === 'cancel') return cancel()

  if (key === 'del') {
    buffer.value = buffer.value.slice(0, -1)
    return
  }

  if (buffer.value.length >= 4) return
  buffer.value += key

  if (buffer.value.length === 4) {
    const ok = submit(buffer.value)
    if (!ok) setTimeout(() => { buffer.value = '' }, 250)
  }
}
</script>

<template>
  <div v-if="isAsking" class="pin-dialog">
    <div class="pin-card">
      <h2>請輸入家長密碼</h2>

      <div class="pin-dots">
        <i v-for="n in 4" :key="n" :class="{ on: buffer.length >= n }" />
      </div>

      <div class="pin-pad">
        <button v-for="n in 9" :key="n" @click="press(String(n))">{{ n }}</button>
        <button class="pin-alt" @click="press('cancel')">取消</button>
        <button @click="press('0')">0</button>
        <button class="pin-alt" @click="press('del')">刪除</button>
      </div>

      <p class="pin-err">{{ errorText }}</p>
    </div>
  </div>
</template>

<style scoped>
.pin-dialog {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 7, 20, .9);
  backdrop-filter: blur(8px);
}

.pin-card {
  width: min(360px, 88vw);
  padding: 30px 26px;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 28px;
  text-align: center;
}
.pin-card h2 { margin: 0 0 22px; font-size: 20px; font-weight: 800; }

.pin-dots {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 26px;
}
.pin-dots i {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--line);
  transition: background .15s ease, border-color .15s ease;
}
.pin-dots i.on { background: var(--accent); border-color: var(--accent); }

.pin-pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.pin-pad button {
  height: 62px;
  border: 0;
  border-radius: 18px;
  background: var(--bg-card);
  color: var(--text);
  font-size: 24px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.pin-pad button:active { background: var(--line); }
.pin-pad .pin-alt {
  font-size: 16px;
  color: var(--text-dim);
  background: transparent;
}

.pin-err {
  margin: 16px 0 0;
  min-height: 20px;
  font-size: 15px;
  color: var(--danger);
}
</style>
