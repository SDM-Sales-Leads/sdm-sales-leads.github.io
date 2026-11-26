// Plot-size breakdown (26 Nov 2026, Walid): Reports → Demand. Per required-size band: share of leads (pie), assigned vs
// unassigned, touched, stage, new vs old, area asked; plus size band × salesperson and size band × project.
// Every number opens exactly those leads. Missing data shows "—", never an invented value.
import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtEGP, pc } from './leadMetrics';
import { Card, Pill } from './CrmMetricsUi';
import { crmNav } from './crmNav';
import { DrillNum } from './DrillNum';
import { DataTable, ExportBar, TD, TH, num } from './ReportParts';
import { NO_SIZE, SizeRow, convOf, sizeBreakdown } from './reportsEngine';
import type { ReportCtx } from './CrmReportsExtra';

const BAND_COLORS = ['#FFCDD2', '#EF9A9A', '#E57373', '#D32F2F', '#B71C1C', '#7F0000'];
const NO_SIZE_COLOR = '#BDBDBD';
const C_ASSIGNED = '#1976D2', C_UNASSIGNED = '#F57C00';
const STAGE_COLORS: Record<string, string> = { Open: '#1976D2', 'Waiting finance': '#FBC02D', Won: '#388E3C', Lost: '#9E9E9E', 'Closed / other': '#E0E0E0' };
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pctTxt = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`);
const open = (ids: string[], title: string) => ids.length && crmNav.leads({ ids, title });

const Donut: React.FC<{ data: { name: string; value: number; color: string; ids?: string[] }[]; title: string; center?: React.ReactNode; sub: string }> = ({ data, title, center, sub }) => {
  const shown = data.filter((d) => d.value > 0);
  const tot = sum(shown.map((d) => d.value));
  return (
    <div className="border border-brand-gray/15 rounded-xl p-3">
      <p className="text-[10px] uppercase font-bold text-brand-gray">{title}</p>
      <div className="h-44 relative">
        {tot ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <PieChart>
              <Pie data={shown} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value" isAnimationActive={false}
                onClick={(d: any) => d?.ids && open(d.ids, `${sub} · ${d.name}`)} cursor="pointer">
                {shown.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: any, n: any) => [`${num(Number(v))} leads (${pctTxt(pc(Number(v), tot))})`, n]} />
            </PieChart>
          </ResponsiveContainer>
        ) : <p className="text-center text-brand-gray pt-16 text-xs">No leads</p>}
        {tot > 0 && center != null && <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">{center}</div>}
      </div>
      <div className="space-y-0.5">
        {data.map((d) => (
          <button key={d.name} type="button" disabled={!d.ids?.length} onClick={() => d.ids && open(d.ids, `${sub} · ${d.name}`)}
            className="w-full flex items-center gap-1.5 text-[10.5px] font-semibold text-brand-gray hover:text-brand-black disabled:hover:text-brand-gray text-left">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="truncate flex-1">{d.name}</span>
            <span className="font-mono text-brand-black">{num(d.value)}</span>
            <span className="w-9 text-right font-mono">{pctTxt(pc(d.value, tot))}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

type Mx = { key: string; label: string; total: number; cells: Map<string, string[]> };
const Matrix: React.FC<{ rows: Mx[]; bands: SizeRow[]; first: string; color: string; limit: number }> = ({ rows, bands, first, color, limit }) => {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.flatMap((r) => bands.map((b) => r.cells.get(b.key)?.length || 0)));
  if (!rows.length) return <p className="text-center text-brand-gray py-4 text-xs">No leads.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-brand-gray/15">
          <th className={TH}>{first}</th>
          {bands.map((b) => <th key={b.key} className={`${TH} text-right whitespace-nowrap`}>{b.key === NO_SIZE ? 'No size' : b.label.replace(' sqm', '')}</th>)}
          <th className={`${TH} text-right`}>Total</th>
        </tr></thead>
        <tbody className="divide-y divide-brand-gray/10 font-semibold text-brand-black">
          {shown.map((r) => (
            <tr key={r.key}>
              <td className={`${TD} font-bold max-w-[180px] truncate`} title={r.label}>{r.label}</td>
              {bands.map((b) => {
                const ids = r.cells.get(b.key) || [];
                const a = ids.length / max;
                return <td key={b.key} className={`${TD} text-right`} style={{ background: ids.length ? `${color}${Math.round((0.08 + 0.5 * a) * 255).toString(16).padStart(2, '0')}` : undefined }}>
                  {ids.length ? <DrillNum n={ids.length} ids={ids} title={`${r.label} · ${b.label}`} /> : <span className="text-brand-gray/50">·</span>}
                </td>;
              })}
              <td className={`${TD} text-right font-black`}><DrillNum n={r.total} ids={[...r.cells.values()].flat()} title={`${r.label} · all sizes`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <button type="button" onClick={() => setAll((x) => !x)} className="mt-2 text-[11px] font-bold text-brand-red hover:underline">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </div>
  );
};

export const SizeBreakdownCard: React.FC<{ c: ReportCtx }> = ({ c }) => {
  const B = useMemo(() => sizeBreakdown(c.pool, c.range, c.allTime), [c.pool, c.range, c.allTime]);
  const [sel, setSel] = useState<string>('All sizes');
  const [mx, setMx] = useState<'owner' | 'project'>('owner');
  const bandColor = (k: string, i: number) => (k === NO_SIZE ? NO_SIZE_COLOR : BAND_COLORS[i % BAND_COLORS.length]);
  const cur = sel === 'All sizes' ? B.total : B.rows.find((r) => r.key === sel) || B.total;
  const T = B.total;
  if (!T.t.leads) return <Card title="Plot-size breakdown"><p className="text-center text-brand-gray py-6">No leads in this period.</p></Card>;

  const stageOf = (r: SizeRow) => {
    const ids = r.t.ids!; const known = ids.open.length + r.pending.length + ids.won.length + ids.lost.length;
    const other = r.t.leads - known;
    const set = new Set([...ids.open, ...r.pending, ...ids.won, ...ids.lost]);
    return [
      { name: 'Open', value: ids.open.length, color: STAGE_COLORS.Open, ids: ids.open },
      { name: 'Waiting finance', value: r.pending.length, color: STAGE_COLORS['Waiting finance'], ids: r.pending },
      { name: 'Won', value: ids.won.length, color: STAGE_COLORS.Won, ids: ids.won },
      { name: 'Lost', value: ids.lost.length, color: STAGE_COLORS.Lost, ids: ids.lost },
      ...(other > 0 ? [{ name: 'Closed / other', value: other, color: STAGE_COLORS['Closed / other'], ids: ids.leads.filter((id) => !set.has(id)) }] : []),
    ];
  };
  const bar = B.rows.map((r) => ({ name: r.key === NO_SIZE ? 'No size' : r.label.replace(' sqm', ''), Assigned: r.assigned.length, Unassigned: r.unassigned.length }));
  const withSize = T.t.leads - (B.rows.find((r) => r.key === NO_SIZE)?.t.leads || 0);
  const biggest = B.rows.filter((r) => r.key !== NO_SIZE).sort((a, b) => b.t.leads - a.t.leads)[0];
  const mostUnassigned = B.rows.filter((r) => r.unassigned.length).sort((a, b) => (pc(b.unassigned.length, b.t.leads) || 0) - (pc(a.unassigned.length, a.t.leads) || 0))[0];

  const sheets = () => [
    { name: 'By size', rows: [['Required size', 'Leads', '% of leads', 'Assigned', 'Unassigned', '% unassigned', 'Open & unassigned', 'Touched', 'Untouched', 'Open', 'Waiting finance', 'Won', 'Lost', 'Conversion %', 'New leads', 'Old leads (Excel)', 'Median size (sqm)', 'Total area asked (sqm)', 'Won value (EGP)'],
      ...[...B.rows, T].map((r) => [r.label, r.t.leads, Number((pc(r.t.leads, T.t.leads) || 0).toFixed(1)), r.assigned.length, r.unassigned.length, Number((pc(r.unassigned.length, r.t.leads) || 0).toFixed(1)), r.openUnassigned.length, r.touched.length, r.untouched.length, r.t.open, r.pending.length, r.t.won, r.t.lost, convOf(r.t) == null ? '' : Number(convOf(r.t)!.toFixed(1)), r.newL.length, r.oldL.length, median(r.sizes) ?? '', r.sizes.length ? Math.round(sum(r.sizes)) : '', r.t.wonWithValue ? Math.round(r.t.wonValue) : ''])] },
    { name: 'Size x salesperson', rows: [['Salesperson', ...B.rows.map((b) => b.label), 'Total'], ...B.byOwner.map((o) => [o.label, ...B.rows.map((b) => o.cells.get(b.key)?.length || 0), o.total])] },
    { name: 'Size x project', rows: [['Project', ...B.rows.map((b) => b.label), 'Total'], ...B.byProject.map((o) => [o.label, ...B.rows.map((b) => o.cells.get(b.key)?.length || 0), o.total])] },
  ];
  const d = (ids: string[], r: SizeRow, what: string, cls = '') => <DrillNum n={ids.length} ids={ids} title={`${r.label} · ${what}`} className={cls} />;

  return (
    <Card title="Plot-size breakdown"
      info="Leads of the period grouped by the required area typed on the lead. Assigned = the lead has a salesperson now; Unassigned = no salesperson. Touched = someone worked it (status moved from New, or marked touched). Waiting finance = Won, cash not yet confirmed. Won counts only deals closed in the window. Old leads = from the Excel used before the CRM. Click any number, pie slice or legend line to open those leads."
      right={<ExportBar name="plot-size-breakdown" sheets={sheets} />}>
      {/* quick facts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: 'Leads with a size', v: `${num(withSize)} of ${num(T.t.leads)}`, s: `${pctTxt(pc(withSize, T.t.leads))} typed a required area` },
          { l: 'Most asked range', v: biggest ? biggest.label : '—', s: biggest ? `${num(biggest.t.leads)} leads · ${pctTxt(pc(biggest.t.leads, T.t.leads))}` : '' },
          { l: 'Unassigned leads', v: num(T.unassigned.length), s: `${num(T.openUnassigned.length)} still open`, ids: T.openUnassigned.length ? T.openUnassigned : T.unassigned, tone: 'text-orange-600' },
          { l: 'Most unassigned range', v: mostUnassigned ? mostUnassigned.label : '—', s: mostUnassigned ? `${pctTxt(pc(mostUnassigned.unassigned.length, mostUnassigned.t.leads))} of its leads (${num(mostUnassigned.unassigned.length)})` : 'every lead has a salesperson', ids: mostUnassigned?.unassigned },
        ].map((k) => (
          <div key={k.l} onClick={() => k.ids && open(k.ids, k.l)} className={`border border-brand-gray/15 rounded-xl p-3 ${k.ids ? 'cursor-pointer hover:border-brand-red/40' : ''}`}>
            <p className="text-[10px] uppercase font-bold text-brand-gray">{k.l}</p>
            <p className={`font-black text-sm mt-0.5 ${k.tone || 'text-brand-black'}`}>{k.v}</p>
            <p className="text-[10.5px] text-brand-gray font-semibold">{k.s}</p>
          </div>
        ))}
      </div>

      {/* band picker for the two right-hand pies */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase font-bold text-brand-gray mr-1">Show pies for</span>
        {['All sizes', ...B.rows.map((r) => r.key)].map((k) => (
          <button key={k} type="button" onClick={() => setSel(k)}
            className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold border ${sel === k ? 'bg-brand-red text-white border-brand-red' : 'bg-white text-brand-gray border-brand-gray/25 hover:text-brand-black'}`}>{k}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Donut title="Leads by size range" sub="Plot size" center={<div><p className="font-black text-lg leading-none">{num(T.t.leads)}</p><p className="text-[9px] uppercase font-bold text-brand-gray">leads</p></div>}
          data={B.rows.map((r, i) => ({ name: r.label, value: r.t.leads, color: bandColor(r.key, i), ids: r.t.ids!.leads }))} />
        <Donut title={`Assigned vs unassigned · ${cur.label}`} sub={cur.label}
          center={<div><p className="font-black text-lg leading-none">{pctTxt(pc(cur.assigned.length, cur.t.leads))}</p><p className="text-[9px] uppercase font-bold text-brand-gray">assigned</p></div>}
          data={[{ name: 'Assigned', value: cur.assigned.length, color: C_ASSIGNED, ids: cur.assigned }, { name: 'Unassigned', value: cur.unassigned.length, color: C_UNASSIGNED, ids: cur.unassigned }]} />
        <Donut title={`Where they stand · ${cur.label}`} sub={cur.label}
          center={<div><p className="font-black text-lg leading-none">{num(cur.t.leads)}</p><p className="text-[9px] uppercase font-bold text-brand-gray">leads</p></div>}
          data={stageOf(cur)} />
      </div>

      {/* assigned vs unassigned per band */}
      <div>
        <p className="text-[10px] uppercase font-bold text-brand-gray mb-1">Assigned vs unassigned by size range</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={bar} margin={{ left: -10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} />
              <YAxis stroke="#6b7280" fontSize={10} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Assigned" stackId="a" fill={C_ASSIGNED} isAnimationActive={false} cursor="pointer" onClick={(_: any, i: number) => open(B.rows[i].assigned, `${B.rows[i].label} · Assigned`)} />
              <Bar dataKey="Unassigned" stackId="a" fill={C_UNASSIGNED} radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(_: any, i: number) => open(B.rows[i].unassigned, `${B.rows[i].label} · Unassigned`)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* full table */}
      <DataTable rows={B.rows} rowKey={(r) => r.key} onRow={(r) => setSel(r.key)}
        foot={(
          <tr className="border-t-2 border-brand-gray/25 font-black text-brand-black">
            <td className={TD}>Total</td>
            <td className={`${TD} text-right`}>{d(T.t.ids!.leads, T, 'Leads')}</td>
            <td className={`${TD} text-right`}>100%</td>
            <td className={`${TD} text-right`}>{d(T.assigned, T, 'Assigned')}</td>
            <td className={`${TD} text-right`}>{d(T.unassigned, T, 'Unassigned', 'text-orange-600')}</td>
            <td className={`${TD} text-right`}>{d(T.openUnassigned, T, 'Open & unassigned')}</td>
            <td className={`${TD} text-right`}>{d(T.touched, T, 'Touched')}</td>
            <td className={`${TD} text-right`}>{d(T.untouched, T, 'Untouched')}</td>
            <td className={`${TD} text-right`}>{d(T.t.ids!.open, T, 'Open')}</td>
            <td className={`${TD} text-right`}>{d(T.t.ids!.won, T, 'Won', 'text-emerald-700')}</td>
            <td className={`${TD} text-right`}>{d(T.t.ids!.lost, T, 'Lost')}</td>
            <td className={`${TD} text-right`}><Pill v={convOf(T.t)} good={5} ok={1} dp={1} /></td>
            <td className={`${TD} text-right`}>{d(T.oldL, T, 'Old leads')}</td>
            <td className={`${TD} text-right`}>{median(T.sizes) == null ? '—' : num(median(T.sizes)!)}</td>
            <td className={`${TD} text-right`}>{T.sizes.length ? num(Math.round(sum(T.sizes))) : '—'}</td>
            <td className={`${TD} text-right`}>{T.t.wonWithValue ? fmtEGP(T.t.wonValue) : '—'}</td>
          </tr>
        )}
        cols={[
          { id: 'k', head: 'Required size', cell: (r) => <span className="inline-flex items-center gap-1.5 font-bold whitespace-nowrap"><span className="w-2 h-2 rounded-full" style={{ background: bandColor(r.key, B.rows.indexOf(r)) }} />{r.label}</span> },
          { id: 'leads', head: 'Leads', right: true, sort: (r) => r.t.leads, cell: (r) => d(r.t.ids!.leads, r, 'Leads') },
          { id: 'share', head: '% of leads', right: true, sort: (r) => r.t.leads, cell: (r) => pctTxt(pc(r.t.leads, T.t.leads)) },
          { id: 'as', head: 'Assigned', info: 'Leads that have a salesperson now.', right: true, sort: (r) => r.assigned.length, cell: (r) => d(r.assigned, r, 'Assigned') },
          { id: 'un', head: 'Unassigned', info: 'Leads with no salesperson. Small grey % = share of this range.', right: true, sort: (r) => r.unassigned.length, cell: (r) => <span className="whitespace-nowrap">{d(r.unassigned, r, 'Unassigned', r.unassigned.length ? 'text-orange-600' : '')} <span className="text-[10px] text-brand-gray">{pctTxt(pc(r.unassigned.length, r.t.leads))}</span></span> },
          { id: 'ou', head: 'Open & unassigned', info: 'Open leads with nobody on them: the ones to hand out first.', right: true, sort: (r) => r.openUnassigned.length, cell: (r) => d(r.openUnassigned, r, 'Open & unassigned') },
          { id: 'to', head: 'Touched', right: true, sort: (r) => r.touched.length, cell: (r) => d(r.touched, r, 'Touched') },
          { id: 'ut', head: 'Untouched', right: true, sort: (r) => r.untouched.length, cell: (r) => d(r.untouched, r, 'Untouched') },
          { id: 'op', head: 'Open', right: true, sort: (r) => r.t.open, cell: (r) => d(r.t.ids!.open, r, 'Open') },
          { id: 'won', head: 'Won', info: 'Finance-confirmed deals closed in the window.', right: true, sort: (r) => r.t.won, cell: (r) => d(r.t.ids!.won, r, 'Won', 'text-emerald-700') },
          { id: 'lost', head: 'Lost', right: true, sort: (r) => r.t.lost, cell: (r) => d(r.t.ids!.lost, r, 'Lost') },
          { id: 'conv', head: 'Conversion', info: 'Won ÷ leads of this range.', right: true, sort: (r) => convOf(r.t), cell: (r) => <Pill v={convOf(r.t)} good={5} ok={1} dp={1} /> },
          { id: 'old', head: 'Old leads', info: 'Leads from the Excel used before the CRM (the rest are new).', right: true, sort: (r) => r.oldL.length, cell: (r) => d(r.oldL, r, 'Old leads') },
          { id: 'med', head: 'Median size', info: 'Median required area (sqm) typed on these leads.', right: true, sort: (r) => median(r.sizes), cell: (r) => { const m = median(r.sizes); return m == null ? '—' : num(m); } },
          { id: 'area', head: 'Area asked', info: 'Sum of the required area (sqm) of these leads: total land the demand represents.', right: true, sort: (r) => (r.sizes.length ? sum(r.sizes) : null), cell: (r) => (r.sizes.length ? num(Math.round(sum(r.sizes))) : '—') },
          { id: 'val', head: 'Won value', right: true, sort: (r) => (r.t.wonWithValue ? r.t.wonValue : null), cell: (r) => (r.t.wonWithValue ? fmtEGP(r.t.wonValue) : '—') },
        ]} />

      {/* matrices */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-brand-gray">Size range by</span>
          {(['owner', 'project'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setMx(k)}
              className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold border ${mx === k ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-brand-gray border-brand-gray/25 hover:text-brand-black'}`}>{k === 'owner' ? 'Salesperson (assigned leads)' : 'Project'}</button>
          ))}
        </div>
        {mx === 'owner'
          ? <Matrix rows={B.byOwner} bands={B.rows} first="Salesperson" color="#1976D2" limit={12} />
          : <Matrix rows={B.byProject} bands={B.rows} first="Project" color="#D32F2F" limit={12} />}
      </div>
    </Card>
  );
};
