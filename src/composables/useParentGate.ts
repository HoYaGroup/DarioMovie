import { useState } from './useState'

const PIN_KEY = 'kidtube.pin'
const DEFAULT_PIN = '1234'

/** 密碼對話框的 Promise，跨元件共用同一份 */
let resolver: ((ok: boolean) => void) | null = null

/**
 * 家長門禁。
 *
 * 入口刻意設計成「長按齒輪 1.5 秒 + 4 位數密碼」——
 * 小朋友亂點碰不到，家長要進去也只要兩秒。
 */
export function useParentGate() {
  const isAsking = useState<boolean>('gate.asking', () => false)
  const errorText = useState<string>('gate.error', () => '')

  function currentPin(): string {
    try {
      return localStorage.getItem(PIN_KEY) || DEFAULT_PIN
    } catch {
      return DEFAULT_PIN
    }
  }

  function requestAccess(): Promise<boolean> {
    errorText.value = ''
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

  return { isAsking, errorText, requestAccess, submit, cancel, setPin, isDefaultPin }
}
