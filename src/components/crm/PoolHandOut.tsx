import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { crmService } from './crmService';

// "Hand out the pool": choose who, how many, how (fair by the routing rules / split evenly) - preview first, then hand out. Oldest leads always go first.
interface Person { id: string; name: string; role: string; onLeave: boolean; manualOnly: boolean; open: number; touched: number; untouched: number }
interface Preview {
  pool: number; requested: number; willAssign: number; noOneCouldTake: number; leftInPool: number; oldestHandedOut: string | null; newestHandedOut: string | null;
  perPerson: { id: string; name: string; role: string; onLeave: boolean; openBefore: number; untouchedBefore: number; gets: number; untouchedAfter: number; overUntouchedCap: boolean }[];
  assigned?: number;
}

export const PoolHandOut: React.FC<{ open: boolean; onClose: () => void; onDone: () => void }> = ({ open, onClose, onDone }) => {
  const [people, setPeople] = useState<Person[]>([]);
  const [caps, setCaps] = useState<{ maxUntouched: number; maxTotal: number; method: string }>({ maxUntouched: 0, maxTotal: 0, method: '' });
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [count, setCount] = useState('');
  const [mode, setMode] = useState<'fair' | 'even'>('fair');
  const [ignoreLimits, setIgnoreLimits] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setPreview(null); setErr(''); setPicked(new Set()); setCount(''); setIgnoreLimits(false); setMode('fair');
    fetch('/api/crm/pool/people').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { setPeople(j.people || []); setCaps({ maxUntouched: j.maxUntouched, maxTotal: j.maxTotal, method: j.method }); }).catch(() => setErr('Could not read the team.'));
    fetch('/api/crm/pool/status').then((r) => (r.ok ? r.json() : null)).then((j) => j && setPoolCount(j.unassigned)).catch(() => {});
  }, [open]);

  const body = (apply: boolean) => JSON.stringify({ apply, count: Number(count) || 0, agentIds: [...picked], mode, ignoreLimits });
  const stale = () => setPreview(null);
  const toggle = (id: string) => { setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); stale(); };
  const autoPeople = useMemo(() => people.filter((p) => !p.manualOnly), [people]);
  const countNum = Number(count) || 0;
  const ready = picked.size > 0 && countNum > 0;

  const run = async (apply: boolean) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/crm/pool/hand-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(apply) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || 'It did not work.'); return; }
      if (apply) {
        toast.success(`${j.assigned || 0} lead(s) handed out.`);
        void crmService.refreshDelta({ force: true }); onDone(); onClose();
      } else setPreview(j);
    } catch { setErr('Could not reach the server.'); } finally { setBusy(false); }
  };

  if (!open) return null;
  const warnCap = preview?.perPerson.some((p) => p.overUntouchedCap && p.gets > 0);
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-brand-black rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-brand-black">Hand out the pool</h3>
            <p className="text-brand-gray font-semibold mt-0.5">Waiting in the pool: <b>{poolCount ?? '…'}</b>. The OLDEST leads go first (call center leads, then by lead date). Nothing changes until you press "Hand out".</p>
          </div>
          <button onClick={onClose} className="text-brand-gray font-extrabold text-lg leading-none">×</button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-extrabold text-brand-black">1. Who gets leads</span>
            <span className="space-x-2">
              <button type="button" className="text-indigo-600 font-bold hover:underline" onClick={() => { setPicked(new Set(autoPeople.filter((p) => !p.onLeave).map((p) => p.id))); stale(); }}>Select the sales team</button>
              <button type="button" className="text-brand-gray font-bold hover:underline" onClick={() => { setPicked(new Set()); stale(); }}>Clear</button>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {people.map((p) => (
              <label key={p.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer ${picked.has(p.id) ? 'border-brand-red bg-brand-red/5' : 'border-brand-gray/20'}`}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="flex-1 min-w-0">
                  <span className="font-bold text-brand-black">{p.name}</span> <span className="text-brand-gray">· {p.role}{p.manualOnly ? ' · manual only' : ''}{p.onLeave ? ' · ON LEAVE' : ''}</span>
                  <span className="block text-[10px] text-brand-gray">{p.untouched} untouched · {p.touched} worked · {p.open} open{caps.maxUntouched && p.untouched >= caps.maxUntouched ? ' · AT THE LIMIT' : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-extrabold text-brand-black">2. How many leads</span>
            <div className="flex gap-1.5 mt-1">
              <input type="number" min={1} max={5000} value={count} onChange={(e) => { setCount(e.target.value); stale(); }} placeholder="e.g. 100" className="border border-brand-gray/25 rounded-lg px-2 py-1.5 flex-1 bg-white" />
              <button type="button" className="px-2.5 rounded-lg border border-brand-gray/25 font-bold hover:bg-brand-gray/5" onClick={() => { setCount(String(poolCount || '')); stale(); }}>All ({poolCount ?? '…'})</button>
            </div>
          </label>
          <div>
            <span className="font-extrabold text-brand-black">3. How to share them</span>
            <div className="mt-1 space-y-1">
              <label className="flex items-start gap-2 cursor-pointer"><input type="radio" checked={mode === 'fair'} onChange={() => { setMode('fair'); stale(); }} /><span><b>Fair by the routing rules</b> ({caps.method || '…'}): whoever carries less gets more.</span></label>
              <label className="flex items-start gap-2 cursor-pointer"><input type="radio" checked={mode === 'even'} onChange={() => { setMode('even'); stale(); }} /><span><b>Split evenly</b> between the chosen people (same number each, within 1).</span></label>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer rounded-lg bg-amber-50 border border-amber-200 p-2.5">
          <input type="checkbox" checked={ignoreLimits} onChange={(e) => { setIgnoreLimits(e.target.checked); stale(); }} className="mt-0.5" />
          <span><b>Ignore the limits</b> ({caps.maxUntouched || '—'} untouched / {caps.maxTotal || '—'} open per person, daily limit). Off = a person who is at the limit gets nothing. On = the chosen people get leads even above the limit, so their lists grow.</span>
        </label>

        {err && <p className="text-rose-600 font-bold">{err}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!ready || busy} onClick={() => void run(false)} className="px-4 py-2 rounded-xl border border-brand-red text-brand-red font-extrabold disabled:opacity-40">{busy && !preview ? 'Checking…' : 'Preview (changes nothing)'}</button>
          {!ready && <span className="self-center text-brand-gray font-semibold">Choose at least one person and the number of leads.</span>}
        </div>

        {preview && (
          <div className="rounded-xl border border-brand-gray/20 p-3 space-y-2">
            <div className="font-extrabold text-brand-black">Preview: {preview.willAssign} of {preview.requested} requested leads would be handed out{preview.oldestHandedOut ? `, dated ${preview.oldestHandedOut} to ${preview.newestHandedOut}` : ''}.</div>
            <table className="w-full text-left">
              <thead><tr className="text-brand-gray border-b border-brand-gray/20"><th className="py-1">Salesperson</th><th>Untouched now</th><th>Gets</th><th>Untouched after</th></tr></thead>
              <tbody>
                {preview.perPerson.map((p) => (
                  <tr key={p.id} className="border-b border-brand-gray/10">
                    <td className="py-1 font-bold text-brand-black">{p.name}{p.onLeave ? ' (on leave)' : ''}</td>
                    <td>{p.untouchedBefore}</td>
                    <td className="font-extrabold">{p.gets}</td>
                    <td className={p.overUntouchedCap && p.gets ? 'text-rose-600 font-bold' : ''}>{p.untouchedAfter}{p.overUntouchedCap && p.gets ? ' (over the limit)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.willAssign < preview.requested && <p className="text-amber-700 font-semibold">{preview.willAssign === 0 ? 'Nobody can take a lead with these settings (everyone chosen is at the limit).' : `${preview.requested - preview.willAssign} fewer than requested: ${preview.noOneCouldTake ? `${preview.noOneCouldTake} lead(s) could not be given to anyone chosen` : 'the pool has no more leads'}.`} Tick "Ignore the limits" or choose more people to give all of them.</p>}
            {warnCap && <p className="text-rose-600 font-semibold">Some people end above the limit: only because "Ignore the limits" is on.</p>}
            <p className="text-brand-gray font-semibold">After this, {preview.leftInPool} lead(s) stay in the pool. Each person gets one notification in the bell.</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || preview.willAssign === 0} onClick={() => void run(true)} className="bg-brand-red disabled:opacity-40 text-white px-4 py-2 rounded-xl font-extrabold">{busy ? 'Handing out…' : `Hand out ${preview.willAssign} lead(s)`}</button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-gray/25 font-bold">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
