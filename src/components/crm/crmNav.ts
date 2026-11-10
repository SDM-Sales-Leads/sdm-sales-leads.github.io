// One way to jump to a record or to a filtered list from any number on any screen (the module listens in SalesCrmModule).
export interface LeadsPreset { ids?: string[]; title?: string; status?: string; project?: string; source?: string; salesperson?: string; search?: string }

const fire = (detail: any) => window.dispatchEvent(new CustomEvent('crm-nav', { detail }));

export const crmNav = {
  /** open a lead: in place, as a drawer over the current screen (360, owner 11 Nov 2026); on the Leads page, its own lead panel */
  lead: (id: string, tab?: string) => { if (id) fire({ kind: 'lead', id: String(id), tab }); },
  /** open the lead on the Leads page itself (the full page) */
  leadPage: (id: string) => { if (id) fire({ kind: 'lead', id: String(id), full: true }); },
  /** open the customer's 360 view (the contact id, e.g. C-3826) */
  customer: (id: string) => { if (id) fire({ kind: 'customer', id: String(id) }); },
  /** open one conversation in Lara > Interactions */
  interaction: (threadId: string) => { if (threadId) fire({ kind: 'interaction', id: String(threadId) }); },
  /** open the leads list showing exactly these leads (or a simple filter) */
  leads: (preset: LeadsPreset) => fire({ kind: 'leads', preset }),
};
