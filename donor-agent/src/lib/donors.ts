import { DONOR_LIST } from "./donor-list";
import type { CaseFile, Donor, DonorStatus } from "./types";

const DAY = 86_400_000;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
const STATUSES: DonorStatus[] = ["new", "sent", "replied", "donated", "no"];

/** Days to wait before a reminder, and before asking a past donor again. */
export const REMIND_AFTER_DAYS = 3;
export const ASK_AGAIN_AFTER_DAYS = 30;
/** After this many messages with no reply, leave the donor alone. */
export const MAX_SENDS = 3;

export function groupOf(name: string, phone?: string): string {
  if (/^uet lahore\b/i.test(name)) return "UET Lahore";
  if (/^upwork member\b/i.test(name)) return "Upwork";
  if (/^(?:new )?d\d+$|\bd\d+$|^donor \d+$/i.test(name)) return "D list";
  if (phone) return "WhatsApp";
  return "Others";
}

/** WhatsApp wants the full number: "+92 300 1234567", "0092…" and "0300 1234567" all become "+923001234567". Anything else is not a phone. */
export function cleanPhone(raw?: string): string | undefined {
  let digits = (raw ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^03\d{9}$/.test(digits)) digits = `92${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : undefined;
}

/** "Ali Aftab Khan — +971503802721", "— +923168238171", or just "Abdul Basit". */
export function parseDonorLine(line: string, id: string, at: string): Donor | null {
  const [left, right] = line.split("—").map((x) => x.trim());
  const phone = cleanPhone(right);
  const name = /^(?:contact|\(no name\))?$/i.test(left) ? "" : left.slice(0, 80);
  if (!name && !phone) return null;
  return { id, name, phone, group: groupOf(name, phone), gender: guessGender(name), status: "new", sends: 0, updatedAt: at };
}

/** Only clear women's names in the list; everyone else gets "Bhai". */
const FEMALE = /^(?:iqra|hajra|kashmala|mubeena|madhu|ayesha|fatima|zainab|maryam|sana|hina|amna|areeba|sara|sarah|mehwish|nimra|rabia|saima|kiran)$/i;
export const guessGender = (name: string): "m" | "f" => (FEMALE.test(name.trim().split(/\s+/)[0] ?? "") ? "f" : "m");

export function seedDonors(at = new Date().toISOString()): Donor[] {
  return DONOR_LIST.split("\n")
    .map((l, i) => parseDonorLine(l, `d${i + 1}`, at))
    .filter((d): d is Donor => !!d);
}

/** Older saved donors had other fields; keep what still makes sense. */
export function normalizeDonor(raw: Omit<Partial<Donor>, "status"> & { status?: string; contact?: string }, i: number): Donor {
  const status = raw.status === "todo" ? "new" : raw.status === "skipped" ? "no" : STATUSES.includes(raw.status as DonorStatus) ? (raw.status as DonorStatus) : "new";
  const name = String(raw.name ?? "").slice(0, 80);
  const phone = cleanPhone(raw.phone ?? raw.contact);
  const amount = Number.isFinite(raw.amount) && raw.amount! > 0 ? raw.amount : undefined;
  return {
    id: String(raw.id ?? `x${i}`),
    name,
    phone,
    group: raw.group || groupOf(name, phone),
    gender: raw.gender === "f" || raw.gender === "m" ? raw.gender : guessGender(name),
    caseId: raw.caseId,
    status,
    sends: Number.isFinite(raw.sends) ? Math.max(0, raw.sends!) : status === "new" ? 0 : 1,
    sentAt: raw.sentAt,
    repliedAt: raw.repliedAt,
    donatedAt: raw.donatedAt,
    amount,
    note: raw.note,
    updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
    undo: raw.undo,
  };
}

export const donorLabel = (d: Donor) => d.name || d.phone || "Donor";

/** A real first name to greet with, or "" for labels like "D12", "UET Lahore 7", "Jr Accounts". */
export function greetName(d: Donor): string {
  if (d.group !== "Others" && d.group !== "WhatsApp") return "";
  const words = d.name.replace(/\(.*?\)/g, " ").split(/\s+/).filter((w) => /^[A-Za-z][a-z]+$/.test(w));
  const skip = /^(?:contact|donor|education|foundation|jr|junior|president|react|native|allahamdulilah|stud|new|uniguide|chippu|callmeshoaib|accounts|society|mami|senior|expert)$/i;
  if (!words.length || skip.test(words[0])) return "";
  if (/^(?:muhammad|syed|abdul|hafiz|rao)$/i.test(words[0]) && words[1] && !skip.test(words[1])) return `${words[0]} ${words[1]}`;
  return words[0];
}

export type PickWhy = "followup" | "again" | "reminder" | "new" | "case";
export interface Pick {
  id: string;
  why: PickWhy;
  /** Short reason shown on the card. */
  label: string;
  score: number;
}

/**
 * Whether this donor should be messaged now, and why. Most likely to give comes first.
 * With an open case, everyone gets that case's DM once (guide Part 8: one DM per person, no reminder DMs).
 */
export function pickFor(d: Donor, now: number, openCase?: CaseFile | null): Pick | null {
  const days = (iso?: string) => (now - ms(iso)) / DAY;
  if (openCase && d.status !== "replied") {
    if (d.status === "no" || d.caseId === openCase.id) return null;
    const gave = d.status === "donated" || !!d.amount;
    if (!gave && d.sends >= MAX_SENDS) return null;
    const who = openCase.facts.name;
    if (gave) return { id: d.id, why: "case", label: `Gave before — send ${who}'s case`, score: 90 + Math.min(9, Math.floor((d.amount ?? 0) / 1000)) };
    if (d.status === "sent") return { id: d.id, why: "case", label: `New case — send ${who}'s case`, score: 70 - d.sends * 5 };
    return { id: d.id, why: "case", label: d.phone ? `${who}'s case — WhatsApp in one tap` : `${who}'s case — copy message`, score: 40 + (d.phone ? 8 : 0) + (greetName(d) ? 4 : 0) };
  }
  switch (d.status) {
    case "replied":
      return { id: d.id, why: "followup", label: "Replied — answer and ask kindly", score: 100 };
    case "donated":
      return days(d.donatedAt) >= ASK_AGAIN_AFTER_DAYS ? { id: d.id, why: "again", label: "Gave before — ask again", score: 80 } : null;
    case "sent":
      if (d.sends >= MAX_SENDS || days(d.sentAt) < REMIND_AFTER_DAYS) return null;
      return { id: d.id, why: "reminder", label: `No reply in ${Math.floor(days(d.sentAt))} days — remind`, score: 60 - d.sends * 5 + (d.amount ? 10 : 0) };
    case "new":
      return { id: d.id, why: "new", label: d.phone ? "New — WhatsApp in one tap" : "New — copy message", score: 40 + (d.phone ? 8 : 0) + (greetName(d) ? 4 : 0) };
    default:
      return null;
  }
}

export function todayPicks(donors: Donor[], now: number, n = 10, openCase?: CaseFile | null): Pick[] {
  return donors
    .map((d, i) => ({ p: pickFor(d, now, openCase), i }))
    .filter((x): x is { p: Pick; i: number } => !!x.p)
    .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
    .slice(0, Math.max(0, n))
    .map((x) => x.p);
}

/** The message to send, in easy English. With an open case, `caseDm` writes the case DM for this donor's first name. */
export function draftMessage(d: Donor, why: PickWhy, teammate: string, caseDm?: (first: string, female: boolean) => string): string {
  const n = greetName(d);
  if (why === "case" && caseDm) return caseDm(n.split(" ")[0] ?? "", d.gender === "f");
  const hi = `Assalam o Alaikum${n ? ` ${n}` : ""}!`;
  switch (why) {
    case "followup":
      return `Thank you so much for your reply${n ? `, ${n}` : ""}! Shall I send you the details to donate? Any amount helps a lot.`;
    case "again":
      return `${hi} Thank you again for your last gift, it really helped. We have a new need now. Would you like to help again?`;
    case "reminder":
      return `${hi} Just a gentle reminder about my last message. Even a small gift helps a lot. Can I share the details?`;
    default:
      return `${hi} This is ${teammate} from GiveLife. We are raising funds for people in need. Even a small gift helps a lot. Can I share the details?`;
  }
}

export type DonorAction = "sent" | "replied" | "donated" | "no" | "undo";

/**
 * Change one donor. Returns how her task count should move: +1 for "sent", −1 when a counted "sent" is undone.
 * `counts` is false when the change should not touch the task (the manager marking, or no open task).
 */
export function applyDonorAction(d: Donor, action: DonorAction, nowIso: string, opts: { amount?: number; counts?: boolean; caseId?: string } = {}): number {
  if (action === "undo") {
    const u = d.undo;
    if (!u) return 0;
    Object.assign(d, { status: u.status, sends: u.sends, sentAt: u.sentAt, repliedAt: u.repliedAt, donatedAt: u.donatedAt, amount: u.amount, caseId: u.caseId, undo: undefined, updatedAt: nowIso });
    return u.counted ? -1 : 0;
  }
  const counted = action === "sent" && !!opts.counts;
  d.undo = { status: d.status, sends: d.sends, sentAt: d.sentAt, repliedAt: d.repliedAt, donatedAt: d.donatedAt, amount: d.amount, counted, caseId: d.caseId };
  d.updatedAt = nowIso;
  if (action === "sent") {
    d.status = "sent";
    d.sends += 1;
    d.sentAt = nowIso;
    if (opts.caseId) d.caseId = opts.caseId;
  } else if (action === "replied") {
    d.status = "replied";
    d.repliedAt = nowIso;
  } else if (action === "donated") {
    d.status = "donated";
    d.donatedAt = nowIso;
    const add = Number(opts.amount);
    if (Number.isFinite(add) && add > 0 && add <= 100_000_000) d.amount = Math.round((d.amount ?? 0) + add);
  } else if (action === "no") d.status = "no";
  return counted ? 1 : 0;
}

export interface DonorStats {
  total: number;
  withPhone: number;
  byStatus: Record<DonorStatus, number>;
  contacted: number;
  raised: number;
  /** Per group: donors, messaged, replied (or gave), gave. */
  groups: { group: string; total: number; contacted: number; replied: number; gave: number }[];
}

export function donorStats(donors: Donor[]): DonorStats {
  const byStatus = { new: 0, sent: 0, replied: 0, donated: 0, no: 0 } as Record<DonorStatus, number>;
  const groups = new Map<string, DonorStats["groups"][number]>();
  let raised = 0;
  for (const d of donors) {
    byStatus[d.status]++;
    raised += d.amount ?? 0;
    const g = groups.get(d.group) ?? { group: d.group, total: 0, contacted: 0, replied: 0, gave: 0 };
    g.total++;
    if (d.sends > 0 || d.status !== "new") g.contacted++;
    if (d.repliedAt || d.status === "donated") g.replied++;
    if (d.status === "donated" || d.amount) g.gave++;
    groups.set(d.group, g);
  }
  return {
    total: donors.length,
    withPhone: donors.filter((d) => d.phone).length,
    byStatus,
    contacted: donors.filter((d) => d.sends > 0 || d.status !== "new").length,
    raised,
    groups: [...groups.values()].sort((a, b) => b.total - a.total),
  };
}

/** Plain, true suggestions from the numbers. Used alone when AI is off, and as facts for the AI. */
export function ruleIdeas(donors: Donor[], now: number): string[] {
  const s = donorStats(donors);
  const picks = donors.map((d) => pickFor(d, now)).filter((p): p is Pick => !!p);
  const count = (why: PickWhy) => picks.filter((p) => p.why === why).length;
  const ideas: string[] = [];
  if (count("followup")) ideas.push(`${count("followup")} donors replied but have not given yet. Answer them first today — they are the most likely to give.`);
  if (count("again")) ideas.push(`${count("again")} donors gave over a month ago. Thank them and ask again.`);
  if (count("reminder")) ideas.push(`${count("reminder")} donors did not reply for ${REMIND_AFTER_DAYS}+ days. Send one gentle reminder.`);
  const freshPhones = donors.filter((d) => d.status === "new" && d.phone).length;
  if (freshPhones) ideas.push(`${freshPhones} donors have a WhatsApp number and no message yet. Start with them: one tap each.`);
  const noPhone = s.total - s.withPhone;
  if (noPhone) ideas.push(`${noPhone} donors have no phone number. Add numbers in the donor hub so messages go out faster.`);
  if (!s.byStatus.donated && !s.raised) ideas.push("No gifts are marked yet. Tap “Gave” when someone donates, so I can learn who gives.");
  const best = s.groups.filter((g) => g.contacted >= 5).sort((a, b) => b.replied / b.contacted - a.replied / a.contacted)[0];
  if (best && best.replied) ideas.push(`${best.group} replies best (${best.replied} of ${best.contacted}). Message more of them.`);
  return ideas.slice(0, 5);
}
