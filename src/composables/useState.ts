import { ref, type Ref } from 'vue'

/**
 * Nuxt 的 `useState(key, init)` 在純 Vite 專案裡沒有對應物：
 * 同一個 key 不管在哪個元件呼叫，永遠拿到同一份 ref，
 * 讓多個元件可以共享同一份「全域」狀態（本質上是個單例 store）。
 *
 * 這裡用一個模組層級的 Map 依 key 快取 ref，行為完全對齊。
 */
const cache = new Map<string, Ref<unknown>>()

export function useState<T>(key: string, init: () => T): Ref<T> {
  if (!cache.has(key)) cache.set(key, ref(init()) as Ref<unknown>)
  return cache.get(key) as Ref<T>
}
