import { Ticket, TicketHistory, SLAConfig } from '../types';
import { fetchWithTimeout } from '../lib/fetchUtils';
import { adminService } from './adminService';
import { toast } from 'sonner';

// spreadsheet-safe CSV cell: quoted, and a leading = + - @ is neutralised so Excel never runs it as a formula
const csvCell = (v: unknown) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
};

// the server explains refusals ("You can only notify...", "The ticket was changed by someone else..."): show that
async function fail(res: Response, fallback: string): Promise<never> {
  let msg = fallback;
  try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep fallback */ }
  throw new Error(msg);
}

/** Attachment limits enforced by the server (routes_tickets.ts checkAttachments): at most 10 files and 6,000,000
 *  characters of base64 data in total (about 4.4 MB of files). */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_CHARS = 6_000_000;
/** length of a base64 data URL for a file of this size (data:<type>;base64, + 4 chars per 3 bytes) */
export const dataUrlLength = (bytes: number, mime = '') => Math.ceil(bytes / 3) * 4 + 13 + mime.length;
export const formatMB = (chars: number) => `${(chars * 0.75 / 1_048_576).toFixed(1)} MB`;

export interface NewTicket {
  title: string;
  description: string;
  type: string;
  subtype: string;
  priority: string;
  workflowId?: string;
  department?: string;
  crmContactId?: string;
  crmContactName?: string;
  attachments?: string[];
}

/** The ticket list comes WITHOUT file data: each attachment is a stub "stripped:<mime>;<chars>" (saves egress).
 *  getTicket(id) returns the full ticket; the server PUT puts a stub back from the stored file, never saves it. */
export const ATT_STUB = 'stripped:';
export const isAttachmentStub = (at: unknown) => typeof at === 'string' && at.startsWith(ATT_STUB);
export const isTicketStripped = (t: Ticket | null | undefined) => !!(t as { attachmentsStripped?: boolean } | null | undefined)?.attachmentsStripped;

export const ticketService = {
  /** One full ticket (with attachment data); same visibility rules as the list. */
  getTicket: async (id: string | number): Promise<Ticket> => {
    const res = await fetchWithTimeout(`/api/tickets/${id}`, {}, 30000);
    if (!res.ok) await fail(res, 'Ticket not found');
    return await res.json();
  },

  getTickets: async (): Promise<Ticket[]> => {
    try {
      const res = await fetchWithTimeout('/api/tickets', {}, 15000);
      if (!res.ok) throw new Error('Failed to fetch tickets');
      return await res.json();
    } catch (err) {
      console.error(err);
      return [];
    }
  },

  /**
   * Creates a ticket. The server decides everything that matters (ticket number, requester, SLA deadline from the
   * SLA table or from the workflow's total SLA + buffer, first workflow step): the browser sends only what the
   * person typed and uses the saved ticket the server returns.
   */
  createTicket: async (data: NewTicket): Promise<Ticket> => {
    const body = {
      title: data.title,
      description: data.description,
      type: data.type,
      subtype: data.subtype,
      priority: data.priority,
      workflowId: data.workflowId || undefined,
      department: data.department || undefined,
      crmContactId: data.crmContactId || undefined,
      crmContactName: data.crmContactName || undefined,
      attachments: data.attachments || [],
    };
    const res = await fetchWithTimeout('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 30000);
    if (!res.ok) await fail(res, 'Failed to save ticket');
    return await res.json();
  },

  /**
   * Updates a ticket. The server applies the SLA rules (pause while "Waiting on User / Vendor", deadline moved by the
   * paused time, recalculated when the priority changes on a ticket without a workflow) and returns the saved
   * ticket: that answer, not a browser-side guess, is what callers get.
   */
  updateTicket: async (id: string | number, updates: Partial<Ticket>, actorEmail: string, currentTicket?: Ticket, _slaConfigs?: SLAConfig[]): Promise<Ticket> => {
    let ticket = currentTicket;
    if (!ticket) ticket = await ticketService.getTicket(id);
    if (!ticket) throw new Error('Ticket not found');

    const now = new Date();
    const historyEntry: TicketHistory = {
      id: Math.random().toString(),
      action: updates.status ? `Status changed to ${updates.status}` : 'Ticket updated',
      actor: actorEmail,
      date: now.toISOString(),
      note: updates.history?.[0]?.note,
      isInternal: updates.history?.[0]?.isInternal,
      attachments: updates.history?.[0]?.attachments
    };

    const res = await fetchWithTimeout(`/api/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, history: [...ticket.history, historyEntry] })
    }, 30000);
    if (!res.ok) await fail(res, 'Failed to update ticket');
    const updatedTicket: Ticket = await res.json();

    // Notification logic (async: never makes the save wait)
    (async () => {
      try {
        const isRequester = actorEmail === updatedTicket.requesterEmail;
        const hasNote = updates.history?.[0]?.note;
        const statusChanged = updates.status && updates.status !== ticket!.status;

        if (statusChanged || (hasNote && !updates.history?.[0]?.isInternal)) {
          // Notify the requester when someone else updated
          if (!isRequester) {
            fetchWithTimeout('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: updatedTicket.requesterEmail,
                subject: `Ticket Update: ${updatedTicket.id}`,
                ticketId: updatedTicket.id,
                action: statusChanged ? `Status: ${updatedTicket.status}` : 'New Comment',
                body: statusChanged 
                  ? `Your ticket status has been updated to ${updatedTicket.status} by ${actorEmail}.\n\nDescription: ${updatedTicket.description}\n\nNote: ${hasNote || 'No additional notes.'}`
                  : `A new comment has been added to your ticket by ${actorEmail}:\n\n"${hasNote}"\n\nDescription: ${updatedTicket.description}`
              })
            }, 10000).catch(err => console.warn('Requester notification failed', err));
          }

          // Notify the assigned technician when the requester updated
          if (isRequester && updatedTicket.assignedTo) {
            const users = await adminService.getUsers();
            const tech = users.find((u: any) => u.id === updatedTicket.assignedTo);
            if (tech) {
              fetchWithTimeout('/api/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: tech.email,
                  subject: `User Update on Ticket: ${updatedTicket.id}`,
                  ticketId: updatedTicket.id,
                  action: statusChanged ? `Status: ${updatedTicket.status}` : 'User Comment',
                  body: statusChanged
                    ? `The requester has updated the ticket status to ${updatedTicket.status}.\n\nDescription: ${updatedTicket.description}\n\nNote: ${hasNote || 'No additional notes.'}`
                    : `The requester (${actorEmail}) has added a comment to the ticket:\n\n"${hasNote}"\n\nDescription: ${updatedTicket.description}`
                })
              }, 10000).catch(err => console.warn(`Tech notification failed for ${tech.email}`, err));
            }
          }
        }
      } catch (err) {
        console.warn('Notification failed', err);
      }
    })();

    return updatedTicket;
  },

  // the server takes the actor from the login: no user id / name in the URL
  deleteTicket: async (id: string | number, _userId?: string, _userName?: string): Promise<void> => {
    const res = await fetchWithTimeout(`/api/tickets/${id}`, { method: 'DELETE' }, 15000);
    if (!res.ok) await fail(res, 'Failed to delete ticket');
  },

  completeStep: async (ticketId: string | number, stepId: string, _actorEmail?: string, _actorName?: string, note?: string): Promise<Ticket> => {
    const res = await fetchWithTimeout(`/api/tickets/${ticketId}/steps/${stepId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note })
    }, 20000);
    if (!res.ok) await fail(res, 'Failed to complete workflow step');
    return await res.json();
  },

  exportTickets: async () => {
    const tickets = await ticketService.getTickets();
    if (tickets.length === 0) {
      toast.info('No tickets to export');
      return;
    }

    const headers = [
      "ID", "Title", "Description", "Type", "Subtype", "Priority", 
      "Status", "Requester Email", "Created At", "Updated At", "SLA Deadline"
    ];
    const rows = tickets.map(t => [
      t.id, t.title, t.description, t.type, t.subtype, t.priority,
      t.status, t.requesterEmail, t.createdAt, t.updatedAt, t.slaDeadline
    ].map(csvCell));

    const csvContent = [
      headers.map(csvCell).join(","),
      ...rows.map(r => r.join(","))
    ].join("\n");

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sdm_service_desk_tickets_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /** Imports a JSON file of tickets (administrators only; the server accepts at most 1000 per file and never deletes). */
  importTickets: async (file: File): Promise<void> => {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsText(file);
    });
    let tickets: unknown;
    try { tickets = JSON.parse(text); } catch { throw new Error('The file is not valid JSON'); }
    if (!Array.isArray(tickets)) throw new Error('The file must contain a list of tickets');
    if (tickets.length > 1000) throw new Error('At most 1000 tickets per file');
    const res = await fetchWithTimeout('/api/tickets/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tickets)
    }, 60000);
    if (!res.ok) await fail(res, 'Failed to import tickets');
  }
};
