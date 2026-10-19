import { crmService } from './crm/crmService';
import { TextSizeButton } from './TextSizeButton';
import React, { useState, useEffect, useMemo } from 'react';
import { buildGroups, groupOf } from './navGroups';
import { useAuth } from '../services/AuthContext';
import { Logo } from '../constants';
import { NotificationBell } from './NotificationBell';
import { getLang, setLang } from '../i18n/lang';
import { ViewSwitch } from './ViewSwitch';
import { 
  LayoutDashboard, 
  Ticket, 
  Settings, 
  GitBranch,
  LogOut, 
  PlusCircle,
  Users,
  Book,
  Activity,
  Menu,
  X,
  Briefcase,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Layers,
  Building,
  Mail,
  CheckSquare,
  GitMerge,
  Share2,
  BarChart,
  UploadCloud,
  Sliders,
  Database,
  Banknote,
  FileSignature,
  Target,
  ArrowUpRight,
  ShieldCheck,
  FileText,
  Bell,
  Trash2,
  BellOff,
  Calendar, Trophy, Network, GraduationCap, SlidersHorizontal, Construction, FileSpreadsheet,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  crmSubTab: string;
  setCrmSubTab: (subTab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  setActiveTab, 
  crmSubTab, 
  setCrmSubTab, 
  isOpen, 
  setIsOpen 
}) => {
  const { user, permissions, logout } = useAuth();
  const [isCrmExpanded, setIsCrmExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasNewNotifications, setHasNewNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Helper to determine if a CRM lead is relevant/accessible to a user
  const isLeadRelevantToUser = (lead: any, currentUser: any) => {
    if (!currentUser) return false;
    
    // Super roles can see all notifications and leads
    const superRoles = ['admin', 'sales manager', 'sales operation', 'infrastructure', 'development', 'finance'];
    const userRoleLower = (currentUser.role || '').toLowerCase();
    if (superRoles.some(r => userRoleLower.includes(r))) {
      return true;
    }
    
    // Sales Rep / Sales Team / Sales Team Leader
    if (userRoleLower.includes('rep') || userRoleLower.includes('sales team') || userRoleLower.includes('leader')) {
      // Team Leader
      if (userRoleLower.includes('leader')) {
        const isAssignedToMe = String(lead.assignedSalespersonId) === String(currentUser.id);
        
        let salespeople: any[] = [];
        try {
          const saved = localStorage.getItem('crm_sales_people');
          if (saved) salespeople = JSON.parse(saved);
        } catch (e) {}
        
        const assignedRep = salespeople.find((s: any) => String(s.id) === String(lead.assignedSalespersonId));
        const isMyTeam = assignedRep && String(assignedRep.teamLeaderId) === String(currentUser.id);
        
        const isUnassigned = !lead.assignedSalespersonId;
        
        return isAssignedToMe || isMyTeam || isUnassigned;
      } else {
        // Regular Sales Rep
        return String(lead.assignedSalespersonId) === String(currentUser.id);
      }
    }
    
    return false;
  };

  const handlePurgeAllNotifications = async () => {
    if (window.confirm("Are you sure you want to delete ALL notifications for all users from local and server storage?")) {
      try {
        await fetch('/api/admin/notifications/purge-all', { method: 'POST' });
        await fetch('/api/crm/notifications/purge-all', { method: 'POST' }).catch(() => {});
      } catch (err) {}

      // Clear all local storage keys starting with crm_notifications
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('crm_notifications') || key.includes('notification'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('crm_notifications_purged_live_v1', 'true');
      } catch (e) {}

      setNotifications([]);
      setHasNewNotifications(false);
      setIsNotificationsOpen(false);
      alert("All notifications have been completely wiped from server and local storage.");
    }
  };

  const loadUserNotifications = () => {
    if (!user) return;

    // Check if initial live cleanup was executed
    if (!localStorage.getItem('crm_notifications_purged_live_v1')) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('crm_notifications') || key.includes('notification'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('crm_notifications_purged_live_v1', 'true');
      } catch (e) {}
    }
    
    const storageKey = `crm_notifications_${user.id}`;
    let currentNotifs: any[] = [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        currentNotifs = JSON.parse(saved);
      }
    } catch (e) {}

    const existingIds = new Set(currentNotifs.map((n: any) => n.id));
    const newNotifs: any[] = [];

    // Only what changed since the last check can produce a notification (the first check starts "now", so the
    // history that came with the migration never floods the bell). The leads are read from memory, not storage.
    const sinceKey = `crm_notif_since_${user.id}`;
    const since = localStorage.getItem(sinceKey) || new Date().toISOString();
    localStorage.setItem(sinceKey, new Date().toISOString());
    const leads: any[] = crmService.getLeads().filter((l: any) => (l.lastUpdated || '') > since);

    leads.forEach((lead: any) => {
      if (!isLeadRelevantToUser(lead, user)) return;

      // 1. Assignment reminder
      if (lead.assignedSalespersonId === String(user.id)) {
        const assignId = `assign_${lead.id}`;
        if (!existingIds.has(assignId)) {
          newNotifs.push({
            id: assignId,
            message: `Lead ${lead.id} (${lead.customerName}) is assigned to you.`,
            type: 'lead',
            refId: lead.id,
            timestamp: lead.assignedDate || lead.lastUpdated || new Date().toISOString(),
            read: false
          });
        }
      }

      // 2. Timeline event updates
      if (lead.timeline && Array.isArray(lead.timeline)) {
        lead.timeline.forEach((event: any) => {
          if (event.user && event.user !== user.name) {
            const updateId = `update_${lead.id}_${event.id || event.timestamp}`;
            if (!existingIds.has(updateId)) {
              newNotifs.push({
                id: updateId,
                message: `${event.user} updated ${lead.customerName} (${lead.id}): ${event.title}`,
                type: 'update',
                refId: lead.id,
                timestamp: event.timestamp || new Date().toISOString(),
                read: false
              });
            }
          }

          // 3. Meeting/visit reminders
          if (event.type === 'Meeting' || event.type === 'Visit') {
            const eventTime = new Date(event.timestamp).getTime();
            const now = Date.now();
            const isFutureOrToday = eventTime > now - (12 * 60 * 60 * 1000); // within last 12 hours or future
            
            if (isFutureOrToday) {
              const reminderId = `reminder_${lead.id}_${event.id || event.timestamp}`;
              if (!existingIds.has(reminderId)) {
                newNotifs.push({
                  id: reminderId,
                  message: `Upcoming ${event.type}: ${lead.customerName} - ${event.title}`,
                  type: event.type.toLowerCase(),
                  refId: lead.id,
                  timestamp: event.timestamp || new Date().toISOString(),
                  read: false
                });
              }
            }
          }
        });
      }
    });

    const finalNotifs = [...newNotifs, ...currentNotifs].slice(0, 50);
    if (newNotifs.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(finalNotifs));
    }
    setNotifications(prev => (prev.length === finalNotifs.length && prev[0]?.id === finalNotifs[0]?.id && prev.every((p, i) => p.read === finalNotifs[i].read)) ? prev : finalNotifs);
    setHasNewNotifications(finalNotifs.some((n: any) => !n.read));
  };

  useEffect(() => {
    loadUserNotifications();

    const handleNotification = (e: any) => {
      if (e.detail) {
        const notif = e.detail;
        
        // If there's a reference lead, check if it is relevant to the current user
        if (notif.refId) {
          const lead = crmService.getLeads().find((l: any) => l.id === notif.refId);
          if (lead && !isLeadRelevantToUser(lead, user)) {
            return; // Not relevant, ignore!
          }
        }

        setHasNewNotifications(true);
        setNotifications(prev => {
          const updated = [notif, ...prev].slice(0, 50);
          localStorage.setItem(`crm_notifications_${user?.id}`, JSON.stringify(updated));
          return updated;
        });
      }
    };

    window.addEventListener('crm-notification', handleNotification);
    
    // No timer: notifications are re-checked only when the lead data really changed (debounced)
    let t: ReturnType<typeof setTimeout> | undefined;
    const onData = () => { if (t) clearTimeout(t); t = setTimeout(loadUserNotifications, 1000); };
    window.addEventListener('crm-data-changed', onData);

    return () => {
      window.removeEventListener('crm-notification', handleNotification);
      window.removeEventListener('crm-data-changed', onData);
      if (t) clearTimeout(t);
    };
  }, [user]);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: permissions?.canViewDashboard },
    { id: 'sales-crm', label: 'Inquiries Sales', icon: Briefcase, permission: permissions?.canViewSalesCrm },
    { id: 'tickets', label: 'My Tickets', icon: Ticket, permission: permissions?.canViewTickets },
    { id: 'new-ticket', label: 'New Ticket', icon: PlusCircle, permission: true }, 
    { id: 'workflow-sla', label: 'Workflow & SLA', icon: GitBranch, permission: permissions?.canViewWorkflowBuilder },
    { id: 'kb', label: 'Knowledge Base', icon: Book, permission: permissions?.canViewKnowledgeBase },
    { id: 'health', label: 'System Health', icon: Activity, permission: permissions?.canViewAdminPanel },
    { id: 'admin', label: 'Admin Panel', icon: Settings, permission: permissions?.canViewAdminPanel },
  ];

  const crmSubTabs = [
    { id: 'dashboard', label: 'Executive Board', icon: LayoutDashboard, permission: permissions?.canViewSalesDashboard },
    { id: 'my-day', label: 'My Day', icon: CheckSquare, permission: permissions?.canViewSalesLeads || permissions?.canViewSalesCrm },
    { id: 'leads', label: 'Sales Leads', icon: Layers, permission: permissions?.canViewSalesLeads },
    { id: 'contacts', label: 'Contacts', icon: Users, permission: permissions?.canViewSalesContacts },
    { id: 'companies', label: 'Corporate Accounts', icon: Building, permission: permissions?.canViewSalesCompanies },
    { id: 'queue', label: 'Mail Ingestion', icon: Mail, permission: permissions?.canViewSalesMail },
    { id: 'rules', label: 'Routing Rules', icon: GitMerge, permission: permissions?.canViewSalesRules },
    { id: 'activities', label: 'Activities Feed', icon: Activity, permission: permissions?.canViewSalesActivities },
    { id: 'reports', label: 'Sales Reports', icon: BarChart, permission: permissions?.canViewSalesReports },
    { id: 'plots-inventory', label: 'Plots Inventory', icon: Database, permission: permissions?.canViewSalesPlotsInventory },
    { id: 'lb-activity', label: 'Land Bank Activity', icon: Database, permission: permissions?.canViewSalesReports || permissions?.canViewSalesLeads },
    { id: 'team-performance', label: 'Team Performance', icon: Users, permission: permissions?.canViewSalesReports },
    { id: 'bd-tracker', label: 'BD Tracker', icon: Target, permission: ['Business Development', 'Admin', 'Sales Operation', 'Sales Director', 'Executive (View)'].includes(user?.role || '') },
    { id: 'calendar', label: 'Calendar', icon: Calendar, permission: permissions?.canViewSalesCrm || permissions?.canViewSalesLeads },
    { id: 'achievements', label: 'Achievements', icon: Trophy, permission: (permissions?.canViewSalesCrm || permissions?.canViewSalesLeads) && !(permissions?.canViewSalesDashboard || permissions?.canViewSalesRules) },
    { id: 'hierarchy', label: 'Hierarchy', icon: Network, permission: permissions?.canViewSalesDashboard || permissions?.canViewSalesRules },
    { id: 'guide', label: 'How to use', icon: GraduationCap, permission: permissions?.canViewSalesCrm || permissions?.canViewSalesLeads },
    { id: 'contract-control', label: 'Contract Control Centre', icon: SlidersHorizontal, permission: permissions?.canViewSalesContracts },
    { id: 'ct-blockers', label: 'Construction Blockers', icon: Construction, permission: permissions?.canViewSalesContracts },
    { id: 'contract-import', label: 'Contract Excel', icon: FileSpreadsheet, permission: permissions?.canViewSalesContracts },
    { id: 'ct-reports', label: 'Contract Reports', icon: BarChart, permission: permissions?.canViewSalesContracts },
    { id: 'offers', label: 'Offers', icon: FileText, permission: permissions?.canViewSalesLeads },
    { id: 'finance', label: 'Won Deals & Cash', icon: Banknote, permission: permissions?.canViewSalesFinance },
    { id: 'contracts', label: 'Contracts', icon: FileSignature, permission: permissions?.canViewSalesContracts },
    { id: 'targets', label: 'Targets & My Report', icon: Target, permission: permissions?.canViewSalesTargets },
    { id: 'external-sales', label: 'External Sales', icon: ArrowUpRight, permission: permissions?.canViewSalesExternal },
    { id: 'audit', label: 'Lead Audit Trail', icon: ShieldCheck, permission: permissions?.canViewSalesAudit },
    { id: 'duplicates', label: 'Duplicates', icon: GitMerge, permission: permissions?.canViewSalesTransfer || permissions?.canViewSalesRules },
    { id: 'import-export', label: 'Bulk Transfer', icon: UploadCloud, permission: permissions?.canViewSalesTransfer },
  ];

  const groups = useMemo(() => buildGroups(permissions, user?.role), [permissions, user?.role]);
  const activeGroup = groupOf(groups, activeTab, crmSubTab);

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 glass-sidebar text-white flex flex-col h-screen transition-all duration-300 transform
        lg:translate-x-0 lg:sticky lg:top-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        ${isCollapsed ? 'w-20' : 'w-64'}
      `}>
        <button 
           onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3 top-8 bg-brand-black border border-white/20 rounded-full p-1 text-white hover:bg-brand-red z-50 transition-all cursor-pointer shadow-lg"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className="relative p-6 flex flex-col items-center justify-center border-b border-white/10 min-h-[120px]">
          <div className={`absolute z-20 ${isCollapsed ? 'top-1 left-1/2 -translate-x-1/2' : 'top-3 left-3'}`}><NotificationBell dark /></div>
          <div className="flex flex-col items-center transition-all duration-300">
            <div className={`p-1 transition-all duration-300 ${isCollapsed ? 'scale-75' : 'scale-100'}`}>
              <Logo height={isCollapsed ? "h-12" : "h-24"} />
            </div>
            {!isCollapsed && <h1 className="font-bold text-[11px] text-white/90 tracking-widest mt-1 uppercase whitespace-nowrap">W-CRM</h1>}
            <ViewSwitch className="mt-3" />
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="lg:hidden absolute top-4 right-4 text-white/50 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 py-6 px-3 space-y-2 overflow-y-auto ">
          {groups.map((g) => {
            const on = g.id === activeGroup?.id;
            const Icon = g.icon;
            return (
              <button
                key={g.id}
                title={isCollapsed ? g.label : undefined}
                onClick={() => { setActiveTab(g.items[0].tab); if (g.items[0].sub) setCrmSubTab(g.items[0].sub); setIsOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${on ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-white/60 hover:bg-white/5 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`}
              >
                <Icon size={20} className={isCollapsed ? 'mx-auto' : ''} />
                {!isCollapsed && <span className="font-medium whitespace-nowrap">{g.label}</span>}
              </button>
            );
          })}
        </div>

        <div className={`p-4 border-t border-white/10 transition-all ${isCollapsed ? 'flex flex-col items-center' : ''} relative`}>
          <div className={`flex items-center gap-3 mb-4 ${isCollapsed ? 'justify-center' : 'px-2'}`}>
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="w-10 h-10 rounded-full bg-brand-red flex items-center justify-center font-bold text-lg flex-shrink-0 shadow-lg relative cursor-pointer hover:opacity-90 transition-opacity"
              title="Toggle Notifications"
            >
              {user?.name.charAt(0)}
              {hasNewNotifications && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 border-2 border-brand-black rounded-full animate-pulse"></span>
              )}
            </button>
            {!isCollapsed && (
              <div className="flex-1 flex items-center justify-between min-w-0">
                <div className="overflow-hidden pr-2">
                  <p className="font-medium truncate whitespace-nowrap">{user?.name}</p>
                  <p className="text-[10px] text-white/40 truncate tracking-wider uppercase font-bold">{user?.role}</p>
                </div>
                <div>
                  <button style={{ display: 'none' }}
                    onClick={() => {
                      setIsNotificationsOpen(!isNotificationsOpen);
                    }}
                    className={`p-2 rounded-full transition-colors relative ${hasNewNotifications ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                    title="Notifications"
                  >
                    <Bell size={18} className={hasNewNotifications ? 'animate-bounce' : ''} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {isNotificationsOpen && (
            <>
              <div 
                className="fixed inset-0 z-[90] cursor-default bg-black/5" 
                onClick={() => setIsNotificationsOpen(false)} 
              />
              <div className="fixed sm:absolute bottom-16 left-2 sm:left-4 w-[380px] sm:w-[450px] max-w-[calc(100vw-1.5rem)] bg-brand-black/95 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl overflow-hidden z-[100] transition-all duration-200">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                  <Bell size={16} className="text-brand-red" />
                  <h3 className="font-bold text-white text-sm">Notifications</h3>
                  {notifications.length > 0 && (
                    <span className="bg-brand-red/20 text-brand-red text-[11px] font-extrabold px-2 py-0.5 rounded-full border border-brand-red/30">
                      {notifications.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {notifications.length > 0 && (
                    <button 
                      onClick={() => {
                        const readAll = notifications.map(n => ({...n, read: true}));
                        setNotifications(readAll);
                        if (user) localStorage.setItem(`crm_notifications_${user.id}`, JSON.stringify(readAll));
                        setHasNewNotifications(false);
                      }}
                      className="text-[11px] font-semibold text-white/60 hover:text-white transition-colors"
                    >
                      Mark read
                    </button>
                  )}
                  <button 
                    onClick={handlePurgeAllNotifications}
                    className="text-[11px] font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                    title="Delete all notifications permanently from server and local storage"
                  >
                    <Trash2 size={12} />
                    <span>Clear All</span>
                  </button>
                </div>
              </div>

              <div className="max-h-80 sm:max-h-96 overflow-y-auto divide-y divide-white/5 custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-white/40 text-xs flex flex-col items-center justify-center gap-2">
                    <BellOff size={24} className="text-white/20" />
                    <p className="font-medium text-white/70">No notifications yet</p>
                    <p className="text-[10px] text-white/30">Clean state initialized for live operations.</p>
                  </div>
                ) : (
                  notifications.map((notif, idx) => (
                    <div 
                      key={notif.id || idx} 
                      onClick={() => {
                        const updated = [...notifications];
                        updated[idx].read = true;
                        setNotifications(updated);
                        if (user) localStorage.setItem(`crm_notifications_${user.id}`, JSON.stringify(updated));
                        const hasUnread = updated.some(n => !n.read);
                        setHasNewNotifications(hasUnread);

                        if (notif.refId) {
                          localStorage.setItem('crm_selected_lead_id_from_notification', notif.refId);
                          window.dispatchEvent(new CustomEvent('crm-select-lead', { detail: { leadId: notif.refId } }));
                        }

                        setActiveTab('sales-crm');
                        setCrmSubTab('leads');
                        setIsNotificationsOpen(false);
                      }}
                      className={`p-3.5 cursor-pointer transition-all hover:bg-white/10 ${!notif.read ? 'bg-brand-red/10' : 'opacity-70'}`}
                    >
                      <div className="flex items-start gap-3">
                        {!notif.read ? (
                          <span className="w-2.5 h-2.5 mt-1 rounded-full bg-brand-red animate-pulse flex-shrink-0 shadow-sm shadow-brand-red"></span>
                        ) : (
                          <span className="w-2.5 h-2.5 mt-1 rounded-full bg-white/20 flex-shrink-0"></span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed break-words ${!notif.read ? 'text-white font-semibold' : 'text-white/80 font-normal'}`}>
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between mt-1.5 text-[10px] text-white/40 font-mono">
                            <span className="uppercase tracking-wider">{notif.type || 'SYSTEM'}</span>
                            <span>{notif.timestamp ? new Date(notif.timestamp).toLocaleString() : 'Just now'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

          <TextSizeButton className={`w-full flex items-center gap-3 py-2.5 rounded-xl text-white/60 hover:bg-white/5 hover:text-white transition-all ${isCollapsed ? 'justify-center px-0' : 'px-4'}`} compact={isCollapsed} />
          <button
            translate="no"
            title={getLang() === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')}
            className={`w-full flex items-center gap-3 py-2.5 rounded-xl text-white/60 hover:bg-white/5 hover:text-white transition-all ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}
          >
            <span className="w-5 text-center font-bold text-sm">{getLang() === 'ar' ? 'EN' : 'ع'}</span>
            {!isCollapsed && <span className="font-medium">{getLang() === 'ar' ? 'English' : 'العربية'}</span>}
          </button>
          <button
            title={isCollapsed ? "Logout" : undefined}
            onClick={logout}
            className={`w-full flex items-center gap-3 py-3 rounded-xl text-white/60 hover:bg-white/5 hover:text-white transition-all ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}
          >
            <LogOut size={20} />
            {!isCollapsed && <span className="font-medium">Logout</span>}
          </button>
        </div>
      </div>
    </>
  );
};
