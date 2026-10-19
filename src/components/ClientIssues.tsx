import React, { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

interface Item { id: number; at: string; user: string; kind: string; label: string; page: string; message: string; ms: number | null; tabs: number; ua: string; width: number | null; net: string }

const TONE: Record<string, string> = { freeze: 'bg-rose-100 text-rose-700', render_error: 'bg-rose-100 text-rose-700', white_page: 'bg-rose-100 text-rose-700', js_error: 'bg-rose-100 text-rose-700', auto_reload: 'bg-amber-100 text-amber-800', api_401: 'bg-amber-100 text-amber-800', api_fail: 'bg-amber-100 text-amber-800' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** what the users' browsers reported: freezes, slow or failing calls, blank pages, automatic reloads, several tabs */
export const ClientIssues: React.FC = () => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState('all');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setErr('');
    fetch(`/api/admin/client-issues?days=${days}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setItems(j.items || [])).catch(() => setErr('Could not load the reports.')).finally(() => setBusy(false));
  };
  useEffect(load, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const kinds = useMemo(() => { const m = new Map<string, { label: string; n: number }>(); for (const i of items || []) { const e = m.get(i.kind) || { label: i.label, n: 0 }; e.n++; m.set(i.kind, e); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n); }, [items]);
  const shown = (items || []).filter((i) => kind === 'all' || i.kind === kind);
  const people = useMemo(() => { const m = new Map<string, number>(); for (const i of items || []) m.set(i.user, (m.get(i.user) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5); }, [items]);
  const copy = () => {
    const t = shown.slice(0, 80).map((i) => `${when(i.at)} | ${i.user} | ${i.label} | ${i.page} | ${i.message}${i.ms ? ` | ${i.ms} ms` : ''}${i.tabs > 1 ? ` | ${i.tabs} tabs` : ''} | ${i.ua}`).join('\n');
    navigator.clipboard?.writeText(`App issues, last ${days} days (${shown.length}):\n${t}`).catch(() => {});
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input-field !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
        </select>
        <select className="input-field !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All kinds</option>
          {kinds.map(([k, v]) => <option key={k} value={k}>{v.label} ({v.n})</option>)}
        </select>
        <button onClick={load} disabled={busy} className="btn-secondary flex items-center gap-2"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh</button>
        <button onClick={copy} className="btn-secondary flex items-center gap-2" title="Copy the list so it can be pasted to Claude"><Copy size={14} /> Copy report</button>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {items && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kinds.slice(0, 4).map(([k, v]) => <div key={k} className="bento-card !p-4"><p className="text-xs text-brand-gray">{v.label}</p><p className="text-xl font-bold">{v.n}</p></div>)}
          {people.length > 0 && <div className="bento-card !p-4 col-span-2 md:col-span-4"><p className="text-xs text-brand-gray mb-1">Most reports from</p><p className="text-sm font-semibold">{people.map(([u, n]) => `${u} (${n})`).join(' · ')}</p></div>}
        </div>
      )}
      <div className="bento-card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-black/5 text-xs uppercase text-brand-gray"><th className="p-3">When (Cairo)</th><th className="p-3">User</th><th className="p-3">What</th><th className="p-3">Page</th><th className="p-3">Detail</th><th className="p-3">Device</th></tr></thead>
          <tbody className="divide-y divide-black/5">
            {items === null && <tr><td colSpan={6} className="p-6 text-center text-brand-gray">Loading…</td></tr>}
            {items && shown.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-brand-gray">No reports in this period. That is good news.</td></tr>}
            {shown.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="p-3 whitespace-nowrap">{when(i.at)}</td>
                <td className="p-3 font-medium whitespace-nowrap">{i.user}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${TONE[i.kind] || 'bg-black/5 text-brand-gray'}`}>{i.label}</span>{i.tabs > 1 && <span className="ml-1 text-[11px] text-brand-gray">{i.tabs} tabs</span>}</td>
                <td className="p-3 whitespace-nowrap">{i.page}</td>
                <td className="p-3 max-w-md break-words">{i.message}{i.ms ? <span className="text-brand-gray"> · {(i.ms / 1000).toFixed(1)} s</span> : null}</td>
                <td className="p-3 text-xs text-brand-gray max-w-[220px] break-words">{[i.width ? `${i.width}px` : '', i.net, i.ua.replace(/Mozilla\/5\.0 \(([^)]*)\).*?(Chrome|Safari|Firefox|Edg)\/([\d.]+).*/, '$1 · $2 $3')].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
