// deno-lint-ignore-file no-explicit-any
// Server-side rules for a lead. The browser applies the same rules for convenience, but only these count:
// they are what keeps lead distribution fair (an owner cannot be changed, a source relabelled or a value
// confirmed by the person who benefits) and what writes the audit trail.
import type { Caller, CrmScope } from "./lib.ts";

export const TEAM_STATUSES = [
  "New", "Sent WhatsApp", "No Answer – Sent WhatsApp", "Out of Coverage – Sent WhatsApp", "Wrong Number", "Mail Sent", "Call Back",
  "Client Will Call Back", "Need Time to Study Our Offer", "Offer Sent – Following Up", "Scheduled Meeting", "Site Visit Scheduled",
  "Negotiation", "Not Interested", "Low Budget", "Won", "Lost",
];
export const LEGACY_STATUSES = ["Assigned", "Contacted", "Follow Up", "Meeting Scheduled", "Quotation Sent", "Waiting Customer", "Duplicate", "Invalid", "No Answer", "Closed"];
export const ALL_STATUSES = new Set([...TEAM_STATUSES, ...LEGACY_STATUSES]);
/** statuses the administrator added in Settings > Dropdown lists (filled by routes_crm from system_config) */
export const CUSTOM_STATUSES = new Set<string>();

/** fields only Sales Operation / admin may change on an existing lead (identity and origin of the lead) */
export const PROTECTED_FOR_REPS = ["source", "channel", "phoneNumber", "email", "date", "priority", "assignedDate", "legacyId", "legacyOwnerName", "srcOriginal", "contract"];
/** fields only accounts receivable (or operations) may change */
const CASH_FIELDS = ["cashStatus", "cashBy", "cashDate"];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());   // Cairo date (was UTC)

const PLOT_STATUS = new Set(["available", "reserved", "sold", "eoi", "hold", "nfs", "unknown"]);
const cs = (v: any, n: number) => (v === undefined || v === null ? "" : String(v).trim().slice(0, n));
const cn = (v: any) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** max 20 plots, whitelisted and clipped fields, one entry per plot key */
export function cleanAssignedPlots(v: any): any[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>(), out: any[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const key = cs(p.key, 160);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const st = cs(p.status, 20).toLowerCase();
    const at = cs(p.assignedAt, 40);
    out.push({ key, park: cs(p.park, 100), project: cs(p.project, 120), unit: cs(p.unit, 160), areaSqm: cn(p.areaSqm), listPriceSqm: cn(p.listPriceSqm), listTotal: cn(p.listTotal), status: PLOT_STATUS.has(st) ? st : "unknown", assignedAt: at && !isNaN(Date.parse(at)) ? new Date(at).toISOString() : "", assignedBy: cs(p.assignedBy, 120) });
    if (out.length >= 20) break;
  }
  return out;
}

const SYSTEM_TEXT = /^(\[merged\]\s*)*(imported from excel|imported via smart paste|auto-assigned|requested area|sole owner set|transferred to|project changed|merged |assigned to |status changed)/i;
const NOT_A_TOUCH = new Set(["Assignment", "Import", "Creation"]);

/** "touched" = a salesperson did anything on the lead (call, WhatsApp, e-mail, meeting, comment, status change ...).
 *  It is stamped once (data.touched = true) and never goes back, so two people never call the same customer. */
export function isTouched(d: any): boolean {
  if (!d) return false;
  if (d.touched === true) return true;
  if (d.mergedInto) return false;
  if ((d.status || "New") !== "New") return true;
  if (d.firstContactAt || d.lastContactDate || d.meetingDate || d.offerSent || d.qualNotes) return true;
  if ((d.comments || []).some((c: any) => !SYSTEM_TEXT.test(String(c?.comment || "").trim()))) return true;
  if ((d.timeline || []).some((e: any) => e && !NOT_A_TOUCH.has(e.type) && String(e.user || "") !== "System")) return true;
  return false;
}

export interface Sanitized { data: any; error?: string; audits: { action: string; from?: string; to?: string; note?: string }[] }

/**
 * d = what the browser sent, ex = what is stored (null for a new lead).
 * Returns the data to store (protected fields restored) or an error to show the user.
 */
export function sanitizeLead(d: any, ex: any | null, c: Caller, scope: CrmScope, assigneeName?: string): Sanitized {
  const audits: Sanitized["audits"] = [];
  if (JSON.stringify(d).length > 400_000) return { data: d, error: "this lead is too large to save", audits };
  if (d.status && !ALL_STATUSES.has(d.status) && !CUSTOM_STATUSES.has(d.status)) return { data: d, error: `unknown status "${String(d.status).slice(0, 40)}"`, audits };
  // plots assigned to the lead and the recommend / manual preference: owner and managers edit them like other lead fields
  const oldPlots = JSON.stringify((ex?.data || {}).assignedPlots || []);
  if (d.assignedPlots !== undefined) d.assignedPlots = cleanAssignedPlots(d.assignedPlots);
  if (d.plotMode !== undefined && d.plotMode !== "recommend" && d.plotMode !== "manual") delete d.plotMode;
  if (JSON.stringify(d.assignedPlots || []) !== oldPlots) {
    const was = new Set(((ex?.data || {}).assignedPlots || []).map((p: any) => p.key)), now = new Set((d.assignedPlots || []).map((p: any) => p.key));
    const added = [...now].filter((k) => !was.has(k)), removed = [...was].filter((k) => !now.has(k));
    audits.push({ action: "plots", from: removed.join(", ").slice(0, 300) || undefined, to: added.join(", ").slice(0, 300) || undefined, note: "assigned plots" });
  }
  const canCash = c.perms.canConfirmCash === true;   // 21 Oct 2026: only accounts receivable (and Admin) - "sees all" no longer brings cash with it

  if (ex) {
    const old = ex.data || {};
    if (scope !== "all") for (const k of PROTECTED_FOR_REPS) { if (k === "contract" && c.perms.canManageContracts === true) continue; if (old[k] === undefined) delete d[k]; else d[k] = old[k]; }
    if (!canCash) for (const k of CASH_FIELDS) { if (old[k] === undefined) delete d[k]; else d[k] = old[k]; }
    // once accounts receivable confirmed the cash, the deal is locked: only a re-open by accounts receivable unlocks it
    if (old.cashStatus === "confirmed" && c.perms.canConfirmCash !== true) for (const k of ["status", "dealValue", "totalSoldValue", "soldArea", "plotNo", "wonDate"]) { if (old[k] === undefined) delete d[k]; else d[k] = old[k]; }
    // the history of a lead is append-only: whatever the browser sends, earlier entries stay
    for (const k of ["timeline", "comments"]) {
      if (Array.isArray(old[k]) && old[k].length) {
        const have = new Set((Array.isArray(d[k]) ? d[k] : []).map((x: any) => x?.id));
        d[k] = [...old[k].filter((x: any) => !have.has(x?.id)), ...(Array.isArray(d[k]) ? d[k] : [])];
      }
    }
    if (assigneeName !== undefined && (d.assignedSalespersonId || "") !== (old.assignedSalespersonId || "")) {
      d.assignedSalespersonName = assigneeName;
      d.assignedDate = new Date().toISOString();
      d.firstContactAt = "";
      d.reassignCount = (Number(old.reassignCount) || 0) + 1;
      audits.push({ action: "owner", from: old.assignedSalespersonName || "(none)", to: assigneeName || "(none)" });
    }
    if (d.status !== old.status) {
      audits.push({ action: "status", from: old.status, to: d.status });
      if (d.status === "Won" && old.status !== "Won") {
        if (!(Number(d.dealValue) > 0)) return { data: d, error: "a Won lead needs the deal value (EGP)", audits };
        d.cashStatus = d.cashStatus || "pending";
        d.wonDate = d.wonDate || today();
      }
      if (d.status === "Lost" && !(d.lostReason && (d.lostCategory || d.lostComment !== undefined))) {
        // the browser asks for both; the server only insists on the reason
        if (!d.lostReason) return { data: d, error: "a Lost lead needs a reason", audits };
      }
    }
    if (String(d.source ?? "") !== String(old.source ?? "")) audits.push({ action: "source", from: old.source, to: d.source });
    for (const k of ["dealValue", "totalSoldValue", "soldArea", "plotNo"]) if (String(d[k] ?? "") !== String(old[k] ?? "")) audits.push({ action: "value", from: `${k}=${old[k] ?? ""}`, to: `${k}=${d[k] ?? ""}` });
    for (const k of ["eoiDate", "reservationDate", "contractDate"]) if (String(d[k] ?? "") !== String(old[k] ?? "")) audits.push({ action: "stage", from: `${k}=${old[k] ?? ""}`, to: `${k}=${d[k] ?? ""}` });
    if (String(d.cashStatus ?? "") !== String(old.cashStatus ?? "")) audits.push({ action: "cash", from: old.cashStatus, to: d.cashStatus });
  } else {
    if (scope !== "all" && d.status === "Won") d.status = "New"; // a lead cannot be created already won
    if (!canCash) for (const k of CASH_FIELDS) delete d[k];
    audits.push({ action: "create", to: d.status || "New", note: d.source || "" });
  }
  if (d.touched !== true && isTouched(d)) d.touched = true;
  if (ex?.data?.touched === true) d.touched = true;            // the mark cannot be removed from the browser
  return { data: d, audits };
}
