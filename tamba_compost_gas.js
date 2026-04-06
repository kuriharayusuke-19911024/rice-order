// ============================================================
// 丹波農商 堆肥発注フォーム ― Google Apps Script (GAS)
// ============================================================
// 【セットアップ手順】
// 1. Google スプレッドシートを新規作成
// 2. メニュー「拡張機能」→「Apps Script」を開く
// 3. このコードを貼り付けて保存
// 4. ADMIN_EMAIL を変更
// 5.「デプロイ」→「新しいデプロイ」→ ウェブアプリ / 自分 / 全員
// 6. デプロイURLを tamba_compost_order.html の GAS_URL に設定
// ※ 更新時は「デプロイを管理」→「新しいバージョン」で再デプロイ
// ============================================================

const ADMIN_EMAIL         = 'tamba.nosho@gmail.com';
const ADMIN_PASSWORD      = '1108';
const OVERSTOCK_THRESHOLD = 100;   // トン（この値を超えると在庫過剰アラート）
const SHEET_ORDERS        = '発注一覧';
const SHEET_STOCK         = '在庫管理';
const SHEET_HISTORY       = '在庫履歴';
const SHEET_SPREAD        = '散布計画';

// ══════════════════════════════════════
// POST
// ══════════════════════════════════════
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'order';

    // ── 発注 ──
    if (action === 'order') {
      saveToSheet(data);
      // 発注数量を在庫から自動減算
      var fields = data.fields || [];
      var totalQty = 0;
      for (var i = 0; i < fields.length; i++) totalQty += parseFloat(fields[i].qty || fields[i].quantity) || 0;
      if (totalQty > 0) {
        updateStockData('sub', totalQty, '発注自動出庫', data.name + '様 発注');
      }
      sendAdminEmail(data);
      sendCustomerEmail(data);
      return jsonOk({ result: 'ok' });
    }

    // ── ログイン ──
    if (action === 'adminLogin') {
      return jsonOk({ result: data.password === ADMIN_PASSWORD ? 'ok' : 'error', message: 'パスワードが違います' });
    }

    // ── 在庫更新（手動） ──
    if (action === 'updateStock') {
      if (data.password !== ADMIN_PASSWORD) return jsonOk({ result: 'error', message: '認証エラー' });
      var newStock = updateStockData(data.type, data.quantity, data.reason, data.memo);
      return jsonOk({ result: 'ok', stock: newStock });
    }

    // ── 散布計画 登録 ──
    if (action === 'saveSpreading') {
      if (data.password !== ADMIN_PASSWORD) return jsonOk({ result: 'error', message: '認証エラー' });
      var sheet = getSpreadSheet();
      sheet.appendRow([
        new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        data.dateFrom || '', data.dateTo || '',
        parseFloat(data.quantity) || 0,
        data.location || '', data.staff || '', data.memo || '',
        data.status || '予定'
      ]);
      return jsonOk({ result: 'ok' });
    }

    // ── 散布計画 状態変更 ──
    if (action === 'updateSpreadStatus') {
      if (data.password !== ADMIN_PASSWORD) return jsonOk({ result: 'error', message: '認証エラー' });
      var sheet = getSpreadSheet();
      var allRows = sheet.getDataRange().getValues();
      var rowIdx = parseInt(data.rowIndex) + 2; // header + 1-based
      if (rowIdx >= 2 && rowIdx <= allRows.length) {
        var oldStatus = sheet.getRange(rowIdx, 8).getValue();
        sheet.getRange(rowIdx, 8).setValue(data.newStatus);
        // 完了に変更 → 在庫から差し引き
        if (data.newStatus === '完了' && oldStatus !== '完了') {
          var qty = parseFloat(sheet.getRange(rowIdx, 4).getValue()) || 0;
          if (qty > 0) updateStockData('sub', qty, '散布計画実行', sheet.getRange(rowIdx, 5).getValue() || '');
        }
      }
      return jsonOk({ result: 'ok' });
    }

    // ── 散布計画 削除 ──
    if (action === 'deleteSpreading') {
      if (data.password !== ADMIN_PASSWORD) return jsonOk({ result: 'error', message: '認証エラー' });
      var sheet = getSpreadSheet();
      var rowIdx = parseInt(data.rowIndex) + 2;
      if (rowIdx >= 2 && rowIdx <= sheet.getLastRow()) sheet.deleteRow(rowIdx);
      return jsonOk({ result: 'ok' });
    }

    // ── 発注一括削除 ──
    if (action === 'bulkDeleteOrders') {
      if (data.password !== ADMIN_PASSWORD) return jsonOk({ result: 'error', message: '認証エラー' });
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
      var rows = data.rowIndices || [];
      rows.sort(function(a,b){ return b - a; }); // 下の行から削除
      for (var i = 0; i < rows.length; i++) {
        var rowNum = parseInt(rows[i]);
        if (rowNum >= 2 && rowNum <= sheet.getLastRow()) sheet.deleteRow(rowNum);
      }
      return jsonOk({ result: 'ok' });
    }

    return jsonOk({ result: 'error', message: '不明なアクション' });
  } catch (err) {
    return jsonOk({ result: 'error', message: err.toString() });
  }
}

// ══════════════════════════════════════
// GET（管理データ取得）
// ══════════════════════════════════════
function doGet(e) {
  var action = (e.parameter || {}).action || '';
  var pw     = (e.parameter || {}).pw || '';

  if (action === 'getStock') {
    if (pw !== ADMIN_PASSWORD) return jsonOk({ result: 'error' });
    var stock = getCurrentStock();
    return jsonOk({ result: 'ok', stock: stock, overstock: stock > OVERSTOCK_THRESHOLD, threshold: OVERSTOCK_THRESHOLD });
  }
  if (action === 'getOrders') {
    if (pw !== ADMIN_PASSWORD) return jsonOk({ result: 'error' });
    return jsonOk(getOrdersData());
  }
  if (action === 'getStockHistory') {
    if (pw !== ADMIN_PASSWORD) return jsonOk({ result: 'error' });
    return jsonOk(getStockHistoryData());
  }
  if (action === 'getSpreading') {
    if (pw !== ADMIN_PASSWORD) return jsonOk({ result: 'error' });
    return jsonOk(getSpreadingData());
  }
  if (action === 'getStockForecast') {
    if (pw !== ADMIN_PASSWORD) return jsonOk({ result: 'error' });
    var current = getCurrentStock();
    var spSheet = getSpreadSheet();
    var spData = spSheet.getDataRange().getValues();
    var planned = 0;
    for (var i = 1; i < spData.length; i++) {
      if (spData[i][7] === '予定') planned += parseFloat(spData[i][3]) || 0;
    }
    return jsonOk({ result: 'ok', current: current, plannedOut: planned, forecast: current - planned, overstock: current > OVERSTOCK_THRESHOLD, threshold: OVERSTOCK_THRESHOLD });
  }
  return jsonOk({ status: 'ready' });
}

function jsonOk(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════
// 発注 → スプレッドシート
// ══════════════════════════════════════
function saveToSheet(d) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ORDERS);
    sheet.appendRow([
      '受付日時','氏名','電話番号','メール','圃場番号','圃場数','堆肥の種類','数量(トン)','散布面積(a)',
      '用途','野菜の種類','前作情報','有機JAS','珪カル資材','作業形態',
      '散布希望(開始)','散布希望(終了)','ピン情報','住所備考','合計数量','その他備考'
    ]);
    sheet.getRange(1,1,1,21).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var fields = d.fields || [];
  var pinText = '';
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].lat) {
      pinText += (fields[i].name||'圃場'+(i+1))+': '+(fields[i].address||fields[i].addr||'')+' ('+fields[i].lat+','+fields[i].lng+')';
      if (i < fields.length-1) pinText += ' ／ ';
    }
  }
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var qty = f.qty || f.quantity || '';
    sheet.appendRow([
      d.submittedAt || new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),
      d.name, d.phone||'', d.email, f.num||f.fieldNum||(i+1), fields.length,
      d.compostType||'牛ふん堆肥', qty, f.area||'',
      d.usage||'', d.vegType||'', d.prevCrop||'',
      d.organicJAS||'なし', d.keical||'なし', f.service||'',
      d.dateFrom, d.dateTo, pinText, f.address||f.addr||'', d.totalQty||d.totalQuantity||'', d.remarks||''
    ]);
  }
}

// ══════════════════════════════════════
// 在庫管理
// ══════════════════════════════════════
function getStockSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STOCK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_STOCK);
    sheet.getRange('A1').setValue('現在庫(トン)').setFontWeight('bold');
    sheet.getRange('B1').setValue(0);
  }
  return sheet;
}
function getCurrentStock() { return parseFloat(getStockSheet().getRange('B1').getValue()) || 0; }
function setCurrentStock(v) { getStockSheet().getRange('B1').setValue(v); }

function getHistorySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_HISTORY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_HISTORY);
    sheet.appendRow(['日時','種別','数量(トン)','理由','メモ','残高(トン)']);
    sheet.getRange(1,1,1,6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSpreadSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SPREAD);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SPREAD);
    sheet.appendRow(['登録日時','散布予定日(開始)','散布予定日(終了)','予定数量(トン)','圃場/場所','担当者','メモ','状態']);
    sheet.getRange(1,1,1,8).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function updateStockData(type, quantity, reason, memo) {
  var current = getCurrentStock();
  var qty = parseFloat(quantity) || 0;
  current = type === 'add' ? current + qty : current - qty;
  setCurrentStock(current);

  getHistorySheet().appendRow([
    new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),
    type === 'add' ? '入庫' : '出庫', qty, reason||'', memo||'', current
  ]);

  // 在庫過剰アラートメール（1回/日制限）
  if (current > OVERSTOCK_THRESHOLD) {
    var props = PropertiesService.getScriptProperties();
    var lastAlert = props.getProperty('lastOverstockAlert') || '';
    var todayKey = new Date().toISOString().split('T')[0];
    if (lastAlert !== todayKey) {
      try {
        GmailApp.sendEmail(ADMIN_EMAIL,
          '【在庫過剰アラート】堆肥在庫が ' + current.toFixed(1) + ' トンに達しました',
          '丹波農商 在庫管理システムからの自動通知です。\n\n'
          + '現在庫: ' + current.toFixed(1) + ' トン\n'
          + 'しきい値: ' + OVERSTOCK_THRESHOLD + ' トン\n\n'
          + '在庫の調整（出庫・販売など）をご検討ください。'
        );
        props.setProperty('lastOverstockAlert', todayKey);
      } catch(emailErr) {}
    }
  }
  return current;
}

// ── データ取得 ──
function getOrdersData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return { result: 'ok', headers: [], orders: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { result: 'ok', headers: data[0]||[], orders: [] };
  return { result: 'ok', headers: data[0], orders: data.slice(1).reverse() };
}

function getStockHistoryData() {
  var sheet = getHistorySheet();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { result: 'ok', history: [] };
  return { result: 'ok', history: data.slice(1).reverse() };
}

function getSpreadingData() {
  var sheet = getSpreadSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { result: 'ok', plans: [] };
  return { result: 'ok', plans: data.slice(1) };
}

// ══════════════════════════════════════
// メール
// ══════════════════════════════════════
function sendAdminEmail(d) {
  var fields = d.fields || [];
  var totalQty = d.totalQty || d.totalQuantity || '';
  var subject = '【堆肥発注】'+d.name+'様より（合計'+totalQty+'トン・'+fields.length+'圃場）';
  var body = ['【堆肥発注通知】丹波農商','','■ 受付日時：'+(d.submittedAt||''),'',
    '▼ 発注者情報','氏名：'+d.name,'電話：'+(d.phone||'未記入'),'メール：'+d.email,'',
    '▼ 発注概要','堆肥の種類：'+(d.compostType||'牛ふん堆肥'),'合計数量：'+totalQty+' トン','圃場数：'+fields.length,''];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var qty = f.qty || f.quantity || '';
    var name = f.name || ('圃場'+(i+1));
    body.push('────────────────','【'+name+'】','数量：'+qty+' トン');
    if (f.area) body.push('散布面積：'+f.area+' a');
    body.push('作業形態：'+(f.service||''));
    if (f.address || f.addr) body.push('住所：'+(f.address||f.addr));
    if (f.lat) body.push('地図：https://maps.google.com/?q='+f.lat+','+f.lng);
    body.push('');
  }
  body.push('────────────────');
  body.push('','▼ 用途・作物');
  body.push('用途：'+(d.usage||'未記入'));
  if (d.vegType) body.push('野菜の種類：'+d.vegType);
  if (d.prevCrop) body.push('前作情報：'+d.prevCrop);
  body.push('','▼ 品質オプション');
  body.push('有機JAS対応：'+(d.organicJAS||'なし'));
  body.push('珪カル資材：'+(d.keical||'なし'));
  body.push('','▼ 散布希望期間',d.dateFrom+' 〜 '+d.dateTo);
  body.push('','▼ ご相談オプション');
  body.push('土壌医への相談：'+(d.consultSoilDoctor||'なし'));
  body.push('相談の上で数量決定：'+(d.consultQty||'なし'));
  body.push('','▼ その他備考',d.remarks||'なし');
  GmailApp.sendEmail(ADMIN_EMAIL, subject, body.join('\n'));
}

function sendCustomerEmail(d) {
  if (!d.email) return;
  var fields = d.fields || [];
  var totalQty = d.totalQty || d.totalQuantity || '';
  var subject = '【丹波農商】堆肥のご発注を受け付けました';
  var body = [d.name+' 様','','この度は丹波農商の堆肥をご発注いただき、誠にありがとうございます。','以下の内容でご注文を受け付けました。','',
    '━━━━━━━━━━━━━━━━━━━━━━','','■ ご注文概要','堆肥の種類：'+(d.compostType||'牛ふん堆肥'),'合計数量：'+totalQty+' トン','圃場数：'+fields.length,''];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var qty = f.qty || f.quantity || '';
    var name = f.name || ('圃場'+(i+1));
    body.push('── '+name+' ──','数量：'+qty+' トン','作業形態：'+(f.service||''));
    if (f.address || f.addr) body.push('住所：'+(f.address||f.addr));
    if (f.lat) body.push('地図：https://maps.google.com/?q='+f.lat+','+f.lng);
    body.push('');
  }
  body.push('■ 用途：'+(d.usage||'未記入'));
  if (d.organicJAS==='希望') body.push('■ 有機JAS対応：希望');
  if (d.keical==='希望') body.push('■ 珪カル資材：希望');
  body.push('','■ 散布希望期間',d.dateFrom+' 〜 '+d.dateTo,'','━━━━━━━━━━━━━━━━━━━━━━','',
    '担当者より改めてご連絡いたします。','通常1〜2営業日以内にお返事いたしますので、','少々お待ちくださいませ。','',
    'ご不明な点がございましたら、お気軽にお問い合わせください。','',
    '─────────────────────','丹波農商','メール：'+ADMIN_EMAIL,'─────────────────────');
  GmailApp.sendEmail(d.email, subject, body.join('\n'));
}
