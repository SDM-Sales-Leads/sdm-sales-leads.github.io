import React, { useMemo, useState, useEffect } from 'react';
import { Ticket, Priority } from '../types';
import { 
  Ticket as TicketIcon, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  History
} from 'lucide-react';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useTheme } from '../services/ThemeContext';

interface DashboardProps {
  tickets: Ticket[];
}

export const Dashboard: React.FC<DashboardProps> = ({ tickets }) => {
  const { settings } = useTheme();
  const [activityLogs, setActivityLogs] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchActivity = async () => {
      try {
        const res = await fetch('/api/admin/activity?page=1&limit=5');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setActivityLogs(Array.isArray(data?.logs) ? data.logs : []); // The server returns { logs, total, page, limit }
        }
      } catch (err) {
        console.error('Failed to fetch activity logs', err);
      }
    };
    fetchActivity();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const open = tickets.filter(t => !['Resolved', 'Closed'].includes(t.status)).length;
    const resolvedToday = tickets.filter(t => {
      if (!['Resolved', 'Closed'].includes(t.status)) return false; // a reopened ticket is not resolved any more
      const dateToUse = t.resolvedAt || t.updatedAt;
      if (!dateToUse) return false;
      const resolvedDate = new Date(dateToUse).toDateString();
      const today = new Date().toDateString();
      return resolvedDate === today;
    }).length;

    const overdue = tickets.filter(t => {
      if (['Resolved', 'Closed'].includes(t.status)) return false;
      if (t.slaPausedAt) return false; // SLA clock is stopped while waiting on user / vendor
      const dl = new Date(t.slaDeadline).getTime();
      return !Number.isNaN(dl) && Date.now() > dl;
    }).length;

    const durations = tickets
      .filter(t => ['Resolved', 'Closed'].includes(t.status))
      .map(t => new Date(t.resolvedAt || t.updatedAt).getTime() - new Date(t.createdAt).getTime())
      .filter(d => Number.isFinite(d) && d >= 0);
    // null (not 0) when nothing has been resolved yet -> shown as "—"
    const hours = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / (1000 * 60 * 60))
      : null;

    return { open, resolvedToday, overdue, hours };
  }, [tickets]);

  const priorityData = useMemo(() => {
    const priorities: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
    return priorities.map(p => ({
      name: p,
      count: tickets.filter(t => t.priority === p).length
    }));
  }, [tickets]);

  const typeData = useMemo(() => {
    const types = Array.from(new Set(tickets.map(t => t.type)));
    return types.map(type => ({
      name: type,
      count: tickets.filter(t => t.type === type).length
    }));
  }, [tickets]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-brand-black">Dashboard</h2>
          <p className="text-brand-gray text-sm">Real-time IT operations overview</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bento-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray">Open Tickets</p>
              <h3 className="text-3xl font-bold mt-1">{stats.open}</h3>
            </div>
            <div className="p-3 bg-blue-50/50 text-blue-600 rounded-xl">
              <TicketIcon size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-blue-600 font-medium">
            <TrendingUp size={14} />
            <span>Not resolved or closed</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bento-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray">Overdue</p>
              <h3 className="text-3xl font-bold mt-1 text-brand-red">{stats.overdue}</h3>
            </div>
            <div className="p-3 bg-red-50/50 text-brand-red rounded-xl">
              <AlertCircle size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-brand-red font-medium">
            <span>{stats.overdue > 0 ? 'SLA breached' : 'No SLA breaches'}</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bento-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray">Resolved Today</p>
              <h3 className="text-3xl font-bold mt-1">{stats.resolvedToday}</h3>
            </div>
            <div className="p-3 bg-emerald-50/50 text-emerald-600 rounded-xl">
              <CheckCircle2 size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <span>Resolved or closed today</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bento-card">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray">Avg. Resolution</p>
              <h3 className="text-3xl font-bold mt-1">{stats.hours === null ? '—' : `${stats.hours}h`}</h3>
            </div>
            <div className="p-3 bg-slate-50/50 text-slate-600 rounded-xl">
              <Clock size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-slate-600 font-medium">
            <span>Created to resolved, all time</span>
          </div>
        </motion.div>
      </div>

      {/* Charts & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bento-card h-[400px] flex flex-col lg:col-span-2">
          <h3 className="font-bold mb-6">Tickets by Priority</h3>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', opacity: 0.5 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'currentColor', opacity: 0.5 }} />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: 'none', 
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    backdropFilter: 'blur(8px)'
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.name === 'Critical' ? settings.primaryColor : 'currentColor'} fillOpacity={entry.name === 'Critical' ? 1 : 0.2} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bento-card h-[400px] flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <History size={18} className="text-brand-gray" />
            <h3 className="font-bold">Recent Activity</h3>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
            {activityLogs.map((log, i) => (
              <div key={log.id ?? i} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 text-[10px] font-bold">
                  {(log.userName || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <p className="text-xs font-bold truncate">{log.userName || '—'}</p>
                    <span className="text-[10.5px] text-brand-gray whitespace-nowrap ml-2">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-brand-gray leading-tight mt-0.5">{log.action}</p>
                  <p className="text-[10px] text-brand-gray/60 truncate mt-1">{log.details}</p>
                </div>
              </div>
            ))}
            {activityLogs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-brand-gray opacity-50">
                <History size={32} className="mb-2" />
                <p className="text-xs">No recent activity</p>
              </div>
            )}
          </div>
        </div>

        <div className="bento-card h-[400px] flex flex-col lg:col-span-3">
          <h3 className="font-bold mb-6">Tickets by Category</h3>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart 
                data={typeData} 
                layout="vertical" 
                margin={{ left: 20, right: 30, top: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis 
                  type="number" 
                  axisLine={false} 
                  tickLine={false} 
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }}
                />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  width={120}
                  tick={{ fontSize: 11, fill: 'currentColor', fontWeight: 500 }}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: 'none', 
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    backdropFilter: 'blur(8px)'
                  }}
                />
                <Bar 
                  dataKey="count" 
                  fill={settings.primaryColor} 
                  radius={[0, 6, 6, 0]} 
                  barSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
