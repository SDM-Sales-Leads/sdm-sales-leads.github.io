import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from '../../services/AuthContext';
import { crmService } from './crmService';
import { loadLists } from './leadConfig';
import { adminService } from '../../services/adminService';
import { Lead, Contact, Company, EmailImportLog } from './types';
import { toast } from 'sonner';
const CrmDashboard = lazy(() => import('./CrmDashboard').then(m => ({ default: m.CrmDashboard })));
const CrmMyDay = lazy(() => import('./CrmMyDay').then(m => ({ default: m.CrmMyDay })));
const CrmLeads = lazy(() => import('./CrmLeads').then(m => ({ default: m.CrmLeads })));
const CrmContacts = lazy(() => import('./CrmContacts').then(m => ({ default: m.CrmContacts })));
const CrmCompanies = lazy(() => import('./CrmCompanies').then(m => ({ default: m.CrmCompanies })));
const CrmLeadQueue = lazy(() => import('./CrmLeadQueue').then(m => ({ default: m.CrmLeadQueue })));
const CrmAssignmentRules = lazy(() => import('./CrmAssignmentRules').then(m => ({ default: m.CrmAssignmentRules })));
const CrmActivities = lazy(() => import('./CrmActivities').then(m => ({ default: m.CrmActivities })));
const CrmReports = lazy(() => import('./CrmReports').then(m => ({ default: m.CrmReports })));
const CrmImportExport = lazy(() => import('./CrmImportExport').then(m => ({ default: m.CrmImportExport })));
const CrmPlotsInventory = lazy(() => import('./CrmPlotsInventory').then(m => ({ default: m.CrmPlotsInventory })));
const CrmFinance = lazy(() => import('./CrmFinance').then(m => ({ default: m.CrmFinance })));
const CrmContracts = lazy(() => import('./CrmContracts').then(m => ({ default: m.CrmContracts })));
const CrmTargets = lazy(() => import('./CrmTargets').then(m => ({ default: m.CrmTargets })));
const CrmExternalSales = lazy(() => import('./CrmExternalSales').then(m => ({ default: m.CrmExternalSales })));
const CrmAudit = lazy(() => import('./CrmAudit').then(m => ({ default: m.CrmAudit })));
const CrmCalendar = lazy(() => import('./CrmCalendar').then(m => ({ default: m.CrmCalendar })));
const CrmHierarchy = lazy(() => import('./CrmHierarchy').then(m => ({ default: m.CrmHierarchy })));
const CrmAchievements = lazy(() => import('./CrmAchievements').then(m => ({ default: m.CrmAchievements })));
const CrmGuide = lazy(() => import('./CrmGuide').then(m => ({ default: m.CrmGuide })));
const CrmContractControl = lazy(() => import('./CrmContractControl').then(m => ({ default: m.CrmContractControl })));
const CrmLbActivity = lazy(() => import('./CrmLbActivity').then(m => ({ default: m.CrmLbActivity })));
const CrmRepActivity = lazy(() => import('./CrmRepActivity').then(m => ({ default: m.CrmRepActivity })));
const CrmTeamPerformance = lazy(() => import('./CrmTeamPerformance').then(m => ({ default: m.CrmTeamPerformance })));
const CrmBdTracker = lazy(() => import('./CrmBdTracker').then(m => ({ default: m.CrmBdTracker })));
const CrmOffers = lazy(() => import('./CrmOffers').then(m => ({ default: m.CrmOffers })));
const CrmDuplicates = lazy(() => import('./CrmDuplicates').then(m => ({ default: m.CrmDuplicates })));
import { 
  TrendingUp, 
  Users, 
  Building, 
  Mail, 
  CheckSquare, 
  GitMerge, 
  Share2, 
  Activity, 
  BarChart, 
  Sliders, 
  LayoutDashboard,
  UploadCloud,
  Layers,
  Database
} from 'lucide-react';

interface SalesCrmModuleProps {
  activeSubTab?: string;
  setActiveSubTab?: (tab: string) => void;
}

export const SalesCrmModule: React.FC<SalesCrmModuleProps> = ({ 
  activeSubTab: propActiveSubTab,
  setActiveSubTab: propSetActiveSubTab
}) => {
  const { user } = useAuth();
  const currentRole = user?.role || 'Read Only';

  const [localActiveSubTab, localSetActiveSubTab] = useState('dashboard');
  const activeSubTab = propActiveSubTab || localActiveSubTab;
  const setActiveSubTab = propSetActiveSubTab || localSetActiveSubTab;
  // the Executive Board no longer is a page of its own: it is the top of Reports (old links and the default tab land there)
  useEffect(() => { if (activeSubTab === 'dashboard') setActiveSubTab('reports'); }, [activeSubTab, setActiveSubTab]);

  // the dropdown lists the admin edits (Settings > Dropdown Lists): fetched once; when they changed, the screens are rebuilt with the new values
  const [listsVer, setListsVer] = useState(0);
  useEffect(() => {
    let off = false;
    void loadLists().then((changed) => { if (changed && !off) setListsVer((v) => v + 1); });
    const again = () => setListsVer((v) => v + 1);
    window.addEventListener('crm-lists-changed', again);
    return () => { off = true; window.removeEventListener('crm-lists-changed', again); };
  }, []);

  // a number or ID clicked on any screen (see crmNav.ts): jump to the record or to the filtered list
  useEffect(() => {
    const go = (e: Event) => {
      const d: any = (e as CustomEvent).detail || {};
      try {
        if (d.kind === 'lead') { localStorage.setItem('selected_lead_id', d.id); localStorage.setItem('crm_selected_lead_id_from_notification', d.id); setActiveSubTab('leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm-select-lead', { detail: { leadId: d.id } })), 60); }
        else if (d.kind === 'customer') { localStorage.setItem('selected_contact_id', d.id); setActiveSubTab('contacts'); setTimeout(() => window.dispatchEvent(new Event('crm-open-contact')), 60); }
        else if (d.kind === 'leads') { localStorage.setItem('crm_leads_preset', JSON.stringify(d.preset || {})); setActiveSubTab('leads'); setTimeout(() => window.dispatchEvent(new Event('crm-leads-preset')), 60); }
      } catch { /* ignore */ }
    };
    window.addEventListener('crm-nav', go);
    return () => window.removeEventListener('crm-nav', go);
  }, [setActiveSubTab]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [logs, setLogs] = useState<EmailImportLog[]>([]);
  const loadErrorShown = React.useRef(false);
  const seenVersion = React.useRef('');
  const knownIds = React.useRef<Set<string> | null>(null);

  // Show what the service holds, but only re-render when a list really changed (version compare is O(1))
  const pushState = (announceNew = false) => {
    const v = crmService.versionKey();
    if (v === seenVersion.current) return;
    seenVersion.current = v;
    const newLeads = crmService.getLeads();
    setLeads(newLeads);
    setContacts(crmService.getContacts());
    setCompanies(crmService.getCompanies());
    setLogs(crmService.getEmailLogs());
    if (announceNew && knownIds.current && knownIds.current.size > 0) {
      const added = newLeads.filter(l => !knownIds.current!.has(l.id));
      if (added.length > 0) {
        const latestNewLeadId = added[0].id;
        window.dispatchEvent(new CustomEvent('crm-notification', {
          detail: { id: Date.now().toString(), message: `A new sales lead has been created: ${latestNewLeadId}`, type: 'lead', refId: latestNewLeadId, timestamp: new Date().toISOString(), read: false }
        }));
        toast.success(`A new sales lead has been created: ${latestNewLeadId}`, {
          action: { label: 'View Lead', onClick: () => { setActiveSubTab('leads'); } },
          duration: 5000,
        });
      }
    }
    knownIds.current = new Set(newLeads.map(l => l.id));
  };

  // First load of this screen: the sales team (cached for minutes) and the lists (full once, then only changes)
  const loadCrmData = async () => {
    pushState();
    try {
      const allUsers = await adminService.getUsers();
      const crmSalesPeople = allUsers
        .filter((u: any) => u.role === 'Sales Team' || u.role === 'Sales Rep' || u.role === 'Sales Team Leader' || u.role === 'Sales Operation' || u.role === 'Business Development'   // BD: only by manual assignment, never in the queue
          || (String(u.role || '').toLowerCase().includes('admin') && String(u.id) === String(user?.id)))   // an admin can assign leads to himself
        .map((u: any) => ({
          id: String(u.id), name: u.name, email: u.email || '', role: u.role || 'Sales Rep',
          activeLeads: u.activeLeads || 0, totalLeads: u.totalLeads || 0, leave: u.leave || false,
          active: u.active !== undefined ? u.active : true, teamLeaderId: u.teamLeaderId ? String(u.teamLeaderId) : undefined,
        }));
      const text = JSON.stringify(crmSalesPeople);
      if (localStorage.getItem('crm_sales_people') !== text) localStorage.setItem('crm_sales_people', text);
    } catch (err) {
      console.error('Failed to sync sales team users from admin panel:', err);
    }
    const { ok } = await crmService.loadAll();
    if (!ok) {
      if (!loadErrorShown.current) { loadErrorShown.current = true; toast.error('Could not load the latest CRM data. Showing what was loaded before.'); }
    } else loadErrorShown.current = false;
    knownIds.current = new Set(crmService.getLeads().map(l => l.id));
    pushState();
  };

  // After the user saves something: the change is already in memory, so update the screen at once and ask the server
  // for the leads that changed (one small query) instead of reloading everything.
  const afterChange = () => {
    pushState();
    void crmService.refreshDelta({ force: true, kinds: ['leads'] }).then((r) => { if (r.changed) pushState(true); });
  };

  useEffect(() => {
    void loadCrmData();
    // one shared, throttled refresh for the whole sales area (every 2 min while visible, and when returning after > 1 min)
    const stopAuto = crmService.startAutoRefresh();
    // a save that was refused or reloaded from the server changed the cached lists; new leads from the poll are announced
    const handleChanged = () => pushState(true);
    window.addEventListener('crm-data-changed', handleChanged);
    return () => { stopAuto(); window.removeEventListener('crm-data-changed', handleChanged); };
  }, []);

  const subTabs = [
    { id: 'dashboard', label: 'Executive Board', icon: LayoutDashboard },
    { id: 'my-day', label: 'My Tasks', icon: CheckSquare },
    { id: 'leads', label: 'Sales Leads', icon: Layers },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'companies', label: 'Corporate Accounts', icon: Building },
    { id: 'queue', label: 'Mail Ingestion', icon: Mail },
    { id: 'rules', label: 'Routing Rules', icon: GitMerge },
    { id: 'activities', label: 'Activities Feed', icon: Activity },
    { id: 'reports', label: 'Sales Reports', icon: BarChart },
    { id: 'import-export', label: 'Bulk Transfer', icon: UploadCloud },
  ];

  return (
    <div className="space-y-6" id="sales-crm-module-root" key={listsVer}>
      {/* Sub-Header Tabs removed in favor of Sidebar sub-navigation as requested */}

      {/* Render active sub component */}
      <div className="min-h-[500px] transition-all">
        <Suspense fallback={<div className="p-8 text-sm text-brand-gray">Loading…</div>}>
        {activeSubTab === 'dashboard' && (
          <CrmDashboard leads={leads} />
        )}
        {activeSubTab === 'my-day' && (
          <CrmMyDay 
            leads={leads} 
            onLeadsUpdated={() => afterChange()} 
            setActiveSubTab={setActiveSubTab}
          />
        )}
        {activeSubTab === 'leads' && (
          <CrmLeads 
            leads={leads} 
            onLeadsUpdated={() => afterChange()} 
            currentRole={currentRole} 
            setActiveSubTab={setActiveSubTab}
          />
        )}
        {activeSubTab === 'contacts' && (
          <CrmContacts 
            contacts={contacts} 
            leads={leads} 
            onContactsUpdated={() => afterChange()} 
            currentRole={currentRole} 
            setActiveSubTab={setActiveSubTab}
          />
        )}
        {activeSubTab === 'companies' && (
          <CrmCompanies 
            companies={companies} 
            leads={leads} 
            onCompaniesUpdated={() => afterChange()} 
            currentRole={currentRole} 
            setActiveSubTab={setActiveSubTab}
          />
        )}
        {activeSubTab === 'queue' && (
          <CrmLeadQueue 
            logs={logs} 
            leads={leads} 
            onLogsUpdated={() => afterChange()} 
            setActiveSubTab={setActiveSubTab}
          />
        )}
        {activeSubTab === 'rules' && (
          <CrmAssignmentRules 
            onRulesUpdated={() => afterChange()} 
            currentRole={currentRole} 
          />
        )}
        {activeSubTab === 'activities' && (
          <CrmActivities 
            leads={leads} 
            onLeadsUpdated={() => afterChange()} 
            currentRole={currentRole} 
          />
        )}
        {activeSubTab === 'reports' && (
          <CrmReports 
            leads={leads} 
          />
        )}
        {activeSubTab === 'plots-inventory' && (
          <CrmPlotsInventory />
        )}
        {activeSubTab === 'lb-activity' && <CrmLbActivity onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'rep-activity' && <CrmRepActivity />}
        {activeSubTab === 'team-performance' && <CrmTeamPerformance leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'bd-tracker' && <CrmBdTracker leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'calendar' && <CrmCalendar leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'hierarchy' && <CrmHierarchy leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'achievements' && <CrmAchievements leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'guide' && <CrmGuide leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'contract-control' && <CrmContractControl leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} view="control" />}
        {activeSubTab === 'ct-blockers' && <CrmContractControl leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} view="blockers" />}
        {activeSubTab === 'contract-import' && <CrmContractControl leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} view="import" />}
        {activeSubTab === 'ct-reports' && <CrmContractControl leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} view="reports" />}
        {activeSubTab === 'offers' && <CrmOffers leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'finance' && <CrmFinance leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'contracts' && <CrmContracts leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'targets' && <CrmTargets leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'external-sales' && <CrmExternalSales leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'duplicates' && <CrmDuplicates leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'audit' && <CrmAudit leads={leads} onLeadsUpdated={() => afterChange()} currentRole={currentRole} setActiveSubTab={setActiveSubTab} />}
        {activeSubTab === 'import-export' && (
          <CrmImportExport 
            leads={leads} 
            onLeadsUpdated={() => afterChange()} 
            currentRole={currentRole} 
          />
        )}
        </Suspense>
      </div>
    </div>
  );
};
