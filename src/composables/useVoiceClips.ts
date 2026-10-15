import { computed, ref } from 'vue'
import { allClips, clipsBytes, loadClips, onClipsChange } from '~/utils/recordings'

/**
 * 爸媽的錄音在畫面上的樣子：有幾句、佔多少空間，錄音增減時畫面跟著更新。
 * 錄音本身存在 utils/recordings.ts（不依賴 Vue，speak 也要用）。
 */
const tick = ref(0)
let wired = false

function wire() {
  if (wired) return
  wired = true
  onClipsChange(() => { tick.value++ })
  loadClips().then(() => { tick.value++ })
}

export function useVoiceClips() {
  wire()
  /** 每次錄音增減就加一；畫面上要查「這句錄過沒」的地方讀它，才會跟著重畫 */
  const version = computed(() => tick.value)
  const count = computed(() => (tick.value, allClips().length))
  const bytes = computed(() => (tick.value, clipsBytes()))
  return { version, count, bytes }
}
