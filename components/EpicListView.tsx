
import React, { useMemo, useState } from 'react';
import { Task, TaskStatus, ProjectConcept, TaskEvaluation } from '../types';
import { Briefcase, ChevronRight, CheckCircle2, Clock, AlertTriangle, TrendingUp, Search, Award } from 'lucide-react';

interface Props {
  tasks: Task[];
  onEpicClick: (epicName: string) => void;
  onClose: () => void;
  projectConcept: ProjectConcept | null;
  onUpdateProjectConcept: (concept: ProjectConcept) => void;
  isAdmin: boolean;
  currentUserName: string;
}

export const EpicListView: React.FC<Props> = ({ 
  tasks, 
  onEpicClick, 
  onClose, 
  projectConcept, 
  onUpdateProjectConcept,
  isAdmin,
  currentUserName
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [evaluatingEpic, setEvaluatingEpic] = useState<string | null>(null);
  
  const epicStats = useMemo(() => {
    const stats: Record<string, { 
      name: string, 
      total: number, 
      rootCount: number,
      subCount: number,
      completed: number, 
      pending: number, 
      overdue: number,
      lastUpdated: string,
      leaders: string[]
    }> = {};

    tasks.forEach(task => {
      const name = task.project || '未分類';
      if (!stats[name]) {
        stats[name] = { name, total: 0, rootCount: 0, subCount: 0, completed: 0, pending: 0, overdue: 0, lastUpdated: task.date, leaders: [] };
      }
      
      const s = stats[name];
      s.total++;
      
      if (task.hierarchyType === 'root' && task.responsiblePerson && !s.leaders.includes(task.responsiblePerson)) {
        s.leaders.push(task.responsiblePerson);
      }
      
      // Only count active (non-completed) tasks in the root/sub breakdown
      if (task.status !== TaskStatus.COMPLETED) {
        if (task.hierarchyType === 'subtask') s.subCount++;
        else s.rootCount++;
      }

      if (task.status === TaskStatus.COMPLETED) s.completed++;
      else if (task.status === TaskStatus.IN_PROGRESS) s.pending++;
      
      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.COMPLETED;
      if (isOverdue) s.overdue++;
      
      if (new Date(task.date) > new Date(s.lastUpdated)) {
        s.lastUpdated = task.date;
      }
    });

    return Object.values(stats).sort((a, b) => b.total - a.total);
  }, [tasks]);

  const handleUpdateEpicEvaluation = (epicName: string, field: string, value: any) => {
    if (!projectConcept) return;
    
    const newEvaluations = { ...(projectConcept.epicEvaluations || {}) };
    const currentEval = newEvaluations[epicName] || { difficulty: 3, outcome: 3, memberRatings: {} };
    
    newEvaluations[epicName] = {
      ...currentEval,
      [field]: value
    };

    onUpdateProjectConcept({
      ...projectConcept,
      epicEvaluations: newEvaluations
    });
  };

  const filteredEpicStats = useMemo(() => {
    return epicStats.filter(epic => 
      epic.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [epicStats, searchTerm]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200">
        <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">エピック・マスターリスト</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">全プロジェクトの進捗状況と統計</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="エピック検索..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-red-500 shadow-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button 
              onClick={onClose}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-600 transition-all shadow-sm"
            >
              閉じる
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredEpicStats.map((epic) => {
              const progress = epic.total > 0 ? Math.round((epic.completed / epic.total) * 100) : 0;
              
              return (
                <div 
                  key={epic.name}
                  onClick={() => onEpicClick(epic.name)}
                  className="group bg-white border border-slate-100 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:border-red-200 transition-all cursor-pointer flex flex-col"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-black text-slate-800 truncate group-hover:text-red-600 transition-colors">{epic.name}</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">最終更新: {epic.lastUpdated}</p>
                    </div>
                    <div className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-[10px] font-black">
                      {epic.total}（{epic.rootCount}/{epic.subCount}）Tasks
                    </div>
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-1000"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-sm font-black text-slate-700">{progress}%</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 flex flex-col items-center">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mb-1" />
                        <span className="text-xs font-black text-emerald-700">{epic.completed}</span>
                        <span className="text-[8px] font-bold text-emerald-600/60 uppercase">完了</span>
                      </div>
                      <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 flex flex-col items-center">
                        <Clock className="w-4 h-4 text-amber-500 mb-1" />
                        <span className="text-xs font-black text-amber-700">{epic.pending}</span>
                        <span className="text-[8px] font-bold text-amber-600/60 uppercase">進行</span>
                      </div>
                      <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 flex flex-col items-center">
                        <AlertTriangle className="w-4 h-4 text-rose-500 mb-1" />
                        <span className="text-xs font-black text-rose-700">{epic.overdue}</span>
                        <span className="text-[8px] font-bold text-rose-600/60 uppercase">遅延</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center">
                    {progress === 100 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEvaluatingEpic(epic.name);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-[10px] font-black hover:bg-red-100 transition-colors"
                      >
                        <Award className="w-3 h-3" />
                        エピック評価
                      </button>
                    )}
                    <span className="text-[10px] font-black text-red-500 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      詳細を見る <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {evaluatingEpic && (
          <div className="fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] w-full max-w-lg p-8 shadow-2xl animate-in zoom-in duration-200">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800">エピック評価: {evaluatingEpic}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">プロジェクト全体の成果を評価します</p>
                  </div>
                </div>
                <button onClick={() => setEvaluatingEpic(null)} className="p-2 text-slate-400 hover:text-red-600 transition-colors">
                  <Clock className="w-5 h-5" />
                </button>
              </div>

              {(() => {
                const epicInfo = epicStats.find(e => e.name === evaluatingEpic);
                const canEvaluate = isAdmin || (epicInfo?.leaders.includes(currentUserName));
                const evaluation = projectConcept?.epicEvaluations?.[evaluatingEpic] || { difficulty: 3, outcome: 3, memberEvaluations: [], memberRatings: {} } as TaskEvaluation;

                return (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">難易度 (1-5)</label>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map(val => (
                            <button
                              key={val}
                              disabled={!canEvaluate}
                              onClick={() => handleUpdateEpicEvaluation(evaluatingEpic, 'difficulty', val)}
                              className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${evaluation.difficulty === val ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">成果 (1-5)</label>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map(val => (
                            <button
                              key={val}
                              disabled={!canEvaluate}
                              onClick={() => handleUpdateEpicEvaluation(evaluatingEpic, 'outcome', val)}
                              className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${evaluation.outcome === val ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">評価コメント</label>
                        <textarea
                          disabled={!canEvaluate}
                          value={evaluation.comment || ''}
                          onChange={(e) => handleUpdateEpicEvaluation(evaluatingEpic, 'comment', e.target.value)}
                          placeholder="エピック全体の総評を入力してください..."
                          className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:border-red-500 min-h-[120px] resize-none"
                        />
                      </div>
                    </div>

                    {!canEvaluate && (
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                        <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                          このエピックの評価権限がありません。評価はリーダーまたは管理者が行います。
                        </p>
                      </div>
                    )}

                    <button
                      onClick={() => setEvaluatingEpic(null)}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-xl"
                    >
                      閉じる
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2 text-slate-400">
            <TrendingUp className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Total Epics: {epicStats.length}</span>
          </div>
          <p className="text-[10px] font-bold text-slate-400 italic">エピックをクリックすると、そのエピックに属するタスクのみを表示します</p>
        </div>
      </div>
    </div>
  );
};
