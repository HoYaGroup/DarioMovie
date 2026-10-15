/**
 * 產生給其他家長的「書單試算表範本」：public/template/booklist-template.xlsx
 *
 *   node scripts/make-template.mjs
 *
 * 範本只放自己寫的字卡（emoji 圖）、官方 YouTube 影片的連結，沒有任何有版權的圖片。
 * 「問句」工作表放每一句問句目前用的字（英文和中文在同一列；改那一列，用到這一句的卡一起改，也可以在最下面加新的）。
 * 家長下載範本 → 上傳到自己的 Google 雲端硬碟用「試算表」開啟（或 Google 試算表 → 檔案 → 匯入）→
 * 照「說明」工作表改成自己的書單 → 共用成「知道連結的人」可檢視 → 把連結貼到 App 的家長設定。
 * 範本會跟著網站部署，家長設定的「學習單」面板有下載連結。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guideSheet, questionSheet, tabSheet, writeWorkbook } from './lib/xlsx-writer.mjs'

// 「問句」工作表的內容用 App 內建的（src/utils/cards.ts），範本才不會跟程式不一樣
const { runnerImport } = await import('vite')
const { FRONT_QUESTIONS, SPECIAL_QUESTIONS, askKindName } = (await runnerImport(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'cards.ts'), { configFile: false, logLevel: 'silent' })).module

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'template', 'booklist-template.xlsx')

const note = (name) => ({ type: '備註', name })

const cards = tabSheet('範例：字卡', [
  { type: '分區', name: '範例字卡', section: '範例 🌟', image: '🍎', stage: '小班' },
  note('這是範例：第一列是欄位名稱，每一列用「類型」說明是什麼。第一個「分區」那一列是這個工作表自己的設定（名稱、大分類、圖示、階段）。'),
  note('看懂了就把這個工作表刪掉（或隱藏），換上自己的。工作表的順序就是小朋友看到的順序，拖曳工作表分頁就能排。'),
  { type: '設定', name: '任務: 家裡找找看，有哪些{zh}？ | Find something {en} at home! | 找:2 | 提示:水果、玩具水果、圖畫書上的都算' },
  { type: '字卡本', name: '水果', meaning: 'Fruits', stage: '小班' },
  { type: '卡', name: 'apple', meaning: '蘋果', image: '🍎', sentences: ['Yum, delicious apple!', 'Do you like apples?'] },
  { type: '卡', name: 'banana', meaning: '香蕉', image: '🍌', sentences: ['I like bananas.', 'A banana is yellow.'] },
  { type: '卡', name: 'grapes', meaning: '葡萄', image: '🍇', sentences: ['Look at the grapes!', 'Grapes are purple.'] },
  note('「圖」可以寫 emoji、https 開頭的圖片網址，或 cards/ 開頭的路徑（有版權或自己的照片請放「素材包」，見「說明」）。「句子1、句子2…」一格一句，翻面時輪流唸。'),
  { type: '字卡本', name: '顏色', meaning: 'Colors', stage: '小班' },
  { type: '卡', name: 'red', meaning: '紅色', image: '🟥', sentences: ['Red like an apple!'], ask: '顏色' },
  { type: '卡', name: 'yellow', meaning: '黃色', image: '🟨', sentences: ['Yellow like a banana!'], ask: '顏色' },
  { type: '卡', name: 'blue', meaning: '藍色', image: '🟦', sentences: ['Blue like the sky!'], ask: '顏色' },
  note('「問句」是卡片正面問的那一句：空白會照字卡本的名稱自動決定（名稱有「顏色」就問 What color is this?），問錯了在這一欄選對的。'),
  { type: '字卡本', name: '動物', meaning: 'Animals', stage: '小班', ask: '動物' },
  { type: '卡', name: 'dog', meaning: '狗', image: '🐶', sentences: ['Woof! I am a dog.'] },
  { type: '卡', name: 'cat', meaning: '貓', image: '🐱', sentences: ['Meow! I am a cat.'] },
  { type: '卡', name: 'fish', meaning: '魚', image: '🐟', sentences: ['The fish can swim.'], ask: '東西' },
  note('想要新的問句：到「問句」工作表最下面加一列（名字、英文、中文都寫），這一欄就能選它，像上面「動物」那一本。某張卡不一樣，在那張卡自己的「問句」欄選（像 fish 問 What is this?）。'),
])

const videos = tabSheet('範例：影片', [
  { type: '分區', name: '範例影片', section: '範例 🌟', image: '🎬' },
  note('影片和網站：貼網址就好，標題可以空白（影片會自動抓 YouTube 的片名）。「單元」是影片上方的小標題，可以不要。'),
  { type: '單元', name: '第一單元' },
  { type: '影片', name: 'Hello Hello（Noodle & Pals）', url: 'https://youtu.be/wKXXT244yFI' },
  { type: '網站', name: '範例網站（在 App 裡面開）', url: 'https://example.com/' },
])

const SPECIAL_NAMES = { number: '數字', zhChar: '識字', bopomofo: '注音' }
const questions = questionSheet([
  ...Object.entries(FRONT_QUESTIONS).map(([kind, q]) => ({ name: askKindName(kind), en: q.en, zh: q.zh })),
  ...Object.entries(SPECIAL_QUESTIONS).map(([kind, q]) => ({ name: SPECIAL_NAMES[kind], en: q.en, zh: q.zh })),
  // 自己加的問句（範例：「動物」那一本用它）
  { name: '動物', en: 'What animal is this?', zh: '這是什麼動物？' },
])

writeWorkbook(out, [guideSheet(), questions, cards, videos])
console.log(`範本：${out}`)
