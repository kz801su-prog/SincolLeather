
import React, { useMemo, useState } from 'react';
import { Task } from '../types';
import { Clock, MessageSquare, TrendingUp, ChevronDown } from 'lucide-react';

interface ActivityEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  author: string;
  type: 'progress' | 'comment';
  content: string;
  timestamp: string;
}

interface Props {
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
}

const formatRelativeTime = (isoString: string): string => {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return isoString;
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (hours < 24) return `${hours}時間前`;
  if (days < 7) return `${days}日前`;
  return new Date(isoString).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatAbsoluteTime = (isoString: string): string => {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const INITIAL_COUNT = 8;

export const ActivityFeed: React.FC<Props> = ({ tasks, onTaskClick }) => {
  const [showAll, setShowAll] = useState(false);

  const activities = useMemo((): ActivityEntry[] => {
    const entries: ActivityEntry[] = [];

    tasks.forEach(task => {
      if (task.isSoftDeleted) return;

      // 進捗エントリ
      (task.progress || []).forEach((p, i) => {
        if (!p.updatedAt && !p.content) return;
        entries.push({
          id: `prog-${task.id}-${i}`,
          taskId: task.id,
          taskTitle: task.title,
          author: p.author || task.responsiblePerson || '不明',
          type: 'progress',
          content: p.content || '',
          timestamp: p.updatedAt || task.date || '',
        });
      });

      // コメントエントリ
      (task.comments || []).forEach(c => {
        if (!c.content) return;
        entries.push({
          id: `comment-${task.id}-${c.id}`,
          taskId: task.id,
          taskTitle: task.title,
          author: c.author || '不明',
          type: 'comment',
          content: c.content,
          timestamp: c.createdAt || '',
        });
      });
    });

    // 新しい順にソート
    entries.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return tb - ta;
    });

    return entries;
  }, [tasks]);

  if (activities.length === 0) return null;

  const displayed = showAll ? activities : activities.slice(0, INITIAL_COUNT);

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm mb-6 overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-red-500" />
          <h2 className="text-xs font-black text-slate-700 uppercase tracking-widest">更新履歴</h2>
          <span className="text-[9px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
            {activities.length}件
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-50">
        {displayed.map(entry => (
          <div
            key={entry.id}
            className="px-6 py-3 flex items-start gap-4 hover:bg-slate-50/60 transition-colors cursor-pointer group"
            onClick={() => onTaskClick(entry.taskId)}
          >
            {/* アバター */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
              entry.type === 'progress' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {entry.author.slice(0, 1)}
            </div>

            {/* 本文 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-slate-800">{entry.author}</span>
                <div className={`flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                  entry.type === 'progress'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-blue-50 text-blue-600'
                }`}>
                  {entry.type === 'progress'
                    ? <><TrendingUp className="w-2.5 h-2.5" /> 進捗更新</>
                    : <><MessageSquare className="w-2.5 h-2.5" /> コメント</>
                  }
                </div>
                <span
                  className="text-[10px] font-bold text-red-600 hover:underline truncate max-w-[200px] group-hover:text-red-700"
                  title={entry.taskTitle}
                >
                  {entry.taskTitle}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5 line-clamp-2 leading-relaxed">
                {entry.content}
              </p>
            </div>

            {/* 時刻 */}
            <div className="flex-shrink-0 text-right">
              <p className="text-[10px] font-bold text-slate-400" title={formatAbsoluteTime(entry.timestamp)}>
                {formatRelativeTime(entry.timestamp)}
              </p>
              <p className="text-[9px] text-slate-300 font-medium mt-0.5 hidden md:block">
                {formatAbsoluteTime(entry.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {activities.length > INITIAL_COUNT && (
        <div className="px-6 py-3 border-t border-slate-50">
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full flex items-center justify-center gap-2 text-[10px] font-black text-slate-400 hover:text-red-600 transition-colors py-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
            {showAll ? '閉じる' : `さらに ${activities.length - INITIAL_COUNT} 件を表示`}
          </button>
        </div>
      )}
    </div>
  );
};
