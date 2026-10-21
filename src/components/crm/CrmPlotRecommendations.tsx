import React, { useState, useEffect } from 'react';
import { canonicalParks } from '../../lib/parkAliases';
import { Plot, landBankLink, trackLbClick } from '../../lib/plotsService';
import { MapPin, ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  plots: Plot[];
  landBankUrl?: string;
  leadId?: string;
  project: string;
  requiredSize: string | number;
  onNavigateToInventory: () => void;
}

interface MergedPlotGroup {
  id: string;
  plots: Plot[];
  totalAreaSqM: number;
  park: string;
  sector: string;
}

export const CrmPlotRecommendations: React.FC<Props> = ({ plots, landBankUrl, leadId, project, requiredSize, onNavigateToInventory }) => {
  const [selectedPlot, setSelectedPlot] = useState<Plot | null>(null);
  const [selectedMergedPlot, setSelectedMergedPlot] = useState<MergedPlotGroup | null>(null);

  // Escape closes the detail windows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedPlot(null); setSelectedMergedPlot(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Parse the requested size (number, "3000", or a range "2000-4000"). No default: unknown size = no recommendations.
  let minSize = NaN;
  let maxSize = NaN;
  if (typeof requiredSize === 'number') {
    minSize = requiredSize;
    maxSize = requiredSize;
  } else if (typeof requiredSize === 'string') {
    const matches = requiredSize.match(/\d[\d,]*(?:\.\d+)?/g);
    if (matches && matches.length > 0) {
      minSize = parseFloat(matches[0].replace(/,/g, ''));
      maxSize = matches.length > 1 ? parseFloat(matches[1].replace(/,/g, '')) : minSize;
    }
  }
  const sizeKnown = Number.isFinite(minSize) && Number.isFinite(maxSize) && minSize > 0 && maxSize > 0;
  if (sizeKnown && minSize > maxSize) { const t = minSize; minSize = maxSize; maxSize = t; }

  const targetSize = (minSize + maxSize) / 2;
  const normName = (v: string) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wanted = normName(project);
  const aliasParks = canonicalParks(project || '');
  const inProject = (pl: Plot) => aliasParks.includes(pl.park) || (!!wanted && (normName(pl.park) === wanted || normName(pl.project) === wanted));

  // Only plots that are available to sell (Land Bank status 'available'), with a real area
  const availablePlots = plots.filter(plot => plot.status === 'available' && plot.areaSqM > 0);

  // Filter plots close to the target size (within 0.7x of minSize to 1.3x of maxSize)
  const matchesSize = (area: number) => {
    if (!sizeKnown) return true;
    return area >= minSize * 0.7 && area <= maxSize * 1.3;
  };

  // Recommendations in the same preferred project
  const preferredProjectRecommendations = availablePlots
    .filter(plot => inProject(plot) && matchesSize(plot.areaSqM))
    .sort((a, b) => sizeKnown ? Math.abs(a.areaSqM - targetSize) - Math.abs(b.areaSqM - targetSize) : a.areaSqM - b.areaSqM)
    .slice(0, sizeKnown ? 4 : 6);

  // Recommendations in alternative projects
  const alternativeProjectRecommendations = availablePlots
    .filter(plot => sizeKnown && !inProject(plot) && matchesSize(plot.areaSqM))
    .sort((a, b) => Math.abs(a.areaSqM - targetSize) - Math.abs(b.areaSqM - targetSize))
    .slice(0, 4);

  let mergedRecommendations: MergedPlotGroup[] = [];
  if (sizeKnown && preferredProjectRecommendations.length === 0 && alternativeProjectRecommendations.length === 0) {
    // Try to find combinations of plots across ALL available plots
    const groupedByProjAndSector: { [key: string]: Plot[] } = {};
    availablePlots.forEach(p => {
      const key = `${p.park}::${p.sector || 'N/A'}`;
      if (!groupedByProjAndSector[key]) groupedByProjAndSector[key] = [];
      groupedByProjAndSector[key].push(p);
    });
    
    const getUnitNumber = (unitCode: string) => {
      const match = (unitCode || '').match(/(\d+)$/);
      return match ? parseInt(match[1], 10) : NaN;
    };

    for (const key in groupedByProjAndSector) {
      const [proj, sec] = key.split('::');
      // Map to object with parsed number, filter out NaN, and sort numerically
      const sectorPlots = groupedByProjAndSector[key]
        .map(p => ({ plot: p, num: getUnitNumber(p.unit) }))
        .filter(p => !isNaN(p.num))
        .sort((a, b) => a.num - b.num);

      for (let i = 0; i < sectorPlots.length; i++) {
        for (let j = 2; j <= 5; j++) {
          if (i + j <= sectorPlots.length) {
            const combination = sectorPlots.slice(i, i + j);
            
            // Check adjacency (consecutive numbers)
            let isContiguous = true;
            for (let k = 0; k < combination.length - 1; k++) {
              if (combination[k+1].num - combination[k].num !== 1) {
                isContiguous = false;
                break;
              }
            }

            if (isContiguous) {
              const plots = combination.map(c => c.plot);
              const totalArea = plots.reduce((sum, p) => sum + p.areaSqM, 0);
              if (matchesSize(totalArea)) {
                mergedRecommendations.push({
                  id: `merged-${plots[0].key}-${j}`,
                  plots: plots,
                  totalAreaSqM: totalArea,
                  park: proj,
                  sector: sec
                });
              }
            }
          }
        }
      }
    }
    
    // Sort and limit
    mergedRecommendations = mergedRecommendations
      .sort((a, b) => Math.abs(a.totalAreaSqM - targetSize) - Math.abs(b.totalAreaSqM - targetSize))
      .slice(0, 6);
  }

  const totalRecsCount = preferredProjectRecommendations.length + alternativeProjectRecommendations.length + mergedRecommendations.length;

  const getStatusBadgeColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'AVAILABLE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'RESERVED':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'SOLD':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'HOLD':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const holdLink = (pl: Plot) => (
    <a href={landBankLink(landBankUrl, pl.key, 'hold', leadId)} target="_blank" rel="noopener noreferrer" onClick={() => trackLbClick(pl.key, 'hold', leadId)}
      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-brand-red text-white text-[10px] font-bold flex items-center gap-1 hover:opacity-90">
      Hold in Land Bank <ExternalLink size={10} />
    </a>
  );

  if (totalRecsCount === 0) {
    return (
      <div className="mt-4 p-4 bg-brand-light border border-black/5 rounded-xl text-center">
        <p className="text-xs text-brand-gray font-semibold">{sizeKnown ? `No plot recommendations found matching the size criteria (${minSize.toLocaleString()} - ${maxSize.toLocaleString()} sqm).` : 'Required size missing and the project is not recognised as a Land Bank park, so no plots can be recommended.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-extrabold text-brand-gray uppercase tracking-wider block">
          Matching Plot Recommendations
        </span>
        <button 
          onClick={onNavigateToInventory}
          className="text-[10px] text-brand-red font-bold flex items-center gap-1 hover:underline"
        >
          View Full Inventory <ExternalLink size={10} />
        </button>
      </div>

      {!sizeKnown && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold">Required size missing — recommendations use the project only.</p>}

      {/* Target Project Recommendations */}
      {preferredProjectRecommendations.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10.5px] font-extrabold text-brand-red uppercase tracking-wider block">
            Preferred Project: {project}
          </span>
          <div className="grid grid-cols-1 gap-2">
            {preferredProjectRecommendations.map(plot => (
              <div key={plot.key} className="p-3.5 bg-brand-light border border-black/5 rounded-xl flex items-center justify-between hover:border-brand-red/20 transition-all">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white rounded-lg border border-black/5">
                    <MapPin size={14} className="text-brand-red" />
                  </div>
                  <div>
                    <button
                      onClick={() => setSelectedPlot(plot)}
                      className="font-bold text-brand-red text-xs hover:underline text-left cursor-pointer focus:outline-none flex items-center gap-1 bg-transparent border-none p-0"
                      title="Click to view full details of this plot"
                    >
                      Unit {plot.unit} <ExternalLink size={10} className="inline-block opacity-70" />
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                      <span className="bg-brand-gray/10 text-brand-gray px-1.5 py-0.5 rounded font-medium">
                        Sector: {plot.sector || 'N/A'}
                      </span>
                      <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold border border-emerald-100">
                        Size: {plot.areaSqM.toLocaleString()} sqm | {(plot.areaSqM / 4200).toFixed(2)} Fed | {(plot.areaSqM / 10000).toFixed(2)} Ha
                      </span>
                      {plot.landType && (
                        <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium border border-blue-100">
                          {plot.landType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {holdLink(plot)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alternative Projects Recommendations */}
      {alternativeProjectRecommendations.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10.5px] font-extrabold text-brand-gray uppercase tracking-wider block">
            Alternative Options (Other Projects)
          </span>
          <div className="grid grid-cols-1 gap-2">
            {alternativeProjectRecommendations.map(plot => (
              <div key={plot.key} className="p-3.5 bg-brand-light border border-black/5 rounded-xl flex items-center justify-between hover:border-brand-red/20 transition-all">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white rounded-lg border border-black/5">
                    <MapPin size={14} className="text-brand-gray" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setSelectedPlot(plot)}
                        className="font-bold text-brand-red text-xs hover:underline text-left cursor-pointer focus:outline-none flex items-center gap-1 bg-transparent border-none p-0"
                        title="Click to view full details of this plot"
                      >
                        Unit {plot.unit} <ExternalLink size={10} className="inline-block opacity-70" />
                      </button>
                      <span className="text-xs text-brand-gray font-normal">({plot.park})</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                      <span className="bg-brand-gray/10 text-brand-gray px-1.5 py-0.5 rounded font-medium">
                        Sector: {plot.sector || 'N/A'}
                      </span>
                      <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold border border-emerald-100">
                        Size: {plot.areaSqM.toLocaleString()} sqm | {(plot.areaSqM / 4200).toFixed(2)} Fed | {(plot.areaSqM / 10000).toFixed(2)} Ha
                      </span>
                      {plot.landType && (
                        <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium border border-blue-100">
                          {plot.landType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {holdLink(plot)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Merged Recommendations */}
      {mergedRecommendations.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10.5px] font-extrabold text-brand-black uppercase tracking-wider block">
            Suggested Merged Plots
          </span>
          <p className="text-[10px] text-brand-gray/80 -mt-1 mb-2">No single plot found. We recommend merging these adjacent plots to reach the target size.</p>
          <div className="grid grid-cols-1 gap-2">
            {mergedRecommendations.map(mergedGroup => (
              <div key={mergedGroup.id} className="p-3.5 bg-brand-light border border-black/5 rounded-xl flex items-center justify-between hover:border-brand-black/20 transition-all">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white rounded-lg border border-black/5">
                    <MapPin size={14} className="text-brand-black" />
                  </div>
                  <div>
                    <button
                      onClick={() => setSelectedMergedPlot(mergedGroup)}
                      className="font-bold text-brand-black text-xs hover:underline text-left cursor-pointer focus:outline-none flex items-center gap-1 bg-transparent border-none p-0"
                      title="Click to view full details of this merged plot"
                    >
                      Merge {mergedGroup.plots.length} Units <ExternalLink size={10} className="inline-block opacity-70" />
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                      <span className="bg-brand-gray/10 text-brand-gray px-1.5 py-0.5 rounded font-medium">
                        Sector: {mergedGroup.sector}
                      </span>
                      <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold border border-emerald-100">
                        Size: {mergedGroup.totalAreaSqM.toLocaleString()} sqm | {(mergedGroup.totalAreaSqM / 4200).toFixed(2)} Fed | {(mergedGroup.totalAreaSqM / 10000).toFixed(2)} Ha
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail overlay modal */}
      <AnimatePresence>
        {selectedPlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-black/10 overflow-hidden text-left"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center px-6 py-5 border-b border-black/5 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand-red/10 text-brand-red rounded-2xl">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base text-brand-black tracking-tight">
                      Unit {selectedPlot.unit} Details
                    </h4>
                    <p className="text-xs text-brand-gray font-semibold tracking-wide uppercase mt-0.5">
                      {selectedPlot.park}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedPlot(null)}
                  className="p-2 hover:bg-black/5 text-brand-gray hover:text-brand-black rounded-xl transition-all cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                {/* Primary Badges */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-brand-light border border-black/5 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-bold text-brand-gray uppercase tracking-wider block">Status</span>
                    <div className="mt-2.5">
                      <span className={`px-2.5 py-1 text-[10px] font-extrabold rounded-full border ${getStatusBadgeColor(selectedPlot.status)}`}>
                        {(selectedPlot.status || '—').toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="bg-brand-light border border-black/5 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-bold text-brand-gray uppercase tracking-wider block">Total Area</span>
                    <div className="text-[10.5px] text-brand-gray/80 mt-1 font-mono">
                      {(selectedPlot.areaSqM / 4200).toFixed(2)} Feddan | {(selectedPlot.areaSqM / 10000).toFixed(2)} Hectare
                    </div>
                    <span className="text-base font-mono font-black text-brand-black block mt-1">
                      {selectedPlot.areaSqM.toLocaleString()} sqm
                    </span>
                  </div>
                </div>

                {/* Specifics */}
                <div className="space-y-3">
                  <h5 className="text-[11px] font-extrabold text-brand-black uppercase tracking-widest border-b border-black/5 pb-1">
                    General Information
                  </h5>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                    <div>
                      <span className="text-brand-gray font-medium block">Project Name</span>
                      <span className="font-bold text-brand-black">{selectedPlot.park || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-brand-gray font-medium block">Sector</span>
                      <span className="font-bold text-brand-black">{selectedPlot.sector || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-brand-gray font-medium block">Land Type</span>
                      <span className="font-bold text-brand-black">{selectedPlot.landType || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-brand-gray font-medium block">Unit Code</span>
                      <span className="font-mono font-bold text-brand-black">{selectedPlot.unit || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Pricing / Sales */}
                <div className="space-y-3">
                  <h5 className="text-[11px] font-extrabold text-brand-black uppercase tracking-widest border-b border-black/5 pb-1">
                    Commercial Guidelines
                  </h5>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                    <div>
                      <span className="text-brand-gray font-medium block">List price per sqm</span>
                      <span className="font-mono font-bold text-emerald-600">
                        {selectedPlot.listPriceSqm ? `${Math.round(selectedPlot.listPriceSqm).toLocaleString('en-US')} EGP / sqm` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-brand-gray font-medium block">List total</span>
                      <span className="font-mono font-bold text-emerald-600">
                        {selectedPlot.listTotal ? `${Math.round(selectedPlot.listTotal).toLocaleString('en-US')} EGP` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-slate-50 border-t border-black/5 flex justify-end gap-2">
                {holdLink(selectedPlot)}
                <button 
                  onClick={() => setSelectedPlot(null)}
                  className="px-5 py-2.5 bg-brand-black hover:bg-black/95 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Merged Detail overlay modal */}
        {selectedMergedPlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-black/10 overflow-hidden text-left"
            >
              <div className="flex justify-between items-center px-6 py-5 border-b border-black/5 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand-black/10 text-brand-black rounded-2xl">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base text-brand-black tracking-tight">
                      Merged Plot ({selectedMergedPlot.plots.length} Units)
                    </h4>
                    <p className="text-xs text-brand-gray font-semibold tracking-wide uppercase mt-0.5">
                      {selectedMergedPlot.park}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedMergedPlot(null)}
                  className="p-2 hover:bg-black/5 text-brand-gray hover:text-brand-black rounded-xl transition-all cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-brand-light border border-black/5 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-bold text-brand-gray uppercase tracking-wider block">Status</span>
                    <div className="mt-2.5">
                      <span className={`px-2.5 py-1 text-[10px] font-extrabold rounded-full border bg-emerald-100 text-emerald-800 border-emerald-200`}>
                        ALL AVAILABLE
                      </span>
                    </div>
                  </div>
                  <div className="bg-brand-light border border-black/5 rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-bold text-brand-gray uppercase tracking-wider block">Total Area</span>
                    <div className="text-[10.5px] text-brand-gray/80 mt-1 font-mono">
                      {(selectedMergedPlot.totalAreaSqM / 4200).toFixed(2)} Feddan | {(selectedMergedPlot.totalAreaSqM / 10000).toFixed(2)} Hectare
                    </div>
                    <span className="text-base font-mono font-black text-brand-black block mt-1">
                      {selectedMergedPlot.totalAreaSqM.toLocaleString()} sqm
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <h5 className="text-[11px] font-extrabold text-brand-black uppercase tracking-widest border-b border-black/5 pb-1">
                    Units to Merge
                  </h5>
                  <div className="space-y-2">
                    {selectedMergedPlot.plots.map(p => (
                      <div key={p.key} className="flex justify-between text-xs py-2 border-b border-black/5">
                        <span className="font-bold text-brand-black">Unit {p.unit}</span>
                        <span className="flex items-center gap-3"><span className="font-mono text-emerald-700">{p.areaSqM.toLocaleString()} sqm</span>{holdLink(p)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-black/5 flex justify-end">
                <button 
                  onClick={() => setSelectedMergedPlot(null)}
                  className="px-5 py-2.5 bg-brand-black hover:bg-black/95 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
