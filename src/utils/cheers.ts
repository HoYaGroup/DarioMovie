import type { SpeechText } from './speech'

/**
 * 字卡的回饋台詞。以前答對一律「Yes!」、答錯一律「No!」，聽起來像機器人；
 * 現在每一種回饋有好幾句輪流說，不會連著兩次一樣，偶爾還會叫小朋友的名字。
 *
 *   right  考考我答對          Yes!／You got it!／Great listening!
 *   wrong  考考我點錯          Hmm, not that one.／Oops!／Almost!（不說 No!，比較不會嚇到）
 *   said   「跟我說」說完了    You said it!／Great talking!
 *   did    「做動作」做完了    You did it!／Great moving!
 */
export type CheerKind = 'right' | 'wrong' | 'said' | 'did'

interface Cheer { en: string; zh: string }

const CHEERS: Record<CheerKind, Cheer[]> = {
  right: [
    { en: 'Yes!', zh: '對！' },
    { en: 'You got it!', zh: '答對了！' },
    { en: "That's right!", zh: '沒錯！' },
    { en: 'Great listening!', zh: '聽得真仔細！' },
    { en: 'Yay!', zh: '耶！' },
    { en: 'Wow!', zh: '哇！' },
  ],
  wrong: [
    { en: 'Hmm, not that one.', zh: '嗯，不是這個喔。' },
    { en: 'Oops!', zh: '哎呀！' },
    { en: 'Almost!', zh: '差一點點！' },
    { en: 'Let me help you.', zh: '我來幫你。' },
  ],
  said: [
    { en: 'You said it!', zh: '你說出來了！' },
    { en: 'Great talking!', zh: '說得真好！' },
    { en: 'Good job!', zh: '做得好！' },
    { en: 'Wow, nice voice!', zh: '哇，聲音好好聽！' },
    { en: 'Super!', zh: '太棒了！' },
  ],
  did: [
    { en: 'You did it!', zh: '你做到了！' },
    { en: 'Great moving!', zh: '動得真好！' },
    { en: 'Good job!', zh: '做得好！' },
    { en: 'Wow, so strong!', zh: '哇，好厲害！' },
    { en: 'Super!', zh: '太棒了！' },
  ],
}

/**
 * App 自己固定會說的話（字卡畫面用）。寫在這裡是為了讓家長設定頁的「錄音」也列得出來——
 * 爸媽用自己的聲音錄過，小朋友聽到的「Your turn!」「Great job!」就是爸媽的聲音（見 utils/recordings.ts）。
 * 有數字的（You got three stars!）每次不一樣，沒辦法預先錄，仍然用合成語音。
 */
export const PROMPTS = {
  quizIntro: { en: "Let's play a game!", zh: '我們來玩遊戲！' },
  playIntro: { en: "Let's play!", zh: '我們來玩！' },
  yourTurn: { en: 'Your turn!', zh: '換你說！' },
  doIt: { en: 'Do it!', zh: '做做看！' },
  listenAgain: { en: 'Listen again.', zh: '再聽一次。' },
  tryAgain: { en: 'Try again.', zh: '再試一次。' },
  tryAgainBang: { en: 'Try again!', zh: '再試一次！' },
  perfect: { en: 'Wow! You got them all! Great job!', zh: '哇！全部答對了！好棒！' },
  goodTry: { en: "Good try! Let's play again!", zh: '沒關係，我們再玩一次！' },
  // 家裡的書（書上找）：打開字卡先翻到同一頁，找完揭曉答案
  openBook: { en: 'Open your book to this page!', zh: '把書翻到這一頁！' },
  findInBook: { en: 'Find it in your book!', zh: '在書上找找看！' },
  hereItIs: { en: 'Here it is!', zh: '在這裡！' },
  // 生活任務：認識一個東西，再到家裡找找看
  missionIntro: { en: "Let's go on a mission!", zh: '我們來做任務！' },
  missionGo: { en: "Let's go!", zh: '出發！' },
  missionAnother: { en: 'Find another one!', zh: '再找一個！' },
  missionDone: { en: 'Mission complete! Great job!', zh: '任務完成！好棒！' },
  // 放哪裡：把東西放到對的地方
  placeIntro: { en: "Let's tidy up!", zh: '我們來收東西！' },
  // 聽聲音：放動物真正的叫聲，點出是誰
  soundListen: { en: 'Listen!', zh: '聽聽看！' },
  soundWho: { en: 'Who is it?', zh: '是誰在叫？' },
  // 排順序：照順序一張一張點
  orderIntro: { en: "Let's put them in order!", zh: '我們來排順序！' },
  orderFirst: { en: 'What comes first?', zh: '哪一個最先？' },
  orderNext: { en: 'What comes next?', zh: '接下來是哪一個？' },
  // 比一比：哪一邊比較多、哪個數字比較大
  cmpIntro: { en: "Let's compare!", zh: '我們來比一比！' },
  cmpMore: { en: 'Which has more?', zh: '哪一邊比較多？' },
  cmpFewer: { en: 'Which has fewer?', zh: '哪一邊比較少？' },
  cmpBigger: { en: 'Which number is bigger?', zh: '哪一個數字比較大？' },
  cmpSmaller: { en: 'Which number is smaller?', zh: '哪一個數字比較小？' },
  cmpThisIs: { en: 'This is', zh: '這是' },
} as const satisfies Record<string, Cheer>

/** 錄音清單用：App 說的每一句固定的話（讚美、提醒、開場），英文一組、中文一組 */
export function appLines(): Cheer[] {
  const seen = new Set<string>()
  const out: Cheer[] = []
  for (const c of [...Object.values(CHEERS).flat(), ...Object.values(PROMPTS)]) {
    if (seen.has(c.en)) continue
    seen.add(c.en)
    out.push(c)
  }
  return out
}

/** 每種回饋上一次說了哪一句，下一次換一句，不會連著兩次一樣 */
const lastPicked: Partial<Record<CheerKind, number>> = {}
/** 這是第幾次回饋：每三次叫一次名字，天天叫就不稀奇了 */
let counter = 0

function pickCheer(kind: CheerKind): Cheer {
  const list = CHEERS[kind]
  let i = Math.floor(Math.random() * list.length)
  if (list.length > 1 && i === lastPicked[kind]) i = (i + 1) % list.length
  lastPicked[kind] = i
  return list[i]!
}

/** 名字是中文就交給中文語音唸，英文名字交給英文語音 */
function nameText(name: string): SpeechText {
  return { text: name, lang: /\p{Script=Han}/u.test(name) ? 'zh-TW' : 'en-US' }
}

/**
 * 這一次的回饋要說的話。english 是全英文模式（English）才用英文說，中文、中英都用中文說，
 * 跟其他指令、回饋一致（見 CardDeck 的 line）。
 * 答錯不叫名字（點錯已經有點挫折，叫名字像在責備）。
 */
export function cheerParts(kind: CheerKind, english: boolean, name = ''): SpeechText[] {
  const c = pickCheer(kind)
  const base: SpeechText = english ? { text: c.en, lang: 'en-US' } : { text: c.zh, lang: 'zh-TW' }
  counter++
  const who = name.trim()
  if (!who || kind === 'wrong' || counter % 3 !== 0) return [base]
  // 「Great job, Dario!」：先說讚美再叫名字；中文是「小明，做得好！」
  return english ? [base, nameText(who)] : [nameText(who), base]
}

/** 畫面上顯示的同一句（回饋的字也要寫在畫面上，沒有語音的裝置才看得到） */
export function cheerText(parts: SpeechText[]): string {
  return parts.map((p) => p.text).join(' ')
}
