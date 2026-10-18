import React, { useEffect, useMemo, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { wipeCrmCache } from '../lib/storageGuard';

const KEY = 'sdm_view_as';
const read = (): { id: string; name: string; role: string } | null => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };

/** Administrators only: look at the system as another person. A coloured frame and a top bar stay on screen until "Exit". */
export const ViewAsBar: React.FC = () => {
  const { user } = useAuth();
  const [as] = useState(read);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; role: string; active?: boolean }[]>([]);
  const [q, setQ] = useState('');
  const isAdmin = user?.role === 'Admin' && !as;

  useEffect(() => {
    if (!open || users.length) return;
    void fetch('/api/users').then((r) => r.json()).then((j) => setUsers((Array.isArray(j) ? j : j.users || []).filter((u: any) => u.active !== false))).catch(() => {});
  }, [open, users.length]);

  const roles = useMemo(() => {
    const m = new Map<string, typeof users>();
    for (const u of users.filter((x) => x.id !== user?.id && (!q || `${x.name} ${x.role}`.toLowerCase().includes(q.toLowerCase())))) m.set(u.role, [...(m.get(u.role) || []), u]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [users, q, user?.id]);

  const go = (u: { id: string; name: string; role: string } | null) => {
    try { if (u) sessionStorage.setItem(KEY, JSON.stringify({ id: u.id, name: u.name, role: u.role })); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    wipeCrmCache();
    window.location.reload();
  };

  if (as) return (
    <>
      <div className="fixed inset-0 z-[60] pointer-events-none border-[5px] border-amber-500" aria-hidden="true" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[61] bg-amber-500 text-black text-xs font-bold rounded-b-xl shadow-lg px-4 py-1.5 flex items-center gap-3">
        <Eye size={14} /> Viewing as {as.name} ({as.role})
        <button onClick={() => go(null)} className="bg-black text-white rounded-lg px-2.5 py-1 inline-flex items-center gap-1"><LogOut size={12} /> Exit, back to admin</button>
      </div>
    </>
  );
  if (!isAdmin) return null;
  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[61]">
      <button onClick={() => setOpen(!open)} className="bg-brand-black/80 hover:bg-brand-black text-white text-[11px] font-bold rounded-b-xl px-3 py-1 inline-flex items-center gap-1.5 shadow"><Eye size={12} /> View as</button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-72 max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-2xl border border-brand-gray/20 p-3 text-xs">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or role" className="w-full border border-brand-gray/25 rounded-lg px-2.5 py-2 mb-2" />
          {roles.map(([role, list]) => (
            <div key={role} className="mb-2">
              <div className="font-extrabold text-brand-gray uppercase text-[10px] tracking-wide mb-1">{role}</div>
              {list.map((u) => <button key={u.id} onClick={() => go(u)} className="block w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand-red/10 font-semibold text-brand-black">{u.name}</button>)}
            </div>
          ))}
          {!roles.length && <div className="text-brand-gray p-2">No one found.</div>}
        </div>
      )}
    </div>
  );
};
