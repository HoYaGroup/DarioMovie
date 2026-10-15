import { computed } from 'vue'
import { canHavePhoto } from '~/utils/cards'
import { readFolderUrl, wordTargets } from '~/utils/photoFiles'
import { lineIndexOf } from '~/utils/voiceLines'
import {
  readApiKey, readSyncLast, syncFromDrive, writeSyncLast,
  type DriveSyncReport, type SyncLast,
} from '~/utils/driveSync'
import { useLibrary } from './useLibrary'
import { useChildName } from './useChildName'
import { useState } from './useState'

/**
 * 資料夾同步在畫面上的樣子：同步中、下載進度、上次的結果、這次的報告（家長設定「照片素材」頁）。
 * **只有家長按「立即同步」才會下載**，開 App 時不會自己跑（要用的時候再按，不會偷偷用掉網路和空間）。
 * 同步本身在 utils/driveSync.ts。
 */
export function useDriveSync() {
  const { videos } = useLibrary()
  const { name: childName } = useChildName()

  /** 現在所有字卡上可以換照片的字（數字卡不行）：給同步時用檔名對卡 */
  const words = computed(() => {
    const all: string[] = []
    for (const v of videos.value) {
      if (v.kind !== 'deck') continue
      for (const c of v.cards ?? []) if (c.word.trim() && canHavePhoto(c)) all.push(c.word)
    }
    return wordTargets(all)
  })

  /** 現在所有字卡、App 說的話裡每一句（含例句、中文）：同步時用檔名對錄音 */
  const lines = computed(() => lineIndexOf(videos.value, childName.value))

  const syncing = useState<boolean>('drive.syncing', () => false)
  const report = useState<DriveSyncReport | null>('drive.report', () => null)
  const last = useState<SyncLast | null>('drive.last', readSyncLast)
  const error = useState<string>('drive.error', () => '')
  /** 素材一個一個下載時的進度（第一次同步幾百個檔案，要讓家長看到有在動） */
  const progress = useState<{ done: number; total: number }>('drive.progress', () => ({ done: 0, total: 0 }))

  async function sync(): Promise<void> {
    if (syncing.value) return
    syncing.value = true
    error.value = ''
    try {
      const r = await syncFromDrive(readFolderUrl(), readApiKey(), words.value, lines.value, (done, total) => { progress.value = { done, total } })
      report.value = r
      last.value = {
        at: Date.now(),
        saved: r.saved.length,
        unchanged: r.unchanged,
        media: r.media.saved,
        mediaUnchanged: r.media.unchanged,
        removed: r.media.removed,
        clips: r.clips.saved.length,
      }
    } catch (e) {
      const message = (e as Error).message || '同步失敗。'
      error.value = message
      last.value = { at: Date.now(), saved: 0, unchanged: 0, error: message }
    } finally {
      syncing.value = false
      progress.value = { done: 0, total: 0 }
      if (last.value) writeSyncLast(last.value)
    }
  }

  return { words, syncing, report, last, error, progress, sync }
}
