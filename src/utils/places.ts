/**
 * 「放哪裡」遊戲的地點：碗放廚房、牙刷放浴室、鞋子放門口。
 * 字卡在片單裡用「放:廚房」指定這樣東西屬於哪裡（寫中文名或英文代號都可以），
 * 遊戲裡小朋友把東西拖到（或點）對的地方。
 *
 * 地點的照片放在 public/cards/real/place-<代號>.webp：現在是網路上的免費授權照片，
 * 想換成自己家的廚房、浴室，拍好丟進 drive/real/ 取一樣的檔名（place-kitchen.jpg）再跑 scripts/make-real-cards.mjs 就會蓋掉。
 * 沒有照片的地點（客廳）退回用 emoji。
 */
export interface Place {
  /** 英文代號，片單的「放:」和照片檔名都用它 */
  id: string
  zh: string
  /** 英文名字：kitchen */
  en: string
  /** 「放在哪裡」的英文片語：in the kitchen、by the door，跟 Put the bowl … 接起來才通順 */
  where: string
  emoji: string
  /** 照片路徑（public 底下）；空字串就用 emoji */
  image: string
}

export const PLACES: Place[] = [
  { id: 'kitchen', zh: '廚房', en: 'kitchen', where: 'in the kitchen', emoji: '🍳', image: 'cards/real/place-kitchen.webp' },
  { id: 'bathroom', zh: '浴室', en: 'bathroom', where: 'in the bathroom', emoji: '🛁', image: 'cards/real/place-bathroom.webp' },
  { id: 'bedroom', zh: '臥室', en: 'bedroom', where: 'in the bedroom', emoji: '🛏️', image: 'cards/real/place-bedroom.webp' },
  { id: 'door', zh: '門口', en: 'door', where: 'by the door', emoji: '🚪', image: 'cards/real/place-door.webp' },
  { id: 'living-room', zh: '客廳', en: 'living room', where: 'in the living room', emoji: '🛋️', image: '' },
]

const byId = new Map(PLACES.map((p) => [p.id, p]))

/** 片單「放:」後面寫的字 → 地點；中文名（廚房）、英文名（kitchen、living room）、代號（living-room）都收，看不懂回 undefined */
export function parsePlace(text: string): Place | undefined {
  const s = text.trim().toLowerCase()
  return PLACES.find((p) => p.id === s || p.zh === text.trim() || p.en === s)
}

/** 這個代號對應的地點（卡片上存的是代號） */
export function placeById(id: string | undefined): Place | undefined {
  return id ? byId.get(id) : undefined
}
