import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Company, Lead, Contact } from './types';
import { crmService } from './crmService';
import { csvCell, safeHttpUrl } from '../../lib/plots';
import { useAuth } from '../../services/AuthContext';
import { 
  Building, 
  Search, 
  Plus, 
  Globe, 
  FileText, 
  ShieldAlert, 
  MapPin, 
  User, 
  TrendingUp,
  X,
  Users,
  ArrowRight,
  Trash2,
  Download,
  Square,
  CheckSquare
} from 'lucide-react';
import { motion } from 'motion/react';
import { PagerBar } from './LeadListParts';
import { useDebounced, makeSearchIndex, usePagedList } from './usePagedList';

const nameKey = (v?: string) => (v || '').trim().toLowerCase();
const companyText = makeSearchIndex<Company>(co => `${co.name || ''} ${co.industry || ''} ${co.city || ''} ${co.assignedAccountManager || ''}`);
interface CompanyStat { totalLeads: number; opportunities: number }
const NO_STAT: CompanyStat = { totalLeads: 0, opportunities: 0 };
const NON_OPP = new Set(['New', 'Assigned', 'Lost', 'Duplicate']);

interface CompanyRowProps {
  co: Company;
  stats: CompanyStat;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (co: Company) => void;
}
const CompanyRow = React.memo<CompanyRowProps>(({ co, stats, isSelected, onToggle, onOpen }) => (
  <tr className={`hover:bg-brand-gray/5 transition-all ${isSelected ? 'bg-brand-red/5' : ''}`}>
    <td className="py-3.5 px-4">
      <button aria-label={`Select ${co.name}`} onClick={() => onToggle(co.id)} className="focus:outline-none">
        {isSelected ? (
          <CheckSquare size={16} className="text-brand-red" />
        ) : (
          <Square size={16} className="text-brand-gray/60" />
        )}
      </button>
    </td>
    <td className="py-3.5 px-4 font-bold text-brand-black">{co.name}</td>
    <td className="py-3.5 px-3 text-brand-gray font-semibold">{co.industry || 'N/A'}</td>
    <td className="py-3.5 px-3 font-mono text-brand-gray">{co.commercialRegistration || 'Pending CR'}</td>
    <td className="py-3.5 px-3 text-center">
      <span className="bg-brand-red/10 text-brand-red px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold">
        {stats.totalLeads} Leads
      </span>
    </td>
    <td className="py-3.5 px-3 text-center">
      <span className="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold">
        {stats.opportunities} Opps
      </span>
    </td>
    <td className="py-3.5 px-4 text-right">
      <button
        onClick={() => onOpen(co)}
        className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-3 py-1 rounded-lg font-bold"
      >
        Details
      </button>
    </td>
  </tr>
));
CompanyRow.displayName = 'CompanyRow';

interface CrmCompaniesProps {
  companies: Company[];
  leads: Lead[];
  onCompaniesUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

export const CrmCompanies: React.FC<CrmCompaniesProps> = ({ 
  companies, 
  leads, 
  onCompaniesUpdated, 
  currentRole,
  setActiveSubTab
}) => {
  const { user } = useAuth();
  const isAdmin = (currentRole?.toLowerCase() || '').includes('admin') || (user?.role?.toLowerCase() || '').includes('admin');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirmCompanyId, setDeleteConfirmCompanyId] = useState<string | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>('');
  const [deleteConfirmBulk, setDeleteConfirmBulk] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  // Form states
  const [newCompanyForm, setNewCompanyForm] = useState({
    name: '',
    industry: '',
    commercialRegistration: '',
    taxNumber: '',
    address: '',
    city: '',
    website: '',
    assignedAccountManager: '',
  });

  // Cross-link hook: auto-select company if set in localStorage
  useEffect(() => {
    const coId = localStorage.getItem('selected_company_id');
    const coName = localStorage.getItem('selected_crm_company_name');
    if (coId || coName) {
      const found = (coId && companies.find(co => co.id === coId)) || (coName ? companies.find(co => (co.name || '').toLowerCase() === coName.toLowerCase()) : undefined);
      if (found) {
        setSelectedCompany(found);
      }
      localStorage.removeItem('selected_crm_company_name');
      localStorage.removeItem('selected_company_id');
    }
  }, [companies]);

  // Escape closes any open window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateModal(false); setDeleteConfirmCompanyId(null); setDeleteConfirmBulk(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Filter Companies
  const debouncedSearch = useDebounced(searchTerm, 250);
  const filteredCompanies = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return q ? companies.filter(co => companyText(co).includes(q)) : companies;
  }, [companies, debouncedSearch]);
  const { pageRows, page, pageSize, setPage, setPageSize, allShown, more } = usePagedList(filteredCompanies, 'sid_companies_page_size', debouncedSearch);
  const selectedSet = useMemo(() => new Set(selectedCompanyIds), [selectedCompanyIds]);

  // Export to CSV helper
  const exportToCSV = () => {
    const headers = [
      'Company Name', 'Industry Focus', 'Commercial Registration', 'Tax Number', 
      'Address', 'City', 'Website', 'Assigned Account Manager'
    ];
    const rows = filteredCompanies.map(co => [
      co.name,
      co.industry || '',
      co.commercialRegistration || '',
      co.taxNumber || '',
      co.address || '',
      co.city || '',
      co.website || '',
      co.assignedAccountManager || ''
    ]);

    const formatCSVRow = (arr: any[]) => arr.map(csvCell).join(',');

    const csvContent = [headers.map(csvCell).join(','), ...rows.map(formatCSVRow)].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `CRM_Companies_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Compute stats per company
  const companyStats = useMemo(() => {
    const stats = new Map<string, CompanyStat>();
    companies.forEach(co => {
      const k = nameKey(co.name);
      if (!stats.has(k)) stats.set(k, { totalLeads: 0, opportunities: 0 });
    });
    leads.forEach(l => {
      if (!l.companyName) return;
      const k = nameKey(l.companyName);
      let st = stats.get(k);
      if (!st) { st = { totalLeads: 0, opportunities: 0 }; stats.set(k, st); }
      st.totalLeads++;
      // Lead counts as opportunity if it transitioned past contacted/follow up stage
      if (!NON_OPP.has(l.status)) st.opportunities++;
    });
    return stats;
  }, [companies, leads]);

  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCompanyForm.name.trim();
    if (!name) return;
    if (currentRole === 'Read Only') { setFormError('You do not have permission to create companies.'); return; }

    // Re-read the stored list so only the new row is added
    const stored = crmService.getCompanies();
    const existing = stored.some(co => (co.name || '').trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setFormError('A company profile with this name already exists.');
      return;
    }

    const website = newCompanyForm.website.trim();
    if (website && !safeHttpUrl(website)) {
      setFormError('Website must be a valid http(s) address.');
      return;
    }

    const newCo: Company = {
      id: 'co_' + Math.random().toString(36).substr(2, 9),
      name,
      industry: newCompanyForm.industry,
      commercialRegistration: newCompanyForm.commercialRegistration.trim(),
      taxNumber: newCompanyForm.taxNumber.trim(),
      address: newCompanyForm.address.trim(),
      city: newCompanyForm.city.trim(),
      website: website ? safeHttpUrl(website) : '',
      assignedAccountManager: newCompanyForm.assignedAccountManager.trim(),
    };

    crmService.saveCompanies([newCo, ...stored]);
    
    setShowCreateModal(false);
    setNewCompanyForm({
    name: '',
    industry: '',
    commercialRegistration: '',
    taxNumber: '',
    address: '',
    city: '',
    website: '',
    assignedAccountManager: '',
  });
    setFormError('');
    onCompaniesUpdated();
  };

  const handleDeleteCompany = (id: string) => {
    if (!isAdmin) {
      setNotice("Unauthorized: Only Administrators can delete corporate accounts.");
      return;
    }
    setDeleteConfirmCompanyId(id);
  };

  const confirmDeleteCompany = () => {
    if (!deleteConfirmCompanyId || !isAdmin) return;
    const id = deleteConfirmCompanyId;
    const remaining = crmService.getCompanies().filter(co => co.id !== id);
    crmService.saveCompanies(remaining);
    setSelectedCompany(null);
    setDeleteConfirmCompanyId(null);
    onCompaniesUpdated();
  };

  const handleSelectCompany = useCallback((id: string) => {
    setSelectedCompanyIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }, []);

  const handleSelectAll = () => {
    if (selectedCompanyIds.length === filteredCompanies.length) {
      setSelectedCompanyIds([]);
    } else {
      setSelectedCompanyIds(filteredCompanies.map(co => co.id));
    }
  };

  const confirmBulkDelete = () => {
    if (!isAdmin) return;
    const remaining = crmService.getCompanies().filter(co => !selectedCompanyIds.includes(co.id));
    crmService.saveCompanies(remaining);
    setSelectedCompanyIds([]);
    setBulkAction('');
    setDeleteConfirmBulk(false);
    setSelectedCompany(null);
    onCompaniesUpdated();
  };

  const executeBulkAction = () => {
    if (selectedCompanyIds.length === 0 || !bulkAction) return;

    if (bulkAction === 'delete') {
      if (!isAdmin) {
        setNotice("Unauthorized: Only Administrators can bulk delete corporate accounts.");
        return;
      }
      setDeleteConfirmBulk(true);
    }
  };

  const companyLeads = useMemo(() => {
    if (!selectedCompany) return [];
    return leads.filter(l => (l.companyName || '').trim().toLowerCase() === (selectedCompany.name || '').trim().toLowerCase());
  }, [selectedCompany, leads]);

  const associatedContacts = useMemo(() => {
    if (!selectedCompany) return [];
    try {
      const allContacts = crmService.getContacts();
      return allContacts.filter(
        c => c.company && c.company.trim().toLowerCase() === (selectedCompany.name || '').trim().toLowerCase()
      );
    } catch (e) {
      return [];
    }
  }, [selectedCompany, companies]);

  return (
    <div className="space-y-6" id="crm-companies-root">
      {notice && (
        <div role="alert" className="flex justify-between items-center text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 text-xs font-bold">
          <span>{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}
      
      {/* Header and Add Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-brand-black flex items-center gap-2">
            <span>Corporate Accounts and Companies</span>
            <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2.5 py-0.5 rounded-full">
              {filteredCompanies.length} Profiles
            </span>
          </h3>
          <p className="text-xs text-brand-gray/80 mt-1">Stores statutory data, registration numbers, tax data, and strategic accounts information.</p>
        </div>
        
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={exportToCSV}
              className="bg-white hover:bg-brand-gray/5 border border-brand-gray/25 text-brand-black px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition-all"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          )}
          {currentRole !== 'Read Only' && (
            <button
              onClick={() => { setFormError(''); setShowCreateModal(true); }}
              className="bg-brand-red hover:bg-brand-red-dark text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow"
            >
              <Plus size={14} />
              <span>New Company</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-gray" size={16} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search companies (by corporate name, industry focus, city, account manager...)"
          className="w-full pl-10 pr-4 py-3 bg-white border border-brand-gray/20 rounded-2xl focus:outline-none focus:ring-1 focus:ring-brand-red shadow-sm text-xs font-semibold"
        />
      </div>

      {/* Bulk Action Controls Bar */}
      {selectedCompanyIds.length > 0 && (
        <div className="bg-brand-black text-white p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-brand-red rounded-full animate-ping" />
            <span className="text-xs font-bold">{selectedCompanyIds.length} Corporate Accounts selected for Bulk Action</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:bg-white focus:text-brand-black"
            >
              <option value="" className="text-brand-black">Select Action...</option>
              {isAdmin && (
                <option value="delete" className="text-brand-black">Bulk Delete Records</option>
              )}
            </select>
            <button
              onClick={executeBulkAction}
              disabled={!bulkAction}
              className="bg-brand-red hover:bg-brand-red-dark disabled:opacity-50 text-white text-xs font-extrabold px-4 py-2 rounded-xl shadow transition-all"
            >
              Execute
            </button>
            <button
              onClick={() => setSelectedCompanyIds([])}
              className="text-xs text-white/60 hover:text-white ml-2 font-semibold"
            >
              Clear Choice
            </button>
          </div>
        </div>
      )}

      {/* Main Grid split */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Company table */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px] font-bold uppercase tracking-wider">
                  <th className="py-4 px-4 w-10">
                    <button aria-label="Select all companies" onClick={handleSelectAll} className="focus:outline-none">
                      {selectedCompanyIds.length === filteredCompanies.length && filteredCompanies.length > 0 ? (
                        <CheckSquare size={16} className="text-brand-red" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th className="py-4 px-4">Corporate Name</th>
                  <th className="py-4 px-3">Industry Focus</th>
                  <th className="py-4 px-3">Reg. Number</th>
                  <th className="py-4 px-3 text-center">Pipeline Volume</th>
                  <th className="py-4 px-3 text-center">Active Opps</th>
                  <th className="py-4 px-4 text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-gray/10 text-xs font-medium text-brand-black">
                {filteredCompanies.length > 0 ? (
                  pageRows.map((co) => (
                    <CompanyRow
                      key={co.id}
                      co={co}
                      stats={companyStats.get(nameKey(co.name)) || NO_STAT}
                      isSelected={selectedSet.has(co.id)}
                      onToggle={handleSelectCompany}
                      onOpen={setSelectedCompany}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-brand-gray">
                      No corporate profiles match current parameters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PagerBar total={filteredCompanies.length} page={page} pageSize={pageSize} onPage={setPage} onSize={setPageSize} shown={allShown} onMore={more} />
        </div>

        {/* Selected company pane */}
        <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-6 flex flex-col h-full justify-between">
          {selectedCompany ? (
            <div className="space-y-6 text-xs">
              
              {/* Header profile */}
              <div className="flex items-center justify-between border-b border-brand-gray/10 pb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-brand-black text-white flex items-center justify-center font-black text-xl">
                    {(selectedCompany.name || '?').charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-brand-black text-sm">{selectedCompany.name}</h4>
                    <p className="text-[10px] uppercase font-bold text-brand-gray tracking-wider mt-0.5">{selectedCompany.industry}</p>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteCompany(selectedCompany.id)}
                    className="bg-rose-100 hover:bg-rose-200 text-rose-700 px-3 py-1.5 rounded-xl flex items-center gap-1 font-bold text-[10px] uppercase tracking-wider"
                    title="Delete Corporate Account"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              {/* Statutory parameters */}
              <div className="space-y-3">
                <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest border-b border-brand-gray/5 pb-1">Statutory Specifications</h5>
                
                <div className="flex justify-between">
                  <span className="text-brand-gray font-semibold">Commercial Reg:</span>
                  <span className="font-mono text-brand-black font-bold">{selectedCompany.commercialRegistration || 'Pending Validation'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-brand-gray font-semibold">Tax Card Number:</span>
                  <span className="font-mono text-brand-black font-bold">{selectedCompany.taxNumber || 'Not Logged'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-brand-gray font-semibold">Website:</span>
                  {safeHttpUrl(selectedCompany.website) ? (
                    <a href={safeHttpUrl(selectedCompany.website)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1 font-bold">
                      <Globe size={11} />
                      <span>Visit Site</span>
                    </a>
                  ) : (
                    <span className="text-brand-gray">N/A</span>
                  )}
                </div>

                <div className="flex justify-between">
                  <span className="text-brand-gray font-semibold">HQ Address:</span>
                  <span className="text-brand-black font-semibold flex items-center gap-1">
                    <MapPin size={11} className="text-brand-red" />
                    {selectedCompany.address || 'N/A'}, {selectedCompany.city}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-brand-gray font-semibold">Key Account Manager:</span>
                  <span className="text-brand-black font-bold flex items-center gap-1">
                    <User size={11} className="text-indigo-600" />
                    {selectedCompany.assignedAccountManager || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Company sales opportunities */}
              <div className="space-y-3">
                <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest border-b border-brand-gray/5 pb-1">Historical Pipeline Logs ({companyLeads.length})</h5>
                
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {companyLeads.map(l => {
                    let sColor = 'bg-brand-gray/10 text-brand-gray';
                    if (l.status === 'Won') sColor = 'bg-emerald-100 text-emerald-800';
                    else if (l.status === 'Lost') sColor = 'bg-rose-100 text-rose-800';

                    const handleOpenLead = () => {
                      localStorage.setItem('selected_lead_id', l.id);
                      if (setActiveSubTab) {
                        setActiveSubTab('leads');
                      }
                    };

                    return (
                      <div key={l.id} className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl flex justify-between items-center">
                        <div>
                          <button
                            onClick={handleOpenLead}
                            className="font-mono font-bold text-brand-red hover:underline hover:text-brand-red-dark text-left"
                            title="Click to open this Sales Lead"
                          >
                            {l.id}
                          </button>
                          <span className="text-brand-gray ml-2 text-[10px]">{l.project} ({typeof l.requiredSize === 'number' ? l.requiredSize.toLocaleString() : l.requiredSize} sqm)</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${sColor}`}>{l.status}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Company sub-account contacts */}
              <div className="space-y-3 border-t border-brand-gray/10 pt-4">
                <h5 className="text-[10px] uppercase font-bold text-brand-gray tracking-widest border-b border-brand-gray/5 pb-1 flex items-center gap-1.5">
                  <Users size={12} className="text-brand-red" />
                  <span>Sub-Account Contacts ({associatedContacts.length})</span>
                </h5>
                
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {associatedContacts.length > 0 ? (
                    associatedContacts.map(c => (
                      <div key={c.id} className="p-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl flex justify-between items-center">
                        <div className="space-y-0.5">
                          <h6 className="font-bold text-brand-black">{c.name}</h6>
                          <p className="text-[10px] text-brand-gray font-semibold">{c.jobTitle || 'Representative'} ({c.department || 'N/A'})</p>
                          <p className="text-[10.5px] font-mono text-brand-gray">{c.phoneNumber}</p>
                        </div>
                        <button
                          onClick={() => {
                            localStorage.setItem('selected_crm_contact_phone', c.phoneNumber);
                            setActiveSubTab?.('contacts');
                          }}
                          className="text-brand-red font-bold hover:underline text-[10px] flex items-center gap-1 uppercase tracking-wider bg-transparent border-0 p-0 cursor-pointer"
                        >
                          <span>Toggle</span>
                          <ArrowRight size={10} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-center py-4 text-brand-gray text-[11px]">No registered contacts linked to this account yet.</p>
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-center text-brand-gray text-xs">
              <div className="space-y-2">
                <Building size={24} className="mx-auto text-brand-gray/40" />
                <p>Select a corporate account to display statutory registration records, tax cards, websites, and sales opportunity summaries.</p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* -------------------- NEW COMPANY MODAL -------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Register Corporate Account</h4>
              <button onClick={() => setShowCreateModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCompany} className="p-6 space-y-4 text-xs font-medium">
              {formError && <p role="alert" className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold">{formError}</p>}
              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Company Name *</label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.name}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, name: e.target.value })}
                  placeholder="e.g., Stefner Steel Industries"
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Industry Sector</label>
                  <select
                    value={newCompanyForm.industry}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, industry: e.target.value })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="">— Not specified —</option>
                    <option value="Steel & Metallurgy">Steel & Metallurgy</option>
                    <option value="Logistics & Warehousing">Logistics & Warehousing</option>
                    <option value="Food Processing">Food Processing</option>
                    <option value="Pharmaceutical Packaging">Pharmaceutical Packaging</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Website Domain</label>
                  <input
                    type="text"
                    value={newCompanyForm.website}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, website: e.target.value })}
                    placeholder="e.g., https://stefnersteel.com"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Commercial Registration #</label>
                  <input
                    type="text"
                    value={newCompanyForm.commercialRegistration}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, commercialRegistration: e.target.value })}
                    placeholder="e.g., CR-98432"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Corporate Tax Number</label>
                  <input
                    type="text"
                    value={newCompanyForm.taxNumber}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, taxNumber: e.target.value })}
                    placeholder="e.g., TX-450-293-19"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Address</label>
                  <input
                    type="text"
                    value={newCompanyForm.address}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, address: e.target.value })}
                    placeholder="e.g., Plot 24, Zone A"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">City HQ Location</label>
                  <input
                    type="text"
                    value={newCompanyForm.city}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, city: e.target.value })}
                    placeholder="e.g., Cairo"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Key Account Manager</label>
                <input
                  type="text"
                  value={newCompanyForm.assignedAccountManager}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, assignedAccountManager: e.target.value })}
                  placeholder="Optional"
                  className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Create Profile
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* -------------------- CUSTOM DELETE CONFIRMATION DIALOG (ADMIN ONLY) -------------------- */}
      {deleteConfirmCompanyId && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-rose-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Trash2 size={18} />
                <span>Confirm Corporate Profile Deletion</span>
              </h4>
              <button onClick={() => setDeleteConfirmCompanyId(null)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray leading-relaxed text-sm">
                Are you absolutely sure you want to permanently delete corporate account <strong className="text-brand-black font-extrabold">{companies.find(co => co.id === deleteConfirmCompanyId)?.name || deleteConfirmCompanyId}</strong>?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. All statutory parameters, assigned accounts, logs, and associated metrics for this company will be permanently deleted from local store.
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmCompanyId(null)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteCompany}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Permanently Delete
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* -------------------- CUSTOM BULK DELETE CONFIRMATION DIALOG (ADMIN ONLY) -------------------- */}
      {deleteConfirmBulk && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-rose-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Trash2 size={18} />
                <span>Confirm Bulk Deletion</span>
              </h4>
              <button onClick={() => setDeleteConfirmBulk(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray leading-relaxed text-sm">
                Are you absolutely sure you want to permanently delete the <strong className="text-brand-black font-extrabold">{selectedCompanyIds.length}</strong> selected corporate profiles?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. All statutory parameters, assigned accounts, logs, and associated metrics for these companies will be permanently deleted from local store.
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmBulk(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBulkDelete}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Permanently Delete Selected
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
};
