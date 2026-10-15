import { useState } from './useState'

const PIN_KEY = 'kidtube.pin'
const DEFAULT_PIN = '1234'

/** 輸入密碼是要進家長設定，還是要開影片時間 */
export type GatePurpose = 'settings' | 'fun'

/** 密碼對話框的 Promise，跨元件共用同一份 */
let resolver: ((ok: boolean) => void) | null = null

/**
 * 家長門禁。
 *
 * 設定的入口刻意設計成「長按齒輪 1.5 秒 + 4 位數密碼」——
 * 小朋友亂點碰不到，家長要進去也只要兩秒。
 * 影片時間（娛樂）的入口是首頁的 🎬 鎖頭鈕，點了一樣要輸入這個密碼。
 */
export function useParentGate() {
  const isAsking = useState<boolean>('gate.asking', () => false)
  const errorText = useState<string>('gate.error', () => '')
  /** 這次輸入密碼是要做什麼，密碼鍵盤上會寫給家長看 */
  const purpose = useState<GatePurpose>('gate.purpose', () => 'settings')

  function currentPin(): string {
    try {
      return localStorage.getItem(PIN_KEY) || DEFAULT_PIN
    } catch {
      return DEFAULT_PIN
    }
  }

  function requestAccess(why: GatePurpose = 'settings'): Promise<boolean> {
    errorText.value = ''
    purpose.value = why
    isAsking.value = true
    return new Promise<boolean>((resolve) => { resolver = resolve })
  }

  function submit(pin: string): boolean {
    if (pin === currentPin()) {
      isAsking.value = false
      resolver?.(true)
      resolver = null
      return true
    }
    errorText.value = '密碼不對，再試一次'
    return false
  }

  function cancel() {
    isAsking.value = false
    resolver?.(false)
    resolver = null
  }

  function setPin(pin: string): { ok: boolean; message: string } {
    if (!/^\d{4}$/.test(pin)) return { ok: false, message: '請輸入 4 位數字。' }
    try {
      localStorage.setItem(PIN_KEY, pin)
      return { ok: true, message: '密碼已更新。' }
    } catch {
      return { ok: false, message: '這台裝置無法儲存設定。' }
    }
  }

  function isDefaultPin(): boolean {
    return currentPin() === DEFAULT_PIN
  }

  return { isAsking, errorText, purpose, requestAccess, submit, cancel, setPin, isDefaultPin }
}
