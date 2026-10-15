import { shallowRef } from 'vue'

/**
 * 卡片正面問的問句，統一在試算表的「問句」工作表管（一個問句一列：問句｜英文｜中文，英文和中文在同一列，不會對不起來）。
 * 這裡存的是試算表上的那幾列：改過的內建問句，和自己加的問句；沒改的內建問句退回程式內建的（utils/cards.ts 的 FRONT_QUESTIONS）。
 * 鍵是問句的名字：內建的用代號（thing、color……、number、zhChar、bopomofo），自己加的就是那個名字。
 *
 * 存一份在 localStorage（才幾百個字）：開 App 時馬上就用得到，不用等試算表讀完，斷線也一樣。
 * 不依賴 DOM：cards.ts 在 node 裡也會載入這個檔案，載入時不能碰 window。
 */
export type QuestionTexts = Record<string, { en?: string; zh?: string }>

const KEY = 'kidtube.questionTexts'

const table = shallowRef<QuestionTexts>({})

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** 這個問句試算表上有沒有一列（沒有就回 undefined）；畫面讀它會跟著更新 */
export function questionOverride(key: string): { en?: string; zh?: string } | undefined {
  return has(table.value, key) ? table.value[key] : undefined
}

/** 試算表「問句」工作表上有哪些問句的名字（含改過的內建問句）；畫面讀它會跟著更新 */
export function questionNames(): string[] {
  return Object.keys(table.value)
}

/** 試算表讀進來之後呼叫：換成試算表上的那一份，也記一份在這台裝置 */
export function setQuestionTexts(next: QuestionTexts) {
  table.value = next
  try {
    if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch { /* 存不下就算了，下次讀試算表還是會有 */ }
}

/** App 啟動時叫一次：先用上次記下來的 */
export function loadQuestionTexts() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) table.value = parsed
  } catch { /* 壞了就當作沒有 */ }
}
