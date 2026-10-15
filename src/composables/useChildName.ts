import { useState } from './useState'

const STORE_KEY = 'kidtube.childName'
/** 名字最長幾個字：小名就好，太長語音唸起來也怪 */
export const NAME_MAX = 10

function read(): string {
  try {
    return (localStorage.getItem(STORE_KEY) ?? '').trim().slice(0, NAME_MAX)
  } catch {
    return ''
  }
}

/**
 * 孩子的小名（家長在設定頁填）：答對、做完動作的時候偶爾叫一下，「Great job, Dario!」。
 * 只記在這台裝置上，不會寫進片單，也不會跟著公開網站出去。沒填就不叫。
 */
export function useChildName() {
  const name = useState<string>('child.name', read)

  function setName(next: string) {
    name.value = next.trim().slice(0, NAME_MAX)
    try {
      if (name.value) localStorage.setItem(STORE_KEY, name.value)
      else localStorage.removeItem(STORE_KEY)
    } catch { /* 略過 */ }
  }

  return { name, setName }
}
