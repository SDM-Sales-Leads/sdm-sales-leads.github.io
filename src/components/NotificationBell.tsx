import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Clock, Pencil, UserPlus, Info, CheckCheck, AlarmClock } from 'lucide-react';

interface Notif { id: string; type: string; leadId: string | null; title: string; body: string | null; at: string; read: boolean }

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const Icon = ({ type }: { type: string }) =>
  type === 'assigned' ? <UserPlus size={15} /> : type === 'reminder' ? <Clock size={15} /> : type === 'changed' ? <Pencil size={15} /> : type === 'escalation' ? <AlarmClock size={15} /> : <Info size={15} />;

/** The bell: stored per user on the server. Unread = red and pulsing, read = gray. A click opens the lead it is about. */
export const NotificationBell: React.FC<{ dark?: boolean; className?: string }> = ({ dark = false, className = '' }) => {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const unreadRef = useRef(0);
  unreadRef.current = unread;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 8, top: 60 });
  const btn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  const load = useCallback(async (force = false) => {
    if (busy.current || (document.hidden && !force)) return;     // background polling pauses while the tab is hidden; opening the panel and the first load always read
    busy.current = true;
    try {
      const res = await fetch('/api/crm/my-notifications?limit=40');
      if (!res.ok) return;
      const j = await res.json();
      setItems(Array.isArray(j.items) ? j.items : []);
      setUnread(Number(j.unread) || 0);
    } catch { /* the bell keeps what it had */ } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    void load(true);
    // the poll of the lists (/crm/pulse) also carries the unread count: the bell reads its items only when that count changes.
    // On pages without that poll, a slow fallback (every 5 min, visible tab) keeps the bell alive.
    const t = setInterval(() => { if (Date.now() - Number((window as any).__sdmLastPulse || 0) > 240_000) void load(); }, 300_000);
    const onPulse = (e: Event) => { const n = Number((e as CustomEvent).detail?.unread) || 0; if (n !== unreadRef.current) void load(); };
    let lastFocus = 0;
    const f = () => { if (Date.now() - lastFocus > 60_000) { lastFocus = Date.now(); void load(); } };
    const r = () => void load();
    window.addEventListener('focus', f);
    window.addEventListener('crm-pulse', onPulse);
    window.addEventListener('crm-notify-refresh', r);
    return () => { clearInterval(t); window.removeEventListener('focus', f); window.removeEventListener('crm-pulse', onPulse); window.removeEventListener('crm-notify-refresh', r); };
  }, [load]);

  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      const w = Math.min(400, window.innerWidth - 16);
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 8 });
      void load(true);
    }
    setOpen(!open);
  };

  const markRead = async (ids: string[] | 'all') => {
    setItems((l) => l.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => (ids === 'all' ? 0 : Math.max(0, u - ids.length)));
    try { await fetch('/api/crm/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) }); } catch { /* next refresh corrects it */ }
  };

  const openItem = (n: Notif) => {
    if (!n.read) void markRead([n.id]);
    setOpen(false);
    if (n.leadId) window.dispatchEvent(new CustomEvent('app-open-lead', { detail: { id: n.leadId } }));
  };

  const hasUnread = unread > 0;
  return (
    <>
      <button
        ref={btn} type="button" onClick={toggle} aria-label={hasUnread ? `${unread} unread notifications` : 'Notifications'} title="Notifications"
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors ${hasUnread ? 'bg-red-600 text-white' : dark ? 'bg-white/10 text-white/70 hover:bg-white/20' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'} ${className}`}
      >
        {hasUnread && <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 animate-ping" />}
        <Bell size={18} className={`relative ${hasUnread ? 'animate-[wiggle_1s_ease-in-out_infinite]' : ''}`} />
        {hasUnread && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-red-600 text-[10px] font-extrabold flex items-center justify-center shadow">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div className="fixed z-[9999] w-[400px] max-w-[calc(100vw-16px)] bg-white text-gray-800 rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" style={{ left: pos.left, top: pos.top }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <b className="text-sm">Notifications {hasUnread && <span className="ml-1 text-red-600">({unread} new)</span>}</b>
              {hasUnread && <button className="text-xs text-red-600 font-bold inline-flex items-center gap-1 hover:underline" onClick={() => markRead('all')}><CheckCheck size={14} /> Mark all as read</button>}
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {items.length === 0 && <p className="text-center text-sm text-gray-400 py-10">No notifications yet.</p>}
              {items.map((n) => (
                <button key={n.id} type="button" onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 flex gap-3 items-start transition-colors ${n.read ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-red-50 hover:bg-red-100 notif-unread'}`}>
                  <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${n.read ? 'bg-gray-200 text-gray-500' : 'bg-red-600 text-white'}`}><Icon type={n.type} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.read ? 'font-medium' : 'font-bold text-gray-900'}`}>{n.title}</span>
                    {n.body && <span className="block text-xs mt-0.5 break-words">{n.body}</span>}
                    <span className="block text-[11px] mt-1 opacity-70">{ago(n.at)}{n.leadId ? ` · ${n.leadId}` : ''}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 shrink-0 w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
};
