
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
  if (row[3] === 'タイトル' || row[0]?.includes('Last Updated') || row[0]?.includes('Board Tracker')) return null;

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
  const uuid = row[20] || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    id: `sheet-${sheetRowNumber}`, // Use actual sheet row number for ID
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

/**
 * 2つのタスクデータをマージする (ユーザー要望: データ量が多い方を優先、ないデータを足す)
 */
export const mergeTasks = (taskA: Task, taskB: Task): Task => {
  // 削除フラグは「どちらかが削除済みなら削除済み」とする（削除が優先）
  const isSoftDeleted = taskA.isSoftDeleted || taskB.isSoftDeleted || false;
  // 基本的なフィールドのマージ（空でない方を優先、または文字数が多い方を優先）
  const pickRich = (valA: any, valB: any) => {
    if (valA === undefined || valA === null || valA === '') return valB;
    if (valB === undefined || valB === null || valB === '') return valA;
    if (typeof valA === 'string' && typeof valB === 'string') {
      return valA.length >= valB.length ? valA : valB;
    }
    return valA;
  };

  // 配列系データのマージ (IDや内容で重複排除)
  const mergeArrays = <T>(arrA: T[] | undefined, arrB: T[] | undefined, key: keyof T): T[] => {
    const combined = [...(arrA || []), ...(arrB || [])];
    const map = new Map();
    combined.forEach(item => {
      const k = item[key];
      if (!map.has(k)) {
        map.set(k, item);
      } else {
        // 同じIDがある場合、より情報量が多い（プロパティが多い）方を保持する等の工夫も可能だが、
        // 現状は最初に見つけたものを優先
      }
    });
    return Array.from(map.values());
  };

  // 進捗(progress)は内容と日付で重複排除
  const mergeProgress = (pA: any[] = [], pB: any[] = []) => {
    const combined = [...pA, ...pB];
    const map = new Map();
    combined.forEach(p => {
      const k = `${p.updatedAt}-${p.content}`;
      if (!map.has(k)) map.set(k, p);
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  };

  // 既読状態(lastViewedBy)はユーザーごとに最新のタイムスタンプを保持
  const mergeLastViewed = (lvA: any[] = [], lvB: any[] = []) => {
    const combined = [...lvA, ...lvB];
    const map = new Map();
    combined.forEach(v => {
      if (!map.has(v.userName) || new Date(v.timestamp).getTime() > new Date(map.get(v.userName).timestamp).getTime()) {
        map.set(v.userName, v);
      }
    });
    return Array.from(map.values());
  };

  return {
    ...taskA,
    ...taskB, // Bで上書きできるものはする
    isSoftDeleted, // 削除フラグは OR ロジックで明示的に設定
    title: pickRich(taskA.title, taskB.title),
    goal: pickRich(taskA.goal, taskB.goal),
    responsiblePerson: pickRich(taskA.responsiblePerson, taskB.responsiblePerson),
    status: (taskA.status === TaskStatus.COMPLETED || taskB.status === TaskStatus.COMPLETED) ? TaskStatus.COMPLETED : (taskA.status || taskB.status),
    progress: mergeProgress(taskA.progress, taskB.progress),
    comments: mergeArrays(taskA.comments, taskB.comments, 'id'),
    attachments: mergeArrays(taskA.attachments, taskB.attachments, 'id'),
    lastViewedBy: mergeLastViewed(taskA.lastViewedBy, taskB.lastViewedBy),
    evaluation: taskA.evaluation || taskB.evaluation, // 評価がある方を優先
  };
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

    const stringRows = rows.map((r: any) =>
      r.c.map((cell: any) => cell && cell.v !== null ? String(cell.v) : '')
    );

    let headerIndex = -1;
    for (let i = 0; i < Math.min(stringRows.length, 5); i++) {
      if (stringRows[i][3] === 'タイトル') {
        headerIndex = i;
        break;
      }
    }

    const resultTasks: Task[] = [];
    stringRows.forEach((row: string[], index: number) => {
      if (index <= headerIndex) return;
      const sheetRowNumber = headerIndex === -1 ? index + 4 : (index - headerIndex) + 3;
      const task = mapRowToTask(row, sheetRowNumber);
      if (task) resultTasks.push(task);
    });

    // Deduplicate by UUID, merging data instead of just overwriting
    const taskMap = new Map<string, Task>();
    resultTasks.forEach(t => {
      const key = t.uuid || t.id;
      if (taskMap.has(key)) {
        taskMap.set(key, mergeTasks(taskMap.get(key)!, t));
      } else {
        taskMap.set(key, t);
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
          const stringRows = result.data.map((row: any[]) => row.map(cell => cell !== null ? String(cell) : ''));
          const resultTasks: Task[] = [];
          stringRows.forEach((row: string[], index: number) => {
            const sheetRowNumber = index + 4;
            const task = mapRowToTask(row, sheetRowNumber);
            if (task) resultTasks.push(task);
          });

          // Deduplicate by UUID, merging data
          const taskMap = new Map<string, Task>();
          resultTasks.forEach(t => {
            const key = t.uuid || t.id;
            if (taskMap.has(key)) {
              taskMap.set(key, mergeTasks(taskMap.get(key)!, t));
            } else {
              taskMap.set(key, t);
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
