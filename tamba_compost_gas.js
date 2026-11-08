// ============================================================
// 丹波農商 堆肥 発注・散布実績・請求 ― Google Apps Script (GAS)
// ============================================================
// このコードは「堆肥発注管理」スプレッドシートの
// 「拡張機能」→「Apps Script」に貼り付けて使います。
//
// 【更新手順】（PRの説明にも同じ手順あり）
// 1. スプレッドシート「堆肥発注管理」→ 拡張機能 → Apps Script を開く
// 2. 今のコードを全部消して、このファイルの中身を貼り付けて保存
// 3. 左の歯車「プロジェクトの設定」→ 一番下「スクリプト プロパティ」→
//    プロパティ ADMIN_PASSWORD に管理画面のパスワードを入れて保存
//    （パスワードはコードに書きません。新しいものに変えるのがおすすめ）
// 4.「デプロイ」→「デプロイを管理」→ 鉛筆（編集）→ バージョン「新バージョン」→ デプロイ
//    ※ URL を変えないため「新しいデプロイ」ではなく「デプロイを管理」から更新する
//
// 【シート】
//  発注一覧   … お客さんの発注（1行=1圃場）。列の並びは今までと同じ
//  発注状態   … 発注ごとの状態（未確認/確認済/散布済/キャンセル）
//  散布実績   … 散布・出荷した記録（売上はここで計上。月末請求の元）
//  請求書     … 発行した請求書（下書き→栗原OK→送付済）
//  在庫管理 / 在庫履歴 … 拠点ごとの在庫。散布実績の登録で自動出庫
//  管理設定   … 単価・割引・顧客メモなど（管理画面の設定を全端末で共有）
// ============================================================

const ADMIN_EMAIL    = 'tamba.nosho@gmail.com';
const SHEET_ORDERS   = '発注一覧';
const SHEET_STATUS   = '発注状態';
const SHEET_RECORDS  = '散布実績';
const SHEET_INVOICES = '請求書';
const SHEET_STOCK    = '在庫管理';
const SHEET_HISTORY  = '在庫履歴';
const SHEET_SPREAD   = '散布計画';
const SHEET_SETTINGS = '管理設定';
const DEFAULT_LOCATIONS = ['前山', '夜久野', '朝来'];

const RECORD_HEADERS  = ['ID','散布日','取引先','散布先','数量(t)','作業形態','単価(円/t・税込)','金額(税込)','出荷拠点','担当','発注キー','メモ','請求書番号','在庫から引いた','登録日時'];
const INVOICE_HEADERS = ['請求書番号','発行日','取引先','対象期間','合計(税込)','状態','散布実績ID','明細JSON','支払期限','メモ','登録日時','更新日時'];
const STATUS_HEADERS  = ['発注キー','状態','出荷拠点','更新日時','メモ'];

// ══════════════════════════════════════
// 共通
// ══════════════════════════════════════
function getPassword_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || '';
}
function isAdmin_(pw) {
  var real = getPassword_();
  return !!real && String(pw || '') === real;
}
function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name, headers) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    if (headers) {
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}
function output_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z0-9_.$]+$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function rowsAsObjects_(sh, headers) {
  var values = sh.getDataRange().getDisplayValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) o[headers[j]] = values[i][j] === undefined ? '' : values[i][j];
    out.push(o);
  }
  return out;
}
function findRow_(sh, col, value) {
  var values = sh.getRange(1, col, sh.getLastRow(), 1).getDisplayValues();
  for (var i = 1; i < values.length; i++) if (String(values[i][0]) === String(value)) return i + 1;
  return -1;
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ══════════════════════════════════════
// GET（管理画面の読み込み。JSONP 対応）
// ══════════════════════════════════════
function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = p.callback || '';
  try {
    if (p.action === 'login') {
      if (!getPassword_()) return output_({ result: 'error', message: 'スクリプトプロパティ ADMIN_PASSWORD が未設定です' }, cb);
      return output_({ result: isAdmin_(p.pw) ? 'ok' : 'error', message: 'パスワードが違います' }, cb);
    }
    if (!isAdmin_(p.pw)) return output_({ result: 'error', message: '認証エラー' }, cb);

    if (p.action === 'getAll') return output_(getAll_(), cb);
    // 旧管理画面との互換
    if (p.action === 'getOrders') return output_(getOrdersRaw_(), cb);
    if (p.action === 'getStock') return output_({ result: 'ok', stock: getStockMap_() }, cb);
    return output_({ result: 'ok', status: 'ready' }, cb);
  } catch (err) {
    return output_({ result: 'error', message: String(err) }, cb);
  }
}

function getOrdersRaw_() {
  var sh = ss_().getSheetByName(SHEET_ORDERS);
  if (!sh) return { result: 'ok', rows: [] };
  var values = sh.getDataRange().getDisplayValues();
  return { result: 'ok', rows: values.slice(1) };
}

function getAll_() {
  var stockSheet = getStockSheet_();
  var hist = sheet_(SHEET_HISTORY, ['日時','種別','数量(トン)','拠点・理由','メモ','残高(トン)']);
  var histValues = hist.getDataRange().getDisplayValues().slice(1).reverse().slice(0, 100);
  return {
    result: 'ok',
    serverTime: now_(),
    orders: getOrdersRaw_().rows,
    statuses: rowsAsObjects_(sheet_(SHEET_STATUS, STATUS_HEADERS), STATUS_HEADERS),
    records: rowsAsObjects_(sheet_(SHEET_RECORDS, RECORD_HEADERS), RECORD_HEADERS),
    invoices: rowsAsObjects_(sheet_(SHEET_INVOICES, INVOICE_HEADERS), INVOICE_HEADERS),
    stock: getStockMap_(),
    stockHistory: histValues,
    settings: getSettings_()
  };
}

// ══════════════════════════════════════
// POST（お客さんの発注・管理画面からの書き込み）
// ══════════════════════════════════════
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'order';

    // ── お客さんの発注（パスワード不要） ──
    if (action === 'order') {
      withLock_(function () { saveOrder_(data); });
      // 在庫は「散布実績」を登録した時だけ減らす（発注時点では減らさない）
      if (data.source !== '代行') {
        try { sendAdminEmail_(data); } catch (mailErr) {}
      }
      if (data.notifyCustomer !== false) {
        try { sendCustomerEmail_(data); } catch (mailErr2) {}
      }
      return output_({ result: 'ok' });
    }

    if (!isAdmin_(data.password)) return output_({ result: 'error', message: '認証エラー' });

    var res = withLock_(function () {
      switch (action) {
        case 'setOrderStatus':  return setOrderStatus_(data);
        case 'addRecord':       return addRecord_(data);
        case 'updateRecord':    return updateRecord_(data);
        case 'deleteRecord':    return deleteRecord_(data);
        case 'createInvoice':   return createInvoice_(data);
        case 'setInvoiceStatus':return setInvoiceStatus_(data);
        case 'deleteInvoice':   return deleteInvoice_(data);
        case 'stockMove':       return stockMove_(data);
        case 'saveSettings':    return saveSettings_(data);
      }
      return { result: 'error', message: '不明なアクション: ' + action };
    });
    return output_(res);
  } catch (err) {
    return output_({ result: 'error', message: String(err) });
  }
}

// ══════════════════════════════════════
// 発注 → 発注一覧（列の並びは従来どおり）
// A受付日時 B氏名 C電話 Dメール E圃場No F圃場数 G堆肥種類 H数量(t) I面積(a)
// J用途 K野菜 L前作 M有機JAS N珪カル O作業形態 P開始 Q終了 Rピン情報 S住所
// T合計数量 U備考 V LINE名 W受付経路
// ══════════════════════════════════════
function saveOrder_(d) {
  var sheet = ss_().getSheetByName(SHEET_ORDERS);
  if (!sheet) {
    sheet = ss_().insertSheet(SHEET_ORDERS);
    sheet.appendRow(['受付日時','氏名','電話番号','メール','圃場番号','圃場数','堆肥の種類','数量(トン)','散布面積(a)',
      '用途','野菜の種類','前作情報','有機JAS','珪カル資材','作業形態',
      '散布希望(開始)','散布希望(終了)','ピン情報','住所','合計数量','その他備考','LINE名','受付経路']);
    sheet.getRange(1, 1, 1, 23).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var fields = d.fields || [];
  var pins = [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].lat) pins.push((fields[i].name || '圃場' + (i + 1)) + ': ' + (fields[i].address || fields[i].addr || '') + ' (' + fields[i].lat + ',' + fields[i].lng + ')');
  }
  var pinText = pins.join(' ／ ');
  var submittedAt = d.submittedAt || now_();
  for (var k = 0; k < fields.length; k++) {
    var f = fields[k];
    sheet.appendRow([
      submittedAt, d.name, d.phone || '', d.email || '', f.num || (k + 1), fields.length,
      d.compostType || '牛ふん堆肥', f.qty || f.quantity || '', f.area || '',
      d.usage || '', d.vegType || '', d.prevCrop || '',
      d.organicJAS || 'なし', d.keical || 'なし', f.service || '',
      d.dateFrom || '', d.dateTo || '', pinText, f.address || f.addr || f.name || '',
      d.totalQty || d.totalQuantity || '', d.remarks || '', d.lineName || '', d.source || 'フォーム'
    ]);
  }
}

// ══════════════════════════════════════
// 発注状態
// ══════════════════════════════════════
function setOrderStatus_(d) {
  var sh = sheet_(SHEET_STATUS, STATUS_HEADERS);
  var row = findRow_(sh, 1, d.key);
  var values = [d.key, d.status || '未確認', d.shipBase || '', now_(), d.memo || ''];
  if (row > 0) sh.getRange(row, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  return { result: 'ok' };
}

// ══════════════════════════════════════
// 散布実績（売上はここで計上）
// ══════════════════════════════════════
function addRecord_(d) {
  var sh = sheet_(SHEET_RECORDS, RECORD_HEADERS);
  var items = d.records || [d];
  var ids = [];
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    var qty = parseFloat(r.qty) || 0;
    var price = parseFloat(r.price) || 0;
    var id = 'R' + new Date().getTime() + '-' + i;
    var deduct = r.deductStock !== false && qty > 0 && r.location;
    sh.appendRow([
      id, r.date || '', r.customer || '', r.place || '', qty, r.service || '',
      price, Math.floor(qty * price), r.location || '', r.staff || '', r.orderKey || '', r.memo || '',
      '', deduct ? 'はい' : 'いいえ', now_()
    ]);
    if (deduct) changeStock_(r.location, -qty, '散布実績', (r.customer || '') + ' ' + (r.date || '') + ' ' + id);
    ids.push(id);
  }
  if (d.orderKey && d.markOrderDone) setOrderStatus_({ key: d.orderKey, status: '散布済', shipBase: items[0] && items[0].location });
  return { result: 'ok', ids: ids };
}

function updateRecord_(d) {
  var sh = sheet_(SHEET_RECORDS, RECORD_HEADERS);
  var row = findRow_(sh, 1, d.id);
  if (row < 0) return { result: 'error', message: '実績が見つかりません' };
  var old = sh.getRange(row, 1, 1, RECORD_HEADERS.length).getValues()[0];
  if (old[12]) return { result: 'error', message: '請求書 ' + old[12] + ' に入っているので変更できません（先に請求書を削除してください）' };
  // 在庫を一度戻してから付け直す
  if (old[13] === 'はい') changeStock_(old[8], parseFloat(old[4]) || 0, '散布実績 修正（戻し）', old[0]);
  var qty = parseFloat(d.qty) || 0, price = parseFloat(d.price) || 0;
  var deduct = d.deductStock !== false && qty > 0 && d.location;
  sh.getRange(row, 1, 1, RECORD_HEADERS.length).setValues([[
    d.id, d.date || '', d.customer || '', d.place || '', qty, d.service || '', price, Math.floor(qty * price),
    d.location || '', d.staff || '', d.orderKey || old[10] || '', d.memo || '', '', deduct ? 'はい' : 'いいえ', old[14]
  ]]);
  if (deduct) changeStock_(d.location, -qty, '散布実績 修正', (d.customer || '') + ' ' + d.id);
  return { result: 'ok' };
}

function deleteRecord_(d) {
  var sh = sheet_(SHEET_RECORDS, RECORD_HEADERS);
  var row = findRow_(sh, 1, d.id);
  if (row < 0) return { result: 'error', message: '実績が見つかりません' };
  var old = sh.getRange(row, 1, 1, RECORD_HEADERS.length).getValues()[0];
  if (old[12]) return { result: 'error', message: '請求書 ' + old[12] + ' に入っているので削除できません' };
  if (old[13] === 'はい') changeStock_(old[8], parseFloat(old[4]) || 0, '散布実績 削除（戻し）', old[2] + ' ' + old[0]);
  sh.deleteRow(row);
  return { result: 'ok' };
}

// ══════════════════════════════════════
// 請求書（散布実績から作る。送る前に栗原さんのOK）
// ══════════════════════════════════════
function nextInvoiceNo_(issueDate) {
  var ym = String(issueDate || now_()).replace(/[^0-9]/g, '').slice(0, 6);
  var props = PropertiesService.getScriptProperties();
  var key = 'invoiceSeq_' + ym;
  var seq = parseInt(props.getProperty(key) || '0', 10) + 1;
  props.setProperty(key, String(seq));
  return ym + '-' + ('00' + seq).slice(-3);
}

function createInvoice_(d) {
  var rsh = sheet_(SHEET_RECORDS, RECORD_HEADERS);
  var ids = d.recordIds || [];
  // 二重請求防止：すでに請求書番号が入っている実績は不可
  var rows = [];
  for (var i = 0; i < ids.length; i++) {
    var row = findRow_(rsh, 1, ids[i]);
    if (row < 0) return { result: 'error', message: '実績 ' + ids[i] + ' が見つかりません' };
    var inv = rsh.getRange(row, 13).getValue();
    if (inv) return { result: 'error', message: '実績 ' + ids[i] + ' はすでに請求書 ' + inv + ' に入っています' };
    rows.push(row);
  }
  var no = nextInvoiceNo_(d.issueDate);
  for (var j = 0; j < rows.length; j++) rsh.getRange(rows[j], 13).setValue(no);
  var ish = sheet_(SHEET_INVOICES, INVOICE_HEADERS);
  ish.appendRow([no, d.issueDate || '', d.customer || '', d.period || '', parseFloat(d.total) || 0, '下書き',
    ids.join(','), JSON.stringify(d.lines || []), d.dueDate || '', d.memo || '', now_(), now_()]);
  return { result: 'ok', number: no };
}

function setInvoiceStatus_(d) {
  var sh = sheet_(SHEET_INVOICES, INVOICE_HEADERS);
  var row = findRow_(sh, 1, d.number);
  if (row < 0) return { result: 'error', message: '請求書が見つかりません' };
  var cur = sh.getRange(row, 6).getValue();
  var order = ['下書き', '栗原OK', '送付済', '入金済'];
  if (d.status === '送付済' && order.indexOf(cur) < 1) {
    return { result: 'error', message: '栗原さんのOK前の請求書は「送付済」にできません' };
  }
  sh.getRange(row, 6).setValue(d.status);
  sh.getRange(row, 12).setValue(now_());
  return { result: 'ok' };
}

function deleteInvoice_(d) {
  var sh = sheet_(SHEET_INVOICES, INVOICE_HEADERS);
  var row = findRow_(sh, 1, d.number);
  if (row < 0) return { result: 'error', message: '請求書が見つかりません' };
  var status = sh.getRange(row, 6).getValue();
  if (status === '送付済' || status === '入金済') return { result: 'error', message: '送付済の請求書は削除できません' };
  // 実績の請求書番号を外す
  var rsh = sheet_(SHEET_RECORDS, RECORD_HEADERS);
  var vals = rsh.getDataRange().getDisplayValues();
  for (var i = 1; i < vals.length; i++) if (vals[i][12] === String(d.number)) rsh.getRange(i + 1, 13).setValue('');
  sh.deleteRow(row);
  return { result: 'ok' };
}

// ══════════════════════════════════════
// 在庫
// ══════════════════════════════════════
function getStockSheet_() {
  var sh = sheet_(SHEET_STOCK, ['拠点', '在庫(トン)']);
  if (sh.getLastRow() < 2) {
    for (var i = 0; i < DEFAULT_LOCATIONS.length; i++) sh.appendRow([DEFAULT_LOCATIONS[i], 0]);
  }
  return sh;
}
function getStockMap_() {
  var vals = getStockSheet_().getDataRange().getValues();
  var map = {};
  for (var i = 1; i < vals.length; i++) {
    var name = String(vals[i][0] || '');
    // 旧形式の「項目」「現在庫」行は拠点ではないので除外
    if (!name || name === '項目' || name === '現在庫' || name === '現在庫(トン)') continue;
    map[name] = parseFloat(vals[i][1]) || 0;
  }
  for (var j = 0; j < DEFAULT_LOCATIONS.length; j++) if (!(DEFAULT_LOCATIONS[j] in map)) map[DEFAULT_LOCATIONS[j]] = 0;
  return map;
}
function setStock_(loc, value) {
  var sh = getStockSheet_();
  var row = findRow_(sh, 1, loc);
  if (row > 0) sh.getRange(row, 2).setValue(value);
  else sh.appendRow([loc, value]);
}
function stockSummary_() {
  var m = getStockMap_();
  return Object.keys(m).map(function (k) { return k + ':' + m[k].toFixed(1); }).join(' / ');
}
function changeStock_(loc, delta, reason, memo) {
  if (!loc) return;
  var cur = getStockMap_()[loc] || 0;
  setStock_(loc, Math.round((cur + delta) * 100) / 100);
  sheet_(SHEET_HISTORY, ['日時','種別','数量(トン)','拠点・理由','メモ','残高(トン)'])
    .appendRow([now_(), delta >= 0 ? '入庫' : '出庫', Math.abs(delta), loc + '：' + (reason || ''), memo || '', stockSummary_()]);
}
// 入庫（製造完成など）/ 出庫 / 棚卸しで直接修正 / 拠点間の移動
function stockMove_(d) {
  var qty = parseFloat(d.quantity) || 0;
  if (d.type === 'add') changeStock_(d.location, qty, d.reason || '入庫', d.memo);
  else if (d.type === 'sub') changeStock_(d.location, -qty, d.reason || '出庫', d.memo);
  else if (d.type === 'set') {
    var cur = getStockMap_()[d.location] || 0;
    changeStock_(d.location, (parseFloat(d.newStock) || 0) - cur, '棚卸し修正：' + (d.reason || ''), d.memo);
  } else if (d.type === 'transfer') {
    changeStock_(d.from, -qty, '移動 → ' + d.to, d.memo);
    changeStock_(d.to, qty, '移動 ← ' + d.from, d.memo);
  } else return { result: 'error', message: '種別が不明です' };
  return { result: 'ok', stock: getStockMap_() };
}

// ══════════════════════════════════════
// 管理設定（単価・割引・顧客メモ・製造予定など。JSON で保存）
// ══════════════════════════════════════
function getSettings_() {
  var sh = sheet_(SHEET_SETTINGS, ['キー', '値(JSON)', '更新日時']);
  var vals = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < vals.length; i++) {
    try { out[vals[i][0]] = JSON.parse(vals[i][1]); } catch (e) {}
  }
  return out;
}
function saveSettings_(d) {
  var sh = sheet_(SHEET_SETTINGS, ['キー', '値(JSON)', '更新日時']);
  var row = findRow_(sh, 1, d.key);
  var values = [d.key, JSON.stringify(d.value), now_()];
  if (row > 0) sh.getRange(row, 1, 1, 3).setValues([values]);
  else sh.appendRow(values);
  return { result: 'ok' };
}

// ══════════════════════════════════════
// メール
// ══════════════════════════════════════
function sendAdminEmail_(d) {
  var fields = d.fields || [];
  var totalQty = d.totalQty || d.totalQuantity || '';
  var subject = '【堆肥発注】' + d.name + '様より（合計' + totalQty + 'トン・' + fields.length + '圃場）';
  var body = ['【堆肥発注通知】丹波農商', '', '■ 受付日時：' + (d.submittedAt || ''), '',
    '▼ 発注者情報', '氏名：' + d.name, '電話：' + (d.phone || '未記入'), 'メール：' + (d.email || '未記入'),
    'LINE名：' + (d.lineName || '未記入'), '',
    '▼ 発注概要', '堆肥の種類：' + (d.compostType || '牛ふん堆肥'), '合計数量：' + totalQty + ' トン', '圃場数：' + fields.length, ''];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    body.push('────────────────', '【' + (f.name || '圃場' + (i + 1)) + '】', '数量：' + (f.qty || '') + ' トン');
    if (f.area) body.push('散布面積：' + f.area + ' a');
    body.push('作業形態：' + (f.service || ''));
    if (f.address || f.addr) body.push('住所：' + (f.address || f.addr));
    if (f.lat) body.push('地図：https://maps.google.com/?q=' + f.lat + ',' + f.lng);
    body.push('');
  }
  body.push('────────────────', '', '▼ 用途・作物', '用途：' + (d.usage || '未記入'));
  if (d.vegType) body.push('野菜の種類：' + d.vegType);
  if (d.prevCrop) body.push('前作情報：' + d.prevCrop);
  body.push('', '▼ 品質オプション', '有機JAS対応：' + (d.organicJAS || 'なし'), '珪カル資材：' + (d.keical || 'なし'));
  body.push('', '▼ 散布希望期間', (d.dateFrom || '') + ' 〜 ' + (d.dateTo || ''));
  body.push('', '▼ ご相談オプション', '土壌医への相談：' + (d.consultSoilDoctor || 'なし'), '相談の上で数量決定：' + (d.consultQty || 'なし'));
  body.push('', '▼ その他備考', d.remarks || 'なし');
  GmailApp.sendEmail(ADMIN_EMAIL, subject, body.join('\n'));
}

function sendCustomerEmail_(d) {
  if (!d.email) return;
  var fields = d.fields || [];
  var totalQty = d.totalQty || d.totalQuantity || '';
  var body = [d.name + ' 様', '', 'この度は丹波農商の堆肥をご発注いただき、誠にありがとうございます。', '以下の内容でご注文を受け付けました。', '',
    '━━━━━━━━━━━━━━━━━━━━━━', '', '■ ご注文概要', '堆肥の種類：' + (d.compostType || '牛ふん堆肥'), '合計数量：' + totalQty + ' トン', '圃場数：' + fields.length, ''];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    body.push('── ' + (f.name || '圃場' + (i + 1)) + ' ──', '数量：' + (f.qty || '') + ' トン', '作業形態：' + (f.service || ''));
    if (f.address || f.addr) body.push('住所：' + (f.address || f.addr));
    if (f.lat) body.push('地図：https://maps.google.com/?q=' + f.lat + ',' + f.lng);
    body.push('');
  }
  body.push('■ 用途：' + (d.usage || '未記入'));
  if (d.organicJAS === '希望') body.push('■ 有機JAS対応：希望');
  if (d.keical && d.keical !== 'なし') body.push('■ 珪カル資材：' + d.keical);
  body.push('', '■ 散布希望期間', (d.dateFrom || '') + ' 〜 ' + (d.dateTo || ''), '', '━━━━━━━━━━━━━━━━━━━━━━', '',
    '担当者より改めてご連絡いたします。', '通常1〜2営業日以内にお返事いたしますので、', '少々お待ちくださいませ。', '',
    'ご不明な点がございましたら、お気軽にお問い合わせください。', '',
    '─────────────────────', '丹波農商', 'メール：' + ADMIN_EMAIL, '─────────────────────');
  GmailApp.sendEmail(d.email, '【丹波農商】堆肥のご発注を受け付けました', body.join('\n'));
}
