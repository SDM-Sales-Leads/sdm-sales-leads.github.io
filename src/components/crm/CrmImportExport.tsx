import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lead } from './types';
import { crmService } from './crmService';
import { csvCell, parseCSV } from '../../lib/plots';
import { useAuth } from '../../services/AuthContext';
import { readXlsx, buildXlsx } from './xlsxLite';
import {
  XLSX_HEADERS, buildPlan, parseHistory, HistRow, summarize, reportRows, leadToRow, Plan, Person, cleanCell,
} from './importEngine';
import { STATUSES, SOURCES, PROJECTS, PRIORITIES } from './leadConfig';
import {
  Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2, X, FileText,
} from 'lucide-react';

interface CrmImportExportProps {
  leads: Lead[];
  onLeadsUpdated: () => void;
  currentRole: string;
}

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
const MAX_IMPORT_ROWS = 20000;
const CHUNK = 100;
const ID_OK = /^[A-Za-z0-9_.:-]{1,60}$/;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvBlob = (rows: (string | number)[][]) =>
  new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });

type Phase = 'idle' | 'reading' | 'preview' | 'importing' | 'done';

export const CrmImportExport: React.FC<CrmImportExportProps> = ({ leads, onLeadsUpdated, currentRole }) => {
  const { user, permissions } = useAuth();
  const roleLc = (currentRole || '').toLowerCase();
  const isReadOnly = currentRole === 'Read Only';
  // Only Sales Operation / admin may import with owners; everyone else imports to themselves (the server enforces the same)
  const canOwners = roleLc.includes('admin') || roleLc.startsWith('sales operation');
  const scopeAll = canOwners || permissions?.canViewSalesRules === true;
  // marketing feeds the sales team: what they import is not owned by them, it goes through the routing rules like e-mail leads
  const leaveUnassigned = !canOwners && permissions?.canEditLeadIdentity === true;

  const [dragActive, setDragActive] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dupMode, setDupMode] = useState<'skip' | 'import'>('skip');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [prog, setProg] = useState({ done: 0, total: 0, label: '' });
  const [result, setResult] = useState<null | { added: number; updated: number; failed: number; cancelled: boolean }>(null);
  const sheetRef = useRef<{ headers: string[]; body: string[][] } | null>(null);
  const cancelRef = useRef(false);
  const historyRef = useRef<Map<string, HistRow[]> | undefined>(undefined);

  const visibleLeads = useMemo(() => leads.filter((l) => !l.mergedInto), [leads]);
  const summary = useMemo(() => (plan && !plan.fatal ? summarize(plan, dupMode) : null), [plan, dupMode]);

  const people = (): Person[] =>
    (crmService.getSalesPeople() as any[])
      .filter((p) => p && p.active !== false && /sales|business|bd/i.test(p.role || '') && !/operation/i.test(p.role || ''))
      .map((p) => ({ id: String(p.id), name: String(p.name || ''), email: p.email, role: p.role }));

  const makePlan = async (upd: boolean, name = fileName) => {
    const s = sheetRef.current!;
    const label = user?.name || 'User';
    return buildPlan(s.headers, s.body, {
      existing: crmService.getLeads(), people: people(), canOwners, scopeAll, leaveUnassigned, history: historyRef.current,
      me: { id: String(user?.id ?? ''), name: label }, userLabel: label, fileName: name,
      today: new Date().toISOString().slice(0, 10), dupMode, updateExisting: upd,
    }, (done, total) => setProg({ done, total, label: 'Checking rows' }));
  };

  // ---------------------------------------------------------------------------------------------
  // reading the file
  // ---------------------------------------------------------------------------------------------
  const processFile = async (file: File) => {
    setError(''); setResult(null); setPlan(null);
    if (isReadOnly) { setError('Unauthorized. You do not have permissions to import records.'); return; }
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setError('Please choose an .xlsx or .csv file (an old .xls file: open it in Excel and save as .xlsx).'); return; }
    if (file.size > MAX_IMPORT_BYTES) { setError('File is too large (max 80 MB).'); return; }
    setPhase('reading'); setFileName(file.name); setProg({ done: 0, total: 0, label: 'Reading the file' });
    await tick();
    try {
      let headers: string[] = []; let body: string[][] = [];
      if (/\.xlsx$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const sh = await readXlsx(buf, 'Leads');
        headers = (sh.rows[0] || []).map((h) => cleanCell(h));
        body = sh.rows.slice(1);
        // migration file: a second sheet "Comments & Notes" holds each lead's comments, assignments, status changes and call outcomes
        historyRef.current = undefined;
        try {
          setProg({ done: 0, total: 0, label: 'Reading the history sheet' }); await tick();
          const h = await readXlsx(buf, 'Comments & Notes');
          if (h.name.toLowerCase() === 'comments & notes') { const hm = parseHistory(h.rows); if (hm.size) { historyRef.current = hm; setDupMode('import'); } }
        } catch { /* a plain lead sheet has no history sheet */ }
      } else {
        const objs = parseCSV(await file.text()) as Record<string, string>[];
        if (objs.length) { headers = Object.keys(objs[0]); body = objs.map((o) => headers.map((h) => o[h] ?? '')); }
      }
      if (!headers.some(Boolean) || !body.length) throw new Error('The file has no data rows below the header row.');
      if (body.length > MAX_IMPORT_ROWS) throw new Error(`Too many rows (max ${MAX_IMPORT_ROWS} per file).`);
      sheetRef.current = { headers, body };
      const p = await makePlan(updateExisting, file.name);
      if (p.fatal) { setError(p.fatal); setPhase('idle'); return; }
      setPlan(p); setPhase('preview');
    } catch (e: any) {
      setError(e?.message || 'The file could not be read.'); setPhase('idle');
    }
  };

  const toggleUpdate = async (v: boolean) => {
    setUpdateExisting(v);
    if (!sheetRef.current) return;
    setPhase('reading');
    const p = await makePlan(v);
    setPlan(p); setPhase('preview');
  };

  // ---------------------------------------------------------------------------------------------
  // importing in chunks of 100 (the UI stays responsive: every chunk waits for the server, then yields)
  // ---------------------------------------------------------------------------------------------
  const idPool = useRef<string[]>([]);
  const takeIds = async (n: number): Promise<string[]> => {
    while (idPool.current.length < n) {
      try {
        const res = await fetch('/api/crm/ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'lead', n: 20 }) });
        if (!res.ok) break;
        idPool.current.push(...((await res.json()).ids || []));
      } catch { break; }
    }
    const out = idPool.current.splice(0, n);
    while (out.length < n) out.push(`LD-T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`);
    return out;
  };

  const runImport = async () => {
    if (!plan || !summary) return;
    cancelRef.current = false;
    const rows = plan.rows.filter((r) => r.lead && (r.kind === 'update' || (r.kind === 'new' && !(r.dup && dupMode === 'skip'))));
    const total = rows.length;
    setPhase('importing'); setProg({ done: 0, total, label: 'Importing' });
    let added = 0, updated = 0, failed = 0, done = 0, cancelled = false;
    const failedRows: string[][] = [['Row', 'Lead name', 'Result', 'Details']];
    const usedIds = new Set(crmService.getLeads().map((l) => l.id));

    for (let i = 0; i < rows.length; i += CHUNK) {
      if (cancelRef.current) { cancelled = true; break; }
      const part = rows.slice(i, i + CHUNK);
      const fresh = part.filter((r) => r.kind === 'new');
      const needId = fresh.filter((r) => !(r.lead!.legacyId && ID_OK.test(r.lead!.legacyId) && !usedIds.has(r.lead!.legacyId)));
      const pool = needId.length ? await takeIds(needId.length) : [];
      let pi = 0;
      const newLeads: Lead[] = []; const upd = new Map<string, Lead>(); const newIds: string[] = [];
      for (const r of part) {
        if (r.kind === 'update') { upd.set(r.lead!.id, r.lead!); continue; }
        const l = { ...r.lead! };
        l.id = needId.includes(r) ? pool[pi++] : l.legacyId!;
        usedIds.add(l.id);
        newLeads.push(l); newIds.push(l.id);
      }
      const current = crmService.getLeads();
      crmService.saveLeads([...newLeads, ...current.map((l) => upd.get(l.id) || l)]);
      await crmService.whenSaved();
      if (leaveUnassigned) for (const id of newIds) crmService.routeLeadAutomatically(id);
      const after = new Map(crmService.getLeads().map((l) => [l.id, l]));
      for (const r of part) {
        if (r.kind === 'update') {
          const got = after.get(r.lead!.id);
          if (got && (got.timeline || []).some((e) => e.id === r.lead!.timeline[r.lead!.timeline.length - 1].id)) updated++;
          else { failed++; failedRows.push([String(r.rowNo), r.name, 'Not saved', 'Refused or changed by someone else: the server reason was shown as a message']); }
        }
      }
      let k = 0;
      for (const r of part) {
        if (r.kind !== 'new') continue;
        if (after.has(newIds[k++])) added++;
        else { failed++; failedRows.push([String(r.rowNo), r.name, 'Not saved', 'Refused by the server: the reason was shown as a message']); }
      }
      done += part.length;
      setProg({ done, total, label: 'Importing' });
      await tick();
    }
    if (failedRows.length > 1) saveBlob(csvBlob(failedRows), `crm_import_not_saved_${new Date().toISOString().slice(0, 10)}.csv`);
    setResult({ added, updated, failed, cancelled });
    setPhase('done');
    onLeadsUpdated();
    toast[failed ? 'warning' : 'success'](`Import finished: ${added} added, ${updated} updated${failed ? `, ${failed} not saved` : ''}.`);
  };

  const reset = () => { setPhase('idle'); setPlan(null); setResult(null); setError(''); sheetRef.current = null; setFileName(''); };

  // ---------------------------------------------------------------------------------------------
  // export / template / report
  // ---------------------------------------------------------------------------------------------
  const stamp = new Date().toISOString().slice(0, 10);
  const exportRows = () => [XLSX_HEADERS as unknown as (string | number)[], ...visibleLeads.map(leadToRow)];
  const handleExportXlsx = () => {
    saveBlob(buildXlsx([{ name: 'Leads', rows: exportRows(), widths: XLSX_HEADERS.map((h) => (h.length > 16 ? 22 : 16)) }]), `Elsewedy_CRM_Leads_${stamp}.xlsx`);
  };
  const handleExportCsv = () => saveBlob(csvBlob(exportRows()), `Elsewedy_CRM_Leads_${stamp}.csv`);
  const handleDownloadTemplate = () => {
    const ref: string[][] = [['Instructions'], ['Fill the "Leads" sheet. Only Lead Name is required. Blank cells never clear existing data.'],
      ['Dates: YYYY-MM-DD or DD/MM/YYYY (day first). Phones: any format, they are converted to +20… style.'],
      ['A Lead ID that already exists updates that lead (only if you can see it). A new Lead ID is kept as the previous system ID.'],
      ['Assigned To: matched to a team member by name (Sales Operation only). Names that match nobody or several people are left unassigned.'], [],
      ['Sources', ...SOURCES], ['Projects', ...PROJECTS], ['Statuses', ...STATUSES], ['Priorities', ...PRIORITIES],
      ['Team members', ...people().map((p) => p.name)]];
    saveBlob(buildXlsx([{ name: 'Leads', rows: [XLSX_HEADERS as unknown as string[]], widths: XLSX_HEADERS.map((h) => (h.length > 16 ? 22 : 16)) }, { name: 'Reference', rows: ref }]), 'Elsewedy_CRM_Leads_template.xlsx');
  };
  const downloadReport = () => plan && saveBlob(csvBlob(reportRows(plan, dupMode)), `crm_import_report_${stamp}.csv`);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (phase !== 'idle' && phase !== 'done') return;
    if (e.dataTransfer.files?.[0]) void processFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void processFile(f);
  };

  const Tile = ({ n, label, tone }: { n: number; label: string; tone?: string }) => (
    <div className={`rounded-xl border px-3 py-2 ${tone || 'bg-brand-gray/5 border-brand-gray/15'}`}>
      <div className="text-lg font-extrabold text-brand-black font-mono">{n.toLocaleString()}</div>
      <div className="text-[10px] text-brand-gray font-bold uppercase tracking-wide">{label}</div>
    </div>
  );

  const busy = phase === 'reading' || phase === 'importing';

  return (
    <div className="space-y-6 text-xs font-semibold" id="crm-import-export-root">
      <div>
        <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
          <span>Bulk Transfer</span>
          <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2.5 py-0.5 rounded-full">Excel / CSV</span>
        </h3>
        <p className="text-xs text-brand-gray/80 mt-1">
          Import and export leads in the sales team's 35-column sheet. Every import shows a preview first; nothing is saved until you confirm.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Importer */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-6 space-y-4">
          <h4 className="font-extrabold text-brand-black text-sm uppercase tracking-wider flex items-center gap-2">
            <Upload size={16} className="text-brand-red" />
            <span>Import leads</span>
          </h4>

          {(phase === 'idle' || phase === 'done') && (
            <>
              <p className="text-brand-gray font-semibold leading-relaxed">
                {canOwners
                  ? 'The "Assigned To" column is matched to your team by name. Names that match nobody (or several people) stay unassigned and are listed for you.'
                  : leaveUnassigned ? 'Leads you import go to the sales team through the routing rules (the owner is set by the Routing page, like e-mail leads). The owner, source, phone, e-mail, lead date and priority of existing leads cannot be changed by an import.'
                  : 'Leads you import are assigned to you. The owner, source, phone, e-mail, lead date and priority of existing leads cannot be changed by an import.'}
              </p>
              <div
                onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${dragActive ? 'border-brand-red bg-brand-red/5' : 'border-brand-gray/25 bg-brand-gray/5'}`}
              >
                <input type="file" id="crm-file-upload" accept=".xlsx,.csv" onChange={handleFileChange} className="hidden" />
                <label htmlFor="crm-file-upload" className="cursor-pointer space-y-3.5 block">
                  <FileSpreadsheet className="mx-auto text-brand-gray/40" size={36} />
                  <div>
                    <span className="text-brand-red hover:underline font-extrabold block">Select an .xlsx or .csv file</span>
                    <span className="text-[10px] text-brand-gray font-bold mt-1 block">or drag and drop it here (up to {MAX_IMPORT_ROWS.toLocaleString()} rows)</span>
                  </div>
                </label>
              </div>
              <div className="pt-1 flex justify-between items-center text-[11px]">
                <span className="text-brand-gray font-bold">First time importing?</span>
                <button onClick={handleDownloadTemplate} className="text-indigo-600 hover:underline flex items-center gap-1 font-bold">
                  <Download size={13} /><span>Download the template (.xlsx)</span>
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="p-4 rounded-xl border bg-rose-50 border-rose-200 text-rose-800 flex gap-3">
              <AlertTriangle size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">{error}</p>
            </div>
          )}

          {phase === 'reading' && (
            <div className="space-y-2" role="status">
              <div className="flex items-center gap-2 text-brand-gray"><Loader2 size={14} className="animate-spin" /><span>{prog.label || 'Reading'}…</span></div>
              {prog.total > 0 && <div className="h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full bg-brand-red" style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} /></div>}
            </div>
          )}

          {phase === 'preview' && plan && summary && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0"><FileText size={14} className="text-brand-gray flex-shrink-0" /><span className="truncate font-bold text-brand-black">{fileName}</span></div>
                <button onClick={reset} className="text-brand-gray hover:text-brand-red" aria-label="Cancel import"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Tile n={summary.total} label="Rows in the file" />
                <Tile n={summary.news} label="New leads" tone="bg-emerald-50 border-emerald-200" />
                <Tile n={summary.updates} label="Existing to update" tone="bg-indigo-50 border-indigo-200" />
                <Tile n={summary.dupSystem + summary.dupFile} label={`Duplicates (${summary.dupSystem} in CRM, ${summary.dupFile} in file)`} tone={summary.dupSystem + summary.dupFile ? 'bg-amber-50 border-amber-200' : undefined} />
                <Tile n={summary.invalid} label="Invalid rows" tone={summary.invalid ? 'bg-rose-50 border-rose-200' : undefined} />
                {canOwners && <Tile n={summary.ownerNot} label="Owner not matched" tone={summary.ownerNot ? 'bg-amber-50 border-amber-200' : undefined} />}
              </div>
              {summary.unchanged > 0 && <p className="text-[11px] text-brand-gray">{summary.unchanged} row(s) change nothing and will be ignored. {summary.warnings} row(s) have warnings (see the report).</p>}
              {plan.corrected > 0 && <p className="text-[11px] text-brand-gray">{plan.corrected} phone number(s) were converted to the international format.</p>}
              {plan.protectedIgnored && <p className="text-[11px] text-amber-700">Some columns (owner, source, phone, e-mail, priority, lead date) were ignored for existing leads: only Sales Operation can change them.</p>}

              <div className="space-y-2 text-[11px]">
                <label className="flex items-center gap-2"><span className="text-brand-gray w-36">Duplicates</span>
                  <select value={dupMode} onChange={(e) => setDupMode(e.target.value as 'skip' | 'import')} className="border border-brand-gray/25 rounded-lg px-2 py-1 bg-white">
                    <option value="skip">Skip them (recommended)</option>
                    <option value="import">Import them anyway (review on the Duplicates page)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 cursor-pointer"><span className="text-brand-gray w-36">Lead ID in the file</span>
                  <input type="checkbox" checked={updateExisting} onChange={(e) => void toggleUpdate(e.target.checked)} />
                  <span>Update the existing lead with that ID (only leads you can see)</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={downloadReport} className="px-3 py-2 rounded-xl border border-brand-gray/25 text-brand-black font-bold flex items-center gap-1.5 hover:bg-brand-gray/5">
                  <Download size={13} /> Row report (.csv)
                </button>
                <button onClick={() => void runImport()} disabled={summary.toImport === 0}
                  className="px-4 py-2 rounded-xl bg-brand-red text-white font-extrabold flex items-center gap-1.5 disabled:opacity-40">
                  <Upload size={13} /> Import {summary.toImport.toLocaleString()} lead{summary.toImport === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          )}

          {phase === 'importing' && (
            <div className="space-y-2" role="status">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-brand-gray"><Loader2 size={14} className="animate-spin" />{prog.label}: {prog.done.toLocaleString()} of {prog.total.toLocaleString()}</span>
                <button onClick={() => { cancelRef.current = true; }} className="text-brand-red font-bold hover:underline">Stop after this batch</button>
              </div>
              <div className="h-2 bg-brand-gray/10 rounded-full overflow-hidden"><div className="h-full bg-brand-red transition-all" style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} /></div>
              <p className="text-[10px] text-brand-gray">Leads are saved in batches of {CHUNK}. Please keep this page open.</p>
            </div>
          )}

          {phase === 'done' && result && (
            <div className={`p-4 rounded-xl border flex gap-3 ${result.failed ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <span className="font-bold block text-xs">{result.cancelled ? 'Import stopped' : 'Import finished'}</span>
                {result.added} new lead(s) added, {result.updated} updated{result.failed ? `, ${result.failed} not saved (a list was downloaded)` : ''}.
              </div>
            </div>
          )}
        </div>

        {/* Export */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="font-extrabold text-brand-black text-sm uppercase tracking-wider flex items-center gap-2">
              <Download size={16} className="text-brand-gray" />
              <span>Export leads</span>
            </h4>
            <p className="text-brand-gray font-semibold leading-relaxed">
              Downloads the leads you are allowed to see in the same 35 columns as the import sheet (Lead ID first), so the file can be edited and imported back.
            </p>
            <div className="p-4 bg-brand-gray/5 border border-brand-gray/10 rounded-xl space-y-2.5">
              <div className="flex justify-between"><span className="text-brand-gray">Columns:</span><span className="text-brand-black font-extrabold font-mono">{XLSX_HEADERS.length}</span></div>
              <div className="flex justify-between"><span className="text-brand-gray">Leads to export:</span><span className="text-brand-black font-bold font-mono">{visibleLeads.length.toLocaleString()}</span></div>
            </div>
          </div>
          <div className="space-y-2 mt-6">
            <button onClick={handleExportXlsx} className="w-full bg-brand-black hover:bg-brand-black/90 text-white font-extrabold py-3 rounded-xl flex items-center justify-center gap-2 shadow">
              <Download size={15} /><span>Export to Excel (.xlsx)</span>
            </button>
            <button onClick={handleExportCsv} className="w-full border border-brand-gray/25 text-brand-black font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-brand-gray/5">
              <Download size={14} /><span>Export as CSV</span>
            </button>
          </div>
        </div>
      </div>
      {busy && <span className="sr-only">Working</span>}
    </div>
  );
};
