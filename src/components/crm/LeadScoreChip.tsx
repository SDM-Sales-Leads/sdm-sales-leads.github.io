import React from 'react';
import { leadScore, isOpenStatus } from './leadConfig';
import type { Lead } from './types';

/** 0-100 ranking aid for an open lead (hidden for closed ones). >= 70 hot, >= 45 warm, else grey. */
export const LeadScoreChip: React.FC<{ lead: Lead; winRate?: number; className?: string }> = React.memo(({ lead, winRate = 0, className = '' }) => {
  if (!isOpenStatus(String(lead.status))) return null;
  const s = leadScore(lead, winRate);
  const tone = s >= 70 ? 'bg-rose-100 text-rose-700 border-rose-200' : s >= 45 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-brand-gray/10 text-brand-gray border-brand-gray/20';
  return (
    <span
      title={`Lead score ${s}/100. A ranking aid built from priority, qualification, requested area, stage, source history and age.`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10.5px] font-extrabold whitespace-nowrap ${tone} ${className}`}
    >
      {s >= 70 ? '▲' : s >= 45 ? '●' : '○'} {s}
    </span>
  );
});
LeadScoreChip.displayName = 'LeadScoreChip';

/** win rate per source (Won / total) for sources with at least 5 leads, computed once per list */
export function sourceWinRates(leads: Lead[]): Map<string, number> {
  const tot = new Map<string, number>(), won = new Map<string, number>();
  for (const l of leads) {
    const k = String(l.source || '');
    tot.set(k, (tot.get(k) || 0) + 1);
    if (l.status === 'Won') won.set(k, (won.get(k) || 0) + 1);
  }
  const out = new Map<string, number>();
  tot.forEach((n, k) => { if (n >= 5) out.set(k, (won.get(k) || 0) / n); });
  return out;
}
