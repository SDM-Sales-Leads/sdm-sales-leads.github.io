import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './services/AuthContext';
import { ThemeProvider, useTheme } from './services/ThemeContext';
import { Toaster } from 'sonner';
import { Login } from './components/Login';
import { ChangePassword } from './components/ChangePassword';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TicketList } from './components/TicketList';
const TicketDetail = lazy(() => import('./components/TicketDetail').then(m => ({ default: m.TicketDetail })));
const TicketForm = lazy(() => import('./components/TicketForm').then(m => ({ default: m.TicketForm })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const KnowledgeBase = lazy(() => import('./components/KnowledgeBase').then(m => ({ default: m.KnowledgeBase })));
const SystemHealth = lazy(() => import('./components/SystemHealth').then(m => ({ default: m.SystemHealth })));
const WorkflowSLAAlignment = lazy(() => import('./components/WorkflowSLAAlignment').then(m => ({ default: m.WorkflowSLAAlignment })));
const SalesCrmModule = lazy(() => import('./components/crm/SalesCrmModule').then(m => ({ default: m.SalesCrmModule })));
import { AnimatedBackground } from './components/AnimatedBackground';
import { ticketService } from './services/ticketService';
import { warmReferenceData } from './services/refData';
import { Ticket as TicketType } from './types';
import { motion } from 'motion/react';

import { Menu } from 'lucide-react';
import { Logo } from './constants';
import { useViewMode } from './lib/viewMode';
import { OldViewShell } from './components/OldViewShell';
import { GlassShell } from './components/GlassShell';
import { GlassHome } from './components/GlassHome';
import { MobileTabBar } from './components/MobileTabBar';
import { ViewAsBar } from './components/ViewAsBar';
import { GroupTabs } from './components/GroupTabs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePageHistory, useBackClose } from './lib/backNav';

const AppContent: React.FC = () => {
  const { user, permissions, isLoading, mustChangePassword } = useAuth();

  // warm the lists the ticket and workflow pages need, once, after the first screen has been drawn
  useEffect(() => { if (user && permissions) warmReferenceData(permissions as any); }, [user, permissions]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [crmSubTab, setCrmSubTab] = useState('dashboard');
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const viewMode = useViewMode(user?.id);
  // Back goes to the page the user came from (and closes an open ticket first)
  usePageHistory({ tab: activeTab, sub: crmSubTab }, !!user, (p) => { setSelectedTicket(null); setActiveTab(p.tab); setCrmSubTab(p.sub); });
  useBackClose(!!selectedTicket, () => setSelectedTicket(null));
  // "My day" is part of Home now: old links, bookmarks and the reminder bell land there
  useEffect(() => { if (activeTab === 'sales-crm' && crmSubTab === 'my-day') { setActiveTab('glass-home'); setCrmSubTab('dashboard'); } }, [activeTab, crmSubTab]);
  // a number or lead clicked on a page outside the Sales module (Home, tickets ...): open the Sales module first, then repeat the click for it
  const tabRef = useRef(activeTab); tabRef.current = activeTab;
  useEffect(() => {
    const h = (e: Event) => {
      const d: any = (e as CustomEvent).detail || {};
      if (d.__replay || tabRef.current === 'sales-crm') return;
      setSelectedTicket(null); setActiveTab('sales-crm'); setCrmSubTab(d.kind === 'customer' ? 'contacts' : 'leads');
      for (const ms of [400, 1500]) setTimeout(() => window.dispatchEvent(new CustomEvent('crm-nav', { detail: { ...d, __replay: true } })), ms);
    };
    window.addEventListener('crm-nav', h);
    return () => window.removeEventListener('crm-nav', h);
  }, []);
  useEffect(() => { (window as any).__sdmPage = `${activeTab}/${crmSubTab}`; }, [activeTab, crmSubTab]);

  // the first page for everybody who works with leads is Home (the day at a glance), in every look
  useEffect(() => {
    if (!user || !permissions) return;
    if (user.role === 'Requester') return;
    if ((permissions as any).canViewSalesCrm || (permissions as any).canViewSalesLeads) setActiveTab((t) => (t === 'dashboard' ? 'glass-home' : t));
  }, [user?.id, permissions]); // eslint-disable-line react-hooks/exhaustive-deps

  // open a lead from anywhere: the bell, or the link in an e-mail (https://.../#lead=LD-1234, works after sign-in)
  useEffect(() => {
    if (!user) return;
    const open = (id: string) => {
      if (!id) return;
      try { localStorage.setItem('selected_lead_id', id); localStorage.setItem('crm_selected_lead_id_from_notification', id); } catch { /* ignore */ }
      setSelectedTicket(null); setActiveTab('sales-crm'); setCrmSubTab('leads');
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm-nav', { detail: { kind: 'lead', id } })), 250);
    };
    const h = (e: Event) => open(String((e as CustomEvent).detail?.id || ''));
    window.addEventListener('app-open-lead', h);
    const m = /#lead=([^&]+)/.exec(window.location.hash);
    if (m) { try { open(decodeURIComponent(m[1])); window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ } }
    return () => window.removeEventListener('app-open-lead', h);
  }, [user]);

  useEffect(() => {
    if (user) {
      loadTickets();
      // Set default tab based on role
      if (user.role === 'Requester') {
        setActiveTab('tickets');
      }

      // Cost-efficient sync: Refresh when user returns to the tab
      // This is "zero cost" when the app is in the background
      let lastTicketLoad = Date.now();
      const handleFocus = () => {
        // coming back to the tab: reload only if the data is more than 2 minutes old
        if (Date.now() - lastTicketLoad < 120_000) return;
        lastTicketLoad = Date.now();
        loadTickets();
      };
      
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
    }
  }, [user]);

  useEffect(() => {
    if (user && tickets.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const ticketId = params.get('ticketId');
      if (ticketId) {
        const ticket = tickets.find(t => String(t.id) === ticketId);
        if (ticket) {
          setSelectedTicket(ticket);
          // Clear the URL parameter without reloading
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }
  }, [user, tickets]);

  const loadTickets = async () => {
    try {
      const allTickets = await ticketService.getTickets();
      if (!user) {
        setTickets([]);
        return allTickets;
      }

      let filtered;
      if (user.role === 'Admin') {
        filtered = allTickets;
      } else if (user.role === 'Requester') {
        filtered = allTickets.filter(t => t.requesterId === user.id);
      } else {
        filtered = allTickets.filter(t => 
          t.requesterId === user.id || 
          t.assignedTo === user.id || 
          !t.department || 
          t.department === user.department ||
          (t.workflowSteps?.some(s => s.status === 'Current' && s.responsibleRole === user.department))
        );
      }
      setTickets(filtered);
      return filtered;
    } catch (err) {
      console.warn("Failed to load tickets:", err);
      return [];
    }
  };

  const handleTicketSelect = (ticket: TicketType) => {
    setSelectedTicket(ticket);
  };

  const handleTicketUpdate = async () => {
    const updatedTickets = await loadTickets();
    if (selectedTicket) {
      const updated = updatedTickets.find(t => t.id === selectedTicket.id);
      setSelectedTicket(updated || null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <AnimatedBackground />
        <div className="flex flex-col items-center gap-4 z-10">
          <div className="w-12 h-12 border-4 border-brand-red border-t-transparent rounded-full animate-spin" />
          <p className="font-bold text-brand-black">Initializing Service Desk...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }
  if (mustChangePassword) {
    return <ChangePassword />;
  }

  const pageContent = (
    <ErrorBoundary resetKey={`${activeTab}|${crmSubTab}`}>
            {!selectedTicket && <GroupTabs activeTab={activeTab} crmSubTab={crmSubTab} go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }} />}
            <Suspense fallback={<div className="p-8 text-sm text-brand-gray">Loading…</div>}>
              <motion.div
                key={selectedTicket ? `detail-${selectedTicket.id}` : activeTab}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.1 }}
              >
                {selectedTicket ? (
                  <TicketDetail 
                    ticket={selectedTicket} 
                    onBack={() => setSelectedTicket(null)} 
                    onUpdate={handleTicketUpdate}
                  />
                ) : (
                  <>
                    {activeTab === 'dashboard' && <Dashboard tickets={tickets} />}
                    {activeTab === 'sales-crm' && (
                      <SalesCrmModule 
                        activeSubTab={crmSubTab} 
                        setActiveSubTab={setCrmSubTab} 
                      />
                    )}
                    {activeTab === 'tickets' && <TicketList tickets={tickets} onSelect={handleTicketSelect} />}
                    {activeTab === 'new-ticket' && (
                      <TicketForm onSuccess={() => {
                        loadTickets();
                        setActiveTab('tickets');
                      }} />
                    )}
                    {activeTab === 'glass-home' && <GlassHome />}
                    {activeTab === 'kb' && <KnowledgeBase />}
                    {activeTab === 'health' && <SystemHealth />}
                    {activeTab === 'workflow-sla' && <WorkflowSLAAlignment />}
                    {activeTab === 'admin' && <AdminPanel />}
                  </>
                )}
              </motion.div>
            </Suspense>
    </ErrorBoundary>
  );

  if (viewMode === 'glass') {
    return (
      <>
        <GlassShell
          activeTab={activeTab}
          crmSubTab={crmSubTab}
          go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }}
        >
          {pageContent}
        </GlassShell>
        <MobileTabBar activeTab={activeTab} crmSubTab={crmSubTab} go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }} />
      </>
    );
  }

  if (viewMode === 'old') {
    return (
      <>
        <OldViewShell
          activeTab={activeTab}
          crmSubTab={crmSubTab}
          go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }}
        >
          {pageContent}
        </OldViewShell>
        <MobileTabBar activeTab={activeTab} crmSubTab={crmSubTab} go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }} />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      <AnimatedBackground />
      
      <div className="flex flex-1 h-screen overflow-hidden z-10">
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setSelectedTicket(null);
          }} 
          crmSubTab={crmSubTab}
          setCrmSubTab={setCrmSubTab}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
        />
        
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile Header */}
          <header className="lg:hidden bg-brand-black text-white px-4 py-2 flex items-center justify-between sticky top-0 z-30">
            <div className="flex flex-col items-center">
              <Logo height="h-12" />
              <span className="font-bold text-[10px] text-white/90 tracking-wider uppercase">W-CRM</span>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-white/10 rounded-lg"
            >
              <Menu size={24} />
            </button>
          </header>

          <main className="flex-1 p-4 md:p-8 overflow-y-auto">
            {/* no exit animation and no waiting: the new page appears at once (a 100 ms fade only) */}
            {pageContent}
          </main>
        </div>
      </div>
      <MobileTabBar activeTab={activeTab} crmSubTab={crmSubTab} go={(tab, sub) => { setActiveTab(tab); setSelectedTicket(null); if (sub) setCrmSubTab(sub); }} />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppContent />
        <ViewAsBar />
        <Toaster position="bottom-right" />
      </ThemeProvider>
    </AuthProvider>
  );
}
