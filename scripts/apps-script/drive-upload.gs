/**
 * 照片上傳到雲端硬碟（Google Apps Script，要部署成「網頁應用程式」）。
 *
 * App 的家長設定「圖片和聲音」→「上傳」有「複製 script」鈕，會把下面兩個值（資料夾、密碼）填好，
 * 直接貼到 script.google.com 的新專案就能用，不用自己改。
 *
 * ‧ 只做一件事：把 App 送來的照片存進 FOLDER_ID 資料夾裡的 photos 子資料夾（沒有就自己建），同名的舊檔丟進垃圾桶（30 天內還找得回來）
 *   檔名就是卡上的字（monday.jpg），App 的「立即同步」會把 photos 資料夾裡的照片依檔名換到對應的卡上
 * ‧ 沒有密碼不收；只收 jpg／png／webp，檔名不能有路徑符號，一張最多 5 MB
 * ‧ 以你的身分執行，所以只碰得到 FOLDER_ID 這一個資料夾（寫死在這裡，App 不能指定別的資料夾）
 * ‧ 改過這份 script 之後，要「部署 › 管理部署作業 › 編輯 › 新版本 › 部署」才會生效（網址不變）
 */
var FOLDER_ID = '__FOLDER_ID__';
var PASSWORD = '__PASSWORD__';

/** 版本：App 的「測試連線」會檢查，舊版 script 會被提醒重新複製（1＝照片放最上層；2＝放進 photos 子資料夾） */
var VERSION = 2;
var PHOTO_DIR = 'photos';
var MAX_BYTES = 5 * 1024 * 1024;
var TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** 用瀏覽器直接開網址會看到這一行，確認有部署成功 */
function doGet() {
  return reply_({ ok: true, hello: 'kidtube-upload', version: VERSION });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (isPlaceholder_(PASSWORD) || isPlaceholder_(FOLDER_ID)) return reply_({ ok: false, error: 'setup' });
    if (req.key !== PASSWORD) return reply_({ ok: false, error: 'password' });

    var folder;
    try {
      folder = DriveApp.getFolderById(FOLDER_ID);
    } catch (err) {
      return reply_({ ok: false, error: 'folder' });
    }
    if (req.action === 'ping') return reply_({ ok: true, folder: folder.getName(), id: folder.getId(), version: VERSION });

    var name = String(req.name || '');
    var ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
    var type = ext && TYPES[ext.toLowerCase()];
    if (!type || name.length > 120 || /[\\\/:*?"<>|\u0000-\u001f]/.test(name) || name.charAt(0) === '.') {
      return reply_({ ok: false, error: 'name' });
    }

    var bytes = Utilities.base64Decode(String(req.data || ''));
    if (!bytes.length) return reply_({ ok: false, error: 'empty' });
    if (bytes.length > MAX_BYTES) return reply_({ ok: false, error: 'size' });

    var dir = subfolder_(folder, PHOTO_DIR);
    // 先收下新的、再丟舊的：中間出錯的話，原本的圖還在
    var olds = [];
    var it = dir.getFilesByName(name);
    while (it.hasNext()) olds.push(it.next());
    var file = dir.createFile(Utilities.newBlob(bytes, type, name));
    for (var i = 0; i < olds.length; i++) olds[i].setTrashed(true);

    return reply_({ ok: true, name: name, id: file.getId(), replaced: olds.length, path: PHOTO_DIR + '/' + name, version: VERSION });
  } catch (err) {
    return reply_({ ok: false, error: 'other', message: String(err && err.message || err) });
  }
}

/** parent 裡叫這個名字的子資料夾，沒有就建一個 */
function subfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function isPlaceholder_(v) {
  return !v || v.indexOf('__') === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
