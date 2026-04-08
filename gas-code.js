// ============================================
// kanwaru-app + 堆肥発注 共有バックエンド（Google Apps Script）
// ============================================

// ★ 権限承認用テスト関数（実行後に削除してOK）
function testMailPermission() {
  MailApp.sendEmail({
    to: 'tamba.nosho@gmail.com',
    subject: '【テスト】GASメール送信テスト',
    body: 'このメールはGASの権限テストです。正常に届いていれば成功です。'
  });
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

  // ===== 堆肥発注 =====
  if (action === 'order') {
    return jsonResponse(saveCompostOrder(body));
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
    if (!sheet || sheet.getLastRow() < 2) return { result: 'ok', orders: [] };

    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 15).getValues();
    var orders = rows.map(function(r) {
      return {
        submittedAt: r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : String(r[0]),
        id: String(r[1]),
        name: String(r[2]),
        phone: String(r[3]),
        email: String(r[4]),
        compostType: String(r[5]),
        totalQty: String(r[6]).replace('トン',''),
        fieldCount: r[7],
        fields: safeParseJSON(r[8], []),
        dateFrom: formatDateCell(r[9]),
        dateTo: formatDateCell(r[10]),
        pins: safeParseJSON(r[11], []),
        addressNote: String(r[12]),
        remarks: String(r[13]),
        status: String(r[14]) || '未確認'
      };
    });

    return { result: 'ok', orders: orders.reverse() };
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
