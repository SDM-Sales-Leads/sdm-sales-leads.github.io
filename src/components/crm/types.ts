 /** Working vocabulary of the sales team (see leadConfig.ts). The older English statuses stay valid for existing rows. */
export type LeadStatus =
  | 'Sent WhatsApp' | 'No Answer – Sent WhatsApp' | 'Out of Coverage – Sent WhatsApp' | 'Wrong Number' | 'Mail Sent'
  | 'Call Back' | 'Client Will Call Back' | 'Need Time to Study Our Offer' | 'Offer Sent – Following Up'
  | 'Scheduled Meeting' | 'Site Visit Scheduled' | 'Low Budget'
  | 'New' 
  | 'Assigned' 
  | 'Contacted' 
  | 'Follow Up' 
  | 'Meeting Scheduled' 
  | 'Negotiation' 
  | 'Quotation Sent' 
  | 'Waiting Customer' 
  | 'Won' 
  | 'Lost' 
  | 'Duplicate' 
  | 'Invalid' 
  | 'No Answer' 
  | 'Not Interested' 
  | 'Closed';

export type LostReason = 
  | 'Not Interested' 
  | 'Price' 
  | 'Competitor' 
  | 'Location' 
  | 'Budget' 
  | 'Project Size' 
  | 'No Response' 
  | 'Duplicate' 
  | 'Cancelled' 
  | 'Other';

export type LeadPriority = 'VIP' | 'Urgent' | 'High' | 'Medium' | 'Normal' | 'Low';

export interface CommentNote {
  id: string;
  date: string;
  time: string;
  user: string;
  comment: string;
  isPrivate: boolean;
  attachmentName?: string;
  voiceNoteUrl?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  uploadedBy: string;
  dataUrl?: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'Call' | 'Email' | 'Meeting' | 'Visit' | 'WhatsApp' | 'SMS' | 'Comment' | 'Status Change' | 'Assignment' | 'Approval' | 'Creation' | 'Import';
  user: string;
  title: string;
  description: string;
}

export interface AssignedPlot {
  key: string; park: string; project: string; unit: string; areaSqm: number;
  listPriceSqm: number | null; listTotal: number | null; status: string; assignedAt: string; assignedBy: string;
}

export interface Lead {
  createdBy?: string;               // who registered the lead (a person, or the mailbox / sheet sync)
  /** plots chosen for this lead (Land Bank keys, max 20) and how the salesperson prefers to pick them */
  assignedPlots?: AssignedPlot[];
  plotMode?: 'recommend' | 'manual';
  emailId?: string;
  id: string; // SL-XXXX
  date: string;
  source: string;
  channel?: string;              // marketing channel: Mobile App / Call Center / Facebook Leads / Walk-in (source = the finer origin, e.g. Billboard)
  project: string;
  customerName: string;
  phoneNumber: string; // Normalized
  email: string;
  companyName?: string;
  requiredSize: string | number; // sqm
  budget?: number; // USD or EGP (Optional)
  slaStatus?: string; // Within SLA, Violated, Met, etc.
  priority: LeadPriority;
  status: LeadStatus;
  assignedSalespersonId?: string;
  assignedSalespersonName?: string;
  assignedDate?: string;
  lastUpdated: string;
  expectedClosingDate: string;
  description: string;
  comments: CommentNote[];
  attachments: Attachment[];
  lostReason?: LostReason | string;
  lostComment?: string;
  lostCategory?: string;
  // ---- fields carried over from the sales team's previous CRM (all optional) ----
  legacyId?: string;               // id in the previous system
  legacyOwnerName?: string;        // owner as written in the previous system (linked to a user by name)
  refNo?: string;
  phone2?: string;
  industry?: string;
  nationality?: string;
  qualification?: '' | 'Qualified' | 'Unqualified';
  temperature?: '' | 'Hot' | 'Warm' | 'Cold';
  qualNotes?: string;
  notes?: string;                  // free notes (previous system's Notes column)
  meetingDate?: string;            // YYYY-MM-DD (call back / meeting / site visit slot)
  meetingTime?: string;            // HH:MM
  nextFollowUpTime?: string;       // HH:MM
  lastContactDate?: string;        // YYYY-MM-DD
  touched?: boolean;               // set by the server once a salesperson did anything on the lead; never removed
  firstContactAt?: string;         // ISO, first contact by the current owner (SLA)
  reassignCount?: number;
  eoiApplicable?: boolean | null;  // true = EOI -> Reservation -> Contract; false = Reservation -> Contract
  eoiDate?: string;
  reservationDate?: string;
  contractDate?: string;
  wonDate?: string;                // closing date (derived unless typed by hand)
  dealValue?: number;              // cash value of the deal, EGP (required for Won)
  totalSoldValue?: number;         // EGP
  soldArea?: number;               // sqm
  plotNo?: string;
  cashStatus?: '' | 'pending' | 'confirmed';
  cashBy?: string;
  cashDate?: string;
  offerSent?: boolean;
  offerDate?: string;
  offerDueDate?: string;
  bdReady?: boolean;
  mergedInto?: string;
  dupCleared?: boolean;
  srcOriginal?: string;
  srcReq?: { from: string; to: string; by: string; byName: string; at: string; note?: string };
  contract?: ContractRecord;       // contract lifecycle after Won

  timeline: TimelineEvent[];
  slaDeadline?: string; // ISO string
  nextFollowUpDate?: string; // YYYY-MM-DD
}

export interface ContactEditLog {
  id: string;
  timestamp: string;
  user: string;
  field: string;
  from: string;
  to: string;
}

export interface Contact {
  id: string;
  serialNumber?: string;
  name: string;
  phoneNumber: string; // Normalized (primary key equivalent)
  alternativeNumber?: string;
  email: string;
  company?: string;
  jobTitle?: string;
  department?: string;
  industry?: string;
  address?: string;
  city?: string;
  country?: string;
  nationality?: string;
  preferredLanguage: 'English' | 'Arabic';
  preferredCommunication: 'WhatsApp' | 'Email' | 'Call' | 'SMS';
  createdDate: string;
  createdBy: string;
  status: 'Active' | 'Inactive';
  lastContactDate?: string;
  editLogs?: ContactEditLog[];
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  commercialRegistration?: string;
  taxNumber?: string;
  address?: string;
  city?: string;
  website?: string;
  assignedAccountManager?: string;
}

export interface EmailImportLog {
  id: string;
  receivedTime: string;
  sender: string;
  subject: string;
  status: 'Success' | 'Error' | 'Failed' | 'Duplicate' | 'Deleted';
  error?: string;
  parsedLeadId?: string;
  bodyPreview: string;
}

export type AssignmentMethod = 
  | 'Round Robin'
  | 'Least Active Leads'
  | 'Least Total Leads'
  | 'Least Open Sqm'
  | 'Balanced Sqm and Leads'
  | 'Random'
  | 'Project Based'
  | 'Required Size'
  | 'Lead Source'
  | 'Priority Based'
  | 'Working Hours'
  | 'VIP Customer Routing'
  | 'Company Industry Routing'
  | 'Manual Assignment Only';

export interface QueueSettings {
  canonicalProjects?: string[];
  canonicalLeadSources?: string[];
  assignmentMethod: AssignmentMethod;
  queueOrder: 'FIFO' | 'LIFO' | 'Priority';
  enableRoundRobin: boolean;
  enableProjectRouting: boolean;
  enableSizeRouting: boolean;
  enablePriorityRouting: boolean;
  maxLeadsPerSalesperson: number;
  maxTouchedPerSalesperson?: number;    // open leads already worked on
  maxUntouchedPerSalesperson?: number;  // open leads nobody worked on yet
  maxDailyAssignment: number;
  sqmWeight?: number;              // Balanced method: % of the decision that follows sqm
  maxSqmPerSalesperson?: number;   // 0 = no limit
  unknownLeadSqm?: number;         // size assumed for a lead with none (0 = counts as one lead only)
  skipUsersOnLeave: boolean;
  skipDisabledUsers: boolean;
  skipInactiveUsers: boolean;
  autoReassignAfterDays: number;
  autoEscalation: boolean;
  businessHoursStart: string; // e.g., "08:00"
  businessHoursEnd: string; // e.g., "17:00"
  backupSalespersonId?: string;
  enableOverflowQueue: boolean;
}

export interface SalespersonActivity {
  id: string;
  salespersonId: string;
  salespersonName: string;
  type: 'Call' | 'Email' | 'WhatsApp' | 'Meeting' | 'Visit';
  leadId: string;
  leadName: string;
  timestamp: string;
  notes: string;
}

export interface SalespersonTask {
  id: string;
  salespersonId: string;
  title: string;
  description: string;
  dueDate: string;
  status: 'Pending' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  leadId?: string;
}

export interface PlotRecord {
  id: string | number;
  projectName: string;
  landType: string;
  status: string;
  sector: string;
  areaSqM: number;
  unitCode: string;
  clientName: string;
  companyName: string;
  salesContractDate: string;
  yearOfSale: string;
  rfPrice: string;
  cashValue: string;
  quarterOfSale?: string;
  salesRep?: string;
  leadSource?: string;
}

// ---------------------------------------------------------------------------------------------
// contract lifecycle (kept inside the Won lead) and new record kinds
// ---------------------------------------------------------------------------------------------
export type ContractStepStatus = 'Pending' | 'In Progress' | 'Done' | 'Blocked' | 'Skipped';
export interface ContractStep {
  key: string;                       // see CONTRACT_STEPS in leadConfig.ts
  department: string;
  status: ContractStepStatus;
  startedAt?: string;
  doneAt?: string;
  dueAt?: string;
  by?: string;
  note?: string;
}
export interface ContractRecord {
  number?: string;
  status: 'Draft' | 'In Progress' | 'On Hold' | 'Signed' | 'Cancelled';
  steps: ContractStep[];
  blocker?: { reason: string; department: string; since: string; by: string } | null;
  signedAt?: string;
  history: { at: string; by: string; text: string }[];
}

export interface ExternalSale {
  id: string;
  salespersonId: string;
  salespersonName: string;
  saleDate: string;
  amount: number;
  project: string;
  description: string;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmedBy?: string;
  confirmedDate?: string;
  createdAt: string;
}
