// ==========================================
// Sincol Leather 2027 - Board Tracker Backend
// Google Apps Script (GAS)
// Version: 5.0
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
 * GASのトリガー設定でこの関数を指定してください
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

  let reportText = "### 【週次進捗確認】未完了タスク一覧 ###\\n\\n";
  pendingTasks.slice(0, 15).forEach(task => {
    reportText += `* ${task[3]} (担当: ${task[1]} / 期限: ${task[8] || '未定'})\\n`;
  });

  if (pendingTasks.length > 15) {
    reportText += `\\n他 ${pendingTasks.length - 15} 件の未完了タスクがあります。`;
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
    let headerRowIndex = 2; // デフォルトは3行目(index 2)
    for (let i = 0; i < Math.min(15, data.length); i++) {
      const cellValue = String(data[i][3] || '').trim();
      if (cellValue === 'タイトル' || cellValue === '項目' || cellValue === 'Title' || cellValue === 'Task') {
        headerRowIndex = i;
        break;
      }
    }

    // 既存タスクにUUIDが空のものがあれば自動付与
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

    // UUID付与後の最新スプレッドシートデータで返す
    const finalData = sheet.getDataRange().getDisplayValues();
    const rows = finalData.length > headerRowIndex + 1 ? finalData.slice(headerRowIndex + 1) : [];

    // 物理行番号を各行のデータに付与して返す (FrontendでのID同期を確実に)
    const paddedRows = rows.map((row, index) => {
      const newRow = new Array(26).fill(''); // 25列 + 1列(行番号用)
      for (let i = 0; i < Math.min(row.length, 25); i++) {
        newRow[i] = row[i];
      }
      // 25番目のインデックス(26列目)に物理行番号を隠しデータとして入れる
      // 物理行番号 = データ開始物理行 + ヘッダー相対インデックス + 1 (ヘッダー行) + 1 (データ開始行) + 現在のインデックス
      newRow[25] = String(index + headerRowIndex + dataStartPhysicalRow + 1);
      return newRow;
    });

    // プロジェクトコンセプトを1行目2列目から取得
    let projectConcept = null;
    try {
      const conceptJson = sheet.getRange(1, 2).getValue();
      if (conceptJson) projectConcept = JSON.parse(conceptJson);
    } catch (e) { }

    // エピックをScriptPropertiesから取得
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
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
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
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'サーバーが混雑しています。少し待ってから再試行してください。'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let jsonString = '';
    if (e && e.postData && e.postData.contents) {
      jsonString = e.postData.contents;
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No post data' })).setMimeType(ContentService.MimeType.JSON);
    }

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid JSON: ' + parseError.toString() })).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getSheetByGid(ss, TARGET_GID);

    if (!sheet) {
      sheet = ss.getSheetByName(DEFAULT_SHEET_NAME) || ss.getSheets()[0];
      if (!sheet) {
        sheet = ss.insertSheet(DEFAULT_SHEET_NAME);
        sheet.getRange(1, 1).setValue("Sincol Leather 2027 Board Tracker");
        sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
        const headers = [
          '作成日', '責任者', '部署', 'タイトル', '詳細(予備)',
          'ステータス', '優先度', '進捗履歴', '完了予定日', '重要フラグ',
          '確認者', 'チーム', '開始日', 'ゴール定義', 'マイルストーン', 'エピック名',
          'コメント', '添付ファイル', '依存関係', '評価データ', 'UUID', 'ParentID', 'HierarchyType', 'TrackID', '既読情報'
        ];
        sheet.getRange(3, 1, 1, headers.length).setValues([headers]);
      }
    }

    // --- 行フォーマット関数 ---
    const formatRow = (t) => {
      let progressStr = "";
      if (Array.isArray(t.progress)) {
        const reversedProgress = [...t.progress].reverse();
        progressStr = reversedProgress.map(p => `[${p.updatedAt}] ${p.content}`).join(' | ');
      }

      const teamStr = Array.isArray(t.team) ? JSON.stringify(t.team) : (t.team || '[]');
      const milestonesStr = Array.isArray(t.milestones) ? JSON.stringify(t.milestones) : (t.milestones || '[]');
      const commentsStr = Array.isArray(t.comments) ? JSON.stringify(t.comments) : (t.comments || '[]');
      const attachmentsStr = Array.isArray(t.attachments) ? JSON.stringify(t.attachments) : (t.attachments || '[]');
      const dependenciesStr = Array.isArray(t.dependencies) ? JSON.stringify(t.dependencies) : (t.dependencies || '[]');
      const evaluationStr = (typeof t.evaluation === 'object' && t.evaluation !== null) ? JSON.stringify(t.evaluation) : (t.evaluation || 'null');
      const lastViewedByStr = Array.isArray(t.lastViewedBy) ? JSON.stringify(t.lastViewedBy) : (t.lastViewedBy || '[]');

      return [
        t.date, t.responsiblePerson, t.department, t.title, t.isSoftDeleted ? 'SOFT_DELETE' : '',
        t.status, t.priority, progressStr, t.dueDate,
        t.isCommitted ? 'TRUE' : 'FALSE', t.reviewer,
        teamStr, t.startDate, t.goal, milestonesStr, t.project || '',
        commentsStr, attachmentsStr, dependenciesStr, evaluationStr, t.uuid || '',
        t.parentId || '', t.hierarchyType || '', t.trackId || '', lastViewedByStr
      ];
    };

    // --- ACTION: SAVE SINGLE TASK (Upsert) ---
    if (data.action === 'save_task') {
      const task = data.task;
      const taskId = data.taskId;
      const rowData = formatRow(task);

      let targetRow = -1;

      // ヘッダー行を特定
      const allData = sheet.getDataRange().getValues();
      let hIdx = 2;
      for (let hi = 0; hi < Math.min(15, allData.length); hi++) {
        const cellVal = String(allData[hi][3] || '').trim();
        if (cellVal === 'タイトル' || cellVal === '項目' || cellVal === 'Title' || cellVal === 'Task') { hIdx = hi; break; }
      }
      const dataStartRow = hIdx + 2; // ヘッダーの次の行（1-indexed物理行）

      // ★ 最優先: taskId が "sheet-{行番号}" なら、その行番号を直接使う
      if (taskId && String(taskId).indexOf('sheet-') === 0) {
        const parsed = parseInt(String(taskId).replace('sheet-', ''), 10);
        if (!isNaN(parsed) && parsed >= dataStartRow && parsed <= sheet.getLastRow()) {
          // UUIDが一致するか、あるいは既存UUIDが空、または既存UUIDが一時的なものなら上書き許可
          const existingUuid = String(sheet.getRange(parsed, 21).getValue()).trim();
          const isTempUuid = existingUuid.indexOf('row-uuid-') === 0;
          if (!existingUuid || isTempUuid || !task.uuid || existingUuid === String(task.uuid).trim()) {
            targetRow = parsed;
          }
        }
      }

      // フォールバック1: UUID検索
      if (targetRow === -1 && task.uuid && sheet.getLastRow() >= dataStartRow) {
        const uCol = sheet.getRange(dataStartRow, 21, sheet.getLastRow() - dataStartRow + 1, 1).getValues();
        for (let ui = 0; ui < uCol.length; ui++) {
          if (String(uCol[ui][0]).trim() === String(task.uuid).trim()) {
            targetRow = ui + dataStartRow;
            break;
          }
        }
      }

      // フォールバック2: TrackID検索 (UUIDが不安定な場合の強力なバックアップ)
      if (targetRow === -1 && task.trackId && sheet.getLastRow() >= dataStartRow) {
        const trackCol = sheet.getRange(dataStartRow, 24, sheet.getLastRow() - dataStartRow + 1, 1).getValues();
        for (let ti = 0; ti < trackCol.length; ti++) {
          if (String(trackCol[ti][0]).trim() === String(task.trackId).trim()) {
            targetRow = ti + dataStartRow;
            break;
          }
        }
      }

      // フォールバック3: タイトルと責任者で検索 (最終手段)
      if (targetRow === -1 && task.title && task.responsiblePerson && sheet.getLastRow() >= dataStartRow) {
        const searchRange = sheet.getRange(dataStartRow, 1, sheet.getLastRow() - dataStartRow + 1, 4).getValues();
        for (let si = 0; si < searchRange.length; si++) {
          const rowTitle = String(searchRange[si][3]).trim();
          const rowPerson = String(searchRange[si][1]).trim();
          if (rowTitle === String(task.title).trim() && rowPerson === String(task.responsiblePerson).trim()) {
            targetRow = si + dataStartRow;
            break;
          }
        }
      }

      // 更新 or 新規追加
      if (targetRow >= dataStartRow && targetRow <= sheet.getLastRow()) {
        sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
      } else {
        sheet.appendRow(rowData);
      }

      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', taskId: taskId, targetRow: targetRow
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: SAVE CONCEPT ---
    if (data.action === 'save_concept') {
      if (data.projectConcept) {
        sheet.getRange(1, 2).setValue(JSON.stringify(data.projectConcept));
      }
      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: SYNC ALL ---
    if (data.action === 'sync_all') {
      const tasks = data.tasks;
      const rows = tasks.map(formatRow);

      const sheetDataForSync = sheet.getDataRange().getValues();
      let headerRowIndexSync = 2;
      for (let i = 0; i < Math.min(15, sheetDataForSync.length); i++) {
        const cellVal = String(sheetDataForSync[i][3] || '').trim();
        if (cellVal === 'タイトル' || cellVal === '項目' || cellVal === 'Title' || cellVal === 'Task') {
          headerRowIndexSync = i;
          break;
        }
      }
      const syncDataStartRow = headerRowIndexSync + 2;

      const lastRow = sheet.getLastRow();
      if (lastRow >= syncDataStartRow) {
        sheet.getRange(syncDataStartRow, 1, lastRow - syncDataStartRow + 1, 25).clearContent();
      }

      if (rows.length > 0) {
        sheet.getRange(syncDataStartRow, 1, rows.length, 25).setValues(rows);
      }

      if (data.projectConcept) {
        sheet.getRange(1, 2).setValue(JSON.stringify(data.projectConcept));
      }

      sheet.getRange(2, 1).setValue("Last Updated: " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', count: rows.length })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: SAVE EPICS ---
    if (data.action === 'save_epics') {
      PropertiesService.getScriptProperties().setProperty('EPICS', JSON.stringify(data.epics || []));
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- ACTION: CLEANUP SHEET (物理削除と重複整理・親子関係修復) ---
    if (data.action === 'cleanup_sheet') {
      const allData = sheet.getDataRange().getValues();
      // ユーザー指定: 1-3行目は変えない。4行目がヘッダー(index 3)、5行目(index 4)からデータ。
      const dataStartRow = 5; 
      const lastRow = sheet.getLastRow();

      if (lastRow < dataStartRow) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'No data to cleanup' })).setMimeType(ContentService.MimeType.JSON);
      }

      const rows = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 25).getValues();
      
      // 1. タイトルごとにグループ化し、最新データと親子情報を抽出
      const titleGroups = {};
      
      // 行データから最新のアクティビティ日時を抽出する関数
      const getLatestActivityDate = (row) => {
        let maxDate = new Date(0);
        
        // a. 作成日/更新日 (1列目)
        try {
          let d = row[0] instanceof Date ? row[0] : new Date(row[0]);
          if (!isNaN(d.getTime())) maxDate = d;
        } catch(e) {}

        // b. 進捗履歴 (8列目: [YYYY-MM-DD] ... 形式をスキャン)
        const progressStr = String(row[7] || '');
        const dateMatches = progressStr.match(/\[(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?.*?)\]/g);
        if (dateMatches) {
          dateMatches.forEach(m => {
            let d = new Date(m.slice(1, -1));
            if (!isNaN(d.getTime()) && d > maxDate) maxDate = d;
          });
        }

        // c. コメント (17列目: JSON形式)
        try {
          const comments = JSON.parse(row[16] || '[]');
          if (Array.isArray(comments)) {
            comments.forEach(c => {
              let d = new Date(c.timestamp || c.date);
              if (!isNaN(d.getTime()) && d > maxDate) maxDate = d;
            });
          }
        } catch(e) {}

        return maxDate;
      };
      
      rows.forEach(row => {
        const title = String(row[3] || '').trim();
        if (!title) return;

        const isDeleted = row[4] === 'SOFT_DELETE' || row[4] === 'TRUE' || row[4] === true;
        if (isDeleted) return;

        if (!titleGroups[title]) {
          titleGroups[title] = {
            latestRow: row,
            isSubtask: false,
            parentId: '',
            latestDate: new Date(0)
          };
        }

        const currentRow = titleGroups[title];
        
        // 親子判定: 一つでも子の記しがあれば、そのタイトルは子として扱う
        const parentId = String(row[21] || '').trim();
        const hType = String(row[22] || '').trim();
        if (parentId || hType === 'subtask') {
          currentRow.isSubtask = true;
          if (parentId) currentRow.parentId = parentId;
        }

        // 最新チェック (作成日、進捗、コメントのすべてを比較)
        const rowDate = getLatestActivityDate(row);

        if (rowDate >= currentRow.latestDate) {
          currentRow.latestDate = rowDate;
          currentRow.latestRow = [...row]; // コピー
        }
      });

      // 2. 抽出した「最新の1件」に対して親子情報を適用
      const uniqueTasks = Object.values(titleGroups).map(group => {
        const row = group.latestRow;
        if (group.isSubtask) {
          row[21] = group.parentId; // ParentID
          row[22] = 'subtask';      // HierarchyType
        } else {
          row[22] = 'root';
        }
        return row;
      });

      // 3. 親子の並び替え (親のすぐ下に子を配置)
      const roots = uniqueTasks.filter(t => String(t[22]) !== 'subtask');
      const subtasks = uniqueTasks.filter(t => String(t[22]) === 'subtask');
      
      const sortedRows = [];
      roots.forEach(root => {
        sortedRows.push(root);
        const children = subtasks.filter(sub => String(sub[21]) === String(root[20])); // UUIDで紐付け
        children.forEach(child => sortedRows.push(child));
      });

      // 親が見つからなかった孤立した子タスクも最後に追加
      const addedUuids = new Set(sortedRows.map(r => String(r[20])));
      uniqueTasks.forEach(t => {
        if (!addedUuids.has(String(t[20]))) {
          sortedRows.push(t);
        }
      });

      // 4. 書き戻し
      sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 25).clearContent();
      if (sortedRows.length > 0) {
        sheet.getRange(dataStartRow, 1, sortedRows.length, 25).setValues(sortedRows);
      }

      sheet.getRange(2, 1).setValue("Last Updated (Cleaned): " + new Date());
      return ContentService.createTextOutput(JSON.stringify({ 
        status: 'success', 
        originalCount: rows.length,
        finalCount: sortedRows.length 
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action: ' + (data.action || 'none') })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      // ロック解放エラーは無視
    }
  }
}

// ==========================================
// ユーティリティ関数
// ==========================================
function getCliqWebhookUrl() {
  return PropertiesService.getScriptProperties().getProperty('CLIQ_WEBHOOK_URL') || DEFAULT_CLIQ_WEBHOOK_URL;
}

function sendCliqNotification(task, template, webhookUrl) {
  if (!webhookUrl) return;
  const text = `### 新規タスク登録 ###\n\n**${task.title}**\n* 担当: ${task.responsiblePerson}\n* 期限: ${task.dueDate || '未定'}`;
  const message = {
    text: text,
    bot: { name: "Project MGT", image: "https://www.google.com/s2/favicons?domain=sincol-leather.jp" }
  };
  try { UrlFetchApp.fetch(webhookUrl, { method: 'post', contentType: 'application/json', payload: JSON.stringify(message) }); } catch (e) { }
}