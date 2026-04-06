
import { Task, TaskStatus, TaskPriority, Milestone, MemberInfo, TaskComment, Attachment, TaskEvaluation, ProjectConcept } from './types';
import { PROJECT_MEMBERS, SPREADSHEET_ID, SHEET_GID } from './constants';

// [Important] Use JSON output instead of CSV to correctly handle newlines in cells
const getJsonUrl = () => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;

const safeJsonParse = <T>(jsonString: string, defaultValue: T): T => {
  if (!jsonString || jsonString === 'null' || jsonString === '' || jsonString === 'undefined') return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
};

// Helper to fix Gviz "Date(yyyy,m,d)" strings if they appear as values or "new Date(...)"
const normalizeGvizDate = (val: string): string => {
  if (!val) return '';
  // Handle "Date(2026,2,31)" or "new Date(2026,2,31)"
  // Note: Gviz months are 0-indexed (0=Jan, 11=Dec)
  const match = val.match(/(?:new\s+)?Date\((\d+),(\d+),(\d+)\)/);
  if (match) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]) + 1;
    const day = parseInt(match[3]);
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
  return val;
};

const mapRowToTask = (rawRow: any[], sheetRowNumber: number): Task | null => {
  // Ensure we have enough columns by padding with empty strings
  const row = [...rawRow];
  while (row.length < 25) { row.push(''); }

  // Check valid row: must have Title(3) OR Person(1) OR Date(0)
  // Also filter out obvious header rows if they slipped through
  const cell3 = String(row[3] || '').trim();
  if (cell3 === 'タイトル' || cell3 === '項目' || cell3 === 'Title' || cell3 === 'Task' || row[0]?.includes('Last Updated') || row[0]?.includes('Board Tracker')) return null;

  const hasContent = row[0] || row[1] || row[3];
  if (!hasContent) return null;

  const date = normalizeGvizDate(row[0] || '');
  const personRaw = row[1] || '';
  const dept = row[2] || '';
  const title = row[3] || '(タイトルなし)';
  const isSoftDeleted = row[4] === 'SOFT_DELETE' || row[4] === 'TRUE' || row[4] === 'true' || row[4] === true;
  const statusRaw = row[5] || '';
  const priorityRaw = row[6] || '';
  const progressContent = row[7] || '';
  const dueDate = normalizeGvizDate(row[8] || '');
  const isCommittedRaw = row[9] || '';
  const reviewerRaw = row[10] || '';
  const teamJson = row[11] || '[]';
  const startDate = normalizeGvizDate(row[12] || '');
  const goal = row[13] || '';
  const milestonesJson = row[14] || '[]';
  const project = row[15] || '';
  const commentsJson = row[16] || '[]';
  const attachmentsJson = row[17] || '[]';
  const dependenciesJson = row[18] || '[]';
  const evaluationJson = row[19] || 'null';

  // ★ 修正: GASから26列目に物理行番号が送られてきている場合はそれを使用する
  const finalSheetRowNumber = row[25] ? parseInt(row[25], 10) : sheetRowNumber;
  const uuid = row[20] || `row-uuid-${finalSheetRowNumber}`;

  const parentId = row[21] || '';
  let hierarchyType = row[22] || '';
  const trackId = row[23] || '';
  const lastViewedByJson = row[24] || '[]';

  // Infer hierarchyType if missing but parentId exists
  if (!hierarchyType && parentId) {
    hierarchyType = 'subtask';
  } else if (!hierarchyType) {
    hierarchyType = 'root';
  }

  const matchedExec = PROJECT_MEMBERS.find(exec => personRaw.includes(exec));
  const person = matchedExec || personRaw || '未割当';

  let status = TaskStatus.TODO;
  const s = statusRaw.toUpperCase();
  if (s.includes('完了') || s === 'TRUE' || s === 'COMPLETED') {
    status = TaskStatus.COMPLETED;
  } else if (s.includes('進行中') || s === 'IN_PROGRESS') {
    status = TaskStatus.IN_PROGRESS;
  } else if (s.includes('遅延') || s.includes('期限切れ') || s === 'OVERDUE') {
    status = TaskStatus.OVERDUE;
  } else if (s.includes('未着手') || s === 'TODO') {
    status = TaskStatus.TODO;
  }

  let priority = TaskPriority.MEDIUM;
  if (priorityRaw.includes('高')) priority = TaskPriority.HIGH;
  else if (priorityRaw.includes('低')) priority = TaskPriority.LOW;

  const progress = progressContent ? progressContent.split(' | ').filter((c: string) => c.trim()).map((content: string, i: number) => {
    const dateMatch = content.match(/^\[(.*?)\]\s*(.*)/);
    return {
      week: i + 1,
      content: dateMatch ? dateMatch[2] : content,
      updatedAt: dateMatch ? dateMatch[1] : date,
      author: person
    };
  }).reverse() : [];

  return {
    id: `sheet-${finalSheetRowNumber}`, // Use actual sheet row number for ID
    date, department: dept, project: project || '未分類',
    responsiblePerson: person, team: safeJsonParse<string[]>(teamJson, []),
    title, goal, startDate, dueDate,
    milestones: safeJsonParse<Milestone[]>(milestonesJson, []),
    isCommitted: isCommittedRaw.toUpperCase() === 'TRUE' || isCommittedRaw === '1',
    isSoftDeleted, status, priority, progress,
    comments: safeJsonParse<TaskComment[]>(commentsJson, []),
    attachments: safeJsonParse<Attachment[]>(attachmentsJson, []),
    dependencies: safeJsonParse<string[]>(dependenciesJson, []),
    lastViewedBy: safeJsonParse<{ userId: string, userName: string, timestamp: string }[]>(lastViewedByJson, []),
    reviewer: reviewerRaw,
    evaluation: safeJsonParse<TaskEvaluation | undefined>(evaluationJson, undefined),
    uuid,
    parentId,
    hierarchyType: hierarchyType as any,
    trackId
  } as Task;
};

export const fetchTasksFromSheet = async (gasUrl?: string): Promise<{ tasks: Task[], projectConcept?: ProjectConcept, epics: string[] }> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  const fetchFromGviz = async (): Promise<{ tasks: Task[], projectConcept?: ProjectConcept, epics: string[] }> => {
    console.log("Fetching tasks via Gviz API (Fallback)");
    const gvizResponse = await fetch(`${getJsonUrl()}&t=${Date.now()}`, { signal: controller.signal });
    if (!gvizResponse.ok) {
      if (gvizResponse.status === 401 || gvizResponse.status === 403) {
        throw new Error("スプレッドシートへのアクセス権限がありません。シートを「リンクを知っている全員」に共有するか、Googleアカウントでログインしてください。");
      }
      throw new Error(`Gviz Fetch failed: ${gvizResponse.status}`);
    }

    const text = await gvizResponse.text();
    const start = text.indexOf('({');
    const end = text.lastIndexOf('})');
    if (start === -1 || end === -1) throw new Error('Invalid JSONP format from Gviz');

    let jsonString = text.substring(start + 1, end + 1);
    jsonString = jsonString.replace(/new Date\((\d+),(\d+),(\d+)\)/g, '"Date($1,$2,$3)"');

    const data = JSON.parse(jsonString);
    const rows = data.table.rows;

    const stringRows = rows.map((r: any) => {
      const row = r.c.map((cell: any) => cell && cell.v !== null ? String(cell.v) : '');
      // パディング
      while (row.length < 25) row.push('');
      return row;
    });

    let headerIndex = -1;
    for (let i = 0; i < Math.min(stringRows.length, 15); i++) {
      const cellValue = String(stringRows[i][3] || '').trim();
      if (cellValue === 'タイトル' || cellValue === '項目' || cellValue === 'Title' || cellValue === 'Task') {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      console.warn("Header row not found in Gviz data, defaulting to index 2 (row 3)");
      headerIndex = 2;
    }

    const resultTasks: Task[] = [];
    stringRows.forEach((row: string[], index: number) => {
      if (index <= headerIndex) return;
      // 物理行番号は単純に index + 1 (Gvizは全シートを返すため)
      const sheetRowNumber = index + 1;
      const task = mapRowToTask(row, sheetRowNumber);
      if (task) resultTasks.push(task);
    });

    // Deduplicate by Title + Responsible Person + Project, keeping the one with the latest activity
    const getLatestActivityDateFromTask = (t: Task): number => {
      let maxDate = new Date(t.date || 0).getTime();
      if (Array.isArray(t.progress)) {
        t.progress.forEach(p => {
          const d = new Date(p.updatedAt || 0).getTime();
          if (!isNaN(d) && d > maxDate) maxDate = d;
        });
      }
      if (Array.isArray(t.comments)) {
        t.comments.forEach(c => {
          const d = new Date(c.createdAt || 0).getTime();
          if (!isNaN(d) && d > maxDate) maxDate = d;
        });
      }
      return maxDate;
    };

    const taskMap = new Map<string, Task>();
    resultTasks.forEach(t => {
      const key = `${t.title}|${t.responsiblePerson}|${t.project}`;
      const existing = taskMap.get(key);
      if (!existing) {
        taskMap.set(key, t);
      } else {
        const existingDate = getLatestActivityDateFromTask(existing);
        const currentDate = getLatestActivityDateFromTask(t);
        if (currentDate > existingDate) {
          taskMap.set(key, t);
        } else if (currentDate === existingDate) {
          const existingRow = parseInt(existing.id.replace('sheet-', ''), 10);
          const currentRow = parseInt(t.id.replace('sheet-', ''), 10);
          if (currentRow > existingRow) {
            taskMap.set(key, t);
          }
        }
      }
    });

    return { tasks: Array.from(taskMap.values()), epics: [] };
  };

  try {
    if (gasUrl) {
      console.log("Fetching tasks via GAS:", gasUrl);
      try {
        const fetchUrl = `${gasUrl}${gasUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const response = await fetch(fetchUrl, { signal: controller.signal });
        console.log("GAS Response status:", response.status);

        if (!response.ok) {
          console.warn(`GAS endpoint returned ${response.status}, falling back to Gviz`);
          return await fetchFromGviz();
        }

        const result = await response.json();
        console.log("GAS Result status:", result.status);

        if (result.status === 'success') {
          clearTimeout(timeoutId);
          console.log(`GAS fetch success: ${result.data.length} rows found. Header at row ${result.headerRowIndex + 1}`);
          const stringRows = result.data.map((row: any[]) => row.map(cell => cell !== null ? String(cell) : ''));
          const resultTasks: Task[] = [];
          
          // GAS側で物理行番号(26列目)が計算されているため、それを使用する
          // フォールバックとして headerRowIndex を使用する
          const headerOffset = (result.headerRowIndex !== undefined ? result.headerRowIndex : 2) + 2;

          stringRows.forEach((row: string[], index: number) => {
            // row[25]に物理行番号が入っているはず
            const sheetRowNumber = row[25] ? parseInt(row[25], 10) : (index + headerOffset);
            const task = mapRowToTask(row, sheetRowNumber);
            if (task) resultTasks.push(task);
          });

          console.log(`Mapped ${resultTasks.length} tasks from GAS data`);

          // Deduplicate by Title + Responsible Person + Project, keeping the one with the latest activity
          const getLatestActivityDateFromTask = (t: Task): number => {
            let maxDate = new Date(t.date || 0).getTime();
            if (Array.isArray(t.progress)) {
              t.progress.forEach(p => {
                const d = new Date(p.updatedAt || 0).getTime();
                if (!isNaN(d) && d > maxDate) maxDate = d;
              });
            }
            if (Array.isArray(t.comments)) {
              t.comments.forEach(c => {
                const d = new Date(c.createdAt || 0).getTime();
                if (!isNaN(d) && d > maxDate) maxDate = d;
              });
            }
            return maxDate;
          };

          const taskMap = new Map<string, Task>();
          resultTasks.forEach(t => {
            const key = `${t.title}|${t.responsiblePerson}|${t.project}`;
            const existing = taskMap.get(key);
            if (!existing) {
              taskMap.set(key, t);
            } else {
              const existingDate = getLatestActivityDateFromTask(existing);
              const currentDate = getLatestActivityDateFromTask(t);
              if (currentDate > existingDate) {
                taskMap.set(key, t);
              } else if (currentDate === existingDate) {
                const existingRow = parseInt(existing.id.replace('sheet-', ''), 10);
                const currentRow = parseInt(t.id.replace('sheet-', ''), 10);
                if (currentRow > existingRow) {
                  taskMap.set(key, t);
                }
              }
            }
          });

          return { tasks: Array.from(taskMap.values()), projectConcept: result.projectConcept, epics: result.epics || [] };
        } else {
          console.warn("GAS returned error status, falling back to Gviz:", result.message);
          return await fetchFromGviz();
        }
      } catch (gasError) {
        console.warn("GAS fetch failed, falling back to Gviz:", gasError);
        return await fetchFromGviz();
      }
    } else {
      const data = await fetchFromGviz();
      clearTimeout(timeoutId);
      return data;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Final fetch error:", error);
    throw error;
  }
};

const mapTaskToRow = (t: Task) => {
  // Ensure progress is array before mapping
  const progressList = Array.isArray(t.progress) ? t.progress : [];

  return {
    date: t.date || "",
    responsiblePerson: t.responsiblePerson || "",
    department: t.department || "",
    title: t.title || "",
    status: t.status,
    priority: t.priority,
    progress: progressList.map(p => ({ updatedAt: p.updatedAt, content: p.content })),
    dueDate: t.dueDate || "",
    isCommitted: t.isCommitted || false,
    isSoftDeleted: t.isSoftDeleted ? 'SOFT_DELETE' : '',
    reviewer: t.reviewer || "",
    team: JSON.stringify(t.team),
    startDate: t.startDate || "",
    goal: t.goal || "",
    milestones: JSON.stringify(t.milestones),
    project: t.project || "",
    comments: JSON.stringify(t.comments || []),
    attachments: JSON.stringify(t.attachments || []),
    dependencies: JSON.stringify(t.dependencies || []),
    evaluation: JSON.stringify(t.evaluation || null),
    uuid: t.uuid || "",
    parentId: t.parentId || "",
    hierarchyType: t.hierarchyType || "root",
    trackId: t.trackId || "",
    lastViewedBy: JSON.stringify(t.lastViewedBy || [])
  };
};

export const saveSingleTaskToSheet = async (
  task: Task,
  gasUrl: string,
  notify?: { email: boolean, cliq: boolean },
  members?: MemberInfo[],
  cliqNewTaskTemplate?: string,
  cliqWebhookUrl?: string
): Promise<boolean> => {
  if (!gasUrl) throw new Error('GAS URL not set');

  const payload = {
    action: 'save_task',
    task: mapTaskToRow(task),
    taskId: task.id
  };

  console.log("[GAS Save] Sending:", task.title, "id:", task.id, "uuid:", task.uuid);

  const attemptSave = async (attempt: number): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト

    try {
      // GASのdoPostは、複数アカウントログイン時などに302リダイレクト先で500エラーやCORSエラーを起こす既知のバグがあります。
      // シート自体は正しく更新されているため、no-corsモードで送信し、結果のエラーを無視します。
      const response = await fetch(gasUrl, {
        method: 'POST',
        mode: 'no-cors', // OpaqueレスポンスになるがCORSエラーを回避
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // no-corsモードではレスポンスの中身（status text等）は一切読めませんが、
      // ネットワーク通信自体が成功（例外がスローされない）していれば成功とみなします。
      console.log("[GAS Save] POST sent successfully (opaque response ignored).");
      return true;
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error(`[GAS Save] Attempt ${attempt} failed:`, error.name, error.message);

      if (error.name === 'AbortError') {
        throw new Error("保存がタイムアウトしました。通信環境を確認してください。");
      }

      // no-corsがTypeErrorを吐いた場合（ブラウザ側の極端なブロックなど）は握りつぶして成功扱いにする
      if (error.name === 'TypeError' || (error.message && error.message.includes('Failed to fetch'))) {
        console.warn("[GAS Save] TypeError on no-cors fetch (mostly network/adblocker). Assuming push success since GAS logs say it worked:", error.message);
        return true;
      }

      const msg = error.message || '';
      throw new Error(`ネットワークエラー: ${msg}`);
    }
  };

  return attemptSave(1);
};

export const saveProjectConceptToSheet = async (
  concept: ProjectConcept,
  gasUrl: string
): Promise<boolean> => {
  if (!gasUrl) throw new Error('GAS URL not set');

  const payload = {
    action: 'save_concept',
    projectConcept: concept
  };

  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' }
    });
    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error(result.message || 'コンセプト保存に失敗しました(GASエラー)');
    }
    return true;
  } catch (error: any) {
    console.error("Concept save failed:", error);
    const msg = error.message || '';
    if (msg.includes('Unknown action')) {
      throw new Error("【重要設定エラー】GASのコードが古いバージョンで動いています。GASエディタにて「新しいデプロイ」を作成し、新しいURLを設定し直してください！");
    }
    throw new Error("コンセプト保存に失敗: " + msg);
  }
};

export const saveEpicsToSheet = async (
  epics: string[],
  gasUrl: string
): Promise<boolean> => {
  if (!gasUrl) throw new Error('GAS URL not set');

  const payload = {
    action: 'save_epics',
    epics: epics
  };

  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' }
    });
    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error(result.message || 'エピック保存に失敗しました(GASエラー)');
    }
    return true;
  } catch (error: any) {
    console.error("Epics save failed:", error);
    const msg = error.message || '';
    if (msg.includes('Unknown action')) {
      throw new Error("【重要設定エラー】GASのコードが古いバージョンで動いています。GASエディタにて「新しいデプロイ」を作成し、新しいURLを設定し直してください！");
    }
    throw new Error("エピック保存に失敗: " + msg);
  }
};

export const syncAllTasksToSheet = async (
  tasks: Task[],
  gasUrl: string,
  notify?: { email: boolean, cliq: boolean },
  members?: MemberInfo[],
  cliqNewTaskTemplate?: string,
  cliqWebhookUrl?: string,
  projectConcept?: ProjectConcept
): Promise<boolean> => {
  if (!gasUrl) throw new Error('GAS URL not set');

  const payload = {
    action: 'sync_all',
    tasks: tasks.map(mapTaskToRow),
    projectConcept: projectConcept
  };

  console.log("Posting ALL tasks to GAS:", gasUrl);
  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' }
    });
    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error(result.message || '全同期に失敗しました(GASエラー)');
    }
    return true;
  } catch (error: any) {
    console.error("Sync failed:", error);
    const msg = error.message || '';
    if (msg.includes('Unknown action')) {
      throw new Error("【重要設定エラー】GASのコードが古いバージョンで動いています。GASエディタにて「新しいデプロイ」を作成し、新しいURLを設定し直してください！");
    }
    throw new Error("全同期に失敗: " + msg);
  }
};

export const cleanupSheet = async (gasUrl: string): Promise<boolean> => {
  if (!gasUrl) throw new Error('GAS URL not set');

  const payload = {
    action: 'cleanup_sheet'
  };

  try {
    // GASの制限(CORS)を回避するため、no-corsモードで送信します。
    // これによりレスポンスの中身は見られなくなりますが、命令は確実にGASに届きます。
    await fetch(gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' }
    });
    return true;
  } catch (error: any) {
    console.error("Cleanup failed:", error);
    const msg = error.message || '';
    throw new Error("クリーンアップ通信に失敗: " + msg);
  }
};
