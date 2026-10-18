import React, { useEffect, useMemo, useState } from 'react';
import { AlarmClock, ChevronDown, ChevronUp, PhoneCall } from 'lucide-react';
import type { Lead } from './types';
import { CC_HOURS, ccLeft, ccState } from './leadMetrics';
import { phoneIntl } from './leadConfig';
import { useAuth } from '../../services/AuthContext';
import { crmScopeOf } from './leadMetrics';

/** Call center leads waiting for their first contact: most urgent first, with the time left of the 24 hours. */
export const CrmCallCenter: React.FC<{ leads: Lead[]; onOpen: (l: Lead) => void }> = ({ leads, onOpen }) => {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const { user, permissions } = useAuth();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  // who sees what here: a salesperson only the call center leads given to him or her, a team leader the leads given to the team,
  // Sales Operation, Admin and Marketing (and other view-all roles) every one, owned or not
  const mine = useMemo(() => {
    const scope = crmScopeOf(user as any, permissions as any);
    if (scope === 'all' || (permissions as any)?.canViewAllLeads) return leads;
    if (scope === 'team') return leads.filter((l) => !!l.assignedSalespersonId);
    return leads.filter((l) => String(l.assignedSalespersonId || '') === String(user?.id ?? ''));
  }, [leads, user, permissions]);
  const rows = useMemo(() => mine.map((l) => ({ l, s: ccState(l, now) })).filter((x) => x.s).sort((a, b) => a.s!.leftMs - b.s!.leftMs) as { l: Lead; s: NonNullable<ReturnType<typeof ccState>> }[], [mine, now]);
  if (!rows.length) return null;
  const late = rows.filter((r) => r.s.overdue).length;
  const lateOwned = rows.filter((r) => r.s.overdue && r.l.assignedSalespersonId).length;
  const noOwner = rows.filter((r) => !r.l.assignedSalespersonId).length;
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <section className={`rounded-2xl border shadow-sm overflow-hidden border-brand-red/25 bg-brand-red/5`} aria-label="Call center leads waiting for first contact">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-white bg-brand-red`}><AlarmClock size={18} /></span>
        <span className="flex-1 min-w-0">
          <span className="block font-extrabold text-brand-black text-sm">Call center first: {rows.length} {rows.length === 1 ? 'lead' : 'leads'} waiting for the first contact</span>
          <span className="block text-[11px] font-semibold text-brand-gray">Every call center lead must be contacted within {CC_HOURS} hours. {lateOwned ? <b className="text-brand-red">{lateOwned} past the limit with an owner: the team leader is alerted. </b> : null}{noOwner ? <b className="text-brand-red">{noOwner} have no owner yet: assign them now. </b> : null}{!late ? 'Call, WhatsApp or e-mail, then log it.' : null}</span>
        </span>
        {open ? <ChevronUp size={18} className="text-brand-gray" /> : <ChevronDown size={18} className="text-brand-gray" />}
      </button>
      {open && (
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {shown.map(({ l, s }) => (
            <button key={l.id} type="button" onClick={() => onOpen(l)} className="bg-white rounded-xl border border-brand-gray/15 hover:border-brand-red/50 px-3 py-2.5 text-left flex items-center gap-3">
              <PhoneCall size={16} className="text-brand-red" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-[13px] text-brand-black truncate">{l.customerName || l.id}</span>
                <span className="block text-[11px] text-brand-gray font-mono truncate">{phoneIntl(l.phoneNumber) || l.phoneNumber || '—'} · {l.assignedSalespersonName || 'not assigned yet'}</span>
              </span>
              <span className={`shrink-0 text-[11px] font-extrabold rounded-full px-2.5 py-1 ${s.overdue ? 'bg-brand-red text-white' : s.leftMs < 6 * 3600_000 ? 'bg-brand-red/80 text-white' : 'bg-brand-red/10 text-brand-red'}`}>{s.overdue ? `Late ${ccLeft(s.leftMs)}` : `${ccLeft(s.leftMs)} left`}</span>
            </button>
          ))}
          {rows.length > 6 && <button type="button" onClick={() => setAll(!all)} className="text-[12px] font-bold text-brand-red py-2 md:col-span-2 xl:col-span-3">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
        </div>
      )}
    </section>
  );
};
