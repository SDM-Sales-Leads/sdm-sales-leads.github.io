// The ONE menu for all three looks: 11 groups, each with its own tabs. A group opens its first tab; the tabs sit above the page.
// The old 36 entries still exist as pages (same ids, same links); only the way to reach them is grouped.
import { crmScopeOf, isManagerScope } from './crm/leadMetrics';
import { Banknote, BarChart3, Briefcase, GraduationCap, Home, Inbox, Layers, LifeBuoy, Map, Settings, Target, Users } from 'lucide-react';

export interface NavItem { id: string; label: string; tab: string; sub?: string }
export interface NavGroup { id: string; label: string; icon: any; emoji: string; items: NavItem[] }

/** people who work their own leads: they get the personal pages, not the team pages */
export const REP_LIKE = ['Sales Rep', 'Sales Team', 'Business Development'];
/** only these roles bring leads in from the mailbox (owner rule) */
export const MAIL_ROLES = ['Admin', 'Sales Operation', 'Marketing', 'Marketing Manager'];
const BD_ROLES = ['Business Development', 'Admin', 'Sales Operation', 'Sales Director', 'Executive (View)'];

export const isHere = (i: NavItem, tab: string, sub: string) => i.tab === tab && (i.sub ? i.sub === sub : true);

export function buildGroups(p: any, role?: string): NavGroup[] {
  const crmAny = !!(p?.canViewSalesCrm || p?.canViewSalesLeads);
  const mgr = !!(p?.canViewSalesDashboard || p?.canViewSalesRules);
  const rep = REP_LIKE.includes(role || '');
  const manager = isManagerScope(crmScopeOf({ role }, p));
  const s = (id: string, label: string, sub: string, show: any): NavItem | null => (show ? { id, label, tab: 'sales-crm', sub } : null);
  const t = (id: string, label: string, tab: string, show: any): NavItem | null => (show ? { id, label, tab } : null);
  const G = (id: string, label: string, icon: any, emoji: string, items: (NavItem | null)[]): NavGroup | null => {
    const list = items.filter(Boolean) as NavItem[];
    return list.length ? { id, label, icon, emoji, items: list } : null;
  };
  return [
    G('home', 'Home', Home, '⌂', [t('home', 'Home', 'glass-home', crmAny), s('my-day', 'My day', 'my-day', crmAny)]),
    G('leads', 'Leads', Layers, '☰', [s('leads', 'Leads', 'leads', p?.canViewSalesLeads), s('calendar', 'Calendar', 'calendar', p?.canViewSalesLeads), s('activities', 'Activity log', 'activities', p?.canViewSalesActivities)]),
    G('customers', 'Customers', Users, '☎', [s('contacts', 'Contacts', 'contacts', p?.canViewSalesContacts), s('companies', 'Corporate accounts', 'companies', p?.canViewSalesCompanies)]),
    G('land', 'Land & Offers', Map, '▧', [s('plots', 'Plots', 'plots-inventory', p?.canViewSalesPlotsInventory), s('offers', 'Offers to follow', 'offers', p?.canViewSalesLeads), s('lbact', 'Printed offers', 'lb-activity', p?.canViewSalesLeads)]),
    G('deals', 'Deals', Banknote, '✓', [s('finance', 'Won deals & cash', 'finance', p?.canViewSalesFinance), s('contracts', 'Contracts', 'contracts', p?.canViewSalesContracts), s('ct-control', 'Control centre', 'contract-control', p?.canViewSalesContracts), s('ct-blockers', 'Blockers', 'ct-blockers', p?.canViewSalesContracts), s('ct-reports', 'Contract reports', 'ct-reports', p?.canViewSalesContracts), s('ct-import', 'Contract Excel', 'contract-import', p?.canViewSalesContracts && role !== 'Executive (View)' && !rep)]),
    G('reports', 'Reports', BarChart3, '▤', [s('analysis', 'Dashboard', 'reports', p?.canViewSalesReports || p?.canViewSalesDashboard), s('team', 'Team', 'team-performance', p?.canViewSalesReports && !rep), s('hierarchy', 'Hierarchy', 'hierarchy', mgr && !rep && manager), s('progress', 'My progress', 'achievements', crmAny && (rep || !mgr))]),
    G('targets', 'Targets', Target, '◎', [s('targets', 'Targets', 'targets', p?.canViewSalesTargets)]),
    G('intake', 'Intake', Inbox, '⇅', [s('queue', 'Mail', 'queue', p?.canViewSalesMail && MAIL_ROLES.includes(role || '')), s('import', 'Excel import / export', 'import-export', p?.canViewSalesTransfer), s('duplicates', 'Duplicates', 'duplicates', p?.canViewSalesTransfer || p?.canViewSalesRules)]),
    G('setup', 'Setup', Settings, '⚙', [s('rules', 'Routing rules', 'rules', p?.canViewSalesRules), s('audit', 'Audit trail', 'audit', p?.canViewSalesAudit), t('admin', 'Users & settings', 'admin', p?.canViewAdminPanel), t('health', 'System health', 'health', p?.canViewAdminPanel)]),
    G('bd', 'BD & External', Briefcase, '↗', [s('bd-tracker', 'BD tracker', 'bd-tracker', BD_ROLES.includes(role || '')), s('external', 'External sales', 'external-sales', p?.canViewSalesExternal)]),
    G('help', 'Help', GraduationCap, '🎓', [s('guide', 'How to use', 'guide', crmAny)]),
    G('service', 'Service desk', LifeBuoy, '🎫', [t('svc-dash', 'Overview', 'dashboard', p?.canViewDashboard), t('tickets', 'My tickets', 'tickets', p?.canViewTickets), t('new-ticket', 'New ticket', 'new-ticket', p?.canViewTickets), t('workflow', 'Workflow & SLA', 'workflow-sla', p?.canViewWorkflowBuilder), t('kb', 'Knowledge base', 'kb', p?.canViewKnowledgeBase)]),
  ].filter(Boolean) as NavGroup[];
}
export const groupOf = (groups: NavGroup[], tab: string, sub: string) => groups.find((g) => g.items.some((i) => isHere(i, tab, sub)));
export const firstTab = (g: NavGroup) => g.items[0];
