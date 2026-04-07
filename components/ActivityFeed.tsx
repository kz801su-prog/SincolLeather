import React, { useMemo } from 'react';
import { Task } from '../types';
import { MessageSquare, TrendingUp, Clock } from 'lucide-react';

interface Props {
  tasks: Task[];
  onTaskClick: (taskId: string, type?: 'progress' | 'comment') => void;
}

interface ActivityItem {
  id: string;
  taskId: string;
  taskTitle: string;
  type: 'progress' | 'comment';
  content: string;
  author: string;
  timestamp: string;
}

export const ActivityFeed: React.FC<Props> = ({ tasks, onTaskClick }) => {
  const activities = useMemo(() => {
    const items: ActivityItem[] = [];
    
    tasks.forEach(task => {
      if (task.isSoftDeleted) return;
      
      if (task.progress) {
        task.progress.forEach((p, index) => {
          items.push({
            id: `progress-${task.id}-${index}`,
            taskId: task.id,
            taskTitle: task.title,
            type: 'progress',
            content: p.content,
            author: p.author,
            timestamp: p.updatedAt
          });
        });
      }
      
      if (task.comments) {
        task.comments.forEach(c => {
          items.push({
            id: `comment-${c.id}`,
            taskId: task.id,
            taskTitle: task.title,
            type: 'comment',
            content: c.content,
            author: c.author,
            timestamp: c.createdAt
          });
        });
      }
    });
    
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [tasks]);

  if (activities.length === 0) {
    return (
      <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 font-bold">履歴がありません</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
      <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
        <Clock className="w-6 h-6 text-slate-400" />
        最新の書き込み: {activities[0]?.author || '履歴なし'}
      </h2>
      
      <div className="space-y-6">
        {activities.map(activity => (
          <div key={activity.id} className="flex gap-4 items-start">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${activity.type === 'progress' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
              {activity.type === 'progress' ? <TrendingUp className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 mb-1">
                <span className="font-bold text-slate-800">{activity.author}</span>
                <span className="text-xs text-slate-400 font-medium">
                  {new Date(activity.timestamp).toLocaleString('ja-JP', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
              <p className="text-sm text-slate-600 mb-2 whitespace-pre-wrap break-words">
                {activity.content}
              </p>
              <button 
                onClick={() => onTaskClick(activity.taskId, activity.type)}
                className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 px-3 py-1.5 rounded-lg transition-colors truncate max-w-full"
              >
                {activity.taskTitle}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
