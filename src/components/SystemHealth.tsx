import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UsagePanel } from './UsagePanel';
import { ClientIssues } from './ClientIssues';
import { motion } from 'motion/react';
import { Activity, Database, Key, RefreshCw, CheckCircle2, AlertCircle, Clock, History, Mail, Users, Gauge } from 'lucide-react';

type Diag = {
  timestamp: string;
  serverMs: number;
  database: { connected: boolean; error: string | null; counts: Record<string, number | null> };
  environment: { hasGeminiKey: boolean; aiStatus: string; aiError: string | null };
  email: { status: string; error: string | null; host: string; mailbox: string };
  ingestion: { auto: boolean; lastLogAt: string | null; lastLogStatus: string | null; mailLogs24h: number | null; leadsFromMail24h: number | null };
  leadsHealth: {
    total: number | null; noOwner: number | null; unlinkedImportedOwners: number | null; missingPhone: number | null;
    duplicatePhoneGroups: number | null; duplicatePhoneLeads: number | null;
  };
};

// Last diagnostics kept in memory so reopening the page shows data at once (refreshed quietly in the background).
let diagCache: { data: Diag; at: number; apiMs: number | null; callMs: number | null } | null = null;
const PAGE_SIZE = 30;

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

const COUNT_LABELS: [string, string][] = [
  ['users', 'Users'], ['tickets', 'Tickets'], ['workflowRequests', 'Workflow requests'], ['leads', 'Leads'],
  ['contacts', 'Contacts'], ['companies', 'Companies'], ['mailLogs', 'Mail logs'], ['leadAudit', 'Lead audit rows'],
];

const Skel: React.FC<{ w?: string }> = ({ w = 'w-16' }) => <span className={`inline-block h-4 ${w} rounded bg-black/10 animate-pulse align-middle`} />;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between items-center gap-3">
    <span className="text-sm text-brand-gray">{label}</span>
    <span className="text-sm font-bold text-right">{children}</span>
  </div>
);

export const SystemHealth: React.FC = () => {
  const [diag, setDiag] = useState<Diag | null>(diagCache?.data ?? null);
  const [apiMs, setApiMs] = useState<number | null>(diagCache?.apiMs ?? null);
  const [callMs, setCallMs] = useState<number | null>(diagCache?.callMs ?? null);
  const [diagLoading, setDiagLoading] = useState(!diagCache);
  const [diagFailed, setDiagFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'issues' | 'usage'>('overview');
  const [logs, setLogs] = useState<any[] | null>(null);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [manualKey, setManualKey] = useState('');

  const mounted = useRef(true);
  const diagCtl = useRef<AbortController | null>(null);
  const logCtl = useRef<AbortController | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => mounted.current && setNotification(null), 5000);
  };

  // One request for the diagnostics (plus a tiny /health ping for the round-trip time). One automatic retry.
  const loadDiag = useCallback(async (ping = false): Promise<boolean> => {
    diagCtl.current?.abort();
    const ctl = new AbortController();
    diagCtl.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 20000);
    const t0 = performance.now();
    const pingReq = fetch('/api/health', { signal: ctl.signal })
      .then(r => (r.ok ? Math.round(performance.now() - t0) : null)).catch(() => null);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const t1 = performance.now();
          const res = await fetch(`/api/admin/diagnostics${ping ? '?ping=true' : ''}`, { signal: ctl.signal });
          if (!res.ok) throw new Error(String(res.status));
          const data: Diag = await res.json();
          if (!mounted.current || diagCtl.current !== ctl) return false;
          const call = Math.round(performance.now() - t1);
          const ms = await pingReq;
          if (!mounted.current || diagCtl.current !== ctl) return false;
          diagCache = { data, at: Date.now(), apiMs: ms, callMs: call };
          setDiag(data); setApiMs(ms); setCallMs(call); setDiagFailed(false);
          return true;
        } catch (e: any) {
          if (e?.name === 'AbortError' || !mounted.current || diagCtl.current !== ctl) return false;
          if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
        }
      }
      if (mounted.current && diagCtl.current === ctl) setDiagFailed(true);
      return false;
    } finally {
      clearTimeout(timer);
      if (mounted.current && diagCtl.current === ctl) setDiagLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (page: number) => {
    logCtl.current?.abort();
    const ctl = new AbortController();
    logCtl.current = ctl;
    setLogLoading(true); setLogError(null);
    try {
      const res = await fetch(`/api/admin/activity?page=${page}&limit=${PAGE_SIZE}`, { signal: ctl.signal });
      if (!res.ok) throw new Error('Activity log failed');
      const data = await res.json();
      if (!mounted.current || logCtl.current !== ctl) return;
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setLogTotal(data.total || 0);
      setLogPage(data.page || page);
    } catch (e: any) {
      if (e?.name === 'AbortError' || !mounted.current) return;
      setLogError('Could not load the activity log. Use Refresh to try again.');
    } finally {
      if (mounted.current && logCtl.current === ctl) setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadDiag();
    return () => {
      mounted.current = false;
      diagCtl.current?.abort();
      logCtl.current?.abort();
      if (notifTimer.current) clearTimeout(notifTimer.current);
    };
  }, [loadDiag]);

  // the activity log is only read when its tab opens
  useEffect(() => {
    if (activeTab === 'activity' && logs === null && !logLoading) loadLogs(1);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    const jobs: Promise<unknown>[] = [loadDiag()];
    if (activeTab === 'activity') jobs.push(loadLogs(logPage));
    const [ok] = (await Promise.all(jobs)) as [boolean];
    if (mounted.current) {
      setRefreshing(false);
      if (ok) notify('success', 'System health refreshed.'); else notify('error', 'Could not load system diagnostics.');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    const ok = await loadDiag(true);
    if (!mounted.current) return;
    setTesting(false);
    if (!ok) notify('error', 'The connection test could not be completed.');
    else notify('success', 'Mailbox and AI connection test completed.');
  };

  const handleSaveKey = async () => {
    if (!manualKey.trim()) return;
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiKey: manualKey.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save key');
      setShowKeyInput(false); setManualKey('');
      notify('success', 'Gemini API key saved.');
      loadDiag();
    } catch (e: any) {
      notify('error', e?.message || 'Failed to save key');
    }
  };

  const totalPages = Math.max(1, Math.ceil(logTotal / PAGE_SIZE));
  const d = diag;
  const L = d?.leadsHealth;
  const ing = d?.ingestion;
  const busy = refreshing || (diagLoading && !d);
  const V = (v: React.ReactNode, w?: string) => (d ? v : <Skel w={w} />);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-brand-black">System Health</h2>
          <p className="text-brand-gray">Live status of the API, database, mail ingestion, AI and lead data</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="flex bg-black/5 p-1 rounded-xl mr-2">
            {([['overview', 'Overview'], ['activity', 'User Activity'], ['issues', 'App issues'], ['usage', 'Usage']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setActiveTab(k)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === k ? 'bg-white shadow-sm text-brand-black' : 'text-brand-gray hover:text-brand-black'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="flex-1 sm:flex-none btn-secondary flex items-center justify-center gap-2">
            <RefreshCw size={18} className={busy ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl border flex items-center gap-3 ${
            notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <p className="text-sm font-medium">{notification.message}</p>
        </motion.div>
      )}

      {diagFailed && !d && activeTab === 'overview' && (
        <div className="p-4 rounded-xl border bg-red-50 border-red-200 text-red-700 text-sm font-medium">
          System diagnostics could not be loaded. Use Refresh to try again.
        </div>
      )}

      {activeTab === 'usage' ? <UsagePanel /> : activeTab === 'issues' ? <ClientIssues /> : activeTab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">API</p>
              <p className="text-xl font-bold text-emerald-900">{apiMs == null ? (diagLoading ? <Skel /> : 'No answer') : `${apiMs} ms`}</p>
            </div>
            <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">Database</p>
              <p className="text-xl font-bold text-slate-900">{V(d?.database.connected ? 'Operational' : 'Offline')}</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Mail ingestion</p>
              <p className="text-xl font-bold text-amber-900">{V(ing?.auto ? 'Scheduled' : 'Manual only', 'w-24')}</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl">
              <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">AI</p>
              <p className={`text-xl font-bold ${d?.environment.aiStatus === 'Operational' ? 'text-indigo-900' : 'text-amber-700'}`}>{V(d?.environment.aiStatus, 'w-24')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* API */}
            <div className="bento-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600"><Gauge size={20} /></div>
                <h3 className="font-bold">API</h3>
              </div>
              <div className="space-y-4">
                <Row label="Round trip (GET /api/health)">{apiMs == null ? (diagLoading ? <Skel /> : '—') : `${apiMs} ms`}</Row>
                <Row label="Diagnostics call">{callMs == null ? (diagLoading ? <Skel /> : '—') : `${callMs} ms`}</Row>
                <Row label="Server time">{V(d ? `${d.serverMs} ms` : '')}</Row>
                <Row label="Checked at">{V(when(d?.timestamp), 'w-28')}</Row>
              </div>
            </div>

            {/* Database */}
            <div className="bento-card">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg ${!d || d.database.connected ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}><Activity size={20} /></div>
                <h3 className="font-bold">Database</h3>
              </div>
              <div className="space-y-4">
                <Row label="Engine">Postgres (Supabase)</Row>
                <Row label="Connection">
                  {!d ? <Skel /> : (
                    <span className={`flex items-center gap-1 justify-end ${d.database.connected ? 'text-emerald-600' : 'text-red-600'}`}>
                      {d.database.connected ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {d.database.connected ? 'Operational' : 'Problem'}
                    </span>
                  )}
                </Row>
                {d?.database.error && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-600 font-mono break-all">{d.database.error}</div>
                )}
              </div>
            </div>

            {/* AI */}
            <div className="bento-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 text-slate-600"><Key size={20} /></div>
                  <h3 className="font-bold">AI (Gemini)</h3>
                </div>
                {d && !d.environment.hasGeminiKey && (
                  <button onClick={() => setShowKeyInput(v => !v)} className="text-[10px] font-bold text-brand-red hover:underline">
                    {showKeyInput ? 'Cancel' : 'Add key'}
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {showKeyInput ? (
                  <div className="space-y-2">
                    <input type="password" className="input-field text-xs" placeholder="Paste Gemini API key here..." value={manualKey} onChange={(e) => setManualKey(e.target.value)} />
                    <button onClick={handleSaveKey} className="w-full btn-primary py-2 text-[10px]">Save key</button>
                  </div>
                ) : (
                  <>
                    <Row label="API key">
                      {!d ? <Skel /> : <span className={d.environment.hasGeminiKey ? 'text-emerald-600' : 'text-red-600'}>{d.environment.hasGeminiKey ? 'Saved' : 'Missing'}</span>}
                    </Row>
                    <Row label="Status">
                      {!d ? <Skel /> : (
                        <span className="flex items-center gap-2 justify-end">
                          <span className={`flex items-center gap-1 ${d.environment.aiStatus === 'Operational' ? 'text-emerald-600' : d.environment.aiStatus === 'Error' ? 'text-red-600' : 'text-amber-600'}`}>
                            {d.environment.aiStatus === 'Operational' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                            {d.environment.aiStatus}
                          </span>
                          <button
                            onClick={handleTest}
                            disabled={testing || !d.environment.hasGeminiKey}
                            className="p-1 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                            title="Run live connection test"
                            aria-label="Run live AI connection test"
                          >
                            <RefreshCw size={12} className={testing ? 'animate-spin' : ''} />
                          </button>
                        </span>
                      )}
                    </Row>
                    {d?.environment.aiError && (
                      <div className="p-2 bg-red-50 border border-red-100 rounded text-[10.5px] text-red-600 font-mono overflow-auto max-h-20">{d.environment.aiError}</div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Mail ingestion */}
            <div className="bento-card md:col-span-3">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${d?.email.status === 'Operational' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}><Mail size={20} /></div>
                  <h3 className="font-bold">Mail ingestion</h3>
                </div>
                <button
                  onClick={handleTest}
                  disabled={testing || !d || d.email.status === 'Not Configured'}
                  className="text-[10px] font-bold text-brand-red hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {testing ? 'Testing...' : 'Test mailbox'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <Row label="Mailbox">{V(d?.email.mailbox || (d?.email.host ? d.email.host : 'Not configured'), 'w-32')}</Row>
                <Row label="Mailbox status">
                  {!d ? <Skel /> : (
                    <span className={d.email.status === 'Operational' ? 'text-emerald-600' : d.email.status === 'Error' ? 'text-red-600' : 'text-brand-gray'}>{d.email.status}</span>
                  )}
                </Row>
                <Row label="Scheduled ingestion">{V(ing?.auto ? 'On' : 'Off')}</Row>
                <Row label="Last mail log">{V(ing?.lastLogAt ? `${when(ing.lastLogAt)}${ing.lastLogStatus ? ` (${ing.lastLogStatus})` : ''}` : '—', 'w-40')}</Row>
                <Row label="Mails processed, last 24 h">{V(num(ing?.mailLogs24h))}</Row>
                <Row label="Leads created from mail, last 24 h">{V(num(ing?.leadsFromMail24h))}</Row>
              </div>
              {d?.email.error && (
                <div className="mt-4 p-2 bg-red-50 border border-red-100 rounded text-[10.5px] text-red-600 font-mono overflow-auto max-h-20">{d.email.error}</div>
              )}
            </div>

            {/* Leads data health */}
            <div className="bento-card md:col-span-3">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-brand-red/10 text-brand-red"><Users size={20} /></div>
                <h3 className="font-bold">Leads data health</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  ['Leads without an owner', L?.noOwner],
                  ['Imported owners not linked to a user', L?.unlinkedImportedOwners],
                  ['Leads missing a phone', L?.missingPhone],
                  ['Phones used by 2+ leads', L?.duplicatePhoneGroups],
                  ['Leads sharing a phone', L?.duplicatePhoneLeads],
                ].map(([label, v]) => (
                  <div key={label as string} className="p-3 bg-slate-50 rounded-xl border border-black/5">
                    <p className="text-[10px] text-brand-gray uppercase font-bold mb-1">{label as string}</p>
                    <p className={`text-2xl font-bold ${typeof v === 'number' && v > 0 ? 'text-amber-700' : 'text-brand-black'}`}>{d ? num(v as number | null | undefined) : <Skel w="w-10" />}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-brand-gray mt-3">Out of {d ? num(L?.total) : '—'} active leads. Duplicates are matched on the normalised phone number.</p>
            </div>

            {/* Row counts */}
            <div className="bento-card md:col-span-3">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600"><Database size={20} /></div>
                <h3 className="font-bold">Database rows</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {COUNT_LABELS.map(([k, label]) => (
                  <div key={k} className="p-3 bg-slate-50 rounded-xl border border-black/5">
                    <p className="text-[10px] text-brand-gray uppercase font-bold mb-1">{label}</p>
                    <p className="text-2xl font-bold text-brand-black">{d ? num(d.database.counts?.[k]) : <Skel w="w-12" />}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bento-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600"><History size={20} /></div>
            <h3 className="font-bold">User Activity Logs</h3>
          </div>

          {logError && <div className="mb-4 p-3 rounded-xl border bg-red-50 border-red-200 text-red-700 text-sm">{logError}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-black/5">
                  <th className="pb-3 font-semibold">Time</th>
                  <th className="pb-3 font-semibold">User</th>
                  <th className="pb-3 font-semibold">Action</th>
                  <th className="pb-3 font-semibold">Type</th>
                  <th className="pb-3 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {logs === null && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`s${i}`}><td colSpan={5} className="py-4"><Skel w="w-full" /></td></tr>
                ))}
                {logs?.map((log: any, i: number) => (
                  <tr key={log.id ?? i} className="hover:bg-black/5 transition-colors">
                    <td className="py-4 text-xs text-brand-gray whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-brand-red/10 flex items-center justify-center text-brand-red text-[10px] font-bold">{(log.userName || '?').charAt(0)}</div>
                        <span className="font-medium">{log.userName || '—'}</span>
                      </div>
                    </td>
                    <td className="py-4 font-bold text-xs">{log.action}</td>
                    <td className="py-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                        log.type === 'auth' ? 'bg-blue-100 text-blue-700' :
                        log.type === 'ticket' ? 'bg-emerald-100 text-emerald-700' :
                        log.type === 'workflow' ? 'bg-purple-100 text-purple-700' :
                        log.type === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                      }`}>{log.type}</span>
                    </td>
                    <td className="py-4 text-xs text-brand-gray max-w-xs truncate" title={log.details}>{log.details}</td>
                  </tr>
                ))}
                {logs && logs.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-brand-gray italic">No activity logs found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {logTotal > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-6 pt-6 border-t border-black/5">
              <p className="text-xs text-brand-gray">
                Showing <span className="font-bold text-brand-black">{(logPage - 1) * PAGE_SIZE + 1}</span> to <span className="font-bold text-brand-black">{Math.min(logPage * PAGE_SIZE, logTotal)}</span> of <span className="font-bold text-brand-black">{logTotal}</span> actions
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => loadLogs(logPage - 1)}
                  disabled={logPage <= 1 || logLoading}
                  aria-label="Previous page"
                  className="p-2 rounded-lg border border-black/5 hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Clock size={14} className="rotate-180" />
                </button>
                <span className="text-xs font-bold px-2">Page {logPage} of {totalPages}</span>
                <button
                  onClick={() => loadLogs(logPage + 1)}
                  disabled={logPage >= totalPages || logLoading}
                  aria-label="Next page"
                  className="p-2 rounded-lg border border-black/5 hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Clock size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
