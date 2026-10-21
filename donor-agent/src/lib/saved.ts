/**
 * Saved messages. The manager saves ready texts (the case post, short emotional texts); Areeba sees the same list
 * on her screen and copies or shares them when she posts in the groups. No times, no pushes.
 * The AI can suggest 5 short texts for the open case; code drops any with new claims, made-up numbers, deadlines
 * or begging words, and fills gaps with ready-made lines.
 */
import { llm, parseJson } from "./llm";
import { BANNED, CLAIM_WORDS, DEADLINE_WORDS, PAY_SHORT, REFERENCE, TYPE_LABEL } from "./case-guide";
import { fitAsk, k, numbersIn, reminderText, similarity } from "./case";
import type { CaseFacts, CaseFile, Db } from "./types";

export const MAX_SAVED = 50;

export const openCaseOf = (d: Pick<Db, "cases">): CaseFile | null => [...(d.cases ?? [])].reverse().find((c) => c.status === "open") ?? null;

/** The last line of a short text: the amount left and how to pay. */
export const payLine = (c: CaseFile) => `${c.facts.amountLeft > 0 ? `${k(c.facts.amountLeft)} left — ` : ""}${PAY_SHORT} @all`;

/** A suggestion as it will be saved: the short text + the pay line. */
export const withPayLine = (c: CaseFile, text: string) => (text.includes(PAY_SHORT) ? text.trim() : `${text.trim()}\n\n${payLine(c)}`);

// ---------- the list ----------

export function saveMessage(d: Db, text: string, id: string, now: number): string | null {
  const t = text.replace(/\r/g, "").trim().slice(0, 5000);
  if (!t) return "Write the message first.";
  d.saved ??= [];
  if (d.saved.some((m) => m.text === t)) return "This message is already saved.";
  d.saved.unshift({ id, text: t, at: new Date(now).toISOString() });
  d.saved = d.saved.slice(0, MAX_SAVED);
  return null;
}

export function removeMessage(d: Db, id: string): string | null {
  const before = d.saved?.length ?? 0;
  d.saved = (d.saved ?? []).filter((m) => m.id !== id);
  return d.saved.length === before ? "That message is already gone." : null;
}

/** Areeba tapped Copy or Share: the manager can see it was used. */
export function markUsed(d: Db, id: string, now: number): string | null {
  const m = d.saved?.find((x) => x.id === id);
  if (!m) return "That message is gone.";
  m.usedAt = new Date(now).toISOString();
  m.uses = (m.uses ?? 0) + 1;
  return null;
}

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
export async function emotionalLines(c: CaseFile, used: string[] = []): Promise<{ lines: string[]; by: "ai" | "rules"; dropped: string[] }> {
  const f = c.facts;
  const ownCase = c.ownText;
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
