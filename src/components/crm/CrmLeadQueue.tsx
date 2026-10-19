import React, { useState } from 'react';
import { CallCenterFairness } from './CallCenterFairness';
import { EmailImportLog, Lead } from './types';
import { crmService } from './crmService';
import DOMPurify from 'dompurify';
import {  
  Mail, 
  RefreshCw, 
  Play, 
  AlertTriangle, 
  CheckCircle, 
  HelpCircle, 
  ArrowRight, 
  Clock, 
  Send,
  Sparkles,
  Search,
  X
, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CrmLeadQueueProps {
  logs: EmailImportLog[];
  leads: Lead[];
  onLogsUpdated: () => void;
  setActiveSubTab?: (tab: string) => void;
}

const WEB_TEMPLATE = `Customer Name
صاحب شركة / اسلام محمد سماني

Customer Number
01118485856

Company Name
ستيفنر للحديد

Project Name
Industria East

Lead Source
Google

Priority
Normal (24 Working Hours)

Required Size
3000

Comment
Looking for light industrial plot immediately for steel rolling factory cold-rolling line. Require 500 KVA power.`;

const MOBILE_TEMPLATE = `Sales Lead :: Mobile App
New Plot Inquiry Request
CONTACT INFORMATION
Name: اكد فواد خضر 
Email: afouad1258@gmail.com 
Phone: 01006795934 
INQUIRY DETAILS
Project: إندستريا أكتوبر 
Plot Type: FoodProcessing 
Priority: Medium 
Inquiry Type: GeneralInformation 
Message: هل يوجد مصانع اغذيه مسحات صغيره 
Date: 2026-06-06 09:10:07 UTC`;

// Email bodies are untrusted: strip scripts/styles/forms/remote media (tracking pixels), force safe links
const sanitizeEmailHtml = (html: string): string => {
  const clean = DOMPurify.sanitize(String(html || ''), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'img', 'video', 'audio', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'src'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
    RETURN_DOM_FRAGMENT: false,
  });
  // Links open in a new tab without access to this page
  return clean.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer nofollow" ');
};

export const CrmLeadQueue: React.FC<CrmLeadQueueProps> = ({ logs, leads, onLogsUpdated, setActiveSubTab }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeLog, setActiveLog] = useState<EmailImportLog | null>(null);
  const [webmailTab, setWebmailTab] = useState<'inbox' | 'sent'>('inbox');
  const [webmailEmails, setWebmailEmails] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('crm_cached_webmail_emails');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return [];
  });
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [loadingEmailBody, setLoadingEmailBody] = useState(false);
  const emailBodyCacheRef = React.useRef<Map<string, string>>(new Map());
  const openEmailIdRef = React.useRef<string | null>(null);

  // Escape closes the email modal
  React.useEffect(() => {
    if (!selectedEmail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEmail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEmail]);

  const handleEmailClick = async (email: any) => {
    openEmailIdRef.current = email.id;
    if (email.bodyHtml) {
      setSelectedEmail({ ...email });
      return;
    }

    if (emailBodyCacheRef.current.has(email.id)) {
      setSelectedEmail({ ...email, bodyHtml: emailBodyCacheRef.current.get(email.id) });
      return;
    }

    setSelectedEmail({ ...email });
    setLoadingEmailBody(true);
    try {
      const res = await fetch(`/api/crm/webmail/body?id=${encodeURIComponent(email.id)}`);
      const data = await res.json();
      if (data.success) {
        emailBodyCacheRef.current.set(email.id, data.body);
        // Ignore a late response if another email was opened (or the modal closed) meanwhile
        if (openEmailIdRef.current === email.id) setSelectedEmail({ ...email, bodyHtml: data.body });
      } else if (openEmailIdRef.current === email.id) {
        setSelectedEmail({ ...email, bodyHtml: '<p>Could not load email body.</p>' });
      }
    } catch (e) {
      if (openEmailIdRef.current === email.id) setSelectedEmail({ ...email, bodyHtml: '<p>Error loading email body.</p>' });
    } finally {
      if (openEmailIdRef.current === email.id) setLoadingEmailBody(false);
    }
  };

  React.useEffect(() => {
    const cachedTime = localStorage.getItem('crm_cached_webmail_time');
    const isExpired = !cachedTime || (Date.now() - Number(cachedTime) > 3 * 60 * 1000);

    // Only fetch if empty or cache expired (>3 mins)
    if (webmailEmails.length === 0 || isExpired) {
      const fetchWebmail = (retryCount = 0) => {
        fetch('/api/crm/webmail')
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(data => {
            if (data.success) {
              setWebmailEmails(data.emails);
              try {
                localStorage.setItem('crm_cached_webmail_emails', JSON.stringify(data.emails));
                localStorage.setItem('crm_cached_webmail_time', Date.now().toString());
              } catch (e) {}
            }
          })
          .catch(err => {
             // no automatic retries: every attempt is a call to the mailbox server. The user can refresh by hand.
             console.error("Failed to fetch webmail:", err.message || err);
          });
      };
      fetchWebmail();
    }
  }, []);

  // Email simulator input
  const sender = '—';
  const subject = 'Inbound Email Sales Inquiry';
  const [emailBody, setEmailBody] = useState('');

  const [simulationResult, setSimulationResult] = useState<{ success: boolean; leadId?: string; error?: string; isDuplicate?: boolean } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number; eta: string } | null>(null);
  const [openBadge, setOpenBadge] = useState<string | null>(null);
  React.useEffect(() => { void crmService.reloadEmailLogs().then(() => onLogsUpdated()); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [logSrc, setLogSrc] = useState<'all' | 'mail' | 'sheet'>('all');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetInfo, setSheetInfo] = useState<{ lastRun: string | null; lastTab: string | null; since: string | null } | null>(null);
  const loadSheetInfo = () => { fetch('/api/crm/fb-sync/status').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setSheetInfo(j); }).catch(() => {}); };
  React.useEffect(loadSheetInfo, []);
  const handleSyncSheet = async () => {
    setSheetBusy(true); setSimulationResult(null); setSyncNotification(null);
    setSyncStatus('Reading the Facebook leads Google Sheet…');
    try {
      let created = 0, dups = 0, failed = 0, left = 0; const leads: { id: string; name: string }[] = [];
      for (let round = 0; round < 10; round++) {
        const res = await fetch('/api/crm/fb-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const part = await res.json();
        if (!res.ok || part.success === false) throw new Error(part.error || 'Could not read the sheet');
        if (part.fbSkipped) { setSyncStatus('Another sheet sync is already running. Try again in a moment.'); return; }
        if (part.fbError) throw new Error(part.fbError);
        created += part.fbNew || 0; dups += part.fbDuplicates || 0; failed += part.fbFailed || 0; left = part.fbRemaining || 0;
        leads.push(...(part.fbLeads || []));
        setSyncStatus(`Reading the Google Sheet… ${created} new lead(s) so far`);
        if (!left) break;
      }
      if (created > 0) { setSyncStatus(''); setSyncNotification({ count: created, leads }); setTimeout(() => setSyncNotification(null), 15000); }
      else setSyncStatus(`Google Sheet synced. No new leads (${dups} duplicate, ${failed} could not be read).`);
      if (left > 0) setSyncStatus((x) => `${x || ''} ${left} more are waiting. Press the button again.`.trim());
      loadSheetInfo(); await crmService.reloadEmailLogs(); await crmService.refreshDelta({ force: true, kinds: ['leads'] }); onLogsUpdated();
    } catch (e: any) { setSyncStatus(`Sheet sync failed: ${e?.message || 'unknown error'}`); }
    finally { setSheetBusy(false); }
  };
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const mailStatus = (email: any): { ok: boolean; text: string; leadId?: string; kind?: 'warn' } => {
    const lead = leads.find((l: any) => (l as any).emailId && (l as any).emailId === email.id);
    if (lead) return { ok: true, text: `Synced: lead ${lead.id} was created from this e-mail.`, leadId: lead.id };
    const log: any = logs.find((l: any) => l.id === email.id);
    if (log?.status === 'Success' && log.parsedLeadId) return { ok: true, text: `Synced: lead ${log.parsedLeadId} was created from this e-mail.`, leadId: log.parsedLeadId };
    if (log?.status === 'Duplicate') return { ok: false, kind: 'warn', text: `Not created: ${log.error || 'duplicate of an existing lead'}`, leadId: log.parsedLeadId };
    if (log) return { ok: false, text: `Not created: ${log.error || log.status}` };
    const subj = String(email.subject || '').toLowerCase();
    if (!['sales lead', 'inquiry', 'enquiry', 'contact', 'form', 'lead', 'request', 'new submission', 'plan your visit'].some((h) => subj.includes(h)))
      return { ok: false, kind: 'warn', text: 'Skipped: the subject does not look like a lead e-mail, so Sync ignores it.' };
    return { ok: false, text: 'Not synced yet. Press SYNC INBOX NOW.' };
  };
  const handleOpenLead = (id: string) => {
    localStorage.setItem('selected_lead_id', id);
    if (setActiveSubTab) {
      setActiveSubTab('leads');
    }
  };

  const filteredLogs = logs.filter(log => {
    const text = `${log.sender} ${log.subject} ${log.status} ${log.error || ''}`.toLowerCase();
    return text.includes(searchTerm.toLowerCase());
  });

  
  const [syncNotification, setSyncNotification] = useState<{
    count: number;
    leads: { id: string; name: string }[];
  } | null>(null);

  const handleSyncInbox = async () => {
    setIsSyncing(true);
    setSyncStatus('Reading the mailbox...');
    setProgress({ label: 'Reading the mailbox', done: 0, total: 0, eta: 'estimating the time…' });
    setSimulationResult(null);
    setSyncNotification(null);
    try {
      // one click reads the whole mailbox: the server takes 25 e-mails per call, so keep asking until none are left
      const data: any = { success: true, newLeadsCount: 0, processed: 0, duplicates: 0, failed: 0, leads: [], remaining: 0 };
      const t0 = Date.now(); let rounds = 0;
      for (let round = 0; round < 12; round++) {
        const res = await fetch('/api/crm/trigger-auto-sync', { method: 'POST' });
        const part = await res.json();
        if (!part.success) { if (round === 0) throw new Error(part.error || 'Failed to sync'); break; }
        if (part.skipped) { data.skipped = round === 0; break; }
        data.newLeadsCount += part.newLeadsCount || 0; data.processed += part.processed || 0;
        data.duplicates += part.duplicates || 0; data.failed += part.failed || 0;
        data.leads.push(...(part.leads || [])); data.remaining = part.remaining || 0;
        rounds++;
        const total = data.processed + (part.remaining || 0);
        const per = (Date.now() - t0) / rounds;                                   // average time of one round
        const left = Math.ceil((part.remaining || 0) / Math.max(1, (part.processed || 1))) * per;
        setProgress({ label: 'Reading the mailbox', done: data.processed, total, eta: left > 0 ? `about ${left < 60000 ? Math.max(5, Math.round(left / 1000)) + ' seconds' : Math.round(left / 60000) + ' min'} left` : 'almost done' });
        setSyncStatus(`Reading the mailbox… ${data.processed} of ${total} e-mails checked, ${data.newLeadsCount} new leads so far`);
        if (!part.remaining) break;
      }

      // Re-fetch webmail to show latest (forcing cache bypass)
      fetch('/api/crm/webmail?force=true').then(r => r.json()).then(webmailData => {
         if (webmailData.success) {
             setWebmailEmails(webmailData.emails);
             try {
               localStorage.setItem('crm_cached_webmail_emails', JSON.stringify(webmailData.emails));
               localStorage.setItem('crm_cached_webmail_time', Date.now().toString());
             } catch (e) {}
         }
      });

      const checked = data.processed || 0;
      if (data.skipped) {
        setSyncStatus('Another sync is already running. Try again in a moment.');
      } else if (data.newLeadsCount > 0) {
        setSyncStatus('');
        setSyncNotification({ count: data.newLeadsCount, leads: data.leads || [] });
        setTimeout(() => setSyncNotification(null), 15000);
      } else if (checked === 0) {
        setSyncStatus('Sync complete. No new lead e-mails in the inbox.');
      } else {
        setSyncStatus(`Sync complete. Checked ${checked} new e-mail(s): no new leads (${data.duplicates || 0} duplicate, ${data.failed || 0} could not be read).`);
      }
      if (data.remaining > 0) setSyncStatus((s) => `${s || ''} ${data.remaining} more e-mails are waiting. Press Sync again.`.trim());
      await crmService.reloadEmailLogs(); await crmService.refreshDelta({ force: true, kinds: ['leads'] });
      setProgress(null);
      onLogsUpdated();
    } catch (e: any) {
      setProgress(null);
      setSyncStatus('Error: ' + e.message);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 8000);
    }
  };

  const handleSimulateEmail = () => {
    setSimulationResult(null);
    if (!emailBody.trim()) {
      setSimulationResult({ success: false, error: 'Paste the raw email text first.' });
      return;
    }
    try {
      const result = crmService.parseEmailAndCreateLead({
        sender,
        subject,
        bodyPreview: emailBody
      }, 'System Administrator');

      setSimulationResult(result);
      onLogsUpdated();
    } catch (e: any) {
      setSimulationResult({ success: false, error: e.message });
    }
  };

  return (
    <div className="space-y-6" id="crm-lead-queue-root">
      <CallCenterFairness />
      {/* Webmail Mini Client */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-brand-gray/10 pb-4 gap-4">
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-brand-black flex items-center gap-2 flex-wrap text-sm sm:text-base">
              <Mail className="text-brand-red shrink-0" size={18} />
              <span className="truncate max-w-full block break-all">Sales mailbox</span>
            </h4>
            <p className="text-xs text-brand-gray mt-1">Direct IMAP/SMTP connection monitor.{sheetInfo?.lastRun ? ` Google Sheet last synced ${new Date(sheetInfo.lastRun).toLocaleString()}${sheetInfo.lastTab ? ` (tab ${sheetInfo.lastTab})` : ''}.` : ' Google Sheet not synced yet.'}</p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
             <button
                onClick={handleSyncInbox}
                disabled={isSyncing}
                className="w-full sm:w-auto justify-center bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-600/20"
              >
                {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                <span>SYNC INBOX NOW</span>
              </button>
             <button
                onClick={handleSyncSheet}
                disabled={sheetBusy}
                className="w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-60"
              >
                {sheetBusy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                <span>SYNC GOOGLE SHEET</span>
              </button>
          </div>
        </div>

        {syncStatus && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold px-4 py-3 rounded-xl flex items-center gap-2">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <span className="truncate">{syncStatus}</span>
          </div>
        )}
        {progress && (
          <div className="px-1">
            <div className="h-2.5 rounded-full bg-indigo-100 overflow-hidden"><div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }} /></div>
            <p className="text-[11px] font-bold text-indigo-800 mt-1">{progress.total ? `${progress.label}: ${progress.done} of ${progress.total} (${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%) · ${progress.eta}` : `${progress.label}… ${progress.eta}`}</p>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-48 flex flex-row md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 shrink-0 border-b md:border-b-0 md:border-r border-brand-gray/10 md:pr-4">
            <button 
              onClick={() => setWebmailTab('inbox')}
              className={`flex-1 md:flex-none text-left px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 shrink-0 ${webmailTab === 'inbox' ? 'bg-brand-red/10 text-brand-red' : 'text-brand-gray hover:bg-brand-gray/5'}`}
            >
              <span>Inbox</span>
              <span className="bg-brand-red text-white px-2 py-0.5 rounded-full text-[9px]">
                {(() => {
                  const seen = new Set<string>();
                  return webmailEmails.filter(e => {
                    if (e.folder !== 'inbox') return false;
                    if (!e.id) return true;
                    if (seen.has(e.id)) return false;
                    seen.add(e.id);
                    return true;
                  }).length;
                })()}
              </span>
            </button>
            <button 
              onClick={() => setWebmailTab('sent')}
              className={`flex-1 md:flex-none text-left px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${webmailTab === 'sent' ? 'bg-brand-red/10 text-brand-red' : 'text-brand-gray hover:bg-brand-gray/5'}`}
            >
              Sent Items
            </button>
          </div>
          <div className="flex-1 bg-brand-gray/5 rounded-xl border border-brand-gray/10 p-2 h-[300px] overflow-y-auto">
            {(() => {
              const filtered = webmailEmails.filter(e => e.folder === webmailTab);
              const seen = new Set<string>();
              const uniqueFiltered = filtered.filter(email => {
                if (!email.id) return true;
                if (seen.has(email.id)) return false;
                seen.add(email.id);
                return true;
              });
              if (uniqueFiltered.length === 0) {
                return <div className="h-full flex items-center justify-center text-brand-gray text-xs">No emails in {webmailTab}.</div>;
              }
              return (
                <div className="space-y-2">
                  {uniqueFiltered.map(email => (
                    <div key={email.id} onClick={() => handleEmailClick(email)} className="bg-white p-3 rounded-lg border border-brand-gray/10 hover:border-brand-gray/30 transition-all cursor-pointer">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 mb-1">
                        <span className="font-bold text-xs text-brand-black truncate max-w-full block">{webmailTab === 'inbox' ? email.sender : 'To: ' + email.sender}</span>
                        <span className="text-[10px] text-brand-gray shrink-0">{new Date(email.receivedTime).toLocaleString()}</span>
                      </div>
                      <div className="text-xs font-semibold text-brand-black truncate">{email.subject}</div>
                      <div className="text-[10px] text-brand-gray truncate mt-1">{email.bodyPreview}</div>
                      {webmailTab === 'inbox' && (() => {
                        const st = mailStatus(email);
                        return (
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setOpenBadge(openBadge === email.id ? null : email.id)} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : st.kind === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
                              {st.ok ? '● SYNCED' : st.kind === 'warn' ? (st.leadId ? '● DUPLICATE' : '● SKIPPED') : '● NOT SYNCED'}
                            </button>
                            {openBadge === email.id && (
                              <div className={`mt-1.5 text-[11px] rounded-lg p-2 border ${st.ok ? 'bg-emerald-50/60 border-emerald-200' : st.kind === 'warn' ? 'bg-amber-50/60 border-amber-200' : 'bg-rose-50/60 border-rose-200'}`}>
                                <p>{st.text}</p>
                                {st.leadId && <button onClick={() => handleOpenLead(st.leadId!)} className="mt-1 text-indigo-600 hover:underline font-mono font-bold">Open lead {st.leadId} →</button>}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {email.isSimulated && <span className="inline-block mt-2 text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">Simulated Fallback</span>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Title */}
      <div>
        <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
          <span>Mailbox Ingestion Queue Monitor</span>
          <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2.5 py-0.5 rounded-full">
            IMAP Active
          </span>
        </h3>
        <p className="text-xs text-brand-gray/80 mt-1">
          A single, unified smart ingestion queue that automatically detects, parses, and maps fields from both website forms and mobile app email layouts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Email Parser and Simulator */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-1">
            <h4 className="font-bold text-brand-black text-sm flex items-center gap-2">
              <Sparkles size={16} className="text-brand-red" />
              <span>Smart Unified Inbound Email Parser</span>
            </h4>
            <p className="text-[11px] text-brand-gray">
              Paste raw text from any source. Our backend uses a smart multilingual line-by-line parser to identify fields (Name, Phone, Target Project, Plot Type, Priority) and link them instantly.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1">Raw Email Body Context</label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={12}
                className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl p-3 focus:outline-none font-mono leading-relaxed"
                placeholder="Copy and paste the raw inbound email here (Web Form layout or Mobile App layout). The smart parser will automatically identify, extract, and map key fields like customer name, phone number, project, plot size, priority, and link it instantly..."
              />
            </div>

            {simulationResult && (
              <div className={`p-4 rounded-xl border flex gap-3 ${simulationResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                {simulationResult.success ? (
                  <CheckCircle size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold block text-xs">{simulationResult.success ? 'Smart Parser Success!' : 'Parser Error Triggered'}</span>
                  <p className="text-[11px] leading-relaxed mt-0.5">
                    {simulationResult.success ? (
                      <>
                        {simulationResult.isDuplicate ? 'Already imported - existing lead record found (no new lead created):' : 'Inbound email successfully mapped and processed! Associated Lead Record created:'}{' '}
                        <button
                          onClick={() => handleOpenLead(simulationResult.leadId || '')}
                          className="font-bold text-indigo-700 underline hover:text-indigo-900 focus:outline-none cursor-pointer"
                        >
                          {simulationResult.leadId}
                        </button>
                        .{simulationResult.isDuplicate ? '' : ' Duplicate check done; the routing rule is applied by the server (an assigned lead keeps the status New with its owner).'}
                      </>
                    ) : (
                      simulationResult.error
                    )}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleSimulateEmail}
              className="w-full bg-brand-red hover:bg-brand-red-dark text-white font-extrabold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow cursor-pointer transition-all"
            >
              <Send size={14} />
              <span>Ingest & Parse Email Inbound</span>
            </button>
          </div>
        </div>

        {/* Email Logs Monitor list */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-5 flex flex-col h-[520px] justify-between">
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-brand-black text-sm uppercase tracking-wide">Historical Mail Ingestion Log</h4>
              <span className="text-[10px] text-brand-gray font-bold uppercase tracking-wider">Auto-refresh Active</span>
            </div>

            
            <div className="flex gap-1.5">
              {([['all', 'All'], ['mail', 'E-mails'], ['sheet', 'Google Sheet']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setLogSrc(k)} className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${logSrc === k ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-gray border-brand-gray/20 hover:border-brand-gray/40'}`}>{l}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray" size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search ingestion logs..."
                className="w-full pl-9 pr-3 py-1.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl text-xs focus:outline-none"
              />
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {(() => {
                const seenLogIds = new Set<string>();
                const uniqueLogs = filteredLogs.filter(log => {
                  const isSheet = String(log.sender || '').startsWith('Facebook Leads');
                  if (logSrc === 'sheet' && !isSheet) return false;
                  if (logSrc === 'mail' && isSheet) return false;
                  if (!log.id) return true;
                  if (seenLogIds.has(log.id)) return false;
                  seenLogIds.add(log.id);
                  return true;
                });
                if (uniqueLogs.length === 0) {
                  return <p className="text-center text-brand-gray text-xs py-8">No matching ingestion records.</p>;
                }
                return uniqueLogs.map(log => {
                  const isSuccess = log.status === 'Success';
                  const isDeleted = log.status === 'Deleted';
                  return (
                    <div 
                      key={log.id}
                      onClick={() => setActiveLog(log)}
                      className={`p-3 rounded-xl border cursor-pointer hover:border-brand-red/30 transition-all ${activeLog?.id === log.id ? 'border-brand-red/50 bg-brand-red/5' : 'bg-brand-gray/5 border-brand-gray/15'}`}
                    >
                      <div className="flex justify-between items-start text-[10px] font-bold text-brand-gray">
                        <span className="truncate max-w-[150px]">{log.sender}</span>
                        <span className="font-mono flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(log.receivedTime).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <h5 className="font-bold text-brand-black text-xs truncate mt-1">{log.subject}</h5>
                      {(log as any).syncedAt && <p className="text-[10px] text-brand-gray mt-0.5">Synced {new Date((log as any).syncedAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>}
                      <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-brand-gray/10 text-[9px] font-bold">
                        <span className={isSuccess ? 'text-emerald-700' : isDeleted ? 'text-amber-600' : 'text-rose-600'}>
                          {isSuccess ? 'CREATED' : isDeleted ? 'DELETED' : log.status === 'Duplicate' ? 'DUPLICATE · NOT CREATED' : 'NOT CREATED'}
                        </span>
                        {isSuccess ? (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (log.parsedLeadId) handleOpenLead(log.parsedLeadId);
                            }}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline font-mono cursor-pointer"
                          >
                            LEAD {log.parsedLeadId}
                          </button>
                        ) : (
                          <span className="text-rose-500 font-semibold truncate max-w-[150px]">{log.error}</span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Active log drilldown overlay drawer */}
          {activeLog && (
            <div className="bg-brand-black text-white p-4 rounded-xl mt-4 text-[11px] leading-relaxed space-y-2 relative">
              <button onClick={() => setActiveLog(null)} className="absolute top-2.5 right-2.5 text-white/60 hover:text-white">
                <X size={14} />
              </button>
              <h5 className="font-bold text-brand-red">Mail Header Analyzer</h5>
              <p><strong>Sender:</strong> {activeLog.sender}</p>
              <p><strong>Subject:</strong> {activeLog.subject}</p>
              <p><strong>Raw Body Match Preview:</strong></p>
              <pre className="bg-white/10 p-2 rounded text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                {activeLog.bodyPreview}
              </pre>
            </div>
          )}
        </div>

      </div>


      {/* Email Body Modal */}
      {selectedEmail && (
        <div role="dialog" aria-modal="true" aria-label="Email body" className="fixed inset-0 bg-brand-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden relative">
            <button 
              onClick={() => { openEmailIdRef.current = null; setSelectedEmail(null); }}
              aria-label="Close email"
              className="absolute top-4 right-4 text-brand-gray hover:text-brand-black bg-brand-gray/10 hover:bg-brand-gray/20 rounded-full p-2 transition-colors z-10"
            >
              <X size={20} />
            </button>
            <div className="p-6 border-b border-brand-gray/10 pr-16 bg-brand-gray/5">
              <h2 className="text-xl font-bold text-brand-black mb-2">{selectedEmail.subject}</h2>
              <div className="flex justify-between items-center text-sm">
                <span className="font-semibold text-brand-black">From: {selectedEmail.sender}</span>
                <span className="text-brand-gray">{new Date(selectedEmail.receivedTime).toLocaleString()}</span>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-white relative">
              {loadingEmailBody ? (
                <div className="flex items-center justify-center h-48 text-brand-gray">
                  <Loader2 className="animate-spin mr-2" size={24} /> Loading full email content...
                </div>
              ) : selectedEmail.bodyHtml && selectedEmail.bodyHtml.replace(/<[^>]*>/g, '').trim() ? (
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selectedEmail.bodyHtml) }} />
              ) : (
                <div className="whitespace-pre-wrap text-sm text-brand-black">{selectedEmail.bodyPreview}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Floating Side Notification */}
      <AnimatePresence>
        {syncNotification && (
          <motion.div
            initial={{ opacity: 0, x: 100, y: 0 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed bottom-6 right-6 z-50 max-w-sm w-96 bg-white rounded-2xl border border-indigo-200 shadow-2xl shadow-indigo-500/10 p-5 space-y-3 pointer-events-auto"
            id="crm-sync-notification"
          >
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h5 className="font-bold text-brand-black text-sm">Inbox Sync Complete</h5>
                  <p className="text-[10px] text-brand-gray">New leads imported successfully</p>
                </div>
              </div>
              <button 
                onClick={() => setSyncNotification(null)}
                className="text-brand-gray hover:text-brand-black transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-indigo-50/50 rounded-xl p-3.5 border border-indigo-100/50 space-y-2">
              <p className="text-xs font-semibold text-indigo-950">
                We found and synchronized <span className="text-indigo-600 font-extrabold">{syncNotification.count}</span> new sales lead{syncNotification.count > 1 ? 's' : ''}:
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {(() => {
                  const seenLeadIds = new Set<string>();
                  return syncNotification.leads
                    .filter(lead => {
                      if (!lead.id) return true;
                      if (seenLeadIds.has(lead.id)) return false;
                      seenLeadIds.add(lead.id);
                      return true;
                    })
                    .map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          handleOpenLead(lead.id);
                          setSyncNotification(null);
                        }}
                        className="w-full text-left bg-white hover:bg-indigo-50 border border-indigo-100/60 hover:border-indigo-200 p-2 rounded-lg text-xs font-bold text-indigo-900 flex justify-between items-center transition-all group shadow-sm"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="text-indigo-600 underline font-extrabold group-hover:text-indigo-700">{lead.id}</span>
                          <span className="text-brand-black font-semibold truncate">({lead.name})</span>
                        </span>
                        <span className="text-[9px] text-indigo-400 group-hover:text-indigo-600 transition-colors shrink-0">View Lead &rarr;</span>
                      </button>
                    ));
                })()}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setSyncNotification(null)}
                className="text-[11px] font-bold text-brand-gray hover:text-brand-black"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
