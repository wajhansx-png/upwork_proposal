/**
 * The group plan. The manager lines up what Areeba posts in the WhatsApp groups and when:
 * first the full case, then short emotional texts. At each time she gets a push and the text
 * on a WhatsApp-like screen (/areeba/posts) with Copy and "I posted it". If she is late, she is pushed
 * every 10 minutes (not at night) and the manager is told once. Everything stops when the case is closed.
 */
import { llm, parseJson } from "./llm";
import { BANNED, CLAIM_WORDS, DEADLINE_WORDS, PAY_SHORT, REFERENCE, TYPE_LABEL } from "./case-guide";
import { caseText, fitAsk, k, numbersIn, reminderText, similarity } from "./case";
import { quietUntil } from "./quiet";
import type { CaseFacts, CaseFile, Db, GroupPost } from "./types";

const MIN = 60_000;
export const NUDGE_EVERY = 10 * MIN;
export const TELL_MANAGER_AFTER = 30 * MIN;
export const MAX_PLAN = 20;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
const iso = (t: number) => new Date(t).toISOString();

export const openCaseOf = (d: Pick<Db, "cases">): CaseFile | null => [...(d.cases ?? [])].reverse().find((c) => c.status === "open") ?? null;

/** The last line of every emotional text: the amount left and how to pay. Made fresh, so the amount is current. */
export const payLine = (c: CaseFile) => `${c.facts.amountLeft > 0 ? `${k(c.facts.amountLeft)} left — ` : ""}${PAY_SHORT} @all`;

/** What she should post for this item right now. */
export const postText = (c: CaseFile, p: GroupPost) => (p.kind === "case" ? p.text.trim() || c.ownText || caseText(c) : p.text.includes(PAY_SHORT) ? p.text : `${p.text.trim()}\n\n${payLine(c)}`);

/** Is the plan still waiting on anything? (A text not sent yet, or sent but not posted.) */
export const planPending = (c: CaseFile | null) => !!c && c.status === "open" && (c.plan ?? []).some((p) => !p.doneAt);

// ---------- emotional lines ----------

const factsText = (f: CaseFacts) =>
  [f.problem, f.illness, f.illnessMeaning, f.worstRisk, f.doctorLine, f.deadline, f.proof, f.age, f.city, f.amountLeft, f.askAmount, ...(f.items ?? []).map((i) => `${i.item} ${i.period ?? ""} ${i.amount}`)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);

/** Problems with one emotional text, or [] when it is fine. Same honesty rules as the case post. */
export function emotionalProblems(text: string, f: CaseFacts, others: string[] = [], extraFacts = ""): string[] {
  const p: string[] = [];
  const t = text.trim();
  if (!t) return ["empty"];
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.length > 4) p.push("more than 3 lines");
  if (words(t).length > 50) p.push("too long");
  if (BANNED.test(t)) p.push("begging word");
  if (!f.deadline && DEADLINE_WORDS.test(t)) p.push("deadline word with no real deadline");
  const known = `${factsText(f)} ${extraFacts.toLowerCase()}`;
  // "Help today" is a call to act, not a claim about the case.
  for (const m of t.matchAll(CLAIM_WORDS)) if (m[0].toLowerCase() !== "today" && !known.includes(m[0].toLowerCase().replace(/s$/, ""))) p.push(`new claim “${m[0]}”`);
  const a = fitAsk(f.amountLeft, f.askAmount);
  const allowed = new Set([String(f.age ?? ""), ...numbersIn(known).map(String), String(f.amountLeft), String(f.askAmount), String(a.n), String(a.ask)]);
  for (const m of t.matchAll(/\d[\d,.]*k?/gi)) {
    const raw = m[0].replace(/[,.]$/, "").replace(/,/g, "").toLowerCase();
    const n = raw.endsWith("k") ? String(Math.round(Number(raw.slice(0, -1)) * 1000)) : raw;
    if (!allowed.has(n)) p.push(`number ${m[0]} not in the facts`);
  }
  if (/[*_~]/.test(t)) p.push("formatting marks");
  if (Object.values(REFERENCE).flat().some((r) => similarity(r, t) >= 0.8)) p.push("copied from an old case");
  if (others.some((o) => similarity(o, t) >= 0.7)) p.push("too close to another version");
  return [...new Set(p)];
}

/** Lines from the guide's formulas, used when the AI is off or all its lines break a rule. */
export function fallbackLines(c: CaseFile): string[] {
  const f = c.facts;
  const out = [
    `${f.name} is still waiting.\nEvery moment matters for ${f.gender === "f" ? "her" : "him"} and the family.\nYour small part can end this wait.`,
    `Think of your own family for one second.\nNow think of ${f.name}'s family right now.\nAllah has put this chance in front of you.`,
    `Many have seen this case.\nVery few have helped.\nBe one of the few today.`,
    // "N people × amount": only for the app's own case text. His own text has his own numbers, and this must never contradict them.
    ...(c.ownText ? [] : [reminderText(c, "people").replace(/[*_]/g, "").replace(/\s*@all\s*$/, "")]),
    ...(f.familySaidPain ? [reminderText(c, "feeling")] : []),
    `As Muslims, we should unite for ${f.name}.\nGive whatever you can, brothers and sisters.`,
  ];
  return out.filter((x) => !emotionalProblems(x, f, [], c.ownText).length).slice(0, 5);
}

/**
 * Five short emotional texts for the groups, in the foundation's voice. The AI writes them; code drops any that
 * break an honesty or style rule. With no AI (or too few good lines), the guide's formula lines fill the gap.
 */
export async function emotionalLines(c: CaseFile): Promise<{ lines: string[]; by: "ai" | "rules"; dropped: string[] }> {
  const f = c.facts;
  const used = (c.plan ?? []).filter((p) => p.kind === "line").map((p) => p.text);
  const ownCase = (c.plan ?? []).find((p) => p.kind === "case" && p.text.trim())?.text ?? c.ownText;
  const r = await llm(
    "You write short follow-up texts for WhatsApp groups for GiveLife Foundation (Pakistan), run by Wajdan Khan. The full case was already posted; donations are slow. " +
      "Each text must make a busy reader stop, feel it in the heart, and give NOW.\n" +
      "ENGLISH: extremely easy. Words a 10-year-old knows. 2 or 3 short lines. Each line 3 to 12 words. Present tense.\n" +
      "VOICE: warm, Muslim, direct, like a brother talking to brothers and sisters. You may use 'Allah', 'dua', 'Muslims', 'brothers/sisters'. At most ONE emoji per text (💔 or 🤲), at the end of a line.\n" +
      "Write 5 texts. Each uses a different trigger:\n" +
      "1. waiting: the person is still waiting while we scroll.\n" +
      "2. mirror: imagine it was your own mother/child/family.\n" +
      "3. few: many saw it, few helped; be one of the few.\n" +
      "4. chance: Allah gives this chance; reward and dua.\n" +
      "5. small: how small each person's part is next to what it saves.\n" +
      "HONESTY (strict): use ONLY the facts given. Never add a claim, a time, a number, a danger or a feeling not in the facts. No deadline unless the facts give one. " +
      "Never use: kindly, request, generous, contribution, needy. No * or _ marks. Do NOT write the payment number or the amount; the app adds that line.\n" +
      "The style examples are from OLD cases: learn the style, NEVER copy them. Do not repeat the texts already used.\n" +
      'Return ONLY JSON: {"texts":["line 1\\nline 2", ...]}',
    JSON.stringify({ facts: f, ...(ownCase ? { case_post_already_sent_use_only_these_facts: ownCase } : {}), case_type: TYPE_LABEL[f.type], style_examples_do_not_copy: REFERENCE[f.type], already_used_do_not_repeat: used }),
    { json: true },
  );
  const j = parseJson<{ texts?: unknown }>(r.text);
  const raw = Array.isArray(j?.texts) ? (j!.texts as unknown[]) : [];
  const good: string[] = [];
  const dropped: string[] = [];
  for (const x of raw.slice(0, 8)) {
    const t = typeof x === "string" ? x.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") : "";
    const p = emotionalProblems(t, f, [...good, ...used], ownCase);
    if (p.length) dropped.push(`Dropped: “${t.slice(0, 50)}” (${p.join(", ")})`);
    else good.push(t);
  }
  const by = good.length ? "ai" : "rules";
  for (const fb of fallbackLines(c)) {
    if (good.length >= 5) break;
    if (![...good, ...used].some((g) => similarity(g, fb) >= 0.7)) good.push(fb);
  }
  return { lines: good.slice(0, 5), by, dropped };
}

// ---------- the plan ----------

export type PlanChange =
  | { action: "add"; kind: GroupPost["kind"]; text?: string; at: string; id: string }
  | { action: "edit"; id: string; text?: string; at?: string }
  | { action: "remove"; id: string }
  | { action: "now"; id: string };

/** Apply one manager change to the open case's plan. Returns an error in plain words, or null. */
export function changePlan(d: Db, ch: PlanChange, now: number): string | null {
  const c = openCaseOf(d);
  if (!c) return "There is no open case. Write a case first.";
  c.plan ??= [];
  if (ch.action === "add") {
    if (c.plan.length >= MAX_PLAN) return `The plan can have ${MAX_PLAN} messages at most.`;
    const at = ms(ch.at);
    if (!at || Number.isNaN(at)) return "Pick a time.";
    if (ch.kind === "case" && c.plan.some((p) => p.kind === "case" && !p.doneAt)) return "The case post is already in the plan.";
    // A case post can be the manager's own text, kept exactly as he wrote it. Empty = the app's case text.
    const text = String(ch.text ?? "").trim().slice(0, ch.kind === "case" ? 5000 : 1500);
    if (ch.kind === "line") {
      if (!text) return "Write the text first.";
      const bad = emotionalProblems(text.replace(PAY_SHORT, ""), c.facts, [], c.ownText).filter((x) => !x.startsWith("too close"));
      if (bad.some((x) => x.startsWith("new claim") || x.startsWith("deadline") || x === "begging word")) return `This text breaks a rule: ${bad[0]}.`;
    }
    c.plan.push({ id: ch.id, kind: ch.kind, text, at: iso(Math.max(at, now)) });
  } else {
    const p = c.plan.find((x) => x.id === ch.id);
    if (!p) return "That message is not in the plan.";
    if (ch.action === "remove") {
      if (p.sentAt && !p.doneAt) return "Areeba already has this one. It stays until she posts it.";
      c.plan = c.plan.filter((x) => x.id !== ch.id);
    } else {
      if (p.sentAt) return "Areeba already got this one. It cannot change now.";
      if (ch.action === "now") p.at = iso(now);
      else {
        if (ch.text !== undefined) {
          const text = ch.text.trim().slice(0, p.kind === "case" ? 5000 : 1500);
          if (!text && p.kind === "line") return "The text is empty.";
          p.text = text;
        }
        if (ch.at !== undefined) {
          const at = ms(ch.at);
          if (!at || Number.isNaN(at)) return "Pick a time.";
          p.at = iso(Math.max(at, now));
        }
      }
    }
  }
  c.plan.sort((a, b) => ms(a.at) - ms(b.at));
  return null;
}

export interface PlanPush { role: "teammate" | "manager"; title: string; body: string; tag: string; url: string; persistent?: boolean }

/**
 * The clock's work, once a minute: send every message whose time came, push her when one waits too long,
 * and tell the manager once when she is 30 minutes late. Pure: changes the db and returns the pushes.
 */
export function runPlan(d: Db, now: number): PlanPush[] {
  const c = openCaseOf(d);
  const pushes: PlanPush[] = [];
  if (!c?.plan?.length) return pushes;
  const name = d.settings.teammateName;
  const n = (p: GroupPost) => c.plan!.indexOf(p) + 1;
  for (const p of c.plan) {
    if (p.doneAt) continue;
    if (!p.sentAt) {
      if (ms(p.at) > now) continue;
      p.sentAt = iso(now);
      p.shownText = postText(c, p);
      pushes.push({
        role: "teammate",
        title: p.kind === "case" ? "📢 Post the case in all groups" : "📢 New group message",
        body: `${p.shownText.split("\n").find((l) => l.trim())?.replace(/[*_]/g, "").slice(0, 90) ?? ""}\nOpen, copy, and post it in all groups.`,
        tag: `grp-${p.id}`,
        url: "/areeba/posts",
        persistent: true,
      });
      continue;
    }
    const waited = now - ms(p.sentAt);
    if (!p.lateToldAt && waited >= TELL_MANAGER_AFTER) {
      p.lateToldAt = iso(now);
      pushes.push({ role: "manager", title: "Group message not posted", body: `${name} has not posted group message ${n(p)} yet (${Math.round(waited / MIN)} min).`, tag: `grp-late-${p.id}`, url: "/manager/case" });
    }
    const quiet = quietUntil(d.settings, now, Number.MAX_SAFE_INTEGER);
    if (!quiet && now - Math.max(ms(p.sentAt), ms(p.lastNudgeAt)) >= NUDGE_EVERY) {
      p.lastNudgeAt = iso(now);
      p.nudges = (p.nudges ?? 0) + 1;
      pushes.push({ role: "teammate", title: "Group message waiting", body: `Group message ${n(p)} is not posted yet. Please post it in all groups now.`, tag: `grp-${p.id}`, url: "/areeba/posts", persistent: true });
    }
  }
  return pushes;
}

/** Her tap: "I posted it in all groups". */
export function markPosted(d: Db, id: string, now: number): string | null {
  const c = openCaseOf(d);
  const p = c?.plan?.find((x) => x.id === id);
  if (!c || !p || !p.sentAt) return "That message is not here.";
  if (!p.doneAt) p.doneAt = iso(now);
  return null;
}

/** What each screen sees. Areeba sees only messages whose time came; never the text of later ones. */
export function planView(d: Db, role: "manager" | "teammate", now: number) {
  const c = openCaseOf(d);
  if (!c) return { caseName: null, items: [], next: null };
  const plan = c.plan ?? [];
  if (role === "manager")
    return {
      caseName: c.facts.name,
      amountLeft: c.facts.amountLeft,
      payLine: payLine(c),
      items: plan.map((p, i) => ({ ...p, n: i + 1, preview: p.shownText ?? postText(c, p), state: p.doneAt ? "posted" : p.sentAt ? "waiting" : "planned" })),
      next: null,
    };
  const upcoming = plan.filter((p) => !p.sentAt && ms(p.at) > now);
  return {
    caseName: c.facts.name,
    items: plan.filter((p) => p.sentAt).map((p) => ({ id: p.id, n: plan.indexOf(p) + 1, kind: p.kind, text: p.shownText ?? "", sentAt: p.sentAt, doneAt: p.doneAt })),
    next: upcoming[0]?.at ?? null,
  };
}
