export type Role = string;

export const ALL_DEPARTMENTS = [
  'Development', 'Finance', 'Infrastructure', 'Sales', 'CRM', 'PMO', 
  'Procurement', 'Community', 'Business development', 'GM', 'CEO', 'CFO', 
  'Sales Team', 'Sales Operation'
] as const;

export type Department = typeof ALL_DEPARTMENTS[number];

export interface User {
  id: string | number;
  name: string;
  email: string;
  role: Role;
  department?: Department;
  teamLeaderId?: string | number;
}

export type TicketStatus = 
  | 'New' 
  | 'In Progress' 
  | 'Waiting on User' 
  | 'Waiting on Vendor' 
  | 'Resolved' 
  | 'Closed' 
  | 'Reopened';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface TicketHistory {
  id: string;
  action: string;
  actor: string;
  date: string;
  note?: string;
  isInternal?: boolean;
  attachments?: string[];
}

export interface TicketWorkflowStep extends WorkflowStep {
  status: 'Pending' | 'Current' | 'Completed';
  completedAt?: string;
  completedBy?: string;
  note?: string;
}

export interface Ticket {
  id: string | number;
  title: string;
  description: string;
  type: string;
  subtype: string;
  priority: Priority;
  status: TicketStatus;
  requesterId: string | number;
  requesterEmail: string;
  assignedTo?: string | number;
  assignedToName?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  slaDeadline: string;
  slaPausedAt?: string;
  totalPausedTime: number; // in milliseconds
  history: TicketHistory[];
  attachments: string[]; // Base64 or filenames
  feedback?: {
    rating: number;
    comment?: string;
    date: string;
  };
  workflowId?: string;
  workflowSteps?: TicketWorkflowStep[];
  currentStepId?: string;
  department?: Department;
  crmContactId?: string;
  crmContactName?: string;
}

export interface Category {
  id: number;
  type: string;
  subtype: string;
  department?: Department;
}

export interface SLAConfig {
  priority: Priority;
  hours: number;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  author: string;
  createdAt: string;
  views: number;
}

export type ComplexityLevel = 'Simple' | 'Medium' | 'Complex';
export type Frequency = 'High' | 'Medium' | 'Low';
export type DependencyType = 'Approval' | 'Input' | 'Execution';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  responsibleRole: string;
  isExternal?: boolean;
  sla?: number;
  hasRequirements?: boolean;
  requirements?: string;
  slaUnit: 'Hours' | 'Days';
  order: number;
  isDecision?: boolean;
  nextStepId?: string;
  yesNextStepId?: string;
  noNextStepId?: string;
  decisionQuestion?: string;
  position?: { x: number; y: number };
  prerequisiteStepIds?: string[];
}

export interface Dependency {
  id: string;
  department: Department;
  type: DependencyType;
}

export interface SalesFeedback {
  recommendedSLA: number; // in days
  businessJustification: string;
  userId?: string;
  userEmail?: string;
  createdAt?: string;
}

export interface WorkflowRequest {
  id: string;
  title: string;
  category: string;
  description: string;
  complexity: ComplexityLevel;
  frequency: Frequency;
  department: Department;
  totalSLA?: number; // in hours
  maxBufferHours: number; // in hours
  slaJustification: string;
  steps: WorkflowStep[];
  dependencies: Dependency[];
  requiredData?: string[];
  salesFeedback?: SalesFeedback;
  status: 'Draft' | 'Aligned' | 'Finalized';
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName?: string;
}

export interface RolePermissions {
  role: Role;
  canViewDashboard: boolean;
  canViewTickets: boolean;
  canViewKnowledgeBase: boolean;
  canViewWorkflowBuilder: boolean;
  canViewAdminPanel: boolean;
  canCreateWorkflow: boolean;
  canApproveWorkflow: boolean;
  canEditWorkflow: boolean;
  canCommentWorkflow: boolean;
  allowedDepartmentsToCreate?: Department[];
  allowedDepartmentsToApprove?: Department[];
  canViewSalesCrm?: boolean;
  canViewSalesDashboard?: boolean;
  canViewSalesLeads?: boolean;
  canViewSalesContacts?: boolean;
  canViewSalesCompanies?: boolean;
  canViewSalesMail?: boolean;
  canViewSalesRules?: boolean;
  canViewSalesActivities?: boolean;
  canViewSalesReports?: boolean;
  canViewSalesPlotsInventory?: boolean;
  canViewSalesTransfer?: boolean;
  canViewSalesFinance?: boolean;
  canConfirmCash?: boolean;
  canViewSalesContracts?: boolean;
  canManageContracts?: boolean;
  canViewSalesTargets?: boolean;
  canViewSalesExternal?: boolean;
  canViewSalesAudit?: boolean;
  canViewAllLeads?: boolean;
  canEditLeadIdentity?: boolean;
  canDistributeLeads?: boolean;
  canExportLeads?: boolean;
};

export interface EmailImportLog {
  id: string;
  receivedTime: string;
  sender: string;
  subject: string;
  status: 'Success' | 'Error';
  error?: string;
  parsedLeadId?: string;
  bodyPreview: string;
}

export interface SystemSettings {
  theme: 'light' | 'dark' | 'glass' | 'corporate';
  primaryColor: string;
  backgroundColor: string;
  effectColor: string;
  fontFamily: 'Inter' | 'Roboto' | 'JetBrains Mono' | 'Playfair Display';
  fontSize: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  backgroundEffect: 'none' | 'particles' | 'grid' | 'orbs' | 'all';
  gridPattern: 'dots' | 'lines' | 'cross';
  particleShape: 'circle' | 'square' | 'star';
  backgroundIntensity: number; // 0-100
  borderRadius: 'none' | 'md' | 'xl' | '2xl' | 'full';
  glassIntensity: number; // 0-100
  animationSpeed: 'slow' | 'normal' | 'fast';
}
