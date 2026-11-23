// deno-lint-ignore-file no-explicit-any
// 23 Nov 2026 (Walid): the customer's answer to a printed offer, in BOTH systems (migration 0035).
//  Accept  -> offer "accepted"; the lead becomes Won (deal value = offer total, plots, area); other open offers on that lead -> "closed";
//             finance gets a bell notification. The deal counts in the sales numbers only after finance confirms the cash.
//  1-day offer hold (23 Nov 2026): printing a SALES OFFER holds its plots for that salesperson for 24 h (no status change: the plots stay
//             Available). Others cannot print a sales offer for them during that day; afterwards the plot card says the offer is still open.
//  Reject  -> offer "rejected" with a reason; the lead stays open.
//  Confirm -> finance (canConfirmCash) confirms the cash of the accepted offer's lead (same rule as Won deals & cash).
// Who may accept/reject: the lead's owner (or the offer's printer when there is no lead), their team leader, and people who see all
// leads to work them (Admin, Sales Operation, Sales Director). Finance and "view only" roles may not.
import { admin, bad, body, can, Caller, crmScope, forbidden, HttpError, needCrm, nowIso, rateLimit, rid, str } from "./lib.ts";
import { route } from "./router.ts";
import { teamIds } from "./routes_crm.ts";
import { lbRoute } from "./integration.ts";
import { cashAction } from "./routes_crm2.ts";
import { lb } from "./routes_authsync.ts";

export const REJECT_REASONS = ["Price too high", "Payment plan", "Plot / location", "Plot size", "Chose a competitor", "Not ready / postponed", "Other"];
const TYPE_LABEL: Record<string, string> = { sales_offer: "Sales offer", financial_offer: "Initial financial offer", proposal: "Proposal" };

/** may this caller accept / reject this offer? (lead = the offer's lead row, if any) */
export async function canDecide(c: Caller, offer: any, lead: any | null): Promise<boolean> {
  const scope = crmScope(c);
  if (scope === "all") return true;
  if (scope !== "own" && scope !== "team") return false;            // finance, view-only
  const owner = lead ? lead.assigned_to : offer.printed_by;
  if (owner === c.id || (!lead && offer.printed_by === c.id)) return true;
  if (scope === "team") return (await teamIds(c)).includes(owner);
  return false;
}

async function loadOffer(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Offer not found");
  const { data } = await admin.from("crm_offer_prints").select("*").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Offer not found");
  return data;
}
async function loadLead(id: string | null) {
  if (!id) return null;
  const { data } = await admin.from("crm_leads").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return data || null;
}

/** 30-day hold request in the Land Bank for the accepted offer's plots (never fails the accept; the reason is stored instead) */
async function holdInLandBank(c: Caller, offer: any, client: string, company: string, leadId: string) {
  try {
    const plots = (Array.isArray(offer.plots) ? offer.plots : []).filter((p: any) => p && p.key).slice(0, 50);
    if (!plots.length) return { note: "no plots on the offer" };
    const { data: snap } = await admin.from("plots_snapshot").select("data").eq("id", 1).maybeSingle();
    const st = new Map<string, string>(); for (const p of (Array.isArray(snap?.data) ? snap!.data : [])) if (p?.key) st.set(String(p.key), String(p.status || ""));
    const busy = plots.filter((p: any) => ["sold", "reserved"].includes(st.get(String(p.key)) || ""));
    if (busy.length) return { note: `already ${busy.map((p: any) => `${p.unit || p.key} ${st.get(String(p.key))}`).join(", ")} in the Land Bank` };
    const parks = [...new Set(plots.map((p: any) => String(p.park || "")).filter(Boolean))];
    const r = await lb({ action: "hold", email: c.email, client: client || company || "Customer", company: company || client || "—",
      park: parks.length === 1 ? parks[0] : "mixed", note: `Offer accepted in Sales Leads (lead ${leadId})`,
      plots: plots.map((p: any) => ({ key: String(p.key), park: p.park || null, sheet: String(p.key).split("|")[0] || null, unit: p.unit || null,
        from: ({ available: "ats", eoi: "eoi", hold: "hold", nfs: "nfs" } as any)[st.get(String(p.key)) || ""] || "ats", area: p.areaSqm ? Math.round(Number(p.areaSqm)) : null })) });
    if (r && r.ok && r.id) return { req: Number(r.id), stage: r.stage };
    return { note: str(r?.error || "the Land Bank did not answer", 280) };
  } catch (e: any) { return { note: str(e?.message || e, 280) }; }
}

export async function decideOffer(c: Caller, id: string, b: any) {
  await rateLimit(`offerdecide:${c.id}`, 60, 30);
  const decision = b.decision === "accept" ? "accept" : b.decision === "reject" ? "reject" : "";
  if (!decision) throw bad("Choose accept or reject");
  const offer = await loadOffer(id);
  if (offer.status !== "open") throw new HttpError(409, `This offer is already ${offer.status}.`);
  let lead = await loadLead(offer.lead_id);
  if (!(await canDecide(c, offer, lead))) throw forbidden("Only the salesperson, their team leader, Sales Operation or an administrator can record the customer's answer");
  const now = nowIso(), label = TYPE_LABEL[offer.offer_type] || "Offer";
  const codes = (Array.isArray(offer.plots) ? offer.plots : []).map((p: any) => p.unit || p.key).join(", ").slice(0, 300) || "no plots";

  if (decision === "reject") {
    const reason = REJECT_REASONS.includes(str(b.reason, 60)) ? str(b.reason, 60) : "";
    if (!reason) throw bad("Choose why the customer rejected the offer");
    const note = str(b.note, 500);
    const u = await admin.from("crm_offer_prints").update({ status: "rejected", decided_at: now, decided_by: c.id, decided_by_name: c.name, reject_reason: reason, decision_note: note || null })
      .eq("id", id).eq("status", "open").select("id");
    if (!u.data?.length) throw new HttpError(409, "This offer was answered at the same time. Reload.");
    if (lead) {
      const d = { ...lead.data };
      d.timeline = [...(Array.isArray(d.timeline) ? d.timeline : []), { id: rid(), timestamp: now, type: "Offer", user: c.name,
        title: `Offer rejected (${label}) for ${codes}`.slice(0, 200), description: `Reason: ${reason}${note ? ". " + note : ""}`.slice(0, 600) }];
      d.lastUpdated = now;
      await admin.from("crm_leads").update({ data: d }).eq("id", lead.id);
      await admin.from("crm_lead_audit").insert({ lead_id: lead.id, actor_id: c.id, actor_name: c.name, action: "offer", from_value: "open", to_value: "rejected", note: `${reason}${note ? ": " + note : ""}`.slice(0, 300) });
    }
    return { success: true, status: "rejected" };
  }

  // ---- accept ----
  const total = Number(offer.total_value);
  if (!(total > 0)) throw bad("This offer has no total value, so it cannot become a Won deal. Print the offer again with the price.");
  if (!lead) {
    // the customer's open lead that this person may work (owner / team / all)
    const scope = crmScope(c), team = scope === "team" ? await teamIds(c) : [];
    const { data: kc } = await admin.from("crm_contacts").select("phone_norm,email_norm").eq("id", offer.contact_id).maybeSingle();
    const q = (v: string) => `"${String(v).replace(/["\\]/g, "")}"`;
    const ors = [kc?.phone_norm ? `phone_norm.eq.${q(kc.phone_norm)}` : "", kc?.email_norm ? `email_norm.eq.${q(kc.email_norm)}` : ""].filter(Boolean);
    const CLOSEDS = new Set(["Won", "Lost", "Wrong Number", "Duplicate", "Invalid", "Closed", "Not Interested", "Low Budget"]);
    const { data: ls } = ors.length ? await admin.from("crm_leads").select("*").is("deleted_at", null).or(ors.join(",")).limit(50) : { data: [] as any[] };
    lead = (ls || []).filter((l: any) => !CLOSEDS.has(String(l.status || "")))
      .find((l: any) => scope === "all" || l.assigned_to === c.id || (scope === "team" && team.includes(l.assigned_to))) || null;
    if (!lead) throw bad("This offer is not linked to an open lead of this customer. Open (or create) the customer's lead first, then accept the offer from there.");
  }
  if (lead.status === "Won" && lead.data?.cashStatus === "confirmed") throw new HttpError(409, "This lead is already a confirmed Won deal.");
  const { data: k } = await admin.from("crm_contacts").select("data").eq("id", offer.contact_id).maybeSingle();
  const client = str(k?.data?.name || lead.data?.customerName || "", 200), company = str(k?.data?.company || k?.data?.companyName || lead.data?.companyName || "", 200);
  const plots = Array.isArray(offer.plots) ? offer.plots : [];
  const area = plots.reduce((a: number, p: any) => a + (Number(p.areaSqm) || 0), 0);

  // the lead -> Won (deal value from the offer), waiting for finance
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = attempt === 0 ? lead : await loadLead(lead.id);
    if (!cur) throw new HttpError(404, "Lead not found");
    const old = cur.data || {}, d = { ...old };
    d.status = "Won"; d.dealValue = Math.round(total); d.totalSoldValue = Math.round(total);
    if (area > 0) d.soldArea = Math.round(area); d.plotNo = codes;
    d.wonDate = old.wonDate || now.slice(0, 10); d.cashStatus = "pending"; d.cashBy = ""; d.cashDate = "";
    d.acceptedOfferId = offer.id; d.lastUpdated = now;
    d.timeline = [...(Array.isArray(old.timeline) ? old.timeline : []), { id: rid(), timestamp: now, type: "Offer", user: c.name,
      title: `Offer accepted (${label}) for ${codes} — lead Won`.slice(0, 200),
      description: `EGP ${Math.round(total).toLocaleString("en-US")}. Waiting for finance to confirm the cash before it counts in the sales numbers.` }];
    const u = await admin.from("crm_leads").update({ data: d, status: "Won" }).eq("id", cur.id).eq("updated_at", cur.updated_at).select("id");
    if (u.data?.length) {
      await admin.from("crm_lead_audit").insert([
        { lead_id: cur.id, actor_id: c.id, actor_name: c.name, action: "offer", from_value: "open", to_value: "accepted", note: codes },
        ...(old.status !== "Won" ? [{ lead_id: cur.id, actor_id: c.id, actor_name: c.name, action: "status", from_value: old.status || null, to_value: "Won", note: "offer accepted" }] : []),
        { lead_id: cur.id, actor_id: c.id, actor_name: c.name, action: "value", from_value: `dealValue=${old.dealValue ?? ""}`, to_value: `dealValue=${Math.round(total)}`, note: "from the accepted offer" },
      ]);
      lead = { ...cur, data: d };
      break;
    }
    if (attempt === 1) throw new HttpError(409, "Someone changed this lead at the same time. Reload and try again.");
  }
  const u = await admin.from("crm_offer_prints").update({ status: "accepted", decided_at: now, decided_by: c.id, decided_by_name: c.name, decision_note: str(b.note, 500) || null, lead_id: lead.id })
    .eq("id", id).eq("status", "open").select("id");
  if (!u.data?.length) throw new HttpError(409, "This offer was answered at the same time. Reload.");
  await admin.from("crm_offer_prints").update({ status: "closed", decided_at: now, decided_by: c.id, decided_by_name: c.name, decision_note: "Another offer on this lead was accepted" })
    .eq("lead_id", lead.id).eq("status", "open").neq("id", id);

  // finance: one bell notification each (people with canConfirmCash; admins see it on the Won deals page anyway)
  try {
    const { data: rp } = await admin.from("role_permissions").select("role,perms");
    const roles = (rp || []).filter((r: any) => r.perms?.canConfirmCash === true && r.role !== "Admin").map((r: any) => r.role);
    if (roles.length) {
      const { data: fin } = await admin.from("app_users").select("id").in("role", roles).eq("active", true);
      const who = client || company || "a customer";
      if (fin?.length) await admin.from("crm_notifications").insert(fin.map((f: any) => ({ user_id: f.id, type: "cash", lead_id: lead.id,
        title: `Won deal to confirm: ${who}`.slice(0, 200), body: `${c.name} recorded the customer's acceptance of the ${label.toLowerCase()} (EGP ${Math.round(total).toLocaleString("en-US")}, ${codes}). Confirm the cash in Won deals & cash.`.slice(0, 1500) })));
    }
  } catch { /* a notification problem must not undo the deal */ }

  // 23 Nov 2026 (Walid): no Land Bank status hold on accept any more; plots stay Available and the plot card shows the offer's state
  void holdInLandBank; void client; void company;
  return { success: true, status: "accepted", leadId: lead.id };
}

/** finance: confirm the cash of an accepted offer's deal (Land Bank button) */
export async function confirmOffer(c: Caller, id: string) {
  const offer = await loadOffer(id);
  if (offer.status !== "accepted" || !offer.lead_id) throw bad("Only an accepted offer can be confirmed");
  const lead = await cashAction(c, offer.lead_id, "confirm", "");
  return { success: true, cashStatus: lead.cashStatus };
}

// Sales Leads (normal login)
route("POST", "/crm/offer-prints/:id/decide", async ({ req, c, params }) => { needCrm(c); return await decideOffer(c, params.id, await body(req, 4000)); });
route("GET", "/crm/offer-reasons", async ({ c }) => { needCrm(c); return { reasons: REJECT_REASONS }; });
// Land Bank (its own login token, verified in lbRoute)
lbRoute("POST", "/integration/offer-decide/:id", async ({ req, c, params }) => await decideOffer(c, params.id, await body(req, 4000)));
lbRoute("POST", "/integration/offer-confirm/:id", async ({ c, params }) => await confirmOffer(c, params.id));

/** per offer row: the result shown everywhere + what THIS caller may do with it (server decides, the pages only show the buttons) */
export async function offerExtras(c: Caller, rows: any[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];
  const leads = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("crm_leads").select("id,status,assigned_to,cash:data->>cashStatus").in("id", ids.slice(i, i + 100));
    for (const l of data || []) leads.set(l.id, l);
  }
  const fin = can(c, "canConfirmCash");
  for (const r of rows) {
    const l = r.lead_id ? leads.get(r.lead_id) || null : null;
    const status = r.status || "open";
    const confirmed = status === "accepted" && l?.status === "Won" && l?.cash === "confirmed";
    out.set(r.id, {
      status, result: confirmed ? "confirmed" : status,
      canDecide: status === "open" ? await canDecide(c, r, l) : false,
      canConfirm: status === "accepted" && !confirmed && fin && l?.status === "Won",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1-day offer hold (23 Nov 2026, Walid)
// ---------------------------------------------------------------------------------------------
export const OFFER_HOLD_MS = 24 * 3600_000;
const keysOf = (r: any) => (Array.isArray(r.plots) ? r.plots : []).map((p: any) => String(p?.key || "")).filter(Boolean);

/** sales offers that touch these plots: still open, or accepted (waiting for finance / confirmed) */
async function salesOffersFor(keys: string[]) {
  const want = new Set(keys);
  const since = new Date(Date.now() - 365 * 864e5).toISOString();
  const { data } = await admin.from("crm_offer_prints").select("id,plots,printed_by,printed_by_name,printed_at,status,lead_id,decided_by_name,decided_at")
    .eq("offer_type", "sales_offer").in("status", ["open", "accepted"]).gte("printed_at", since).order("printed_at", { ascending: false }).limit(2000);
  return (data || []).filter((r: any) => keysOf(r).some((k: string) => want.has(k)));
}

/** called before a sales offer is recorded: refuse while another salesperson's 1-day hold is on one of the plots */
export async function checkOfferHold(c: Caller, keys: string[]) {
  if (!keys.length) return;
  const now = Date.now();
  const rows = (await salesOffersFor(keys)).filter((r: any) => r.status === "open" && r.printed_by !== c.id && now - Date.parse(r.printed_at) < OFFER_HOLD_MS);
  if (!rows.length) return;
  const r = rows[0], until = new Date(Date.parse(r.printed_at) + OFFER_HOLD_MS);
  const units = (Array.isArray(r.plots) ? r.plots : []).filter((p: any) => keys.includes(String(p.key))).map((p: any) => p.unit || p.key).join(", ");
  const t = until.toLocaleString("en-GB", { timeZone: "Africa/Cairo", weekday: "short", hour: "2-digit", minute: "2-digit" });
  throw new HttpError(409, `On hold: ${r.printed_by_name || "another salesperson"} printed a sales offer for ${units} and holds it until ${t} (Cairo). You can print a sales offer for it after that.`);
}

// the plot card asks: is any of these plots held / under an open or accepted sales offer?
lbRoute("GET", "/integration/plot-offers", async ({ c, query }) => {
  await rateLimit(`lbplotoffers:${c.id}`, 60, 120);
  const keys = String(query.get("keys") || "").split("~").map((k) => str(k, 160)).filter(Boolean).slice(0, 30);
  if (!keys.length) return { success: true, plots: {} };
  const rows = await salesOffersFor(keys);
  const leadIds = [...new Set(rows.map((r: any) => r.lead_id).filter(Boolean))];
  const cash = new Map<string, string>();
  if (leadIds.length) { const { data } = await admin.from("crm_leads").select("id,cash:data->>cashStatus").in("id", leadIds); for (const l of data || []) cash.set(l.id, l.cash || ""); }
  const now = Date.now(), out: Record<string, any> = {};
  for (const k of keys) {
    const mine = rows.filter((r: any) => keysOf(r).includes(k));
    if (!mine.length) continue;
    const item = (r: any) => ({ byName: r.printed_by_name || "", mine: r.printed_by === c.id, at: r.printed_at });
    const holdRow = mine.find((r: any) => r.status === "open" && now - Date.parse(r.printed_at) < OFFER_HOLD_MS);
    out[k] = {
      hold: holdRow ? { ...item(holdRow), until: new Date(Date.parse(holdRow.printed_at) + OFFER_HOLD_MS).toISOString() } : null,
      open: mine.filter((r: any) => r.status === "open" && r !== holdRow).map(item),
      accepted: mine.filter((r: any) => r.status === "accepted").map((r: any) => ({ ...item(r), confirmed: cash.get(r.lead_id) === "confirmed", decidedAt: r.decided_at })),
    };
  }
  return { success: true, plots: out };
});
