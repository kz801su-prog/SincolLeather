// ==========================================
// Sincol Leather 2027 - Board Tracker Backend
// Google Apps Script (GAS)
// Version: 6.0 (Enhanced Merge & Recovery)
// ==========================================

// 1. 設定セクション
const TARGET_GID = 2043314835; // ターゲットとなるシートのGID
const DEFAULT_SHEET_NAME = '決定事項';

// デフォルトのWebhook URL
const DEFAULT_CLIQ_WEBHOOK_URL = 'https://cliq.zoho.com/company/719554203/api/v2/channelsbyname/tnzcd/message?zapikey=1001.c4e498597d7ecb17a361dc28ca531e5a.08ffaf17c758fce2840d1bae11abb486';

function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === String(gid)) {
      return sheets[i];
    }
  }
  return null;
}

/**
 * 毎週月曜日の朝8時に実行されるレポート機能
 */
function weeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = getSheetByGid(ss, TARGET_GID);
  if (!sheet) return;

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 3) return;

  const tasks = data.slice(3);
  const pendingTasks = tasks.filter(row => row[5] !== 'COMPLETED' && row[5] !== '完了');

  if (pendingTasks.length === 0) return;

  let reportText = "### 【週次進捗確認】未完了タスク一覧 ###\n\n";
  pendingTasks.slice(0, 15).forEach(task => {
    reportText += `* ${task[3]} (担当: ${task[1]} / 期限: ${task[8] || '未定'})\n`;
  });

  if (pendingTasks.length > 15) {
    reportText += `\n他 ${pendingTasks.length - 15} 件の未完了タスクがあります。`;
  }

  const webhookUrl = getCliqWebhookUrl();
  const message = {
    text: reportText,
    bot: { name: "Project MGT", image: "https://www.google.com/s2/favicons?domain=sincol-leather.jp" }
  };

  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(message)
  });
}

// ==========================================
// doGet - データ読み取り
// ==========================================
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getSheetByGid(ss, TARGET_GID);
    if (!sheet) sheet = ss.getSheetByName(DEFAULT_SHEET_NAME) || ss.getSheets()[0];

    const dataRange = sheet.getDataRange();
    const dataStartPhysicalRow = dataRange.getRow();
    const data = dataRange.getDisplayValues();

    // ヘッダー行を動的に特定 (列Dが「タイトル」または「項目」である行を探す)
    let headerRowIndex = 2; 
    for (let i = 0; i < Math.min(15, data.length); i++) {
      const cellValue = String(data[i][3] || '').trim();
      if (cellValue === 'タイトル' || cellValue === '項目' || cellValue === 'Title' || cellValue === 'Task') {
        headerRowIndex = i;
        break;
      }
    }

    const headerPhysicalRow = dataStartPhysicalRow + headerRowIndex;
    const itemsStartRow = headerPhysicalRow + 1;
    const lastRow = sheet.getLastRow();

    if (lastRow >= itemsStartRow) {
      const uuidsRange = sheet.getRange(itemsStartRow, 21, lastRow - itemsStartRow + 1, 1);
      const uuids = uuidsRange.getValues();
      let changed = false;
      for (let i = 0; i < uuids.length; i++) {
        const u = String(uuids[i][0]).trim();
        if (!u) {
          uuids[i][0] = Utilities.getUuid();
          changed = true;
        }
      }
      if (changed) {
        uuidsRange.setValues(uuids);
      }
    }

    const finalData = sheet.getDataRange().getDisplayValues();
    const rows = finalData.length > headerRowIndex + 1 ? finalData.slice(headerRowIndex + 1) : [];

    const paddedRows = rows.map((row, index) => {
      const newRow = new Array(26).fill('');
      for (let i = 0; i < Math.min(row.length, 25); i++) {
        newRow[i] = row[i];
      }
      newRow[25] = String(index + headerRowIndex + dataStartPhysicalRow + 1);
      return newRow;
    });

    let projectConcept = null;
    try {
      const conceptJson = sheet.getRange(1, 2).getValue();
      if (conceptJson) projectConcept = JSON.parse(conceptJson);
    } catch (e) { }

    const epicsStr = PropertiesService.getScriptProperties().getProperty('EPICS');
    const epics = epicsStr ? JSON.parse(epicsStr) : [];

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: paddedRows,
      headerRowIndex: headerRowIndex,
      projectConcept: projectConcept,
      epics: epics
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// doPost - データ書き込み
// ==========================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const success = lock.tryLock(15000);
    if (!success) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'サーバー混雑' })).setMimeType(ContentService.MimeType.JSON);
    }

    let jsonString = '';
    if (e && e.postData && e.postData.contents) {
      jsonString = e.postData.contents;
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No data' })).setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(jsonString);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getSheetByGid(ss, TARGET_GID);

    if (!sheet) {
      sheet = ss.getSheetByName(DEFAULT_SHEET_NAME) || ss.getSheets()[0];
    }

    // --- 行フォーマット関数 ---
    const formatRow = (t) => {
      let progressStr = "";
      if (Array.isArray(t.progress)) {
        const reversedProgress = [...t.progress].reverse();
        progressStr = reversedProgress.map(p => `[${p.updatedAt}] ${p.content}`).join(' | ');
      }
      const val = (v) => Array.isArray(v) ? JSON.stringify(v) : (v || (typeof v === 'object' ? JSON.stringify(v) : ''));
      
      return [
        t.date || "", t.responsiblePerson || "", t.department || "", t.title || "", t.isSoftDeleted ? 'SOFT_DELETE' : '',
        t.status || "", t.priority || "", progressStr, t.dueDate || "",
        t.isCommitted ? 'TRUE' : 'FALSE', t.reviewer || "",
        val(t.team), t.startDate || "", t.goal || "", val(t.milestones), t.project || '',
        val(t.comments), val(t.attachments), val(t.dependencies), val(t.evaluation), t.uuid || '',
        t.parentId || '', t.hierarchyType || '', t.trackId || '', val(t.lastViewedBy)
      ];
    };

    // --- マージロジック関数 (データ消失防止の要) ---
    const mergeTaskRows = (existing, incoming) => {
      const merged = [...incoming];
      const mergeJsonArray = (idx, idKey) => {
        try {
          const arrE = JSON.parse(existing[idx] || '[]');
          const arrI = JSON.parse(incoming[idx] || '[]');
          const combined = [...arrE, ...arrI];
          const map = {};
          combined.forEach(item => {
            if (!item) return;
            const key = item[idKey] || (typeof item === 'string' ? item : JSON.stringify(item));
            if (!map[key]) map[key] = item;
          });
          return JSON.stringify(Object.values(map));
        } catch (e) { return incoming[idx]; }
      };

      try {
        const progE = (existing[7] || "").split(' | ').filter(s => s.trim());
        const progI = (incoming[7] || "").split(' | ').filter(s => s.trim());
        const combinedProg = Array.from(new Set([...progE, ...progI]));
        merged[7] = combinedProg.join(' | ');
      } catch (e) { }

      merged[16] = mergeJsonArray(16, 'id');
      merged[17] = mergeJsonArray(17, 'id');
      merged[24] = mergeJsonArray(24, 'userName');

      const richIndices = [1, 2, 3, 10, 13, 15, 18, 19];
      richIndices.forEach(idx => {
        const valE = String(existing[idx] || "");
        const valI = String(incoming[idx] || "");
        if (valE.length > valI.length) merged[idx] = valE;
      });

      if (existing[5] === 'COMPLETED' || existing[5] === '完了') merged[5] = existing[5];

      // SOFT_DELETE フラグは一度立ったら保持する（上書きで消えるのを防止）
      if (existing[4] === 'SOFT_DELETE') merged[4] = 'SOFT_DELETE';

      return merged;
    };

    // --- ACTION: SAVE SINGLE TASK ---
    if (data.action === 'save_task') {
      const task = data.task;
      const taskId = data.taskId;
      const rowData = formatRow(task);
      const allData = sheet.getDataRange().getValues();
      
      let hIdx = 2;
      for (let hi = 0; hi < Math.min(15, allData.length); hi++) {
        const cellVal = String(allData[hi][3] || '').trim();
        if (cellVal === 'タイトル' || cellVal === '項目' || cellVal === 'Title' || cellVal === 'Task') { hIdx = hi; break; }
      }
      const dataStartRow = hIdx + 2;
      let targetRow = -1;

      // 1. sheet-行番号での直接解決
      if (taskId && String(taskId).indexOf('sheet-') === 0) {
        const parsed = parseInt(String(taskId).replace('sheet-', ''), 10);
        if (!isNaN(parsed) && parsed >= dataStartRow && parsed <= sheet.getLastRow()) {
          const existingUuid = String(sheet.getRange(parsed, 21).getValue()).trim();
          if (!existingUuid || existingUuid.indexOf('row-uuid-') === 0 || !task.uuid || existingUuid === String(task.uuid).trim()) {
            targetRow = parsed;
          }
        }
      }

      // 2. UUID検索
      if (targetRow === -1 && task.uuid && sheet.getLastRow() >= dataStartRow) {
        const uCol = sheet.getRange(dataStartRow, 21, sheet.getLastRow() - dataStartRow + 1, 1).getValues();
        for (let ui = 0; ui < uCol.length; ui++) {
          if (String(uCol[ui][0]).trim() === String(task.uuid).trim()) { targetRow = ui + dataStartRow; break; }
        }
      }

      // 3. TrackID検索
      if (targetRow === -1 && task.trackId && sheet.getLastRow() >= dataStartRow) {
        const trackCol = sheet.getRange(dataStartRow, 24, sheet.getLastRow() - dataStartRow + 1, 1).getValues();
        for (let ti = 0; ti < trackCol.length; ti++) {
          if (String(trackCol[ti][0]).trim() === String(task.trackId).trim()) { targetRow = ti + dataStartRow; break; }
        }
      }

      // 4. タイトル+責任者でのフォールバック
      if (targetRow === -1 && task.title && task.responsiblePerson && sheet.getLastRow() >= dataStartRow) {
        const searchRange = sheet.getRange(dataStartRow, 1, sheet.getLastRow() - dataStartRow + 1, 4).getValues();
        for (let si = 0; si < searchRange.length; si++) {
          if (String(searchRange[si][3]).trim() === String(task.title).trim() && String(searchRange[si][1]).trim() === String(task.responsiblePerson).trim()) {
            targetRow = si + dataStartRow; break;
          }
        }
      }

      if (targetRow >= dataStartRow && targetRow <= sheet.getLastRow()) {
        const existingRowData = allData[targetRow - 1];
        const mergedRowData = mergeTaskRows(existingRowData, rowData);
        sheet.getRange(targetRow, 1, 1, mergedRowData.length).setValues([mergedRowData]);
      } else {
        sheet.appendRow(rowData);
      }

      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', taskId: taskId, targetRow: targetRow })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: SYNC ALL / SAVE CONCEPT / SAVE EPICS (省略せずに維持) ---
    if (data.action === 'save_concept') {
      if (data.projectConcept) sheet.getRange(1, 2).setValue(JSON.stringify(data.projectConcept));
      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'sync_all') {
      const rows = data.tasks.map(formatRow);
      const lastRow = sheet.getLastRow();
      let hIdxSync = 2;
      const allDataSync = sheet.getDataRange().getValues();
      for (let i = 0; i < Math.min(15, allDataSync.length); i++) {
        const cv = String(allDataSync[i][3] || '').trim();
        if (cv === 'タイトル' || cv === '項目' || cv === 'Title' || cv === 'Task') { hIdxSync = i; break; }
      }
      const dataStart = hIdxSync + 2;
      if (lastRow >= dataStart) sheet.getRange(dataStart, 1, lastRow - dataStart + 1, 25).clearContent();
      if (rows.length > 0) sheet.getRange(dataStart, 1, rows.length, 25).setValues(rows);
      if (data.projectConcept) sheet.getRange(1, 2).setValue(JSON.stringify(data.projectConcept));
      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', count: rows.length })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'save_epics') {
      PropertiesService.getScriptProperties().setProperty('EPICS', JSON.stringify(data.epics || []));
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: CLEANUP SHEET (高度な整理機能) ---
    if (data.action === 'cleanup_sheet') {
      const allData = sheet.getDataRange().getValues();
      const dataStartRow = 5; 
      const lastRow = sheet.getLastRow();
      if (lastRow < dataStartRow) return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'No data' })).setMimeType(ContentService.MimeType.JSON);

      const rows = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 25).getValues();
      const titleGroups = {};
      
      const getLatestActivityDate = (row) => {
        let maxDate = new Date(0);
        try { let d = row[0] instanceof Date ? row[0] : new Date(row[0]); if (!isNaN(d.getTime())) maxDate = d; } catch(e) {}
        const progressStr = String(row[7] || '');
        const dateMatches = progressStr.match(/\[(\d{4}-\d{2}-\d{2}.*?)\]/g);
        if (dateMatches) dateMatches.forEach(m => { let d = new Date(m.slice(1, -1)); if (!isNaN(d.getTime()) && d > maxDate) maxDate = d; });
        try {
          const comments = JSON.parse(row[16] || '[]');
          if (Array.isArray(comments)) comments.forEach(c => { let d = new Date(c.timestamp || c.date); if (!isNaN(d.getTime()) && d > maxDate) maxDate = d; });
        } catch(e) {}
        return maxDate;
      };
      
      rows.forEach(row => {
        const title = String(row[3] || '').trim();
        if (!title || row[4] === 'SOFT_DELETE' || row[4] === 'TRUE' || row[4] === true) return;
        if (!titleGroups[title]) titleGroups[title] = { latestRow: row, isSubtask: false, parentId: '', latestDate: new Date(0) };
        const group = titleGroups[title];
        const pId = String(row[21] || '').trim();
        if (pId || String(row[22]).trim() === 'subtask') { group.isSubtask = true; if (pId) group.parentId = pId; }
        const rowDate = getLatestActivityDate(row);
        if (rowDate >= group.latestDate) { group.latestDate = rowDate; group.latestRow = [...row]; }
      });

      const uniqueTasks = Object.values(titleGroups).map(g => {
        const r = g.latestRow;
        if (g.isSubtask) { r[21] = g.parentId; r[22] = 'subtask'; } else { r[22] = 'root'; }
        return r;
      });

      const sortedRows = [];
      const roots = uniqueTasks.filter(t => String(t[22]) !== 'subtask');
      const subtasks = uniqueTasks.filter(t => String(t[22]) === 'subtask');
      roots.forEach(root => {
        sortedRows.push(root);
        subtasks.filter(sub => String(sub[21]) === String(root[20])).forEach(child => sortedRows.push(child));
      });
      const addedUuids = new Set(sortedRows.map(r => String(r[20])));
      uniqueTasks.forEach(t => { if (!addedUuids.has(String(t[20]))) sortedRows.push(t); });

      sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 25).clearContent();
      if (sortedRows.length > 0) sheet.getRange(dataStartRow, 1, sortedRows.length, 25).setValues(sortedRows);
      sheet.getRange(2, 1).setValue("Last Updated (Cleaned): " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', originalCount: rows.length, finalCount: sortedRows.length })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e) { }
  }
}

function getCliqWebhookUrl() { return PropertiesService.getScriptProperties().getProperty('CLIQ_WEBHOOK_URL') || DEFAULT_CLIQ_WEBHOOK_URL; }