import { crmNav } from './crmNav';
import { MultiSelect } from '../ui/MultiSelect';
import { useBackClose } from '../../lib/backNav';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Contact, Lead, ContactEditLog } from './types';
import { crmService, normalizePhone } from './crmService';
import { csvCell } from '../../lib/plots';
import { useAuth } from '../../services/AuthContext';
import { ColumnSelector } from './ColumnSelector';
import { 
  Users, 
  Search, 
  Plus, 
  Phone, 
  Mail, 
  MessageSquare, 
  Briefcase, 
  Building, 
  Globe, 
  PlusCircle, 
  X, 
  UserCheck, 
  TrendingUp,
  Bookmark,
  Languages,
  Edit,
  History,
  Calendar,
  User,
  Trash2,
  Download,
  Square,
  CheckSquare,
  MessageCircle,
  ArrowUp,
  ArrowDown,
  ExternalLink
} from 'lucide-react';
import { motion } from 'motion/react';
import { PagerBar } from './LeadListParts';
import { Customer360, ContactAgg, EMPTY_AGG, aggregateLeads, indexLeadsByPhone, fmtEgp, waLink } from './Customer360';
import { CHANNELS, phoneIntl } from './leadConfig';
import { useDebounced, makeSearchIndex, usePagedList } from './usePagedList';

const phoneKey = (v?: string) => normalizePhone(v || '');
const contactText = makeSearchIndex<Contact>(c => `${c.serialNumber || ''} ${c.name || ''} ${c.phoneNumber || ''} ${c.email || ''} ${c.company || ''} ${c.city || ''}`);
const dashv = (v?: string | number | null) => (v === undefined || v === null || v === '' ? '—' : String(v));
interface ContactRowProps {
  c: Contact;
  agg: ContactAgg;
  latestLeadId?: string;
  cols: Record<string, boolean>;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (c: Contact) => void;
  onLead: (id: string) => void;
}
const ContactRow = React.memo<ContactRowProps>(({ c, agg, latestLeadId, cols, isSelected, onToggle, onOpen, onLead }) => {
  const tel = phoneIntl(c.phoneNumber) ? c.phoneNumber : '';
  const wa = waLink(c.phoneNumber, c.name);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr onClick={() => onOpen(c)} className={`cursor-pointer hover:bg-brand-gray/5 transition-all ${isSelected ? 'bg-brand-red/5' : ''}`}>
      <td className="py-3 px-4" onClick={stop}>
        <button onClick={() => onToggle(c.id)} className="focus:outline-none" aria-label="Select contact">
          {isSelected ? <CheckSquare size={16} className="text-brand-red" /> : <Square size={16} className="text-brand-gray/60" />}
        </button>
      </td>
      {cols.id && <td className="py-3 px-3"><span className="font-mono text-[10px] text-brand-red bg-brand-red/10 px-1.5 py-0.5 rounded font-bold">{c.serialNumber || '—'}</span></td>}
      {cols.name && (
        <td className="py-3 px-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 shrink-0 rounded-full bg-brand-red/10 text-brand-red flex items-center justify-center font-black text-xs">{(c.name || '?').charAt(0).toUpperCase()}</div>
            <div className="min-w-0">
              <div className="font-bold text-brand-black truncate max-w-[200px]">{c.name}</div>
              {c.jobTitle && <div className="text-[10px] text-brand-gray truncate max-w-[200px]">{c.jobTitle}</div>}
            </div>
          </div>
        </td>
      )}
      {cols.company && <td className="py-3 px-3 font-semibold text-brand-black">{c.company || <span className="text-brand-gray font-medium">Private</span>}</td>}
      {cols.phone && <td className="py-3 px-3 font-mono text-brand-gray whitespace-nowrap">{dashv(c.phoneNumber)}</td>}
      {cols.email && <td className="py-3 px-3 text-brand-gray truncate max-w-[180px]">{dashv(c.email)}</td>}
      {cols.leads && <td className="py-3 px-3 text-center">{agg.total > 0 ? (
        <button type="button" title="Click to open this customer's leads" className="bg-brand-gray/10 hover:bg-brand-red/10 hover:text-brand-red text-brand-black px-2 py-0.5 rounded-full font-mono text-[10px] font-bold underline decoration-dotted underline-offset-2"
          onClick={(e) => { e.stopPropagation(); crmNav.leads({ search: c.phoneNumber || c.email || c.name, title: `Leads of ${c.name}` }); }}>{agg.total}</button>
      ) : <span className="bg-brand-gray/10 text-brand-black px-2 py-0.5 rounded-full font-mono text-[10px] font-bold">{agg.total}</span>}</td>}
      {cols.open && <td className="py-3 px-3 text-center"><span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${agg.open ? 'bg-blue-50 text-blue-700' : 'text-brand-gray'}`}>{agg.open}</span></td>}
      {cols.won && <td className="py-3 px-3 text-right font-mono text-[11px] font-bold text-emerald-700 whitespace-nowrap">{agg.won ? `${fmtEgp(agg.wonValue)} (${agg.won})` : '—'}</td>}
      {cols.last && <td className="py-3 px-3 font-mono text-brand-gray whitespace-nowrap">{dashv(agg.lastActivity)}</td>}
      {cols.channels && <td className="py-3 px-3 text-[11px]">{agg.channels.length ? agg.channels.join(', ') : '—'}</td>}
      <td className="py-3 px-3 text-right whitespace-nowrap" onClick={stop}>
        <div className="inline-flex items-center gap-1">
          {tel ? <a href={`tel:${tel}`} title="Call" className="p-1.5 rounded-lg bg-brand-gray/10 hover:bg-brand-black hover:text-white text-brand-black"><Phone size={13} /></a> : null}
          {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700"><MessageCircle size={13} /></a> : null}
          {latestLeadId ? <button onClick={() => onLead(latestLeadId)} title={`Open lead ${latestLeadId}`} className="p-1.5 rounded-lg bg-brand-red/10 hover:bg-brand-red hover:text-white text-brand-red"><ExternalLink size={13} /></button> : null}
        </div>
      </td>
    </tr>
  );
});
ContactRow.displayName = 'ContactRow';

type SortKey = 'serial' | 'name' | 'company' | 'phone' | 'leads' | 'open' | 'won' | 'last';

// Predefined lists of option strings for standard values
const JOB_TITLE_OPTIONS = [
  'Procurement Manager',
  'Purchasing Officer',
  'General Manager',
  'Managing Director',
  'Chief Executive Officer',
  'Project Engineer',
  'Operations Manager',
  'Supply Chain Lead',
  'Commercial Manager',
  'Logistics Executive',
  'CEO',
  'CFO',
  'Consultant',
  'Legal Advisor'
];

const DEPARTMENT_OPTIONS = [
  'Procurement',
  'Purchasing',
  'Engineering',
  'Supply Chain',
  'Executive Office',
  'Operations',
  'Finance',
  'Legal',
  'Logistics',
  'Marketing',
  'Sales'
];

const NATIONALITY_OPTIONS = [
  'Egyptian',
  'Saudi',
  'Emirati',
  'Kuwaiti',
  'Qatari',
  'Bahraini',
  'Omani',
  'Jordanian',
  'Syrian',
  'Lebanese',
  'Iraqi',
  'Yemeni',
  'Libyan',
  'Tunisian',
  'Algerian',
  'Moroccan',
  'Sudanese',
  'Palestinian',
  'British',
  'American',
  'Canadian',
  'Australian',
  'German',
  'French',
  'Italian',
  'Spanish',
  'Dutch',
  'Swiss',
  'Turkish',
  'Indian',
  'Pakistani',
  'Chinese',
  'Japanese',
  'South Korean',
  'South African',
  'Russian',
  'Greek',
  'Cypriot',
  'Austrian',
  'Belgian',
  'Irish',
  'New Zealander',
  'Malaysian',
  'Indonesian',
  'Thai',
  'Nigerian',
  'Kenyan',
  'Ghanaian'
];

const COUNTRY_CITIES_MAP: Record<string, string[]> = {
  'Egypt': [
    'Cairo', 'Giza', 'Alexandria', 'Suez', 'Port Said', 'Luxor', 'Aswan', 'Tanta', 'Mansoura', 
    'Asyut', 'Fayoum', 'Zagazig', 'Damietta', 'Ismailia', 'Sharm El Sheikh', 'Hurghada', 
    'El Gouna', 'New Administrative Capital', '6th of October City', '10th of Ramadan City', 
    'Sadat City', 'New Damietta', 'Obour City', 'Shorouk City', 'Badr City'
  ],
  'Saudi Arabia': [
    'Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Dhahran', 'Jubail', 'Yanbu', 
    'Tabuk', 'Abha', 'Taif', 'Buraidah'
  ],
  'United Arab Emirates': [
    'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'
  ],
  'Kuwait': [
    'Kuwait City', 'Hawally', 'Salmiya', 'Jahra', 'Ahmadi'
  ],
  'Qatar': [
    'Doha', 'Al Rayyan', 'Al Wakrah', 'Al Khor'
  ],
  'Bahrain': [
    'Manama', 'Riffa', 'Muharraq'
  ],
  'Oman': [
    'Muscat', 'Salalah', 'Sohar', 'Nizwa'
  ],
  'Jordan': [
    'Amman', 'Zarqa', 'Irbid', 'Aqaba'
  ],
  'Lebanon': [
    'Beirut', 'Tripoli', 'Sidon', 'Tyre'
  ],
  'Syria': [
    'Damascus', 'Aleppo', 'Homs', 'Latakia'
  ],
  'Iraq': [
    'Baghdad', 'Basra', 'Erbil', 'Mosul', 'Sulaymaniyah'
  ],
  'Yemen': [
    'Sanaa', 'Aden', 'Taiz', 'Hodeidah'
  ],
  'Libya': [
    'Tripoli (Libya)', 'Benghazi'
  ],
  'Tunisia': [
    'Tunis', 'Sfax'
  ],
  'Algeria': [
    'Algiers', 'Oran'
  ],
  'Morocco': [
    'Casablanca', 'Rabat', 'Marrakesh', 'Tangier'
  ],
  'Sudan': [
    'Khartoum', 'Port Sudan'
  ],
  'Palestine': [
    'Gaza', 'Ramallah', 'Jerusalem'
  ],
  'United Kingdom': [
    'London', 'Manchester', 'Birmingham'
  ],
  'United States': [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami', 'San Francisco', 'Washington D.C.'
  ],
  'Canada': [
    'Toronto', 'Vancouver', 'Montreal'
  ],
  'Australia': [
    'Sydney', 'Melbourne'
  ],
  'Germany': [
    'Berlin', 'Munich', 'Frankfurt', 'Hamburg'
  ],
  'France': [
    'Paris', 'Lyon', 'Marseille'
  ],
  'Italy': [
    'Rome', 'Milan'
  ],
  'Spain': [
    'Madrid', 'Barcelona'
  ],
  'Netherlands': [
    'Amsterdam', 'Rotterdam'
  ],
  'Switzerland': [
    'Zurich', 'Geneva'
  ],
  'Sweden': [
    'Stockholm'
  ],
  'Norway': [
    'Oslo'
  ],
  'Turkey': [
    'Istanbul', 'Ankara', 'Izmir'
  ],
  'India': [
    'Mumbai', 'Delhi', 'Bangalore'
  ],
  'Pakistan': [
    'Karachi', 'Lahore', 'Islamabad'
  ],
  'China': [
    'Beijing', 'Shanghai', 'Shenzhen', 'Guangzhou'
  ],
  'Japan': [
    'Tokyo', 'Osaka'
  ],
  'South Korea': [
    'Seoul'
  ],
  'Singapore': [
    'Singapore'
  ],
  'Brazil': [
    'Rio de Janeiro', 'Sao Paulo'
  ],
  'South Africa': [
    'Johannesburg', 'Cape Town'
  ],
  'Russia': [
    'Moscow', 'Saint Petersburg'
  ],
  'Greece': [
    'Athens'
  ],
  'Cyprus': [
    'Nicosia', 'Limassol'
  ],
  'Austria': [
    'Vienna'
  ],
  'Belgium': [
    'Brussels'
  ],
  'Ireland': [
    'Dublin'
  ],
  'New Zealand': [
    'Auckland', 'Wellington'
  ],
  'Malaysia': [
    'Kuala Lumpur'
  ],
  'Indonesia': [
    'Jakarta'
  ],
  'Thailand': [
    'Bangkok'
  ],
  'Vietnam': [
    'Hanoi', 'Ho Chi Minh City'
  ],
  'Nigeria': [
    'Lagos'
  ],
  'Kenya': [
    'Nairobi'
  ],
  'Ghana': [
    'Accra'
  ]
};

const COUNTRY_OPTIONS = Object.keys(COUNTRY_CITIES_MAP);
const ALL_CITIES_OPTIONS = Object.values(COUNTRY_CITIES_MAP).flat();

interface SearchableSelectProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = "Search or type...",
  required = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync search input with initial/current value when dropdown is closed
  useEffect(() => {
    if (!isOpen) {
      setSearch(value);
    }
  }, [value, isOpen]);

  // Filter options based on user's query
  const filteredOptions = useMemo(() => {
    if (!search || search.toLowerCase() === value.toLowerCase()) return options;
    return options.filter(opt =>
      opt.toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search, value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    onChange(val);
    if (!isOpen) setIsOpen(true);
  };

  const handleSelectOption = (opt: string) => {
    onChange(opt);
    setSearch(opt);
    setIsOpen(false);
  };

  return (
    <div className="relative space-y-1.5" ref={containerRef}>
      <label className="block text-[10px] uppercase font-bold text-brand-gray">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          required={required}
          className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-brand-red/50 pr-8"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-gray/60 hover:text-brand-black"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto bg-white border border-brand-gray/20 rounded-xl shadow-lg font-sans text-xs">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectOption(opt)}
                className={`w-full text-left px-3 py-2 hover:bg-brand-gray/5 transition-colors ${
                  opt.toLowerCase() === value.toLowerCase() ? 'bg-brand-red/5 text-brand-red font-bold' : 'text-brand-black'
                }`}
              >
                {opt}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-brand-gray text-[11px] italic">
              No matching standard option. Press enter or continue typing to save custom value.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface CrmContactsProps {
  contacts: Contact[];
  leads: Lead[];
  onContactsUpdated: () => void;
  currentRole: string;
  setActiveSubTab?: (tab: string) => void;
}

export const CrmContacts: React.FC<CrmContactsProps> = ({ 
  contacts, 
  leads, 
  onContactsUpdated, 
  currentRole,
  setActiveSubTab
}) => {
  const { user } = useAuth();
  const isAdmin = (currentRole?.toLowerCase() || '').includes('admin') || (user?.role?.toLowerCase() || '').includes('admin');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  useBackClose(!!selectedContact, () => setSelectedContact(null));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirmContactId, setDeleteConfirmContactId] = useState<string | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>('');
  const [deleteConfirmBulk, setDeleteConfirmBulk] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  // Column management
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['id', 'name', 'company', 'phone', 'email', 'leads', 'open', 'won', 'last', 'channels']);
  const columns = Object.fromEntries(['id', 'name', 'company', 'phone', 'email', 'leads', 'open', 'won', 'last', 'channels'].map(k => [k, visibleColumns.includes(k)])) as Record<string, boolean>;
  const columnsList = [
    { key: 'id', label: 'Customer ID' },
    { key: 'name', label: 'Name' },
    { key: 'company', label: 'Company' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'leads', label: 'Leads' },
    { key: 'open', label: 'Open leads' },
    { key: 'won', label: 'Won value' },
    { key: 'last', label: 'Last activity' },
    { key: 'channels', label: 'Channels' },
  ];
  const colCount = 2 + visibleColumns.filter(k => columns[k]).length;

  // Form states
  const [newContactForm, setNewContactForm] = useState({
    name: '',
    phoneNumber: '',
    alternativeNumber: '',
    email: '',
    company: '',
    jobTitle: '',
    department: '',
    industry: '',
    address: '',
    city: '',
    country: '',
    nationality: '',
    preferredLanguage: 'Arabic' as 'Arabic' | 'English',
    preferredCommunication: 'WhatsApp' as 'WhatsApp' | 'Email' | 'Call' | 'SMS',
  });

  const [editContactForm, setEditContactForm] = useState({
    name: '',
    phoneNumber: '',
    alternativeNumber: '',
    email: '',
    company: '',
    jobTitle: '',
    department: '',
    industry: '',
    address: '',
    city: '',
    country: '',
    nationality: '',
    preferredLanguage: 'Arabic' as 'Arabic' | 'English',
    preferredCommunication: 'WhatsApp' as 'WhatsApp' | 'Email' | 'Call' | 'SMS',
    status: 'Active' as 'Active' | 'Inactive'
  });

  // Cross-link hooks: open a contact's Customer 360 from other screens (also when the screen is already open)
  useEffect(() => {
    const open = () => {
    let id: string | null = null, phone: string | null = null;
    try { id = localStorage.getItem('selected_contact_id'); phone = localStorage.getItem('selected_crm_contact_phone'); } catch { /* ignore */ }
    if (!id && !phone) return;
    const found = (id && contacts.find(c => c.id === id || c.serialNumber === id)) || (phone && contacts.find(c => phoneKey(c.phoneNumber) === phoneKey(phone))) || null;
    if (found) setSelectedContact(found);
    if (found || contacts.length) {
      try { localStorage.removeItem('selected_contact_id'); localStorage.removeItem('selected_crm_contact_phone'); } catch { /* ignore */ }
    }
    };
    open();
    window.addEventListener('crm-open-contact', open);
    return () => window.removeEventListener('crm-open-contact', open);
  }, [contacts]);

  // Escape closes any open window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateModal(false); setShowEditModal(false); setDeleteConfirmContactId(null); setDeleteConfirmBulk(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leads indexed by contact once; aggregates per contact computed once per data change
  const leadsByPhone = useMemo(() => indexLeadsByPhone(leads), [leads]);
  const aggMap = useMemo(() => {
    const m = new Map<string, ContactAgg>();
    leadsByPhone.forEach((ls, k) => m.set(k, aggregateLeads(ls)));
    return m;
  }, [leadsByPhone]);
  const latestLead = useMemo(() => {
    const m = new Map<string, string>();
    leadsByPhone.forEach((ls, k) => { let b = ls[0]; for (const l of ls) if ((l.date || '') > (b.date || '')) b = l; m.set(k, b.id); });
    return m;
  }, [leadsByPhone]);
  const aggOf = useCallback((c: Contact) => aggMap.get(phoneKey(c.phoneNumber)) || EMPTY_AGG, [aggMap]);

  const [fCompany, setFCompany] = useState<string[]>([]);
  const [fOwner, setFOwner] = useState<string[]>([]);
  const [fChannel, setFChannel] = useState<string[]>([]);
  const [fCity, setFCity] = useState<string[]>([]);
  const [fLeads, setFLeads] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('serial');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' || k === 'company' || k === 'phone' ? 'asc' : 'desc'); }
  };
  const filterOptions = useMemo(() => {
    const co = new Set<string>(), ci = new Set<string>(), ow = new Set<string>();
    contacts.forEach(c => { if (c.company) co.add(c.company); if (c.city) ci.add(c.city); });
    aggMap.forEach(a => a.owners.forEach(o => ow.add(o)));
    const sort = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b));
    return { companies: sort(co), cities: sort(ci), owners: sort(ow) };
  }, [contacts, aggMap]);

  const debouncedSearch = useDebounced(searchTerm, 250);
  const filteredContacts = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    let rows = q ? contacts.filter(c => contactText(c).includes(q)) : contacts.slice();
    if (fCompany.length) rows = rows.filter(c => fCompany.includes(c.company as string));
    if (fCity.length) rows = rows.filter(c => fCity.includes(c.city as string));
    if (fOwner.length || fChannel.length || fLeads.length) {
      rows = rows.filter(c => {
        const a = aggOf(c);
        if (fOwner.length && !fOwner.some((o) => a.owners.includes(o))) return false;
        if (fChannel.length && !fChannel.some((c) => a.channels.includes(c))) return false;
        if (fLeads.length && !((fLeads.includes('open') && a.open) || (fLeads.includes('won') && a.won) || (fLeads.includes('none') && !a.total))) return false;
        return true;
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    const str = (x?: string) => (x || '').toLowerCase();
    const val = (c: Contact): string | number => {
      const a = aggOf(c);
      switch (sortKey) {
        case 'name': return str(c.name);
        case 'company': return str(c.company);
        case 'phone': return c.phoneNumber || '';
        case 'leads': return a.total;
        case 'open': return a.open;
        case 'won': return a.wonValue;
        case 'last': return a.lastActivity;
        default: return c.serialNumber || '';
      }
    };
    return rows.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir; });
  }, [contacts, debouncedSearch, fCompany, fCity, fOwner, fChannel, fLeads, sortKey, sortDir, aggOf]);
  const resetKey = `${debouncedSearch}|${fCompany.join(',')}|${fCity.join(',')}|${fOwner.join(',')}|${fChannel.join(',')}|${fLeads.join(',')}|${sortKey}|${sortDir}`;
  const { pageRows, page, pageSize, setPage, setPageSize, allShown, more } = usePagedList(filteredContacts, 'sid_contacts_page_size', resetKey);
  const selectedSet = useMemo(() => new Set(selectedContactIds), [selectedContactIds]);
  const openLead = useCallback((id: string) => { try { localStorage.setItem('selected_lead_id', id); } catch { /* ignore */ } setActiveSubTab?.('leads'); }, [setActiveSubTab]);
  const anyFilter = !!(fCompany.length || fCity.length || fOwner.length || fChannel.length || fLeads.length || searchTerm);

  // Export to CSV helper
  const exportToCSV = () => {
    const headers = [
      'Serial Number', 'Name', 'Phone', 'Alternative Phone', 'Email', 'Company', 
      'Job Title', 'Department', 'Industry', 'Address', 'City', 'Country', 
      'Nationality', 'Preferred Language', 'Preferred Communication', 'Created Date', 
      'Created By', 'Status'
    ];
    const rows = filteredContacts.map(c => [
      c.serialNumber || '',
      c.name,
      c.phoneNumber,
      c.alternativeNumber || '',
      c.email,
      c.company || '',
      c.jobTitle || '',
      c.department || '',
      c.industry || '',
      c.address || '',
      c.city || '',
      c.country || '',
      c.nationality || '',
      c.preferredLanguage,
      c.preferredCommunication,
      c.createdDate || '',
      c.createdBy || '',
      c.status
    ]);

    const formatCSVRow = (arr: any[]) => arr.map(csvCell).join(',');

    const csvContent = [headers.map(csvCell).join(','), ...rows.map(formatCSVRow)].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `CRM_Contacts_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Dynamic parent-child city options based on country
  const newContactCityOptions = useMemo(() => {
    const selectedCountry = newContactForm.country;
    if (selectedCountry && COUNTRY_CITIES_MAP[selectedCountry]) {
      return COUNTRY_CITIES_MAP[selectedCountry];
    }
    return ALL_CITIES_OPTIONS;
  }, [newContactForm.country]);

  const editContactCityOptions = useMemo(() => {
    const selectedCountry = editContactForm.country;
    if (selectedCountry && COUNTRY_CITIES_MAP[selectedCountry]) {
      return COUNTRY_CITIES_MAP[selectedCountry];
    }
    return ALL_CITIES_OPTIONS;
  }, [editContactForm.country]);

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newContactForm.name.trim();
    const phone = phoneKey(newContactForm.phoneNumber);
    if (!name || !phone) { setFormError('Name and a valid mobile number are required.'); return; }
    if (currentRole === 'Read Only') { setFormError('You do not have permission to create contacts.'); return; }

    // Re-read the stored list so only the new row is added (props may be stale)
    const stored = crmService.getContacts();
    const existing = stored.some(c => phoneKey(c.phoneNumber) === phone);
    if (existing) {
      setFormError('A contact with this mobile number already exists as a unique identifier.');
      return;
    }
    const emailKey = newContactForm.email.trim().toLowerCase();
    if (emailKey && stored.some(c => (c.email || '').trim().toLowerCase() === emailKey)) {
      setFormError('A contact with this email address already exists.');
      return;
    }

    // Find maximum numeric value of existing serial numbers
    let maxNum = 0;
    stored.forEach(c => {
      if (c.serialNumber && c.serialNumber.startsWith('C-')) {
        const num = parseInt(c.serialNumber.substring(2), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const nextSerial = 'C-' + String(maxNum + 1).padStart(4, '0');

    const newContact: Contact = {
      id: 'c_' + Math.random().toString(36).substr(2, 9),
      serialNumber: nextSerial,
      name,
      phoneNumber: phone,
      alternativeNumber: newContactForm.alternativeNumber.trim() ? phoneKey(newContactForm.alternativeNumber) : '',
      email: newContactForm.email,
      company: newContactForm.company,
      jobTitle: newContactForm.jobTitle,
      department: newContactForm.department,
      industry: newContactForm.industry,
      address: newContactForm.address,
      city: newContactForm.city,
      country: newContactForm.country,
      nationality: newContactForm.nationality,
      preferredLanguage: newContactForm.preferredLanguage,
      preferredCommunication: newContactForm.preferredCommunication,
      createdDate: new Date().toISOString().split('T')[0],
      createdBy: user?.name || user?.email || 'Unknown',
      status: 'Active',
    };

    crmService.saveContacts([newContact, ...stored]);
    
    // Auto-create company if named
    if (newContactForm.company) {
      const companies = crmService.getCompanies();
      const coExists = companies.some(co => (co.name || '').trim().toLowerCase() === newContactForm.company.trim().toLowerCase());
      if (!coExists) {
        const newCo = {
          id: 'co_' + Math.random().toString(36).substr(2, 9),
          name: newContactForm.company.trim(),
          industry: newContactForm.industry,
          city: newContactForm.city,
        };
        crmService.saveCompanies([newCo, ...companies]);
      }
    }

    setShowCreateModal(false);
    setFormError('');
    setNewContactForm({
      name: '',
      phoneNumber: '',
      alternativeNumber: '',
      email: '',
      company: '',
      jobTitle: '',
      department: '',
      industry: '',
      address: '',
      city: '',
      country: '',
      nationality: '',
      preferredLanguage: 'Arabic',
      preferredCommunication: 'WhatsApp',
    });
    onContactsUpdated();
  };

  const handleOpenEditModal = () => {
    if (!selectedContact) return;
    setEditContactForm({
      name: selectedContact.name,
      phoneNumber: selectedContact.phoneNumber,
      alternativeNumber: selectedContact.alternativeNumber || '',
      email: selectedContact.email || '',
      company: selectedContact.company || '',
      jobTitle: selectedContact.jobTitle || '',
      department: selectedContact.department || '',
      industry: selectedContact.industry || '',
      address: selectedContact.address || '',
      city: selectedContact.city || '',
      country: selectedContact.country || '',
      nationality: selectedContact.nationality || '',
      preferredLanguage: selectedContact.preferredLanguage || 'Arabic',
      preferredCommunication: selectedContact.preferredCommunication || 'WhatsApp',
      status: selectedContact.status || 'Active'
    });
    setShowEditModal(true);
  };

  const handleEditContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;
    const editPhone = phoneKey(editContactForm.phoneNumber);
    if (!editContactForm.name.trim() || !editPhone) { setFormError('Name and a valid mobile number are required.'); return; }
    if (currentRole === 'Read Only') { setFormError('You do not have permission to edit contacts.'); return; }

    // Re-read the stored list: edit only this contact, keep every other row as stored
    const stored = crmService.getContacts();
    const current = stored.find(c => c.id === selectedContact.id);
    if (!current) { setFormError('This contact no longer exists (it may have been deleted).'); return; }
    if (stored.some(c => c.id !== current.id && phoneKey(c.phoneNumber) === editPhone)) {
      setFormError('A contact with this mobile number already exists as a unique identifier.');
      return;
    }

    const newLogs: ContactEditLog[] = [...(current.editLogs || [])];
    const userWhoEdited = user?.name || user?.email || 'Unknown';
    const timestamp = new Date().toISOString();

    const compareAndLog = (fieldFriendlyName: string, oldValue: any, newValue: any) => {
      const oldStr = oldValue === undefined || oldValue === null ? '' : String(oldValue).trim();
      const newStr = newValue === undefined || newValue === null ? '' : String(newValue).trim();
      if (oldStr !== newStr) {
        newLogs.push({
          id: Math.random().toString(36).substr(2, 9),
          timestamp,
          user: userWhoEdited,
          field: fieldFriendlyName,
          from: oldStr || 'None',
          to: newStr || 'None'
        });
      }
    };

    compareAndLog('Name', current.name, editContactForm.name);
    compareAndLog('Unique Mobile Key', current.phoneNumber, editPhone);
    compareAndLog('Alternative Mobile', current.alternativeNumber, editContactForm.alternativeNumber);
    compareAndLog('Email Address', current.email, editContactForm.email);
    compareAndLog('Company Name', current.company, editContactForm.company);
    compareAndLog('Job Title', current.jobTitle, editContactForm.jobTitle);
    compareAndLog('Department', current.department, editContactForm.department);
    compareAndLog('Industry Focus', current.industry, editContactForm.industry);
    compareAndLog('Address', current.address, editContactForm.address);
    compareAndLog('City', current.city, editContactForm.city);
    compareAndLog('Country', current.country, editContactForm.country);
    compareAndLog('Nationality', current.nationality, editContactForm.nationality);
    compareAndLog('Preferred Language', current.preferredLanguage, editContactForm.preferredLanguage);
    compareAndLog('Preferred Inbound', current.preferredCommunication, editContactForm.preferredCommunication);
    compareAndLog('Status', current.status, editContactForm.status);

    const updatedContact: Contact = {
      ...current,
      name: editContactForm.name.trim(),
      phoneNumber: editPhone,
      alternativeNumber: editContactForm.alternativeNumber.trim() ? phoneKey(editContactForm.alternativeNumber) : '',
      email: editContactForm.email,
      company: editContactForm.company,
      jobTitle: editContactForm.jobTitle,
      department: editContactForm.department,
      industry: editContactForm.industry,
      address: editContactForm.address,
      city: editContactForm.city,
      country: editContactForm.country,
      nationality: editContactForm.nationality,
      preferredLanguage: editContactForm.preferredLanguage,
      preferredCommunication: editContactForm.preferredCommunication,
      status: editContactForm.status,
      editLogs: newLogs
    };

    const updatedContacts = stored.map(c => c.id === current.id ? updatedContact : c);
    crmService.saveContacts(updatedContacts);

    if (editContactForm.company.trim() && editContactForm.company.trim() !== (current.company || '').trim()) {
      const companies = crmService.getCompanies();
      const coExists = companies.some(co => (co.name || '').trim().toLowerCase() === editContactForm.company.trim().toLowerCase());
      if (!coExists) {
        const newCo = {
          id: 'co_' + Math.random().toString(36).substr(2, 9),
          name: editContactForm.company.trim(),
          industry: editContactForm.industry,
          city: editContactForm.city,
        };
        crmService.saveCompanies([newCo, ...companies]);
      }
    }

    setSelectedContact(updatedContact);
    setShowEditModal(false);
    setFormError('');
    onContactsUpdated();
  };

  const handleDeleteContact = (id: string) => {
    if (!isAdmin) {
      setNotice("Unauthorized: Only Administrators can delete contacts.");
      return;
    }
    setDeleteConfirmContactId(id);
  };

  const confirmDeleteContact = () => {
    if (!deleteConfirmContactId || !isAdmin) return;
    const id = deleteConfirmContactId;
    const remaining = crmService.getContacts().filter(c => c.id !== id);
    crmService.saveContacts(remaining);
    setSelectedContact(null);
    setDeleteConfirmContactId(null);
    onContactsUpdated();
  };

  const handleSelectContact = useCallback((id: string) => {
    setSelectedContactIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }, []);

  const handleSelectAll = () => {
    if (selectedContactIds.length === filteredContacts.length) {
      setSelectedContactIds([]);
    } else {
      setSelectedContactIds(filteredContacts.map(c => c.id));
    }
  };

  const confirmBulkDelete = () => {
    if (!isAdmin) return;
    const remaining = crmService.getContacts().filter(c => !selectedContactIds.includes(c.id));
    crmService.saveContacts(remaining);
    setSelectedContactIds([]);
    setBulkAction('');
    setDeleteConfirmBulk(false);
    setSelectedContact(null);
    onContactsUpdated();
  };

  const executeBulkAction = () => {
    if (selectedContactIds.length === 0 || !bulkAction) return;

    if (bulkAction === 'delete') {
      if (!isAdmin) {
        setNotice("Unauthorized: Only Administrators can bulk delete contact records.");
        return;
      }
      setDeleteConfirmBulk(true);
    }
  };

  const contactLeads = useMemo(() => {
    if (!selectedContact) return [];
    return leadsByPhone.get(phoneKey(selectedContact.phoneNumber)) || [];
  }, [selectedContact, leadsByPhone]);

  return (
    <div className="space-y-6" id="crm-contacts-root">
      {notice && (
        <div role="alert" className="flex justify-between items-center text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 text-xs font-bold">
          <span>{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}
      
      {selectedContact ? (
        <Customer360
          contact={selectedContact}
          leads={contactLeads}
          companies={crmService.getCompanies()}
          onBack={() => setSelectedContact(null)}
          onEdit={currentRole !== 'Read Only' ? () => { setFormError(''); handleOpenEditModal(); } : undefined}
          onDelete={isAdmin ? () => handleDeleteContact(selectedContact.id) : undefined}
          setActiveSubTab={setActiveSubTab}
        />
      ) : (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-xl font-black text-brand-black flex items-center gap-2.5">
            <Users size={20} className="text-brand-red" />
            <span>Contacts</span>
            <span className="text-xs bg-brand-red/10 text-brand-red font-bold px-2.5 py-0.5 rounded-full">
              {filteredContacts.length.toLocaleString('en-US')}{filteredContacts.length !== contacts.length ? ` of ${contacts.length.toLocaleString('en-US')}` : ''}
            </span>
          </h3>
          <p className="text-xs text-brand-gray mt-1">Click a customer to open the full Customer 360 view. Contacts are linked to leads by mobile number.</p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnSelector columns={columnsList} visibleColumns={visibleColumns} onChange={setVisibleColumns} />
          {isAdmin && (
            <button onClick={exportToCSV} className="bg-white hover:bg-brand-gray/5 border border-brand-gray/25 text-brand-black px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all">
              <Download size={14} /><span>Export</span>
            </button>
          )}
          {currentRole !== 'Read Only' && (
            <button onClick={() => { setFormError(''); setShowCreateModal(true); }} className="bg-brand-red hover:bg-brand-red-dark text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow">
              <Plus size={14} /><span>New Contact</span>
            </button>
          )}
        </div>
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-gray" size={16} />
          <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, phone, email, company or Customer ID"
            className="w-full pl-10 pr-4 py-2.5 bg-brand-gray/5 border border-brand-gray/15 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-red text-xs font-semibold" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect options={filterOptions.companies.map((x) => ({ value: x, label: x }))} value={fCompany} onChange={setFCompany} allLabel="All companies" name="companies" className="min-w-[140px] max-w-[220px]" buttonClassName={`bg-white border rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none flex items-center justify-between gap-2 text-left w-full ${fCompany.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`} />
          <MultiSelect options={[{ value: 'open', label: 'With open leads' }, { value: 'won', label: 'Won customers' }, { value: 'none', label: 'No leads yet' }]} value={fLeads} onChange={setFLeads} allLabel="All customers" name="groups" className="min-w-[140px] max-w-[220px]" buttonClassName={`bg-white border rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none flex items-center justify-between gap-2 text-left w-full ${fLeads.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`} />
          <MultiSelect options={filterOptions.owners.map((x) => ({ value: x, label: x }))} value={fOwner} onChange={setFOwner} allLabel="All salespeople" name="salespeople" className="min-w-[140px] max-w-[220px]" buttonClassName={`bg-white border rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none flex items-center justify-between gap-2 text-left w-full ${fOwner.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`} />
          <MultiSelect options={CHANNELS.map((x) => ({ value: x, label: x }))} value={fChannel} onChange={setFChannel} allLabel="All channels" name="channels" className="min-w-[140px] max-w-[220px]" buttonClassName={`bg-white border rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none flex items-center justify-between gap-2 text-left w-full ${fChannel.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`} />
          {filterOptions.cities.length > 0 && (
            <MultiSelect options={filterOptions.cities.map((x) => ({ value: x, label: x }))} value={fCity} onChange={setFCity} allLabel="All cities" name="cities" className="min-w-[140px] max-w-[220px]" buttonClassName={`bg-white border rounded-xl px-3 py-2 text-xs font-semibold text-brand-black focus:outline-none flex items-center justify-between gap-2 text-left w-full ${fCity.length ? 'border-brand-red/50 text-brand-red' : 'border-brand-gray/20'}`} />
          )}
          {anyFilter && (
            <button onClick={() => { setSearchTerm(''); setFCompany([]); setFCity([]); setFOwner([]); setFChannel([]); setFLeads([]); }} className="text-xs font-bold text-brand-red hover:underline flex items-center gap-1"><X size={12} /> Clear</button>
          )}
        </div>
      </div>

      {/* Bulk Action Controls Bar */}
      {selectedContactIds.length > 0 && (
        <div className="bg-brand-black text-white p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-brand-red rounded-full animate-ping" />
            <span className="text-xs font-bold">{selectedContactIds.length} Contacts selected for Bulk Action</span>
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
              onClick={() => setSelectedContactIds([])}
              className="text-xs text-white/60 hover:text-white ml-2 font-semibold"
            >
              Clear Choice
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-brand-gray/20 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-brand-gray/5 border-b border-brand-gray/15 text-brand-gray text-[10px]">
                <th className="py-3.5 px-4 w-10">
                  <button onClick={handleSelectAll} className="focus:outline-none" aria-label="Select all">
                    {selectedContactIds.length === filteredContacts.length && filteredContacts.length > 0 ? <CheckSquare size={16} className="text-brand-red" /> : <Square size={16} />}
                  </button>
                </th>
{columns.id && (<>
                  <th className="py-3.5 px-3 text-left"><button onClick={() => toggleSort('serial')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Customer ID{sortKey === 'serial' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.name && (<>
                  <th className="py-3.5 px-3 text-left"><button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Name{sortKey === 'name' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.company && (<>
                  <th className="py-3.5 px-3 text-left"><button onClick={() => toggleSort('company')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Company{sortKey === 'company' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.phone && (<>
                  <th className="py-3.5 px-3 text-left"><button onClick={() => toggleSort('phone')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Phone{sortKey === 'phone' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.email && <th className="py-3.5 px-3 uppercase tracking-wider font-bold">Email</th>}
{columns.leads && (<>
                  <th className="py-3.5 px-3 text-center"><button onClick={() => toggleSort('leads')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Leads{sortKey === 'leads' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.open && (<>
                  <th className="py-3.5 px-3 text-center"><button onClick={() => toggleSort('open')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Open{sortKey === 'open' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.won && (<>
                  <th className="py-3.5 px-3 text-right"><button onClick={() => toggleSort('won')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Won value{sortKey === 'won' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.last && (<>
                  <th className="py-3.5 px-3 text-left"><button onClick={() => toggleSort('last')} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-brand-black">Last activity{sortKey === 'last' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
</>)}
{columns.channels && <th className="py-3.5 px-3 uppercase tracking-wider font-bold">Channels</th>}
                <th className="py-3.5 px-3 text-right uppercase tracking-wider font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-gray/10 font-medium text-brand-black">
              {filteredContacts.length > 0 ? (
                pageRows.map((c) => {
                  const k = phoneKey(c.phoneNumber);
                  return (
                    <ContactRow
                      key={c.id}
                      c={c}
                      agg={aggMap.get(k) || EMPTY_AGG}
                      latestLeadId={latestLead.get(k)}
                      cols={columns}
                      isSelected={selectedSet.has(c.id)}
                      onToggle={handleSelectContact}
                      onOpen={setSelectedContact}
                      onLead={openLead}
                    />
                  );
                })
              ) : (
                <tr><td colSpan={colCount} className="py-10 text-center text-brand-gray">No contacts match the current search and filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <PagerBar total={filteredContacts.length} page={page} pageSize={pageSize} onPage={setPage} onSize={setPageSize} shown={allShown} onMore={more} />
      </div>
      </>
      )}

      {/* -------------------- NEW CONTACT MODAL -------------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-brand-black text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide">Register Corporate Contact</h4>
              <button onClick={() => setShowCreateModal(false)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateContact} className="p-6 space-y-4 text-xs font-medium">
              {formError && <p role="alert" className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold">{formError}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Contact Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newContactForm.name}
                    onChange={(e) => setNewContactForm({ ...newContactForm, name: e.target.value })}
                    placeholder="e.g., Eslam Mohamed"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Unique Mobile Key *</label>
                  <input
                    type="text"
                    required
                    value={newContactForm.phoneNumber}
                    onChange={(e) => setNewContactForm({ ...newContactForm, phoneNumber: e.target.value })}
                    placeholder="e.g., 01118485856"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Alternative Mobile</label>
                  <input
                    type="text"
                    value={newContactForm.alternativeNumber}
                    onChange={(e) => setNewContactForm({ ...newContactForm, alternativeNumber: e.target.value })}
                    placeholder="e.g., 01004958392"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={newContactForm.email}
                    onChange={(e) => setNewContactForm({ ...newContactForm, email: e.target.value })}
                    placeholder="e.g., eslam@company.com"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={newContactForm.company}
                    onChange={(e) => setNewContactForm({ ...newContactForm, company: e.target.value })}
                    placeholder="e.g., Stefner Steel"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Job Title"
                    value={newContactForm.jobTitle}
                    onChange={(val) => setNewContactForm({ ...newContactForm, jobTitle: val })}
                    options={JOB_TITLE_OPTIONS}
                    placeholder="Search or type job title..."
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Department"
                    value={newContactForm.department}
                    onChange={(val) => setNewContactForm({ ...newContactForm, department: val })}
                    options={DEPARTMENT_OPTIONS}
                    placeholder="Search or type department..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Address</label>
                  <input
                    type="text"
                    value={newContactForm.address}
                    onChange={(e) => setNewContactForm({ ...newContactForm, address: e.target.value })}
                    placeholder="e.g., Plot 27, 5th Settlement"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none text-xs"
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="City"
                    value={newContactForm.city}
                    onChange={(val) => setNewContactForm({ ...newContactForm, city: val })}
                    options={newContactCityOptions}
                    placeholder="Search or type city..."
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Country"
                    value={newContactForm.country}
                    onChange={(val) => {
                      const updated = { ...newContactForm, country: val };
                      if (val && COUNTRY_CITIES_MAP[val]) {
                        if (!COUNTRY_CITIES_MAP[val].includes(newContactForm.city)) {
                          updated.city = '';
                        }
                      }
                      setNewContactForm(updated);
                    }}
                    options={COUNTRY_OPTIONS}
                    placeholder="Search or type country..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <SearchableSelect
                    label="Nationality"
                    value={newContactForm.nationality}
                    onChange={(val) => setNewContactForm({ ...newContactForm, nationality: val })}
                    options={NATIONALITY_OPTIONS}
                    placeholder="Search or type nationality..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Preferred Language</label>
                  <select
                    value={newContactForm.preferredLanguage}
                    onChange={(e) => setNewContactForm({ ...newContactForm, preferredLanguage: e.target.value as any })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="Arabic">Arabic</option>
                    <option value="English">English</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Preferred Inbound</label>
                  <select
                    value={newContactForm.preferredCommunication}
                    onChange={(e) => setNewContactForm({ ...newContactForm, preferredCommunication: e.target.value as any })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Email">Email</option>
                    <option value="Call">Phone Call</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Industry Segment</label>
                  <select
                    value={newContactForm.industry}
                    onChange={(e) => setNewContactForm({ ...newContactForm, industry: e.target.value })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="">— Not specified —</option>
                    <option value="Steel & Metallurgy">Steel & Metallurgy</option>
                    <option value="Logistics & Warehousing">Logistics & Warehousing</option>
                    <option value="Food Processing">Food Processing</option>
                    <option value="Pharmaceutical Packaging">Pharmaceutical packaging</option>
                  </select>
                </div>
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
                  Create Contact
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* -------------------- EDIT CONTACT MODAL -------------------- */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-brand-black/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center pb-2 border-b border-brand-gray/10">
              <div className="flex items-center gap-2">
                <Edit className="text-brand-red" size={20} />
                <h3 className="font-bold text-brand-black text-sm uppercase tracking-wider">Edit Corporate Contact Profile</h3>
              </div>
              <button 
                onClick={() => setShowEditModal(false)}
                className="p-1.5 hover:bg-brand-gray/10 rounded-full transition"
              >
                <X size={18} className="text-brand-gray" />
              </button>
            </div>

            <form onSubmit={handleEditContact} className="space-y-4 text-xs">
              {formError && <p role="alert" className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold">{formError}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Contact Name *</label>
                  <input
                    type="text"
                    required
                    value={editContactForm.name}
                    onChange={(e) => setEditContactForm({ ...editContactForm, name: e.target.value })}
                    placeholder="e.g., Eng. Ahmed Elsewedy"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Unique Mobile Key *</label>
                  <input
                    type="text"
                    required
                    value={editContactForm.phoneNumber}
                    onChange={(e) => setEditContactForm({ ...editContactForm, phoneNumber: e.target.value })}
                    placeholder="e.g., +201000000000"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Alternative Mobile</label>
                  <input
                    type="text"
                    value={editContactForm.alternativeNumber}
                    onChange={(e) => setEditContactForm({ ...editContactForm, alternativeNumber: e.target.value })}
                    placeholder="e.g., +201200000000"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={editContactForm.email}
                    onChange={(e) => setEditContactForm({ ...editContactForm, email: e.target.value })}
                    placeholder="name@company.com"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={editContactForm.company}
                    onChange={(e) => setEditContactForm({ ...editContactForm, company: e.target.value })}
                    placeholder="e.g., Elsewedy Electric"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Job Title"
                    value={editContactForm.jobTitle}
                    onChange={(val) => setEditContactForm({ ...editContactForm, jobTitle: val })}
                    options={JOB_TITLE_OPTIONS}
                    placeholder="Search or type job title..."
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Department"
                    value={editContactForm.department}
                    onChange={(val) => setEditContactForm({ ...editContactForm, department: val })}
                    options={DEPARTMENT_OPTIONS}
                    placeholder="Search or type department..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Preferred Language</label>
                  <select
                    value={editContactForm.preferredLanguage}
                    onChange={(e) => setEditContactForm({ ...editContactForm, preferredLanguage: e.target.value as any })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="Arabic">Arabic</option>
                    <option value="English">English</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Preferred Inbound</label>
                  <select
                    value={editContactForm.preferredCommunication}
                    onChange={(e) => setEditContactForm({ ...editContactForm, preferredCommunication: e.target.value as any })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Email">Email</option>
                    <option value="Call">Phone Call</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Industry Segment</label>
                  <select
                    value={editContactForm.industry}
                    onChange={(e) => setEditContactForm({ ...editContactForm, industry: e.target.value })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  >
                    <option value="">— Not specified —</option>
                    <option value="Steel & Metallurgy">Steel & Metallurgy</option>
                    <option value="Logistics & Warehousing">Logistics & Warehousing</option>
                    <option value="Food Processing">Food Processing</option>
                    <option value="Pharmaceutical Packaging">Pharmaceutical packaging</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Address</label>
                  <input
                    type="text"
                    value={editContactForm.address}
                    onChange={(e) => setEditContactForm({ ...editContactForm, address: e.target.value })}
                    placeholder="e.g., Plot 27, 5th Settlement"
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="City"
                    value={editContactForm.city}
                    onChange={(val) => setEditContactForm({ ...editContactForm, city: val })}
                    options={editContactCityOptions}
                    placeholder="Search or type city..."
                  />
                </div>
                <div className="sm:col-span-1">
                  <SearchableSelect
                    label="Country"
                    value={editContactForm.country}
                    onChange={(val) => {
                      const updated = { ...editContactForm, country: val };
                      if (val && COUNTRY_CITIES_MAP[val]) {
                        if (!COUNTRY_CITIES_MAP[val].includes(editContactForm.city)) {
                          updated.city = '';
                        }
                      }
                      setEditContactForm(updated);
                    }}
                    options={COUNTRY_OPTIONS}
                    placeholder="Search or type country..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <SearchableSelect
                    label="Nationality"
                    value={editContactForm.nationality}
                    onChange={(val) => setEditContactForm({ ...editContactForm, nationality: val })}
                    options={NATIONALITY_OPTIONS}
                    placeholder="Search or type nationality..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-brand-gray mb-1.5">Contact Status</label>
                  <select
                    value={editContactForm.status}
                    onChange={(e) => setEditContactForm({ ...editContactForm, status: e.target.value as any })}
                    className="w-full bg-brand-gray/5 border border-brand-gray/20 rounded-xl px-3 py-2 focus:outline-none font-bold text-brand-black"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-brand-gray/10">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-brand-red hover:bg-brand-red-dark text-white px-5 py-2 rounded-xl font-bold shadow"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* -------------------- CUSTOM DELETE CONFIRMATION DIALOG (ADMIN ONLY) -------------------- */}
      {deleteConfirmContactId && (
        <div className="fixed inset-0 bg-brand-black/50 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gray/20 rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
          >
            <div className="p-5 border-b border-brand-gray/15 flex justify-between items-center bg-rose-600 text-white">
              <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-2">
                <Trash2 size={18} />
                <span>Confirm Contact Deletion</span>
              </h4>
              <button onClick={() => setDeleteConfirmContactId(null)} className="text-white/60 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-brand-gray leading-relaxed text-sm">
                Are you absolutely sure you want to permanently delete contact <strong className="text-brand-black font-extrabold">{contacts.find(c => c.id === deleteConfirmContactId)?.name || deleteConfirmContactId}</strong>?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. All spec files, logs, and communication history linked to this contact will be permanently deleted from local store.
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmContactId(null)}
                  className="bg-brand-gray/10 hover:bg-brand-gray/20 text-brand-black px-4 py-2 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteContact}
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
                Are you absolutely sure you want to permanently delete the <strong className="text-brand-black font-extrabold">{selectedContactIds.length}</strong> selected contacts?
              </p>
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 leading-relaxed text-[11px]">
                <strong>Warning:</strong> This operation cannot be undone. All spec files, logs, and communication history linked to these contacts will be permanently deleted from the local store.
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
