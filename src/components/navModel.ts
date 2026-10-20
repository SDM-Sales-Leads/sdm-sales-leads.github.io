// The menu of the Glass view: the same entries and permission rules as the sidebar of the current view, in one list.
import {
  LayoutDashboard, Ticket, Settings, GitBranch, PlusCircle, Users, Book, Activity, Briefcase, Layers, Building, Mail, CheckSquare, GitMerge,
  BarChart, UploadCloud, Database, Banknote, FileSignature, Target, ArrowUpRight, ShieldCheck, FileText, Calendar, Trophy, Network,
  GraduationCap, SlidersHorizontal, Construction, FileSpreadsheet, Home,
} from 'lucide-react';

export interface NavEntry { id: string; label: string; icon: any; tab: string; sub?: string; show: boolean }

export function buildGlassNav(p: any, role?: string): { general: NavEntry[]; crm: NavEntry[] } {
  const crmAny = !!(p?.canViewSalesCrm || p?.canViewSalesLeads);
  const mgr = !!(p?.canViewSalesDashboard || p?.canViewSalesRules);
  const g = (id: string, label: string, icon: any, show: any, tab = id): NavEntry => ({ id, label, icon, tab, show: !!show });
  const c = (id: string, label: string, icon: any, show: any): NavEntry => ({ id: 'crm-' + id, label, icon, tab: 'sales-crm', sub: id, show: !!show });
  return {
    general: [
      { id: 'glass-home', label: 'Home', icon: Home, tab: 'glass-home', show: true },
      g('dashboard', 'Dashboard', LayoutDashboard, p?.canViewDashboard),
      g('tickets', 'My Tickets', Ticket, p?.canViewTickets),
      g('new-ticket', 'New Ticket', PlusCircle, true),
      g('workflow-sla', 'Workflow & SLA', GitBranch, p?.canViewWorkflowBuilder),
      g('kb', 'Knowledge Base', Book, p?.canViewKnowledgeBase),
      g('health', 'System Health', Activity, p?.canViewAdminPanel),
      g('admin', 'Admin Panel', Settings, p?.canViewAdminPanel),
    ],
    crm: [
      c('dashboard', 'Executive Board', LayoutDashboard, p?.canViewSalesDashboard),
      c('leads', 'Sales Leads', Layers, p?.canViewSalesLeads),
      c('contacts', 'Contacts', Users, p?.canViewSalesContacts),
      c('companies', 'Corporate Accounts', Building, p?.canViewSalesCompanies),
      c('queue', 'Mail Ingestion', Mail, p?.canViewSalesMail),
      c('rules', 'Routing Rules', GitMerge, p?.canViewSalesRules),
      c('activities', 'Activities Feed', Activity, p?.canViewSalesActivities),
      c('reports', 'Sales Reports', BarChart, p?.canViewSalesReports),
      c('plots-inventory', 'Plots Inventory', Database, p?.canViewSalesPlotsInventory),
      c('lb-activity', 'Land Bank Activity', Database, p?.canViewSalesReports || p?.canViewSalesLeads),
      c('team-performance', 'Team Performance', Users, p?.canViewSalesReports),
      c('bd-tracker', 'BD Tracker', Target, ['Business Development', 'Admin', 'Sales Operation', 'Sales Director', 'Executive (View)'].includes(role || '')),
      c('calendar', 'Calendar', Calendar, crmAny),
      c('achievements', 'Achievements', Trophy, crmAny && !mgr),
      c('hierarchy', 'Hierarchy', Network, mgr),
      c('guide', 'How to use', GraduationCap, crmAny),
      c('contract-control', 'Contract Control Centre', SlidersHorizontal, p?.canViewSalesContracts),
      c('ct-blockers', 'Construction Blockers', Construction, p?.canViewSalesContracts),
      c('contract-import', 'Contract Excel', FileSpreadsheet, p?.canViewSalesContracts),
      c('ct-reports', 'Contract Reports', BarChart, p?.canViewSalesContracts),
      c('offers', 'Offers', FileText, p?.canViewSalesLeads),
      c('finance', 'Won Deals & Cash', Banknote, p?.canViewSalesFinance),
      c('contracts', 'Contracts', FileSignature, p?.canViewSalesContracts),
      c('targets', 'Targets & My Report', Target, p?.canViewSalesTargets),
      c('external-sales', 'External Sales', ArrowUpRight, p?.canViewSalesExternal),
      c('audit', 'Lead Audit Trail', ShieldCheck, p?.canViewSalesAudit),
      c('duplicates', 'Duplicates', GitMerge, p?.canViewSalesTransfer || p?.canViewSalesRules),
      c('import-export', 'Bulk Transfer', UploadCloud, p?.canViewSalesTransfer),
    ],
  };
}
export { Briefcase };
