// ============================================
// kanwaru-app + 堆肥発注 共有バックエンド（Google Apps Script）
// ============================================

// ★ テストデータ削除用（実行後に削除してOK）
function deleteTestOrders() {
  var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
  var sheet = ss.getSheetByName(COMPOST_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  var testIds = ['1236aa0d','c00bb4fc','c8d3ce1e','25f1700c','a640cd0d','7cb46127'];
  for (var i = sheet.getLastRow(); i >= 2; i--) {
    var id = String(sheet.getRange(i, 2).getValue());
    if (testIds.indexOf(id) >= 0) sheet.deleteRow(i);
  }
}

const COMPOST_SS_ID = '1J8UWMAzxztYBCxayXRg3fAKrtaf6CfMInJJqQ2bFTQA';
const COMPOST_SHEET = '堆肥発注';
const NOTIFY_EMAIL = 'tamba.nosho@gmail.com';
const ADMIN_PW = '1108';

function doGet(e) {
  var action = (e.parameter.action || '').toString();

  // ===== 堆肥発注系 =====
  if (action === 'getOrders') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(getCompostOrders());
  }
  if (action === 'updateOrderStatus') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(updateCompostOrderStatus(
      (e.parameter.orderId || '').toString(),
      (e.parameter.status || '確認済').toString()
    ));
  }

  // ===== 在庫管理 =====
  if (action === 'getStock') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(getStockData());
  }
  if (action === 'getStockHistory') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(getStockHistory());
  }
  if (action === 'getStockForecast') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(getStockForecast());
  }

  // ===== 散布計画 =====
  if (action === 'getSpreading') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(getSpreadingData());
  }

  // ★ テストデータ削除用（一時的）
  if (action === 'deleteTestOrders') {
    var pw = (e.parameter.pw || '').toString();
    if (pw !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    deleteTestOrders();
    return jsonResponse({ result: 'ok', message: 'テストデータを削除しました' });
  }

  // ===== kanwaru-app 既存機能 =====
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === 'getSchedule') return jsonResponse(getSheetData(ss, 'schedule'));
  if (action === 'getClock')    return jsonResponse(getSheetData(ss, 'clock'));
  if (action === 'getWork')     return jsonResponse(getSheetData(ss, 'work'));
  if (action === 'getJournal')  return jsonResponse(getSheetData(ss, 'journal'));

  return jsonResponse({ result: 'ok', message: 'backend ready' });
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action;

  // ===== 管理者ログイン =====
  if (action === 'adminLogin') {
    if (body.password === ADMIN_PW) {
      return jsonResponse({ result: 'ok', message: 'ログイン成功' });
    } else {
      return jsonResponse({ result: 'error', message: 'パスワードが正しくありません' });
    }
  }

  // ===== 堆肥発注 =====
  if (action === 'order') {
    return jsonResponse(saveCompostOrder(body));
  }

  // ===== 在庫管理 =====
  if (action === 'updateStock') {
    if (body.password !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(updateStock(body));
  }

  // ===== 散布計画 =====
  if (action === 'saveSpreading') {
    if (body.password !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(saveSpreading(body));
  }
  if (action === 'updateSpreadStatus') {
    if (body.password !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(updateSpreadStatus(body));
  }
  if (action === 'deleteSpreading') {
    if (body.password !== ADMIN_PW) return jsonResponse({ result: 'error', message: '認証エラー' });
    return jsonResponse(deleteSpreading(body));
  }

  // ===== kanwaru-app 既存機能 =====
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'saveSchedule')   return jsonResponse(saveRow(ss, 'schedule', body.data, ['id','title','date','startTime','endTime','category','member','memo','createdBy','updatedAt']));
  if (action === 'deleteSchedule') return jsonResponse(deleteRow(ss, 'schedule', body.id));
  if (action === 'saveClock')      return jsonResponse(upsertRow(ss, 'clock', body.data, ['date','member','clockIn','clockOut','updatedAt'], function(row) { return row[0] === body.data.date && row[1] === body.data.member; }));
  if (action === 'saveWork')       return jsonResponse(upsertByKey(ss, 'work', body.data, ['date','member','blocks','updatedAt'], function(row) { return row[0] === body.data.date && row[1] === body.data.member; }));
  if (action === 'saveJournal')    return jsonResponse(saveRow(ss, 'journal', body.data, ['id','name','tag','content','likes','comments','readBy','createdAt']));
  if (action === 'updateJournal')  return jsonResponse(updateRow(ss, 'journal', body.id, body.data));
  if (action === 'deleteJournal')  return jsonResponse(deleteRow(ss, 'journal', body.id));

  return jsonResponse({ result: 'error', message: 'Unknown action: ' + action });
}

// ─── 堆肥発注機能 ───

function saveCompostOrder(data) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName(COMPOST_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(COMPOST_SHEET);
      sheet.appendRow([
        '受付日時','注文ID','氏名','電話番号','メール',
        '堆肥種類','合計数量(t)','圃場数','圃場詳細JSON',
        '散布開始日','散布終了日','地図ピンJSON',
        '住所メモ','備考','ステータス'
      ]);
      sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
    }

    var orderId = Utilities.getUuid().slice(0, 8);
    var submittedAt = data.submittedAt || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    sheet.appendRow([
      submittedAt, orderId,
      data.name || '', data.phone || '', data.email || '',
      data.compostType || '牛ふん堆肥',
      data.totalQuantity || '', data.fieldCount || '',
      JSON.stringify(data.fields || []),
      data.dateFrom || '', data.dateTo || '',
      JSON.stringify(data.pins || []),
      data.addressNote || '', data.remarks || '', '未確認'
    ]);

    try { sendCompostNotification(data, orderId, submittedAt); } catch(mailErr) { /* メール送信失敗しても発注は保存済み */ }

    return { result: 'ok', orderId: orderId, message: '発注を受け付けました' };
  } catch (err) {
    return { result: 'error', message: err.toString() };
  }
}

function getCompostOrders() {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName(COMPOST_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return { result: 'ok', headers: [], orders: [] };

    var headers = sheet.getRange(1, 1, 1, 15).getValues()[0].map(String);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 15).getValues();
    var orders = rows.map(function(r) {
      return r.map(function(cell, i) {
        if (cell instanceof Date) return Utilities.formatDate(cell, 'Asia/Tokyo', i === 0 ? 'yyyy/MM/dd HH:mm' : 'yyyy-MM-dd');
        return String(cell);
      });
    });

    return { result: 'ok', headers: headers, orders: orders.reverse() };
  } catch (err) {
    return { result: 'error', message: err.toString() };
  }
}

function updateCompostOrderStatus(orderId, status) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName(COMPOST_SHEET);
    if (!sheet) return { result: 'error', message: 'シートが見つかりません' };

    var rows = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === orderId) {
        sheet.getRange(i + 2, 15).setValue(status);
        return { result: 'ok', message: 'ステータスを更新しました' };
      }
    }
    return { result: 'error', message: '注文が見つかりません' };
  } catch (err) {
    return { result: 'error', message: err.toString() };
  }
}

function sendCompostNotification(data, orderId, submittedAt) {
  var fields = data.fields || [];
  var fieldDetail = '';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    fieldDetail += '  圃場' + (i+1) + ': ' + (f.quantity||f.qty||'') + 't / ' + (f.usage||'') + ' / ' + (f.service||'') + '\n';
    if (f.organicJAS === '希望') fieldDetail += '    → 有機JAS対応\n';
    if (f.keical === '希望') fieldDetail += '    → 珪カル資材追加\n';
  }

  var body = '【新規発注通知】丹波農商 堆肥発注システム\n\n'
    + '注文ID: ' + orderId + '\n'
    + '受付日時: ' + submittedAt + '\n\n'
    + '■ お客様情報\n'
    + '  氏名: ' + (data.name||'') + '\n'
    + '  電話: ' + (data.phone||'') + '\n'
    + '  メール: ' + (data.email||'') + '\n\n'
    + '■ 発注内容\n'
    + '  堆肥種類: ' + (data.compostType||'牛ふん堆肥') + '\n'
    + '  合計数量: ' + (data.totalQuantity||'') + '\n'
    + '  圃場数: ' + (data.fieldCount||'') + '\n'
    + fieldDetail + '\n'
    + '■ 散布希望期間\n'
    + '  ' + (data.dateFrom||'') + ' ～ ' + (data.dateTo||'') + '\n\n'
    + (data.addressNote ? '■ 住所メモ\n  ' + data.addressNote + '\n\n' : '')
    + (data.remarks ? '■ 備考\n  ' + data.remarks + '\n\n' : '')
    + '──────────────────\n管理者ページで確認してください。';

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '【堆肥発注】' + (data.name||'') + '様 ' + (data.totalQuantity||'') + ' - 丹波農商',
    body: body
  });
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch(e) { return fallback; }
}

function formatDateCell(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(val);
}

// ─── 在庫管理機能 ───

function getStockData() {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('在庫管理');
    if (!sheet) {
      sheet = ss.insertSheet('在庫管理');
      sheet.appendRow(['現在庫(t)']);
      sheet.getRange(2, 1).setValue(0);
    }
    var current = sheet.getRange(2, 1).getValue() || 0;
    return { result: 'ok', current: current };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function updateStock(body) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('在庫管理');
    if (!sheet) {
      sheet = ss.insertSheet('在庫管理');
      sheet.appendRow(['現在庫(t)']);
      sheet.getRange(2, 1).setValue(0);
    }
    var current = parseFloat(sheet.getRange(2, 1).getValue()) || 0;
    var qty = parseFloat(body.quantity) || 0;
    if (body.type === '入庫') current += qty;
    else current = Math.max(0, current - qty);
    sheet.getRange(2, 1).setValue(current);

    // 履歴シート
    var hist = ss.getSheetByName('在庫履歴');
    if (!hist) {
      hist = ss.insertSheet('在庫履歴');
      hist.appendRow(['日時', '種別', '数量', '理由', 'メモ', '残高']);
      hist.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    hist.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
      body.type, qty, body.reason || '', body.memo || '', current
    ]);

    return { result: 'ok', current: current };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function getStockHistory() {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('在庫履歴');
    if (!sheet || sheet.getLastRow() < 2) return { result: 'ok', history: [] };
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    var history = rows.map(function(r) {
      return [
        r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : String(r[0]),
        String(r[1]), r[2], String(r[3]), String(r[4]), r[5]
      ];
    });
    return { result: 'ok', history: history };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function getStockForecast() {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var stockSheet = ss.getSheetByName('在庫管理');
    var current = stockSheet ? (parseFloat(stockSheet.getRange(2, 1).getValue()) || 0) : 0;

    // 未確認発注の合計を計算
    var orderSheet = ss.getSheetByName(COMPOST_SHEET);
    var plannedOut = 0;
    if (orderSheet && orderSheet.getLastRow() >= 2) {
      var rows = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 15).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][14]) !== '確認済') {
          plannedOut += parseFloat(String(rows[i][6]).replace('トン','')) || 0;
        }
      }
    }
    return { result: 'ok', current: current, plannedOut: plannedOut, forecast: current - plannedOut };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

// ─── 散布計画機能 ───

function getSpreadingData() {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('散布計画');
    if (!sheet || sheet.getLastRow() < 2) return { result: 'ok', plans: [] };
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    var plans = rows.map(function(r) {
      return [
        r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy/MM/dd') : String(r[0]),
        r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Tokyo', 'yyyy-MM-dd') : String(r[1]),
        r[2] instanceof Date ? Utilities.formatDate(r[2], 'Asia/Tokyo', 'yyyy-MM-dd') : String(r[2]),
        r[3], String(r[4]), String(r[5]), String(r[6]), String(r[7])
      ];
    });
    return { result: 'ok', plans: plans };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function saveSpreading(body) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('散布計画');
    if (!sheet) {
      sheet = ss.insertSheet('散布計画');
      sheet.appendRow(['登録日', '開始日', '終了日', '数量', '圃場', '担当', 'メモ', '状態']);
      sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd'),
      body.dateFrom || '', body.dateTo || '',
      parseFloat(body.quantity) || 0,
      body.location || '', body.person || '', body.memo || '', '予定'
    ]);
    return { result: 'ok' };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function updateSpreadStatus(body) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('散布計画');
    if (!sheet) return { result: 'error', message: 'シートが見つかりません' };
    var rowIndex = parseInt(body.rowIndex);
    if (isNaN(rowIndex)) return { result: 'error', message: '無効な行番号' };
    sheet.getRange(rowIndex + 2, 8).setValue('完了');
    return { result: 'ok' };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

function deleteSpreading(body) {
  try {
    var ss = SpreadsheetApp.openById(COMPOST_SS_ID);
    var sheet = ss.getSheetByName('散布計画');
    if (!sheet) return { result: 'error', message: 'シートが見つかりません' };
    var rowIndex = parseInt(body.rowIndex);
    if (isNaN(rowIndex)) return { result: 'error', message: '無効な行番号' };
    sheet.deleteRow(rowIndex + 2);
    return { result: 'ok' };
  } catch (err) { return { result: 'error', message: err.toString() }; }
}

// ─── kanwaru-app 既存ヘルパー関数 ───

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function getSheetData(ss, sheetName) {
  var sheet = getOrCreateSheet(ss, sheetName);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { result: 'ok', data: [] };
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
        try { val = JSON.parse(val); } catch(e) {}
      }
      obj[headers[j]] = val;
    }
    rows.push(obj);
  }
  return { result: 'ok', data: rows };
}

function saveRow(ss, sheetName, data, headers) {
  var sheet = getOrCreateSheet(ss, sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  var row = headers.map(function(h) {
    var val = data[h];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return val;
  });
  sheet.appendRow(row);
  return { result: 'ok' };
}

function upsertRow(ss, sheetName, data, headers, matchFn) {
  var sheet = getOrCreateSheet(ss, sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  var allData = sheet.getDataRange().getValues();
  for (var i = 1; i < allData.length; i++) {
    if (matchFn(allData[i])) {
      var row = headers.map(function(h) {
        var val = data[h]; if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val); return val;
      });
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return { result: 'ok' };
    }
  }
  var newRow = headers.map(function(h) {
    var val = data[h]; if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val); return val;
  });
  sheet.appendRow(newRow);
  return { result: 'ok' };
}

function upsertByKey(ss, sheetName, data, headers, matchFn) {
  return upsertRow(ss, sheetName, data, headers, matchFn);
}

function deleteRow(ss, sheetName, id) {
  var sheet = getOrCreateSheet(ss, sheetName);
  var allData = sheet.getDataRange().getValues();
  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { result: 'ok' };
    }
  }
  return { result: 'error', message: 'Not found' };
}

function updateRow(ss, sheetName, id, updates) {
  var sheet = getOrCreateSheet(ss, sheetName);
  var allData = sheet.getDataRange().getValues();
  var headers = allData[0];
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(id)) {
      for (var key in updates) {
        var colIdx = headers.indexOf(key);
        if (colIdx >= 0) {
          var val = updates[key];
          if (typeof val === 'object') val = JSON.stringify(val);
          sheet.getRange(i + 1, colIdx + 1).setValue(val);
        }
      }
      return { result: 'ok' };
    }
  }
  return { result: 'error', message: 'Not found' };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
