// Lara > Issues & audit (22 Nov 2026, owner: "a log of issues and an audit log for her issues so we can track it and fix the issues").
// Issues: raised automatically from video-call events (face/voice out of sync, slow start, clip not loaded, connection drop, tool
// error, page error) or reported by a person; each has a status and a note. Audit: every video call with its full timeline.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ListChecks, Loader2, Plus, Search, Video } from 'lucide-react';

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, init ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Server answered ${r.status}`);
  return j;
};
const post = (p: string, b: any) => api(p, { method: 'POST', body: JSON.stringify(b) });
const card = 'bento-card bg-white border border-brand-gray/20 rounded-2xl p-5 shadow-sm space-y-3';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const KIND: Record<string, string> = { desync: 'Face/voice sync', lip_sync: 'Lip sync', slow_start: 'Slow start', clip_stall: 'Clip loading', connection: 'Connection', tool_error: 'Tool', error: 'Page error', language: 'Language', answer: 'Answer', voice: 'Voice', face: 'Face', other: 'Other' };
const STATUS_TONE: Record<string, string> = { open: 'bg-red-50 text-red-700', investigating: 'bg-amber-50 text-amber-700', fixed: 'bg-emerald-50 text-emerald-700', wontfix: 'bg-gray-100 text-gray-600' };

function Pager({ page, size, total, onPage, onSize }: { page: number; size: number; total: number; onPage: (n: number) => void; onSize: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between text-xs text-brand-gray">
      <span>{total ? `${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}` : '0'}</span>
      <div className="flex items-center gap-2">
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="input-field text-xs py-1">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-2 py-1 rounded-lg border disabled:opacity-40">‹</button>
        <span>{page}/{pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-2 py-1 rounded-lg border disabled:opacity-40">›</button>
      </div>
    </div>
  );
}

export const LaraIssues: React.FC = () => {
  const [st, setSt] = useState<'open' | 'fixed' | 'wontfix'>('open');
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [q, setQ] = useState(''); const [qd, setQd] = useState('');
  const [form, setForm] = useState<any>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [call, setCall] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQd(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [st, size, qd]);
  const load = useCallback(async () => {
    setRows(null);
    const p = new URLSearchParams({ status: st, page: String(page), size: String(size) }); if (qd.trim()) p.set('q', qd.trim());
    try { const r = await api(`/lara/issues?${p}`); setRows(r.rows); setTotal(r.total || 0); } catch (e: any) { toast.error(e.message); setRows([]); }
  }, [st, page, size, qd]);
  useEffect(() => { void load(); }, [load]);
  const update = async (id: string, patch: any) => { try { await post(`/lara/issues/${id}`, patch); toast.success('Saved'); void load(); } catch (e: any) { toast.error(e.message); } };
  const report = async () => { try { await post('/lara/issues', form); toast.success('Issue added'); setForm(null); setSt('open'); void load(); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-extrabold text-sm flex items-center gap-2"><AlertTriangle size={16} className="text-brand-red" />Issues</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-brand-gray/20 overflow-hidden text-xs font-bold">{(['open', 'fixed', 'wontfix'] as const).map((s) => <button key={s} onClick={() => setSt(s)} className={`px-3 py-1.5 ${st === s ? 'bg-brand-red text-white' : ''}`}>{s === 'open' ? 'Open' : s === 'fixed' ? 'Fixed' : "Won't fix"}</button>)}</div>
            <button onClick={() => setForm(form ? null : { title: '', kind: 'other', details: '' })} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Plus size={14} />Report issue</button>
          </div>
        </div>
        <p className="text-xs text-brand-gray">Problems seen in Lara's video calls are added here automatically (the same problem adds to one row per day). Add anything you notice yourself with "Report issue" — for example her tone, an answer, or the lip sync.</p>
        {form && (
          <div className="rounded-xl border border-brand-gray/20 p-3 space-y-2">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What is wrong?" className="input-field w-full text-sm" />
            <div className="flex gap-2">
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="input-field text-sm">{['lip_sync', 'desync', 'language', 'answer', 'voice', 'face', 'connection', 'other'].map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
              <input value={form.callId || ''} onChange={(e) => setForm({ ...form, callId: e.target.value })} placeholder="Call id (optional)" className="input-field text-sm flex-1" />
            </div>
            <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Details (what happened, when, which customer)" className="input-field w-full text-sm h-20" />
            <div className="flex gap-2"><button onClick={report} className="btn-primary rounded-xl px-3 py-1.5 text-xs font-bold">Save</button><button onClick={() => setForm(null)} className="rounded-xl border px-3 py-1.5 text-xs font-bold">Cancel</button></div>
          </div>
        )}
        <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-brand-gray" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues…" className="input-field w-full pl-8 text-sm" /></div>
        {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray py-4 text-center">No issues here.</p> : (
          <ul className="divide-y divide-brand-gray/10">
            {rows.map((r) => (
              <li key={r.id} className="py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-brand-black">{r.title}</p>
                    <p className="text-[11px] text-brand-gray">{KIND[r.kind] || r.kind} · {r.source === 'auto' ? `seen ${r.count}×` : `reported by ${r.created_by || '—'}`} · first {when(r.first_seen)} · last {when(r.last_seen)}{r.lead_id ? ` · ${r.lead_id}` : ''}</p>
                  </div>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_TONE[r.status] || ''}`}>{r.status}</span>
                </div>
                {r.details && <p className="text-xs text-brand-black/80">{r.details}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(['open', 'investigating', 'fixed', 'wontfix'] as const).filter((s) => s !== r.status).map((s) => <button key={s} onClick={() => update(r.id, { status: s })} className="rounded-lg border px-2 py-1 font-bold">{s === 'wontfix' ? "Won't fix" : s[0].toUpperCase() + s.slice(1)}</button>)}
                  {r.call_id && <button onClick={() => setCall(r.call_id)} className="rounded-lg border px-2 py-1 font-bold flex items-center gap-1"><Video size={12} />View call</button>}
                </div>
                <div className="flex gap-2">
                  <input value={notes[r.id] ?? r.note ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="Note (cause, fix, version)…" className="input-field text-xs flex-1" />
                  <button onClick={() => update(r.id, { note: notes[r.id] ?? r.note ?? '' })} className="rounded-lg border px-2 py-1 text-xs font-bold">Save note</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows !== null && <Pager page={page} size={size} total={total} onPage={setPage} onSize={setSize} />}
      </section>
      <CallAudit open={call} onOpen={setCall} />
    </div>
  );
};

const CallAudit: React.FC<{ open: string | null; onOpen: (id: string | null) => void }> = ({ open, onOpen }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { (async () => { setRows(null); try { const r = await api(`/lara/call-audit?page=${page}&size=${size}`); setRows(r.rows); } catch (e: any) { toast.error(e.message); setRows([]); } })(); }, [page, size]);
  useEffect(() => { if (!open) { setEvents(null); return; } (async () => { setEvents(null); try { const r = await api(`/lara/call-audit?call=${encodeURIComponent(open)}`); setEvents(r.events); } catch (e: any) { toast.error(e.message); setEvents([]); } })(); }, [open]);
  const sec = (ms?: number) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
  const bad = new Set(['desync', 'clip_stall', 'ws_close', 'error', 'tool_error']);
  const summary = (e: any) => { const d = e.data || {}; return Object.entries(d).filter(([k]) => k !== 'ua').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); };
  return (
    <section className={card}>
      <h3 className="font-extrabold text-sm flex items-center gap-2"><ListChecks size={16} className="text-sky-700" />Video-call audit log</h3>
      <p className="text-xs text-brand-gray">Every video call with Lara, newest first. Open one to see its full timeline: connect, first sound, each tool, when her voice and face were out of sync, clips that loaded late, and how it ended.</p>
      {rows === null ? <Loader2 className="animate-spin text-brand-gray" /> : rows.length === 0 ? <p className="text-sm text-brand-gray py-3 text-center">No video calls recorded yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-left text-brand-gray"><th className="py-1">When</th><th>Lead</th><th>Length</th><th>First sound</th><th>Problems</th><th>Ended</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.callId} className={`border-t border-brand-gray/10 ${open === r.callId ? 'bg-sky-50' : ''}`}>
              <td className="py-1.5">{when(r.at)}</td><td>{r.leadId || '—'}</td><td>{r.seconds != null ? `${r.seconds} s` : '—'}</td><td>{r.firstAudioMs != null ? `${(r.firstAudioMs / 1000).toFixed(1)} s` : '—'}</td>
              <td className={r.problems ? 'text-red-700 font-bold' : ''}>{r.problems || 0}</td><td>{r.reason || '—'}</td>
              <td><button onClick={() => onOpen(open === r.callId ? null : r.callId)} className="rounded-lg border px-2 py-0.5 font-bold">{open === r.callId ? 'Close' : 'Timeline'}</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <Pager page={page} size={size} total={rows && rows.length === size ? page * size + 1 : (page - 1) * size + (rows?.length || 0)} onPage={setPage} onSize={setSize} />
      {open && (
        <div className="rounded-xl border border-brand-gray/20 p-3">
          <p className="text-xs font-bold mb-2">Call {open}</p>
          {events === null ? <Loader2 className="animate-spin text-brand-gray" /> : events.length === 0 ? <p className="text-xs text-brand-gray">No events for this call.</p> : (
            <ul className="space-y-0.5 text-[11px] font-mono max-h-80 overflow-y-auto">
              {events.map((e, i) => <li key={i} className={bad.has(e.kind) ? 'text-red-700 font-bold' : ''}>{sec(e.t_ms).padStart(7)}  {e.kind.padEnd(12)} {summary(e)}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
