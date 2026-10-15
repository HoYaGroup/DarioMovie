import { computed } from 'vue'
import { allPhotos, photosVersion } from '~/utils/photos'
import { allClips } from '~/utils/recordings'
import { lastBackupAt } from '~/utils/backup'
import { useVoiceClips } from './useVoiceClips'

/**
 * 照片和錄音是家長花時間做的，只存在這台裝置：有幾個是上次備份之後才新增的，
 * 家長設定頁拿來提醒「還沒備份」。從沒備份過的話，全部都算沒備份。
 */
export function useBackupStatus() {
  const { version: clipsVersion } = useVoiceClips()

  const total = computed(() => {
    void photosVersion.value
    void clipsVersion.value
    return allPhotos().length + allClips().length
  })

  const unbacked = computed(() => {
    void photosVersion.value
    void clipsVersion.value
    const since = lastBackupAt.value ?? 0
    return allPhotos().filter((p) => p.at > since).length + allClips().filter((c) => c.at > since).length
  })

  return { lastBackupAt, total, unbacked }
}
