/**
 * 偵測目前是不是跑在側載的 TWA（Trusted Web Activity）電視 App 裡。
 * TWA 啟動網頁時，瀏覽器會帶上 `android-app://<package>` 的 referrer，這是官方認可的偵測方式；
 * 另外相容 `?tv=1`，方便本機開發用一般瀏覽器模擬電視版，不用真的打包 APK 才能測。
 */
export function useTvMode() {
  const isTv = document.referrer.startsWith('android-app://')
    || new URLSearchParams(location.search).has('tv')

  return { isTv }
}
