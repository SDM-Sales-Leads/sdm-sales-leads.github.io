// The bulk-upload template. Every drop-down list of the system is shown with real values in the first rows (EXAMPLE rows: the importer ignores any row
// whose Lead Name starts with "EXAMPLE"), a "Guide" sheet says what each column wants, and a "Lists" sheet holds every allowed value.
// Written 3 Nov 2026 for the old Excel history (Jan 2026 onwards) but it is the same template for every bulk upload.
import { XLSX_HEADERS } from './importEngine';

export interface TemplateLists {
  projects: string[]; statuses: string[]; closedStatuses: string[]; sources: string[]; priorities: string[]; qualifications: string[];
  temperatures: string[]; industries: string[]; lostReasons: string[]; nationalities: string[]; team: string[];
}
type Sheet = { name: string; rows: (string | number)[][]; widths?: number[] };

const H = XLSX_HEADERS as unknown as string[];
const idx = (h: string) => { const i = H.indexOf(h); if (i < 0) throw new Error('template header missing: ' + h); return i; };

const PHONES = ['+20 100 123 4567', '01001234567', '0020 100 123 4567', '+971 50 123 4567', '(+966) 55 123 4567'];
const AREAS = ['2500', '5,000', '2,500 - 5,000', '10000', '3000 sqm'];
const NEEDS_MEETING = ['Call Back', 'Scheduled Meeting', 'Site Visit Scheduled'];
const NEEDS_FOLLOW = ['Sent WhatsApp', 'No Answer – Sent WhatsApp', 'Out of Coverage – Sent WhatsApp', 'Mail Sent', 'Client Will Call Back', 'Need Time to Study Our Offer', 'Offer Sent – Following Up'];
const cyc = <T,>(a: T[], i: number, blank: T | '' = '') => (a.length ? a[i % a.length] : blank);

function exampleRows(L: TemplateLists): (string | number)[][] {
  // statuses: first row closed, second open, third closed ... so both kinds are seen at once
  const closed = L.statuses.filter((s) => L.closedStatuses.includes(s)), open = L.statuses.filter((s) => !L.closedStatuses.includes(s));
  const order: string[] = [];
  for (let i = 0; i < Math.max(closed.length, open.length); i++) { if (i < closed.length) order.push(closed[i]); if (i < open.length) order.push(open[i]); }
  const n = Math.max(L.projects.length, order.length, 12);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < n; i++) {
    const r: (string | number)[] = new Array(H.length).fill('');
    const set = (h: string, v: string | number) => { r[idx(h)] = v; };
    const status = cyc(order, i) as string;
    const isClosed = L.closedStatuses.includes(status);
    const day = String((i % 27) + 1).padStart(2, '0');
    const month = String((i % 6) + 1).padStart(2, '0');
    set('Lead Name', `EXAMPLE ${String(i + 1).padStart(2, '0')} - delete this row`);
    set('Reference No.', `OLD-${1001 + i}`);
    set('Company', i % 3 === 0 ? '' : `Example Company ${i + 1}`);
    set('Customer Number', cyc(PHONES, i));
    set('Email', i % 4 === 3 ? '' : `example${i + 1}@example.com`);
    set('Lead Source', cyc(L.sources, i));
    set('Project Interested In', cyc(L.projects, i));
    set('Requested Area (sqm)', cyc(AREAS, i));
    set('Industry', cyc(L.industries, i));
    set('Nationality', cyc(L.nationalities, i));
    set('Priority', cyc(L.priorities, i));
    set('Qualification', i % 2 === 0 ? cyc(L.qualifications, i / 2) : '');
    set('Temperature', i % 2 === 0 ? cyc(L.temperatures, i / 2) : '');
    set('Status', status);
    set('Assigned To', i % 5 === 4 ? '' : cyc(L.team, i));
    set('Lead Date (YYYY-MM-DD)', `2026-${month}-${day}`);
    set('Last Contact Date', `2026-${month}-${String(Math.min(28, Number(day) + 2)).padStart(2, '0')}`);
    const notes: string[] = [`EXAMPLE. Status "${status}" is ${isClosed ? 'CLOSED (the deal is over)' : 'OPEN (still being worked)'}.`];
    if (status === 'Won') {
      set('Deal Value (EGP)', 4500000 + i * 100000); set('Total Sold Value (EGP)', 4500000 + i * 100000); set('Sold Area (sqm)', 2500); set('Plot Number', `A-${10 + i}`);
      set('Cash Status', i % 2 ? 'pending' : 'confirmed'); set('Contract Date', `2026-${month}-${day}`);
      notes.push('Won needs the Deal Value and the Cash Status (confirmed = paid, pending = not paid yet).');
    }
    if (status === 'Lost') { set('Lost Reason', cyc(L.lostReasons, i)); notes.push('Lost needs a Lost Reason from the list.'); }
    if (NEEDS_MEETING.includes(status)) { set('Meeting Date', `2026-${month}-${day}`); set('Meeting Time', '10:30'); notes.push('This status needs the meeting date and time.'); }
    if (NEEDS_FOLLOW.includes(status)) { set('Next Follow-up (YYYY-MM-DD)', `2026-${month}-${day}`); notes.push('This status needs the next follow-up date.'); }
    if (i % 3 === 1) { set('Offer Sent (YES/NO)', 'YES'); set('Offer Date (YYYY-MM-DD)', `2026-${month}-${day}`); } else if (i % 3 === 2) set('Offer Sent (YES/NO)', 'NO');
    if (i === 0) notes.push('Lead ID stays EMPTY for old leads; the old Excel number goes in Reference No.');
    set('Notes', notes.join(' '));
    rows.push(r);
  }
  return rows;
}

function guide(): (string | number)[][] {
  const g: [string, string, string, string, string][] = [
    ['Lead ID', 'Leave EMPTY for new or old leads. A Lead ID that exists in the system would UPDATE that lead.', 'No', 'empty', ''],
    ['Lead Name', 'The customer / contact person. Never an ad name, a campaign, an e-mail or a number.', 'YES', 'text', 'Mohamed Ali'],
    ['Reference No.', 'The number the lead had in the old Excel sheet (so it can be traced back).', 'No', 'text', 'OLD-1043'],
    ['Company', 'The customer company.', 'No', 'text', 'Delta Plastics'],
    ['Customer Number', 'Mobile number with country code if known. Keep it as TEXT.', 'One of phone / e-mail', '+20 100 123 4567 or 01001234567', '+201001234567'],
    ['Email', 'Customer e-mail. Used to find duplicates.', 'One of phone / e-mail', 'name@company.com', 'm.ali@delta.com'],
    ['Lead Source', 'Where the lead came from. Choose from the list (Lists sheet, column Sources).', 'Recommended', 'list', 'Facebook'],
    ['Project Interested In', 'The park. Choose from the list (Lists sheet, column Projects): the first example rows show every project.', 'Recommended', 'list', 'Industria Sadat'],
    ['Customer Number 2', 'A second phone, if any.', 'No', 'phone', ''],
    ['Requested Area (sqm)', 'The land size the customer asked for.', 'No', 'a number, or a range', '2,500 - 5,000'],
    ['Sold Area (sqm)', 'Only for Won leads: the area sold.', 'Won only', 'number', '2500'],
    ['Plot Number', 'Only for Won leads: the plot.', 'Won only', 'text', 'A-12'],
    ['Industry', 'Customer industry. Choose from the list.', 'No', 'list', 'Textile'],
    ['Nationality', 'Customer nationality (list).', 'No', 'list', 'Egyptian'],
    ['Priority', 'VIP / High / Medium / Low.', 'No', 'list', 'Medium'],
    ['Qualification', 'Qualified or Unqualified. A qualification needs the Qualification Notes in the system.', 'No', 'list', 'Qualified'],
    ['Temperature', 'Hot / Warm / Cold (only for a Qualified lead).', 'No', 'list', 'Warm'],
    ['Status', 'The lead\'s status. Choose from the list (Lists sheet: it says which statuses are OPEN and which are CLOSED). For OLD leads use the status the lead ended with.', 'YES for old leads', 'list', 'Lost'],
    ['Lost Reason', 'Only when Status = Lost. One reason from the list.', 'Lost only', 'list', 'Bought From Another Developer'],
    ['Meeting Date', 'For Call Back / Scheduled Meeting / Site Visit Scheduled.', 'those statuses', 'YYYY-MM-DD or DD/MM/YYYY', '2026-03-12'],
    ['Meeting Time', 'With the meeting date.', 'those statuses', 'HH:MM', '10:30'],
    ['EOI Applicable', 'Did the customer file an Expression of Interest?', 'No', 'YES / NO', 'YES'],
    ['EOI Date', 'Date of the EOI.', 'No', 'YYYY-MM-DD', ''],
    ['Reservation Date', 'Date of the reservation.', 'No', 'YYYY-MM-DD', ''],
    ['Contract Date', 'Date of the contract (Won).', 'No', 'YYYY-MM-DD', ''],
    ['Total Sold Value (EGP)', 'Total value of the sale in EGP (Won).', 'No', 'number, no text', '4500000'],
    ['Assigned To', 'The salesperson the lead was given to, written as in the Lists sheet (Team members). A name that matches nobody leaves the lead without an owner.', 'Recommended', 'list', 'Mohamed Tarek'],
    ['Next Follow-up (YYYY-MM-DD)', 'The next follow-up date (statuses that wait for the customer).', 'those statuses', 'YYYY-MM-DD', '2026-04-01'],
    ['Deal Value (EGP)', 'Won only: the deal value in EGP, above zero.', 'Won only', 'number, no text', '4500000'],
    ['Cash Status', 'Won only: confirmed = the money is received, pending = not paid yet.', 'Won only', 'confirmed / pending', 'confirmed'],
    ['Offer Sent (YES/NO)', 'Was an offer sent?', 'No', 'YES / NO', 'YES'],
    ['Offer Date (YYYY-MM-DD)', 'The date the offer was sent (needed when Offer Sent = YES).', 'with Offer Sent', 'YYYY-MM-DD', '2026-03-20'],
    ['Notes', 'Free text: what was agreed, what the customer said.', 'No', 'text', 'Asked for 3,000 sqm near the port'],
    ['Lead Date (YYYY-MM-DD)', 'The date the lead ARRIVED in the old Excel. REQUIRED for old leads: a blank date would count as today.', 'YES for old leads', 'YYYY-MM-DD or DD/MM/YYYY', '2026-02-18'],
    ['Last Contact Date', 'Last time the customer was contacted.', 'No', 'YYYY-MM-DD', '2026-03-02'],
  ];
  const mistakes: Record<string, string> = {
    'Lead ID': 'Typing the old Excel number here: it can overwrite a current lead. Use Reference No.',
    'Lead Name': 'Pasting the Facebook ad name or the campaign text.', 'Customer Number': 'Excel turning 0100… into 100… : format the column as Text.',
    'Project Interested In': 'Writing it your own way ("Sokhna 360", "Industria Borg El Arab"). Use the exact names of the list.', 'Status': 'Leaving it blank (it becomes New) or inventing a status.',
    'Lead Date (YYYY-MM-DD)': 'Leaving it empty, or writing 03/04/2026 meaning April (day first!).', 'Assigned To': 'Using a nickname. Use the full name of the list.',
    'Deal Value (EGP)': 'Writing "4.5M" or "EGP 4,500,000": numbers only.',
  };
  return [['Column', 'What to put', 'Required?', 'Format / allowed values', 'Example', 'Common mistake'], ...g.map((x) => [x[0], x[1], x[2], x[3], x[4], mistakes[x[0]] || ''])];
}

function lists(L: TemplateLists): (string | number)[][] {
  const cols: [string, string[]][] = [
    ['Projects', L.projects], ['Status', L.statuses], ['Open or closed', L.statuses.map((s) => (L.closedStatuses.includes(s) ? 'CLOSED' : 'OPEN'))],
    ['Sources', L.sources], ['Priority', L.priorities], ['Qualification', L.qualifications], ['Temperature', L.temperatures], ['Industry', L.industries],
    ['Lost reasons', L.lostReasons], ['Nationality', L.nationalities], ['Cash status', ['pending', 'confirmed']], ['Offer sent / EOI', ['YES', 'NO']], ['Team members (Assigned To)', L.team],
  ];
  const n = Math.max(...cols.map((c) => c[1].length));
  return [cols.map((c) => c[0]), ...Array.from({ length: n }, (_, i) => cols.map((c) => c[1][i] ?? ''))];
}

function readMe(): (string | number)[][] {
  return [
    ['READ ME FIRST - how to fill this template'],
    [''],
    ['1. Sheet "Leads": one lead per row. Rows that start with "EXAMPLE" are only examples: they show every project, status, source and other drop-down value. They are ignored when you upload, but please delete them anyway.'],
    ['2. Sheet "Guide": what each column means, whether it is required, the format and the most common mistake.'],
    ['3. Sheet "Lists": every allowed value (projects, statuses with OPEN / CLOSED, sources, lost reasons, team names...). Copy the value exactly; do not invent new ones.'],
    ['4. OLD LEADS (for example the Excel sheet kept since January): leave Lead ID EMPTY, put the old Excel number in Reference No., and always fill Lead Date and Status. Tick "These are old leads" on the upload page.'],
    ['5. Dates: YYYY-MM-DD (2026-03-18) or DD/MM/YYYY (day first). Phones: format the column as Text so the leading 0 is kept.'],
    ['6. Won leads need Deal Value and Cash Status. Lost leads need a Lost Reason.'],
    ['7. One row = one customer enquiry. If the same customer appears twice, keep both rows: the system recognises the same phone / e-mail and adds the older one as a history note.'],
    ['8. Sheet "Comments & Notes" (optional): one row per comment or call outcome of a lead. Lead ID there = the Lead ID of the Leads sheet, so it only works for rows that have a Lead ID. For old leads it is simpler to put the comments in the Notes column.'],
    ['9. Nothing is saved until you press Import on the upload page. You first see a preview: new leads, duplicates, rows with errors, owners not found. Fix the file and upload again.'],
  ];
}

export function buildTemplateSheets(L: TemplateLists): Sheet[] {
  const w = (h: string) => (h.length > 22 ? 28 : h.length > 14 ? 22 : 16);
  return [
    { name: 'Read me first', rows: readMe(), widths: [150] },
    { name: 'Leads', rows: [H as unknown as string[], ...exampleRows(L)], widths: H.map((h) => (h === 'Notes' ? 60 : w(h))) },
    { name: 'Guide', rows: guide(), widths: [30, 70, 18, 34, 28, 60] },
    { name: 'Lists', rows: lists(L), widths: [26, 30, 14, 22, 10, 14, 12, 24, 36, 16, 12, 14, 28] },
    { name: 'Comments & Notes', rows: [['Lead ID', 'Date', 'Time', 'Written By', 'Type', 'Comment'], ['EXAMPLE-1', '2026-03-02', '11:15', 'Mohamed Tarek', 'Comment', 'EXAMPLE: called the customer, asked for an offer (Type can be Comment, Assignment, Status change, Call outcome or System)']], widths: [16, 12, 8, 20, 18, 90] },
  ];
}
