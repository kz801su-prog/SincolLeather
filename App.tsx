import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  List, Calendar, Settings, RefreshCw, Plus, Search,
  CloudUpload, BrainCircuit, X, LayoutGrid, Loader2,
  Armchair, ShieldCheck, Users, Trash2, UserPlus, Lock, CheckCircle, AlertTriangle, LogOut, Link as LinkIcon, Activity, History,
  FileCode, Copy, Check, Award, Briefcase, Edit2, Bell, Star, TrendingUp, Target, CheckCircle2, Trash
} from 'lucide-react';
import { Task, TaskStatus, TaskPriority, MemberInfo, TaskComment, ProjectConcept, Attachment } from './types';
import { fetchTasksFromSheet, syncAllTasksToSheet, saveSingleTaskToSheet, saveProjectConceptToSheet, saveEpicsToSheet, cleanupSheet } from './googleSheetsService';
import { analyzeProgress } from './geminiService';
import { DashboardCards } from './components/DashboardCards';
import { TaskItem } from './components/TaskItem';
import { TimelineView } from './components/TimelineView';
import { MatrixView } from './components/MatrixView';
import { EvaluationView } from './components/EvaluationView';
import { EpicListView } from './components/EpicListView';
import { ActivityFeed } from './components/ActivityFeed';
import { DEFAULT_GAS_URL, INITIAL_TASKS, DEFAULT_CLIQ_URL, MEMBERS as INITIAL_MEMBERS, ADMIN_USER_NAME, SHEET_GID, DEFAULT_PROJECTS } from './constants';

import GAS_CODE from './server/Code.js?raw';

const APP_VERSION = "v12.2-CLEANUP-FIX";

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline' | 'matrix' | 'evaluation' | 'activity'>('list');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'concept' | 'notifications' | 'members' | 'evaluation' | 'evaluation_tasks' | 'epics'>('general');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [initialTaskTab, setInitialTaskTab] = useState<'basic' | 'chat' | 'files' | 'hierarchy'>('basic');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // GAS URLの二重化を自動修正するサニタイザー
  const sanitizeGasUrl = (url: string | null): string => {
    if (!url) return DEFAULT_GAS_URL;
    // URLが二重に結合されている場合を検出・修正 (例: ...exechttps://...exec → ...exec)
    const execIndex = url.indexOf('/exec');
    if (execIndex !== -1 && url.indexOf('https://', execIndex) !== -1) {
      const cleanUrl = url.substring(0, execIndex + '/exec'.length);
      console.warn('[URL Fix] Doubled GAS URL detected and fixed:', url, '->', cleanUrl);
      localStorage.setItem('board_gas_url', cleanUrl);
      return cleanUrl;
    }
    return url.trim();
  };

  const [settings, setSettings] = useState(() => {
    let savedGasUrl = sanitizeGasUrl(localStorage.getItem('board_gas_url'));
    if (savedGasUrl === 'https://script.google.com/macros/s/AKfycbxB6_zkrGd6_zZWuO7097Fyv0Pz7MOPsVA7Vp5fd8lKnxqlnzbcElQWkSq1cZWyevuK/exec') {
      savedGasUrl = DEFAULT_GAS_URL;
      localStorage.setItem('board_gas_url', DEFAULT_GAS_URL);
    }
    return {
      gasUrl: savedGasUrl ?? DEFAULT_GAS_URL,
      cliqUrl: localStorage.getItem('board_cliq_url') ?? DEFAULT_CLIQ_URL,
      reportTime: localStorage.getItem('board_report_time') || 'Monday 08:00',
      userName: localStorage.getItem('board_user_name') || ''
    };
  });

  const [members, setMembers] = useState<MemberInfo[]>(() => {
    const saved = localStorage.getItem('board_members_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) { }
    }
    return INITIAL_MEMBERS;
  });

  const isAdmin = useMemo(() => {
    const isSpecialAdmin = settings.userName.trim() === ADMIN_USER_NAME;
    const memberAdmin = members.find(m => m.name === settings.userName.trim())?.role === 'admin';
    return isSpecialAdmin || memberAdmin;
  }, [settings.userName, members]);

  const [epics, setEpics] = useState<string[]>(() => {
    const saved = localStorage.getItem('board_epics');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) { }
    }
    return DEFAULT_PROJECTS;
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [showEpicList, setShowEpicList] = useState(false);
  const [showConceptModal, setShowConceptModal] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState<{ show: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [messageModal, setMessageModal] = useState<{ show: boolean; title: string; message: string } | null>(null);
  const [timelineSelectedTaskId, setTimelineSelectedTaskId] = useState<string | null>(null);

  const [newEpicName, setNewEpicName] = useState('');
  const [editingEpicIdx, setEditingEpicIdx] = useState<number | null>(null);
  const [editingEpicName, setEditingEpicName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'user'>('user');
  const [editingMemberRole, setEditingMemberRole] = useState<'admin' | 'user'>('user');

  const [projectConcept, setProjectConcept] = useState<ProjectConcept>(() => {
    const saved = localStorage.getItem('board_project_concept');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) { }
    }
    return { name: 'Sincol Leather 2027', content: '', attachments: [] };
  });

  const handleUpdateProjectConcept = async (newConcept: ProjectConcept) => {
    setProjectConcept(newConcept);
    localStorage.setItem('board_project_concept', JSON.stringify(newConcept));
    try {
      await saveProjectConceptToSheet(newConcept, settings.gasUrl);
    } catch (e) {
      console.error("Failed to save project concept:", e);
    }
  };

  const totalUnreadCount = useMemo(() => {
    if (!settings.userName) return 0;
    return tasks.reduce((count, task) => {
      const userView = task.lastViewedBy?.find(v => v.userName === settings.userName);
      const lastViewTime = userView ? new Date(userView.timestamp).getTime() : 0;

      const hasNewProgress = task.progress?.some(p => new Date(p.updatedAt).getTime() > lastViewTime && p.author !== settings.userName);
      const hasNewComment = task.comments?.some(c => new Date(c.createdAt).getTime() > lastViewTime && c.author !== settings.userName);

      return (hasNewProgress || hasNewComment) ? count + 1 : count;
    }, 0);
  }, [tasks, settings.userName]);

  const saveQueueRef = useRef<Map<string, Task>>(new Map());
  const isSavingRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processQueue = useCallback(async () => {
    if (isSavingRef.current || saveQueueRef.current.size === 0) return;

    isSavingRef.current = true;
    
    // キューから最初のタスクを取得
    const nextEntry = saveQueueRef.current.entries().next().value;
    if (!nextEntry) {
      isSavingRef.current = false;
      return;
    }
    const [taskId, taskToSave] = nextEntry;
    saveQueueRef.current.delete(taskId);

    try {
      console.log("[SaveQueue] Executing save for:", taskToSave.title, "uuid:", taskToSave.uuid);
      await saveSingleTaskToSheet(taskToSave, settings.gasUrl, undefined, members, undefined, settings.cliqUrl);
      console.log("[SaveQueue] Save completed for:", taskToSave.title);
    } catch (e: any) {
      setErrorMsg(e.message || "タスクの保存に失敗しました");
      console.error("Save error:", e);
    } finally {
      isSavingRef.current = false;
      // 次のタスクがあれば少し間を置いて実行 (GASのロック解放待ち)
      if (saveQueueRef.current.size > 0) {
        setTimeout(processQueue, 500);
      }
    }
  }, [settings.gasUrl, members, settings.cliqUrl]);

  // セーブキュー: 同時に1つしかPOSTが走らないようにする
  const handleSingleTaskSave = useCallback((task: Task, immediate = false) => {
    if (!settings.gasUrl) {
      if (immediate) {
        setErrorMsg("設定画面でGAS WebアプリのURLを入力してください。保存できません。");
        setShowSettingsModal(true);
      }
      return;
    }

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    const addToQueue = (t: Task) => {
      saveQueueRef.current.set(t.id, t);
      processQueue();
    };

    if (immediate) {
      addToQueue(task);
    } else {
      saveTimeoutRef.current = setTimeout(() => {
        addToQueue(task);
        saveTimeoutRef.current = null;
      }, 1500);
    }
  }, [settings.gasUrl, processQueue]);

  const markAllTasksAsViewed = useCallback(() => {
    if (!settings.userName) return;
    
    setTasks(prevTasks => {
      const now = new Date().toISOString();
      const nextTasks = prevTasks.map(task => {
        const userView = task.lastViewedBy?.find(v => v.userName === settings.userName);
        const lastViewTime = userView ? new Date(userView.timestamp).getTime() : 0;
        const hasNewProgress = task.progress?.some(p => new Date(p.updatedAt).getTime() > lastViewTime && p.author !== settings.userName);
        const hasNewComment = task.comments?.some(c => new Date(c.createdAt).getTime() > lastViewTime && c.author !== settings.userName);

        if (!(hasNewProgress || hasNewComment)) return task;

        const lastViewedBy = [...(task.lastViewedBy || [])];
        const userViewIndex = lastViewedBy.findIndex(v => v.userName === settings.userName);
        
        let updatedLastViewedBy;
        if (userViewIndex !== -1) {
          updatedLastViewedBy = [...lastViewedBy];
          updatedLastViewedBy[userViewIndex] = { ...lastViewedBy[userViewIndex], timestamp: now };
        } else {
          updatedLastViewedBy = [...lastViewedBy, { userId: settings.userName, userName: settings.userName, timestamp: now }];
        }
        
        const updatedTask = { ...task, lastViewedBy: updatedLastViewedBy };
        handleSingleTaskSave(updatedTask, true);
        return updatedTask;
      });
      return nextTasks;
    });
  }, [settings.userName, handleSingleTaskSave]);

  const markTaskAsViewed = useCallback((taskId: string) => {
    if (!settings.userName) return;

    setTasks(prevTasks => {
      const taskIndex = prevTasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) return prevTasks;

      const task = prevTasks[taskIndex];
      
      // 既読時間を計算 (現在の時刻と、タスク内の最新更新時刻の大きい方を使う)
      // これにより、端末間の時刻ズレでNewマークが消えない問題を回避する
      let latestActivityTime = new Date().getTime();
      if (task.progress) {
        task.progress.forEach(p => {
          const d = new Date(p.updatedAt).getTime();
          if (!isNaN(d) && d > latestActivityTime) latestActivityTime = d;
        });
      }
      if (task.comments) {
        task.comments.forEach(c => {
          const d = new Date(c.createdAt).getTime();
          if (!isNaN(d) && d > latestActivityTime) latestActivityTime = d;
        });
      }
      
      const now = new Date(latestActivityTime).toISOString();

      const lastViewedBy = [...(task.lastViewedBy || [])];
      const userViewIndex = lastViewedBy.findIndex(v => v.userName === settings.userName);

      let updatedLastViewedBy;
      if (userViewIndex !== -1) {
        updatedLastViewedBy = [...lastViewedBy];
        updatedLastViewedBy[userViewIndex] = { ...lastViewedBy[userViewIndex], timestamp: now };
      } else {
        updatedLastViewedBy = [...lastViewedBy, { userId: settings.userName, userName: settings.userName, timestamp: now }];
      }

      const updatedTask = { ...task, lastViewedBy: updatedLastViewedBy };
      
      // 保存を実行 (updaterの中で直接呼ぶのではなく、副作用として扱うのが理想だが、
      // ここでは確実に最新のupdatedTaskを渡すために、handleSingleTaskSaveを呼ぶ)
      handleSingleTaskSave(updatedTask, true);

      const nextTasks = [...prevTasks];
      nextTasks[taskIndex] = updatedTask;
      return nextTasks;
    });
  }, [settings.userName, handleSingleTaskSave]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const fetched = await fetchTasksFromSheet(settings.gasUrl);
      setTasks(fetched.tasks);
      if (fetched.projectConcept) {
        setProjectConcept(fetched.projectConcept);
      }
      if (fetched.epics && fetched.epics.length > 0) {
        setEpics(fetched.epics);
      } else {
        // GAS側が空（まだ一度も保存されていない）場合はデフォルト値またはローカル値を使う
        setEpics(prev => prev.length > 0 ? prev : DEFAULT_PROJECTS);
      }
      setIsInitialLoadDone(true);
    } catch (e: any) {
      setErrorMsg("スプレッドシートの読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [settings.gasUrl]);

  useEffect(() => {
    if (settings.userName) {
      const timer = setTimeout(() => {
        loadData();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loadData, settings.userName]);

  useEffect(() => {
    localStorage.setItem('board_members_v2', JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    localStorage.setItem('board_epics', JSON.stringify(epics));
  }, [epics]);

  useEffect(() => {
    localStorage.setItem('board_project_concept', JSON.stringify(projectConcept));
  }, [projectConcept]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(GAS_CODE);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const executePushAll = async (currentTasks = tasks, currentMembers = members, currentProjectConcept = projectConcept) => {
    setLoading(true);
    try {
      await syncAllTasksToSheet(currentTasks, settings.gasUrl, undefined, currentMembers, undefined, settings.cliqUrl, currentProjectConcept);
    } catch (e) {
      setErrorMsg('保存エラーが発生しました。');
    } finally {
      setLoading(false);
      setShowPushConfirm(false);
    }
  };

  const handlePushAll = (currentTasks = tasks, currentMembers = members, currentProjectConcept = projectConcept, skipConfirm = false) => {
    if (!settings.gasUrl) {
      setErrorMsg("設定画面でGAS WebアプリのURLを入力してください。");
      setShowSettingsModal(true);
      return;
    }
    if (currentTasks.length === 0) {
      setErrorMsg("タスクが0件のため、上書きを中止しました。");
      return;
    }
    if (skipConfirm) {
      executePushAll(currentTasks, currentMembers, currentProjectConcept);
    } else {
      setShowPushConfirm(true);
    }
  };

  const updateTaskAndSave = useCallback((taskId: string, updater: (task: Task) => Task, saveMode: 'immediate' | 'debounced' | 'none' = 'debounced') => {
    setTasks(prev => {
      const taskIndex = prev.findIndex(t => t.id === taskId);
      if (taskIndex === -1) return prev;

      const updatedTask = updater(prev[taskIndex]);
      
      if (saveMode !== 'none') {
        handleSingleTaskSave(updatedTask, saveMode === 'immediate');
      }

      const nextTasks = [...prev];
      nextTasks[taskIndex] = updatedTask;
      return nextTasks;
    });
  }, [handleSingleTaskSave]);

  const addTask = (overrides?: Partial<Task>) => {
    setSearchTerm('');
    setViewMode('list');

    const newTaskId = `new-${Date.now()}`;
    const newTask: Task = {
      id: newTaskId,
      date: new Date().toISOString().split('T')[0],
      department: '未設定',
      project: '未分類',
      responsiblePerson: settings.userName,
      team: [],
      title: '新規タスク',
      isSoftDeleted: false,
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      progress: [],
      milestones: [],
      comments: [],
      attachments: [],
      lastViewedBy: [{ userId: settings.userName, userName: settings.userName, timestamp: new Date().toISOString() }],
      dueDate: '',
      evaluation: undefined,
      uuid: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      trackId: `track-${Date.now()}`,
      hierarchyType: 'root',
      ...overrides
    };

    setTasks(prev => [...prev, newTask]);
    markTaskAsViewed(newTaskId);
    setTimeout(() => handleSingleTaskSave(newTask, true), 100);
  };

  const addSubTask = (parentId: string) => {
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) return;

    addTask({
      parentId: parent.uuid || parent.id,
      hierarchyType: 'subtask',
      project: parent.project || '未分類',
      trackId: `track-sub-${Date.now()}`,
      title: `[子] ${parent.title} の作業`
    });
  };

  const addSiblingTask = (predecessorId: string) => {
    const pred = tasks.find(t => t.id === predecessorId);
    if (!pred) return;

    addTask({
      parentId: pred.parentId,
      hierarchyType: 'sibling',
      project: pred.project,
      trackId: pred.trackId,
      dependencies: [pred.uuid || pred.id],
      title: `[続] ${pred.title} の次工程`,
      startDate: pred.dueDate || pred.date
    });
  };

  const updateTask = (updatedTask: Task) => {
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  const updateTasks = (updatedTasks: Task[]) => {
    const updatedIds = new Set(updatedTasks.map(t => t.id));
    setTasks(prev => {
      const filtered = prev.filter(t => !updatedIds.has(t.id));
      return [...filtered, ...updatedTasks];
    });
  };

  const softDeleteTask = (taskId: string) => {
    updateTaskAndSave(taskId, t => ({ ...t, isSoftDeleted: true }), 'immediate');
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const executeLogout = () => {
    localStorage.removeItem('board_user_name');
    setTasks([]);
    setIsInitialLoadDone(false);
    setSettings(prev => ({ ...prev, userName: '' }));
    setShowLogoutModal(false);
    window.location.reload();
  };

  const filteredTasks = useMemo(() => {
    // 1. Initial filter based on search and epic
    const matchesInitial = tasks.filter(t => {
      if (t.isSoftDeleted) return false;
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        t.title.toLowerCase().includes(searchLower) ||
        t.responsiblePerson.toLowerCase().includes(searchLower) ||
        t.project.toLowerCase().includes(searchLower) ||
        t.department.toLowerCase().includes(searchLower) ||
        (t.description || '').toLowerCase().includes(searchLower) ||
        (t.goal || '').toLowerCase().includes(searchLower) ||
        t.team.some(m => m.toLowerCase().includes(searchLower)) ||
        t.progress.some(p => p.content.toLowerCase().includes(searchLower)) ||
        t.comments.some(c => c.content.toLowerCase().includes(searchLower)) ||
        t.attachments.some(a => a.name.toLowerCase().includes(searchLower)) ||
        t.milestones.some(m => m.title.toLowerCase().includes(searchLower));

      const matchesEpic = epicFilter ? (t.project === epicFilter) : true;
      return matchesSearch && matchesEpic;
    });

    // 2. Ancestor Expansion: If a child matches, we must include its ancestors to maintain hierarchy
    const expandedSet = new Set<string>();
    const tasksById = new Map<string, Task>();
    tasks.forEach(t => tasksById.set(t.id, t));
    tasks.forEach(t => { if (t.uuid) tasksById.set(t.uuid, t); });

    const addAncestors = (task: Task) => {
      if (expandedSet.has(task.id)) return;
      expandedSet.add(task.id);
      if (task.parentId) {
        const parent = tasksById.get(task.parentId.trim());
        if (parent) addAncestors(parent);
      }
    };

    const addDescendants = (task: Task) => {
      expandedSet.add(task.id);
      const children = tasks.filter(t => !t.isSoftDeleted && t.parentId?.trim() === (task.uuid || task.id));
      children.forEach(child => {
        if (!expandedSet.has(child.id)) {
          addDescendants(child);
        }
      });
    };

    matchesInitial.forEach(t => {
      addAncestors(t);
      addDescendants(t);
    });

    const baseFiltered = tasks.filter(t => expandedSet.has(t.id));

    // 3. Build Hierarchy
    const roots = baseFiltered.filter(t => {
      const pId = t.parentId?.trim();
      return !pId || !baseFiltered.find(p => (p.uuid === pId || p.id === pId));
    });

    const result: (Task & { depth: number; isLastChild?: boolean })[] = [];
    const visited = new Set<string>();

    const sortTasks = (taskList: Task[]) => {
      return [...taskList].sort((a, b) => {
        // Completed tasks at the bottom
        if (a.status === TaskStatus.COMPLETED && b.status !== TaskStatus.COMPLETED) return 1;
        if (a.status !== TaskStatus.COMPLETED && b.status === TaskStatus.COMPLETED) return -1;
        
        // Then by date
        const dateA = new Date(a.startDate || a.date).getTime();
        const dateB = new Date(b.startDate || b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;

        // Finally by title
        return a.title.localeCompare(b.title);
      });
    };

    const addWithChildren = (parent: Task, depth = 0) => {
      if (depth > 10) return;

      const children = baseFiltered.filter(t => {
        const pId = t.parentId?.trim();
        if (!pId) return false;
        return pId === parent.uuid || pId === parent.id;
      });
      
      const sortedChildren = sortTasks(children);

      sortedChildren.forEach((child, index) => {
        if (visited.has(child.id)) return;
        visited.add(child.id);
        
        const childHasChildren = baseFiltered.some(t => {
          const pId = t.parentId?.trim();
          return pId === child.uuid || pId === child.id;
        });

        result.push({ 
          ...child, 
          depth, 
          isLastChild: index === sortedChildren.length - 1,
          hasChildren: childHasChildren 
        } as any);
        addWithChildren(child, depth + 1);
      });
    };

    const sortedRoots = sortTasks(roots);

    sortedRoots.forEach((root, index) => {
      if (visited.has(root.id)) return;
      visited.add(root.id);
      
      const rootHasChildren = baseFiltered.some(t => {
        const pId = t.parentId?.trim();
        return pId === root.uuid || pId === root.id;
      });

      result.push({ 
        ...root, 
        depth: 0, 
        isLastChild: index === sortedRoots.length - 1,
        hasChildren: rootHasChildren
      } as any);
      addWithChildren(root, 1);
    });

    return result;
  }, [tasks, searchTerm, epicFilter]);

  const stats = useMemo(() => {
    const activeTasks = tasks.filter(t => !t.isSoftDeleted);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    return {
      total: activeTasks.length,
      rootCount: activeTasks.filter(t => t.status !== TaskStatus.COMPLETED && t.hierarchyType !== 'subtask').length,
      subCount: activeTasks.filter(t => t.status !== TaskStatus.COMPLETED && t.hierarchyType === 'subtask').length,
      completed: activeTasks.filter(t => t.status === TaskStatus.COMPLETED).length,
      pending: activeTasks.filter(t => t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.TODO).length,
      overdue: activeTasks.filter(t => {
        if (t.status === TaskStatus.COMPLETED) return false;
        if (t.status === TaskStatus.OVERDUE) return true;
        return t.dueDate && t.dueDate < todayStr;
      }).length,
      epics: new Set(activeTasks.map(t => t.project).filter(p => p && p !== '未分類')).size
    };
  }, [tasks]);

  const handleAiAnalyze = async () => {
    setIsAiAnalyzing(true);
    try {
      const result = await analyzeProgress(tasks);
      setMessageModal({
        show: true,
        title: 'AI分析結果',
        message: result
      });
    } catch (e) {
      setErrorMsg('AI分析に失敗しました。');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  if (!settings.userName) {
    const storedPassword = localStorage.getItem('board_password');
    const isFirstTime = !storedPassword;

    const handleLoginSubmit = () => {
      const nameInput = document.getElementById('manual-login-name') as HTMLInputElement;
      const selectName = (document.getElementById('select-login-name') as HTMLSelectElement).value;
      const passwordInput = document.getElementById('login-password') as HTMLInputElement;

      const name = nameInput.value.trim() || selectName;
      const password = passwordInput.value.trim();

      if (!name) {
        setErrorMsg('名前を選択または入力してください。');
        return;
      }

      if (!password) {
        setErrorMsg('パスワードを入力してください。');
        return;
      }

      if (isFirstTime) {
        localStorage.setItem('board_password', password);
        localStorage.setItem('board_user_name', name);
        setSettings({
          ...settings,
          userName: name,
          gasUrl: localStorage.getItem('board_gas_url') || DEFAULT_GAS_URL
        });
      } else {
        if (password === storedPassword) {
          localStorage.setItem('board_user_name', name);
          setSettings({
            ...settings,
            userName: name,
            gasUrl: localStorage.getItem('board_gas_url') || DEFAULT_GAS_URL
          });
        } else {
          setErrorMsg('パスワードが正しくありません。');
        }
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md w-full border border-slate-100">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg bg-red-600">
              <Armchair className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-black text-center mb-2">{projectConcept.name || 'Project MGT'}</h1>
          <p className="text-xs text-slate-400 text-center font-bold mb-8 uppercase tracking-widest">
            {isFirstTime ? '初期パスワード設定' : 'ログイン'}
          </p>

          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block">名前を選択</label>
              <select
                id="select-login-name"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-red-500"
                defaultValue=""
              >
                <option value="" disabled>名前を選択してください</option>
                {members.map((m, i) => (
                  <option key={i} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold">または</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block">名前を直接入力</label>
              <input
                type="text"
                id="manual-login-name"
                className="w-full p-4 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-red-500"
                placeholder="例: 山田太郎"
              />
            </div>

            <div className="pt-4 border-t border-slate-100">
              <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block">
                {isFirstTime ? '設定するパスワード' : 'パスワード'}
              </label>
              <input
                type="password"
                id="login-password"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-red-500"
                placeholder="パスワードを入力"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLoginSubmit();
                }}
              />
              {isFirstTime && <p className="text-[9px] text-red-400 mt-2 font-bold">※ 次回からこのパスワードが必要になります。</p>}
            </div>

            <button
              onClick={handleLoginSubmit}
              className="w-full mt-3 bg-red-600 text-white p-4 rounded-xl font-bold text-sm hover:bg-red-700 transition-all shadow-lg active:scale-95"
            >
              {isFirstTime ? 'パスワードを設定してログイン' : 'ログイン'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <div className={`text-white text-[12px] font-black py-2.5 px-4 text-center tracking-[0.2em] flex items-center justify-center gap-4 sticky top-0 z-[100] shadow-2xl border-b ${isAdmin ? 'bg-amber-600 border-amber-400' : 'bg-slate-800 border-slate-700'}`}>
        {isAdmin ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
        <span>
          {isAdmin ? `矢追様 管理者ログイン中 (評価機能 有効)` : `ユーザー: ${settings.userName}`}
        </span>
        <button
          onClick={() => handleLogout()}
          className="ml-4 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-[10px] transition-all flex items-center gap-1"
        >
          <LogOut className="w-3 h-3" /> ログアウト
        </button>
      </div>

      <div className="max-w-[1400px] mx-auto p-4 md:p-8">
        {errorMsg && (
          <div className="mb-6 bg-rose-50 border-2 border-rose-200 p-6 rounded-[2rem] flex flex-col md:flex-row items-center gap-6 text-rose-700 shadow-xl">
            <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 flex-shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <p className="font-black text-sm mb-1">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSettingsModal(true)}
                className="px-6 py-3 bg-white border border-rose-200 text-rose-600 rounded-xl font-black text-xs hover:bg-rose-100 transition-all"
              >
                設定を確認
              </button>
              <button
                onClick={loadData}
                className="px-6 py-3 bg-rose-600 text-white rounded-xl font-black text-xs hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
              >
                再試行
              </button>
            </div>
          </div>
        )}

        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="flex items-center space-x-4 cursor-pointer group" onClick={() => setShowConceptModal(true)}>
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-red-600 group-hover:scale-105 transition-all"><Armchair className="w-6 h-6 text-white" /></div>
              {totalUnreadCount > 0 && (
                <div 
                  className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-lg animate-bounce cursor-pointer hover:bg-red-600 hover:scale-110 transition-all z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const firstUnreadTask = tasks.find(task => {
                      const userView = task.lastViewedBy?.find(v => v.userName === settings.userName);
                      const lastViewTime = userView ? new Date(userView.timestamp).getTime() : 0;
                      const hasNewProgress = task.progress?.some(p => new Date(p.updatedAt).getTime() > lastViewTime && p.author !== settings.userName);
                      const hasNewComment = task.comments?.some(c => new Date(c.createdAt).getTime() > lastViewTime && c.author !== settings.userName);
                      return hasNewProgress || hasNewComment;
                    });
                    if (firstUnreadTask) {
                      setViewMode('list');
                      setSearchTerm('');
                      setEpicFilter(null);
                      setExpandedTaskId(firstUnreadTask.id);
                      setTimeout(() => {
                        document.getElementById(firstUnreadTask.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }
                  }}
                  title="未読のタスクへ移動"
                >
                  {totalUnreadCount}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black group-hover:text-red-600 transition-colors">{projectConcept.name || 'Project MGT'}</h1>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-black bg-red-100 text-red-600`}>
                  {APP_VERSION}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Sincol Leather 2027</p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-white shadow text-red-600' : 'text-slate-400'}`} title="リストビュー"><List className="w-5 h-5" /></button>
              <button onClick={() => setViewMode('timeline')} className={`p-2 rounded-lg ${viewMode === 'timeline' ? 'bg-white shadow text-red-600' : 'text-slate-400'}`} title="タイムライン"><Calendar className="w-5 h-5" /></button>
              <button onClick={() => setViewMode('matrix')} className={`p-2 rounded-lg ${viewMode === 'matrix' ? 'bg-white shadow text-red-600' : 'text-slate-400'}`} title="マトリックス"><LayoutGrid className="w-5 h-5" /></button>
              {isAdmin && <button onClick={() => setViewMode('evaluation')} className={`p-2 rounded-lg ${viewMode === 'evaluation' ? 'bg-white shadow text-red-600' : 'text-slate-400'}`} title="評価"><Award className="w-5 h-5" /></button>}
              <button onClick={() => setViewMode('activity')} className={`p-2 rounded-lg ${viewMode === 'activity' ? 'bg-white shadow text-red-600' : 'text-slate-400'}`} title="履歴"><History className="w-5 h-5" /></button>
            </div>

            <button onClick={() => {
              const searchInput = document.getElementById('task-search-input');
              if (searchInput) {
                searchInput.focus();
                searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }} className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-600 shadow-sm transition-all" title="検索">
              <Search className="w-5 h-5" />
            </button>

            <button onClick={handleAiAnalyze} className="p-3 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 shadow-sm transition-all" title="AI分析">
              {isAiAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
            </button>

            <button onClick={loadData} className="p-3 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 shadow-sm" title="更新"><RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} /></button>
            
            {totalUnreadCount > 0 && (
              <button onClick={markAllTasksAsViewed} className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl hover:bg-red-100 shadow-sm transition-all" title="すべて既読にする">
                <CheckCircle2 className="w-5 h-5" />
              </button>
            )}

            <button onClick={() => addTask()} className="bg-slate-900 text-white px-5 py-3 rounded-xl font-black text-xs flex items-center gap-2 shadow-lg active:scale-95 transition-all hover:bg-slate-800">
              <Plus className="w-4 h-4" /> 新規
            </button>

            <button onClick={() => setShowSettingsModal(true)} className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-600 transition-all" title="設定">
              <Settings className="w-5 h-5" />
            </button>

            <button onClick={() => handleLogout()} className="p-3 bg-rose-50 border border-rose-100 text-rose-500 rounded-xl hover:bg-rose-100 shadow-sm transition-all" title="ログアウト">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <DashboardCards
          stats={stats}
          onEpicClick={() => setShowEpicList(true)}
          onTotalClick={() => setEpicFilter(null)}
        />

        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="task-search-input"
            type="text"
            placeholder="タスク検索..."
            className="w-full pl-10 pr-4 py-4 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-red-500 shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          {!isInitialLoadDone && loading && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 bg-white rounded-[2rem] border border-slate-100 shadow-sm">
              <div className="w-20 h-20 border-4 border-slate-100 border-t-red-600 rounded-full animate-spin"></div>
              <h2 className="text-xl font-black text-slate-800 mt-8">データを読み込み中</h2>
            </div>
          ) : (
            <>
              {viewMode === 'list' && (
                filteredTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    members={members}
                    depth={(task as any).depth}
                    isLastChild={(task as any).isLastChild}
                    hasChildren={(task as any).hasChildren}
                    isInitiallyExpanded={expandedTaskId === task.id}
                    initialTab={expandedTaskId === task.id ? initialTaskTab : 'basic'}
                    autoEditTitle={editingTaskId === task.id}
                    isAdmin={isAdmin}
                    currentUserName={settings.userName}
                    onUpdateTaskDetails={(tid, details) => {
                      // タイトル変更は遅延保存（保存ボタンで即時保存される）
                      const isImmediate = !!details.attachments || !!details.status;
                      updateTaskAndSave(tid, t => ({ ...t, ...details }), isImmediate ? 'immediate' : 'none');
                      if (details.title) setEditingTaskId(null);
                    }}
                    onUpdateStatus={(tid, status) => {
                      updateTaskAndSave(tid, t => ({ ...t, status }), 'immediate');
                    }}
                    onUpdatePriority={(tid, priority) => {
                      updateTaskAndSave(tid, t => ({ ...t, priority }), 'immediate');
                    }}
                    onAddProgress={async (tid, content) => {
                      updateTaskAndSave(tid, t => {
                        const newP = { week: t.progress.length + 1, content, updatedAt: new Date().toISOString(), author: settings.userName };
                        return { ...t, progress: [newP, ...t.progress] };
                      }, 'immediate');
                    }}
                    onAddComment={async (tid, content) => {
                      updateTaskAndSave(tid, t => {
                        const newC: TaskComment = { id: Date.now().toString(), content, author: settings.userName, createdAt: new Date().toISOString() };
                        return { ...t, comments: [...(t.comments || []), newC] };
                      }, 'immediate');
                    }}
                    onMarkAsViewed={() => markTaskAsViewed(task.id)}
                    onManualSync={async (t) => {
                      updateTaskAndSave(t.id, task => task, 'immediate');
                    }}
                    onDeleteTask={softDeleteTask}
                    onAddSubTask={addSubTask}
                    onAddSiblingTask={addSiblingTask}
                    epics={epics}
                    allTasks={tasks}
                    onShowConfirm={(title, msg, onConfirm) => {
                      setShowCleanupConfirm({
                        show: true,
                        title,
                        message: msg,
                        onConfirm
                      });
                    }}
                    onShowMessage={(title, msg) => {
                      setMessageModal({
                        show: true,
                        title,
                        message: msg
                      });
                    }}
                  />
                ))
              )}

              {viewMode === 'activity' && (
                <ActivityFeed tasks={tasks} onTaskClick={(id, type) => {
                  setViewMode('list');
                  setSearchTerm('');
                  setEpicFilter(null);
                  setExpandedTaskId(null);
                  setTimeout(() => {
                    setExpandedTaskId(id);
                    setInitialTaskTab(type === 'comment' ? 'chat' : 'basic');
                    const el = document.getElementById(`task-${id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
                }} />
              )}

              {viewMode === 'matrix' && <MatrixView tasks={tasks.filter(t => !t.isSoftDeleted)} />}

              {viewMode === 'timeline' && (
                <TimelineView
                  tasks={tasks}
                  members={members}
                  onUpdateTask={updateTask}
                  onUpdateTasks={updateTasks}
                  onSoftDeleteTask={softDeleteTask}
                  onAddTask={(date) => addTask({ startDate: date, dueDate: date })}
                  currentUserName={settings.userName}
                  isAdmin={isAdmin}
                  onMarkAsViewed={markTaskAsViewed}
                  onEditTaskFromTimeline={(taskId) => setTimelineSelectedTaskId(taskId)}
                  onShowConfirm={(title, msg, onConfirm) => {
                    setShowCleanupConfirm({
                      show: true,
                      title,
                      message: msg,
                      onConfirm
                    });
                  }}
                  onShowMessage={(title, msg) => {
                    setMessageModal({
                      show: true,
                      title,
                      message: msg
                    });
                  }}
                />
              )}

              {viewMode === 'evaluation' && (
                <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
                  <EvaluationView
                    tasks={tasks}
                    members={members}
                    isAdmin={isAdmin}
                    currentUserName={settings.userName}
                    isTopPage={true}
                    projectConcept={projectConcept}
                    onTaskClick={(taskId) => {
                      setViewMode('list');
                      setSearchTerm('');
                      setEpicFilter(null);
                      setExpandedTaskId(null);
                      setTimeout(() => {
                        setExpandedTaskId(taskId);
                        setInitialTaskTab('basic');
                      }, 100);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {showSettingsModal && (
          <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-200 max-h-[90vh] flex flex-col">
              <div className="p-8 border-b flex justify-between items-center bg-slate-50/50 flex-shrink-0">
                <h2 className="font-black text-xl flex items-center gap-3"><Settings className="w-6 h-6 text-red-600" /> 設定</h2>
                <button onClick={() => setShowSettingsModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-all"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex bg-slate-50 border-b overflow-x-auto custom-scrollbar">
                <button onClick={() => setSettingsTab('general')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'general' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>基本設定</button>
                <button onClick={() => setSettingsTab('concept')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'concept' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>コンセプト</button>
                <button onClick={() => setSettingsTab('notifications')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'notifications' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>通知設定</button>
                {(isAdmin || tasks.some(t => t.responsiblePerson === settings.userName && t.status === TaskStatus.COMPLETED)) && (
                  <button onClick={() => setSettingsTab('evaluation_tasks')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'evaluation_tasks' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>評価</button>
                )}
                <button onClick={() => setSettingsTab('evaluation')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'evaluation' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>評価結果</button>
                {isAdmin && <button onClick={() => setSettingsTab('members')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'members' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>メンバー</button>}
                {isAdmin && <button onClick={() => setSettingsTab('epics')} className={`flex-1 py-4 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${settingsTab === 'epics' ? 'bg-white text-red-600 border-b-2 border-red-600' : 'text-slate-400 hover:text-slate-600'}`}>エピック</button>}
              </div>

              <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
                {settingsTab === 'general' && (
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-500 uppercase">GAS Web App URL</label>
                      <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500" value={settings.gasUrl} onChange={e => setSettings({ ...settings, gasUrl: e.target.value })} />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-500 uppercase">Cliq Webhook URL</label>
                      <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500" value={settings.cliqUrl} onChange={e => setSettings({ ...settings, cliqUrl: e.target.value })} />
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-slate-500 uppercase">GASコード ({APP_VERSION})</label>
                        <button onClick={() => {
                          navigator.clipboard.writeText(GAS_CODE);
                          setMessageModal({
                            show: true,
                            title: 'コピー完了',
                            message: 'GASコードをコピーしました。GASエディタに貼り付けて新しいデプロイを作成してください。'
                          });
                        }} className="text-[10px] font-black bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-all">コピー</button>
                      </div>
                      <pre className="w-full p-4 bg-slate-900 text-slate-100 rounded-xl text-[10px] font-mono overflow-x-auto h-64">
                        {GAS_CODE}
                      </pre>
                    </div>

                    {isAdmin && (
                      <div className="pt-6 border-t border-slate-100">
                        <div className="flex flex-col gap-3">
                          <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
                            <Trash className="w-3 h-3 text-red-500" /> スプレッドシートの掃除
                          </label>
                          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                            削除済み(SOFT_DELETE)の行を物理的に削除し、重複したタスクを整理します。<br />
                            ※この操作は元に戻せません。実行前にバックアップを推奨します。
                          </p>
                          <button
                            onClick={async () => {
                              console.log("[Cleanup] Button clicked. GAS URL:", settings.gasUrl);
                              if (!settings.gasUrl) {
                                setErrorMsg('GAS URLが設定されていません。');
                                return;
                              }
                              setShowCleanupConfirm({
                                show: true,
                                title: 'スプレッドシートの掃除',
                                message: 'スプレッドシート上の削除済みタスクと重複タスクを完全に削除します。この操作は元に戻せません。よろしいですか？',
                                onConfirm: async () => {
                                  try {
                                    setLoading(true);
                                    console.log("[Cleanup] Starting cleanup process...");
                                    await cleanupSheet(settings.gasUrl);
                                    console.log("[Cleanup] Request sent successfully.");
                                    setMessageModal({
                                      show: true,
                                      title: '送信完了',
                                      message: 'スプレッドシートの掃除命令を送信しました。シートの整理には数秒かかる場合があります。完了後、自動的に再読み込みします。'
                                    });
                                    setTimeout(() => window.location.reload(), 3000);
                                  } catch (e: any) {
                                    console.error("[Cleanup] Error:", e);
                                    setErrorMsg(`掃除に失敗しました: ${e.message}`);
                                  } finally {
                                    setLoading(false);
                                  }
                                }
                              });
                            }}
                            disabled={loading}
                            className="w-fit px-6 py-3 bg-red-50 text-red-600 rounded-xl font-black text-xs hover:bg-red-100 transition-all flex items-center gap-2 disabled:opacity-50"
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash className="w-4 h-4" />}
                            掃除を実行する
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {settingsTab === 'concept' && (
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase">プロジェクト名</label>
                    <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500" value={projectConcept.name} onChange={e => setProjectConcept({ ...projectConcept, name: e.target.value })} />
                    <label className="text-[10px] font-black text-slate-500 uppercase">コンセプト詳細</label>
                    <textarea className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500 h-32" value={projectConcept.content} onChange={e => setProjectConcept({ ...projectConcept, content: e.target.value })} />
                    <button onClick={async () => {
                      await saveProjectConceptToSheet(projectConcept, settings.gasUrl);
                      localStorage.setItem('board_project_concept', JSON.stringify(projectConcept));
                      setMessageModal({
                        show: true,
                        title: '保存完了',
                        message: 'プロジェクトコンセプトをスプレッドシートに保存しました。'
                      });
                    }} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800 transition-all">コンセプトを保存</button>
                  </div>
                )}
                {settingsTab === 'notifications' && (
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase">レポート時間</label>
                    <select className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500" value={settings.reportTime} onChange={e => setSettings({ ...settings, reportTime: e.target.value })}>
                      <option value="Monday 08:00">月曜 08:00</option>
                      <option value="Monday 09:00">月曜 09:00</option>
                    </select>
                    <label className="text-[10px] font-black text-slate-500 uppercase">Cliq Webhook URL</label>
                    <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-red-500" value={settings.cliqUrl} onChange={e => setSettings({ ...settings, cliqUrl: e.target.value })} />
                  </div>
                )}
                {settingsTab === 'epics' && isAdmin && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-black text-sm flex items-center gap-2 uppercase tracking-wider text-red-600"><Briefcase className="w-4 h-4" /> エピック管理</h3>
                      <div className="flex items-center gap-2">
                        <input type="text" value={newEpicName} onChange={e => setNewEpicName(e.target.value)} placeholder="新しいエピック名" className="p-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-red-500" />
                        <button onClick={() => {
                          if (newEpicName) {
                            setEpics(prev => {
                              if (prev.includes(newEpicName)) return prev;
                              const next = [...prev, newEpicName];
                              saveEpicsToSheet(next, settings.gasUrl);
                              return next;
                            });
                            setNewEpicName('');
                          }
                        }} className="text-[10px] font-black bg-red-50 text-red-600 px-4 py-2 rounded-lg hover:bg-red-100 transition-all flex items-center gap-1">
                          <Plus className="w-3 h-3" /> 追加
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {epics.map((epic, idx) => (
                        <div key={epic} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                          <span className="text-xs font-bold text-slate-700">{epic}</span>
                          <button onClick={() => {
                            setEpics(prev => {
                              const next = prev.filter((_, i) => i !== idx);
                              saveEpicsToSheet(next, settings.gasUrl);
                              return next;
                            });
                          }} className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {settingsTab === 'evaluation' && (
                  <div className="space-y-4">
                    <h3 className="font-black text-sm flex items-center gap-2 uppercase tracking-wider text-red-600"><Award className="w-4 h-4" /> 評価結果</h3>
                    <EvaluationView tasks={tasks} members={members} isAdmin={isAdmin} currentUserName={settings.userName} projectConcept={projectConcept} />
                  </div>
                )}
                {settingsTab === 'evaluation_tasks' && (isAdmin || tasks.some(t => t.responsiblePerson === settings.userName && t.status === TaskStatus.COMPLETED)) && (
                  <div className="space-y-4">
                    <h3 className="font-black text-sm flex items-center gap-2 uppercase tracking-wider text-red-600"><Target className="w-4 h-4" /> 評価対象タスク</h3>
                    <div className="space-y-4">
                      {tasks.filter(t => !t.isSoftDeleted && t.status === TaskStatus.COMPLETED && (isAdmin || t.responsiblePerson === settings.userName)).map(task => (
                        <div key={task.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
                          <h4 className="text-sm font-bold text-slate-800">{task.title}</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">難易度 (1-100)</label>
                              <input type="number" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-red-500" value={task.evaluation?.difficulty || 50} onChange={e => {
                                const val = parseInt(e.target.value);
                                updateTaskAndSave(task.id, t => {
                                  const currentEval = t.evaluation || { difficulty: 50, outcome: 3, memberEvaluations: [] };
                                  return { ...t, evaluation: { ...currentEval, difficulty: val } };
                                }, 'immediate');
                              }} />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">成果 (1-5)</label>
                              <input type="number" min="1" max="5" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-red-500" value={task.evaluation?.outcome || 3} onChange={e => {
                                const val = parseInt(e.target.value) as 1 | 2 | 3 | 4 | 5;
                                updateTaskAndSave(task.id, t => {
                                  const currentEval = t.evaluation || { difficulty: 50, outcome: 3, memberEvaluations: [] };
                                  return { ...t, evaluation: { ...currentEval, outcome: val } };
                                }, 'immediate');
                              }} />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">メンバー別評価</label>
                            <div className="space-y-2">
                              {members.filter(m => task.team?.includes(m.name)).map(m => {
                                const evalData = task.evaluation?.memberEvaluations?.find(me => me.memberId === m.name);
                                return (
                                  <div key={m.name} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100">
                                    <span className="text-xs font-bold text-slate-700">{m.name}</span>
                                    <div className="flex gap-1">
                                      {[1, 2, 3, 4, 5].map(r => (
                                        <button key={r} onClick={() => {
                                          updateTaskAndSave(task.id, t => {
                                            const currentEval = t.evaluation || { difficulty: 50, outcome: 3, memberEvaluations: [] };
                                            const existingIndex = currentEval.memberEvaluations.findIndex(me => me.memberId === m.name);
                                            let newMemberEvals = [...currentEval.memberEvaluations];
                                            if (existingIndex >= 0) {
                                              newMemberEvals[existingIndex] = { ...newMemberEvals[existingIndex], rating: r as any };
                                            } else {
                                              newMemberEvals.push({ memberId: m.name, rating: r as any });
                                            }
                                            return { ...t, evaluation: { ...currentEval, memberEvaluations: newMemberEvals } };
                                          }, 'immediate');
                                        }} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${evalData?.rating === r ? 'bg-red-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-red-50'}`}>
                                          {r}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                              {(!task.team || task.team.length === 0) && (
                                <p className="text-xs font-bold text-slate-400 italic">チームメンバーが設定されていません</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {settingsTab === 'members' && isAdmin && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-black text-sm flex items-center gap-2 uppercase tracking-wider text-red-600"><Users className="w-4 h-4" /> 評価対象メンバー名簿</h3>
                      <div className="flex items-center gap-2">
                        <input type="text" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} placeholder="新しいメンバー名" className="p-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-red-500" />
                        <button onClick={() => {
                          if (newMemberName) {
                            setMembers(prev => [...prev, { name: newMemberName, email: '', type: 'internal', role: 'user' }]);
                            setNewMemberName('');
                          }
                        }} className="text-[10px] font-black bg-red-50 text-red-600 px-4 py-2 rounded-lg hover:bg-red-100 transition-all flex items-center gap-1">
                          <UserPlus className="w-3 h-3" /> 追加
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {members.map((m, idx) => (
                        <div key={`${m.name}-${idx}`} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                          <span className="text-xs font-bold text-slate-700">{m.name}</span>
                          <div className="flex items-center gap-2">
                            <select
                              value={m.role}
                              onChange={(e) => {
                                const newRole = e.target.value as 'admin' | 'user';
                                setMembers(prev => prev.map((mem, i) => i === idx ? { ...mem, role: newRole } : mem));
                              }}
                              className="text-[10px] font-black bg-white border border-slate-200 rounded-lg p-1 outline-none focus:border-red-500"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button onClick={() => {
                              setMembers(prev => prev.filter((_, i) => i !== idx));
                            }} className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="p-8 border-t flex-shrink-0">
                <button onClick={async () => {
                  localStorage.setItem('board_gas_url', sanitizeGasUrl(settings.gasUrl));
                  localStorage.setItem('board_cliq_url', settings.cliqUrl);
                  localStorage.setItem('board_report_time', settings.reportTime);
                  localStorage.setItem('board_members_v2', JSON.stringify(members));
                  setShowSettingsModal(false);
                  loadData();
                }} className="w-full py-5 bg-red-600 text-white rounded-2xl font-black shadow-xl hover:bg-red-700 transition-all active:scale-95">
                  設定を保存して再読込
                </button>
              </div>
            </div>
          </div>
        )}

        {timelineSelectedTaskId && (() => {
          const t = tasks.find(task => task.id === timelineSelectedTaskId);
          if (!t) return null;
          return (
            <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 lg:p-10" onClick={() => setTimelineSelectedTaskId(null)}>
              <div
                className="w-full max-w-4xl max-h-[95vh] overflow-y-auto custom-scrollbar relative bg-slate-50 rounded-[3rem] p-4 lg:p-8"
                onClick={e => e.stopPropagation()}
              >
                <div className="absolute top-6 right-6 z-[400]">
                  <button onClick={() => setTimelineSelectedTaskId(null)} className="p-3 bg-white text-slate-400 hover:text-red-500 rounded-full shadow-lg border border-slate-100 hover:scale-110 transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <TaskItem
                  task={t}
                  members={members}
                  depth={0}
                  isInitiallyExpanded={true}
                  initialTab="basic"
                  autoEditTitle={false}
                  isAdmin={isAdmin}
                  currentUserName={settings.userName}
                  onUpdateTaskDetails={(tid, details) => {
                    const isImmediate = !!details.attachments || !!details.status;
                    updateTaskAndSave(tid, t2 => ({ ...t2, ...details }), isImmediate ? 'immediate' : 'none');
                  }}
                  onUpdateStatus={(tid, status) => updateTaskAndSave(tid, t2 => ({ ...t2, status }), 'immediate')}
                  onUpdatePriority={(tid, priority) => updateTaskAndSave(tid, t2 => ({ ...t2, priority }), 'immediate')}
                  onAddProgress={async (tid, content) => {
                    updateTaskAndSave(tid, t2 => {
                      const newP = { week: t2.progress.length + 1, content, updatedAt: new Date().toISOString(), author: settings.userName };
                      return { ...t2, progress: [newP, ...t2.progress] };
                    }, 'immediate');
                  }}
                  onAddComment={async (tid, content) => {
                    updateTaskAndSave(tid, t2 => {
                      const newC: TaskComment = { id: Date.now().toString(), content, author: settings.userName, createdAt: new Date().toISOString() };
                      return { ...t2, comments: [...(t2.comments || []), newC] };
                    }, 'immediate');
                  }}
                  onMarkAsViewed={() => markTaskAsViewed(t.id)}
                  onManualSync={async (taskObj) => {
                    updateTaskAndSave(taskObj.id, t2 => t2, 'immediate');
                  }}
                  onDeleteTask={(tid) => { softDeleteTask(tid); setTimelineSelectedTaskId(null); }}
                  onAddSubTask={addSubTask}
                  onAddSiblingTask={addSiblingTask}
                  epics={epics}
                  allTasks={tasks}
                  onShowConfirm={(title, msg, onConfirm) => {
                    setShowCleanupConfirm({
                      show: true,
                      title,
                      message: msg,
                      onConfirm
                    });
                  }}
                  onShowMessage={(title, msg) => {
                    setMessageModal({
                      show: true,
                      title,
                      message: msg
                    });
                  }}
                />
              </div>
            </div>
          );
        })()}
        {showCleanupConfirm && (
          <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden p-8 animate-in zoom-in duration-200">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                  <Trash className="w-8 h-8 text-red-600" />
                </div>
                <h2 className="font-black text-xl">{showCleanupConfirm.title}</h2>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">
                  {showCleanupConfirm.message}
                </p>
                <div className="flex gap-3 w-full mt-4">
                  <button
                    onClick={() => setShowCleanupConfirm(null)}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => {
                      showCleanupConfirm.onConfirm();
                      setShowCleanupConfirm(null);
                    }}
                    className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-sm hover:bg-red-700 shadow-lg shadow-red-200 transition-all"
                  >
                    実行する
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEpicList && (
          <EpicListView 
            tasks={tasks} 
            onEpicClick={(epicName) => {
              setSearchTerm(epicName);
              setShowEpicList(false);
            }}
            onClose={() => setShowEpicList(false)}
            projectConcept={projectConcept}
            onUpdateProjectConcept={handleUpdateProjectConcept}
            isAdmin={isAdmin}
            currentUserName={settings.userName}
          />
        )}

        {messageModal && (
          <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden p-8 animate-in zoom-in duration-200">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="font-black text-xl">{messageModal.title}</h2>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">
                  {messageModal.message}
                </p>
                <button
                  onClick={() => setMessageModal(null)}
                  className="w-full mt-4 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-slate-800 transition-all"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
