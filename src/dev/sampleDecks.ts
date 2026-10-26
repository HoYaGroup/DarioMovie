import type { SheetPlaylist } from '~/utils/sheetSource'

/**
 * 開發用的測試字卡：npm run dev 而且還沒設定學習單試算表時，學習庫自動用這一份（見 useLibrary 的 syncFromPlaylist），
 * 不用接試算表就有東西測。部署出去的網站沒有這一份（import.meta.env.DEV 是 false，整段會被拿掉）。
 *
 * 每一本對應一種要測的玩法，寫法跟試算表轉出來的書單文字一樣（見 utils/playlist.ts、utils/cards.ts）。
 * 圖只用 emoji 和 public/cards 裡已經進版控的圖（數字形狀、ABC 圖卡、實物照片、動物叫聲），沒有有版權的書頁。
 * 改了這裡存檔，重新整理就會套用（內容的指紋變了，跟試算表改過一樣）。
 */
const SAMPLE = `
# 測試字卡 🧪

【數字】🔢

// 有圖的數字卡：考考我是「看圖選數字」；練習有找出所有的 6、描一描；比一比是比數字大小
字卡本: 數字像什麼 1～10 | Number Shapes 1-10
卡: 1 | 像一支鉛筆 like a pencil | cards/shapes/1-q.webp | cards/shapes/1.webp
卡: 2 | 像一隻鴨子 like a duck | cards/shapes/2-q.webp | cards/shapes/2.webp
卡: 3 | 像一隻蝴蝶 like a butterfly | cards/shapes/3-q.webp | cards/shapes/3.webp
卡: 4 | 像一艘帆船 like a sailboat | cards/shapes/4-q.webp | cards/shapes/4.webp
卡: 5 | 像一個勾勾 like a hook | cards/shapes/5-q.webp | cards/shapes/5.webp
卡: 6 | 像大肚子 like a big tummy | cards/shapes/6-q.webp | cards/shapes/6.webp
卡: 7 | 像一根拐杖 like a cane | cards/shapes/7-q.webp | cards/shapes/7.webp
卡: 8 | 像一個雪人 like a snowman | cards/shapes/8-q.webp | cards/shapes/8.webp
卡: 9 | 像一顆氣球 like a balloon | cards/shapes/9-q.webp | cards/shapes/9.webp
卡: 10 | 像球棒和棒球 like a bat and a ball | cards/shapes/10-q.webp | cards/shapes/10.webp

// 數一數：正面點著數、答 How many 才翻得過去；練習有數一數、哪一堆、給我幾個；最後一張有影片片段（要有網路）
字卡本: 數一數 1～10 | Let's Count 1-10
任務: 拿出{zh}個東西，一個一個數！ | Get {en} things and count them! | 找:數字
卡: 1 | 🍎
卡: 2 | 🐶
卡: 3 | 🐸
卡: 4 | 🍌
卡: 5 | 🐟
卡: 6 | 🍓
卡: 7 | 🐞
卡: 8 | 🐥
卡: 9 | 🍊
卡: 10 | 🐝 | https://youtu.be/g9EgE_JtEAw 0:20-0:50

// 一次產生一串數字卡：上面一排數字可以跳；描一描會出兩位數
字卡本: 認數字 0～20 | Numbers 0-20
數字卡: 0～20

// 排順序：照順序點
字卡本: 星期 | Days of the Week
順序: 是
卡: Monday | 星期一 | 🌙 | Today is Monday. | I go to school on Monday.
卡: Tuesday | 星期二 | 🔥 | Today is Tuesday. | Tuesday comes after Monday.
卡: Wednesday | 星期三 | 💧 | Today is Wednesday. | Wednesday comes after Tuesday.
卡: Thursday | 星期四 | 🌳 | Today is Thursday. | Thursday comes after Wednesday.
卡: Friday | 星期五 | 🪙 | Today is Friday. | Friday comes after Thursday.
卡: Saturday | 星期六 | 🪐 | Today is Saturday. | I play with my family on Saturday.
卡: Sunday | 星期天 | ☀️ | Today is Sunday. | I rest on Sunday.

【英文】🔤

// ABC：上面一排 A～Z 可以跳（沒有卡的字母淡掉）；練習有找出所有的 b（混著 d）、描字母；任務找某個字母開頭的東西
字卡本: ABC 圖卡 | ABC Picture Cards
任務: 家裡有什麼東西是 {abc} 開頭的？ | Find something that starts with {abc}! | 找:2
卡: apple | 蘋果 | cards/abc/apple-q.webp | cards/abc/apple.webp | Yum, delicious apple! | The apple is red.
卡: banana | 香蕉 | cards/abc/banana-q.webp | cards/abc/banana.webp | The banana is yellow. | Peel the banana.
卡: cat | 貓 | cards/abc/cat-q.webp | cards/abc/cat.webp | Meow! I am a cat. | Pet the cat gently.
卡: duck | 鴨子 | cards/abc/duck-q.webp | cards/abc/duck.webp | Quack, quack! I am a duck. | The duck can swim.
卡: elephant | 大象 | cards/abc/elephant-q.webp | cards/abc/elephant.webp | The elephant has a long nose. | The elephant is big and gray.
卡: fox | 狐狸 | cards/abc/fox-q.webp | cards/abc/fox.webp | Look, a red fox! | The fox has a fluffy tail.
卡: giraffe | 長頸鹿 | cards/abc/giraffe-q.webp | cards/abc/giraffe.webp | The giraffe is tall. | The giraffe has a long neck.
卡: house | 房子 | cards/abc/house-q.webp | cards/abc/house.webp | This is my house. | My house has a red door.

// 實物照片加真正的叫聲：有「聽聲音」，翻面也會放叫聲；任務到家裡找
字卡本: 農場動物 | Farm Animals
任務: 家裡找找看，哪裡有{zh}？真的、玩具、書上的圖片都可以！ | Can you find the {en}? A real one, a toy or a picture is OK! | 找:2
卡: cow | 牛 | cards/real/cow.webp | Moo! I am a cow. | The cow gives us milk. | 聲:cards/sounds/cow.wav
卡: pig | 豬 | cards/real/pig.webp | Oink, oink! I am a pig. | The pig likes mud. | 聲:cards/sounds/pig.wav
卡: dog | 狗 | cards/real/dog.webp | Woof, woof! I am a dog. | Let's walk the dog. | 聲:cards/sounds/dog.wav
卡: cat | 貓 | cards/real/cat.webp | Meow! I am a cat. | Shh! The cat is sleeping. | 聲:cards/sounds/cat.wav
卡: duck | 鴨子 | cards/real/duck.webp | Quack, quack! I am a duck. | The duck can swim. | 聲:cards/sounds/duck.wav
卡: chicken | 雞 | cards/real/chicken.webp | Cluck, cluck! I am a chicken. | The chicken lays eggs. | 聲:cards/sounds/chicken.wav
卡: sheep | 綿羊 | cards/real/sheep.webp | Baa! I am a sheep. | The sheep is soft and white. | 聲:cards/sounds/sheep.wav
卡: horse | 馬 | cards/real/horse.webp | Neigh! I am a horse. | The horse can run fast. | 聲:cards/sounds/horse.wav
卡: goat | 山羊 | cards/real/goat.webp | Maa! I am a goat. | The goat likes grass.
卡: rabbit | 兔子 | cards/real/rabbit.webp | Hop, hop, little rabbit! | The rabbit has long ears.

// 放哪裡：把東西拖到廚房、浴室、臥室、門口；任務把東西拿去放好
字卡本: 家裡的東西 | Things at Home
任務: 把{zh}拿去{place}，放放看！ | Put the {en} {where}! | 找:1
卡: bowl | 碗 | cards/real/bowl.webp | Eat soup from the bowl. | The bowl is full of rice. | 放:廚房
卡: spoon | 湯匙 | cards/real/spoon.webp | Eat with a spoon. | Here is your spoon. | 放:廚房
卡: cup | 杯子 | cards/real/cup.webp | Drink from the cup. | Hold your cup with two hands. | 放:廚房
卡: toothbrush | 牙刷 | cards/real/toothbrush.webp | Brush your teeth. | Brush up and down. | 放:浴室
卡: soap | 肥皂 | cards/real/soap.webp | Wash your hands with soap. | Rub, rub, rub with soap. | 放:浴室
卡: towel | 毛巾 | cards/real/towel.webp | Dry your hands with a towel. | The towel is soft. | 放:浴室
卡: pillow | 枕頭 | cards/real/pillow.webp | My pillow is soft. | Good night, pillow. | 放:臥室
卡: blanket | 被子 | cards/real/blanket.webp | The blanket keeps me warm. | Cover up with the blanket. | 放:臥室
卡: shoes | 鞋子 | cards/real/shoes.webp | Put on your shoes. | Take off your shoes. | 放:門口
卡: umbrella | 雨傘 | cards/real/umbrella.webp | It's raining. Take an umbrella! | Open the umbrella. | 放:門口

// 名稱有「動作」：上面是「做動作」（App 說、小朋友做）
字卡本: 動作 | Actions
卡: run | 跑 | 🏃 | Run, run, run! | I can run fast.
卡: jump | 跳 | 🦘 | Jump, jump, jump! | I can jump high.
卡: clap | 拍手 | 👏 | Clap your hands! | Clap two times.
卡: wave | 揮手 | 👋 | Wave bye-bye! | Wave hello!
卡: dance | 跳舞 | 💃 | Let's dance! | Dance with me!
卡: sleep | 睡覺 | 🛌 | Time to sleep. | Good night. Sleep tight!

// 相反詞（對:）：正面問「Is it big or small?」
字卡本: 相反詞 | Opposites
卡: big | 大 | 🐘 | The elephant is big. | 對:small
卡: small | 小 | 🐜 | The ant is small. | 對:big
卡: hot | 熱 | 🔥 | The soup is hot. | 對:cold
卡: cold | 冷 | 🧊 | The ice is cold. | 對:hot
卡: fast | 快 | 🚄 | The train is fast. | 對:slow
卡: slow | 慢 | 🐌 | The snail is slow. | 對:fast

// 名稱有「怎麼說」：整句話，上面是「跟我說」
字卡本: 吃飯怎麼說 | Mealtime Talk
卡: I'm hungry | 我肚子餓了 | 🤤🍔 | I'm hungry. I want a hamburger!
卡: I'm thirsty | 我口渴了 | 🥵🥤 | I'm thirsty. I want a cold drink!
卡: more, please | 請再給我一些 | 🥣🙏 | More soup, please!
卡: it's yummy | 好好吃 | 😋🍰 | Mmm, this cake is yummy!
卡: I'm full | 我吃飽了 | 😌🍽️ | No more, thank you. I'm full.
卡: all done | 我吃完了 | 👍🍽️ | I ate my lunch. All done!

【中文】✏️

// 識字卡：正面只有符號，翻面才有圖；練習只出描一描（一輪四題）
字卡本: 注音 ㄅㄆㄇㄈ
卡: ㄅ | 唸:玻 | 爸爸 | 👨
卡: ㄆ | 唸:坡 | 蘋果 | 🍎
卡: ㄇ | 唸:摸 | 媽媽 | 👩
卡: ㄈ | 唸:佛 | 飛機 | ✈️
卡: ㄉ | 唸:得 | 大象 | 🐘
卡: ㄊ | 唸:特 | 兔子 | 🐰

字卡本: 認識國字
卡: 一 | 數字 1
卡: 二 | 數字 2
卡: 三 | 數字 3
卡: 日 | 太陽、生日 | ☀️
卡: 月 | 月亮、月餅 | 🌙
卡: 山 | 高山、爬山 | ⛰️
卡: 水 | 喝水、水果 | 💧
`

export function sampleSheet(): SheetPlaylist {
  const lines = SAMPLE.split('\n')
  return {
    text: SAMPLE,
    origins: [],
    warnings: [],
    tabs: 1,
    items: 0,
    cards: lines.filter((l) => l.startsWith('卡:')).length,
    questions: {},
  }
}
