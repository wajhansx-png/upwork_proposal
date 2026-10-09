/**
 * Case texts by the GiveLife writing guide. Code builds the fixed blocks, the numbers and the checks;
 * the AI only writes the hook and the story lines, and code throws them away if they break a rule.
 */
import { llm, parseJson } from "./llm";
import {
  BANNED, CLAIM_WORDS, DEADLINE_WORDS, DIVIDER, PAY_BLOCK, PAY_NUMBER, PAY_SHORT, PROOF_ASK, REFERENCE, RETURN_LINE, SIGN_OFF, TYPE_LABEL, VERSES,
} from "./case-guide";
import type { CaseFacts, CaseFile, CasePost, CaseType } from "./types";

const TYPES: CaseType[] = ["child", "adult", "death", "orphans", "needs"];
export const MAX_PEOPLE = 25;

// ---------- numbers ----------

/** 19000 -> "19k", 17400 -> "17.4k", 950 -> "950". */
export function k(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return `${Math.round(n / 100) / 10}k`;
}
export const money = (n: number) => Math.round(n).toLocaleString("en-US");
export const peopleNeeded = (left: number, ask: number) => Math.ceil(left / ask);

/** N people at the ask amount. If N is over 25, a bigger ask keeps the goal small; if nothing fits, "any amount". */
export function fitAsk(left: number, ask: number): { ask: number; n: number; raised: boolean; any: boolean } {
  if (peopleNeeded(left, ask) <= MAX_PEOPLE) return { ask, n: peopleNeeded(left, ask), raised: false, any: false };
  for (const a of [1500, 2000, 3000, 5000]) if (a > ask && peopleNeeded(left, a) <= MAX_PEOPLE) return { ask: a, n: peopleNeeded(left, a), raised: true, any: false };
  return { ask, n: peopleNeeded(left, ask), raised: false, any: true };
}

export const itemsTotal = (f: CaseFacts) => (f.items ?? []).reduce((s, i) => s + i.amount, 0);

/** Unicode bold for the closing title only. */
export function boldUnicode(s: string): string {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
    return ch;
  }).join("");
}

const medical = (t: CaseType) => t === "child" || t === "adult";
const pron = (f: CaseFacts) => (f.gender === "f" ? { he: "she", He: "She", his: "her", him: "her" } : { he: "he", He: "He", his: "his", him: "him" });

/** What the money does, for the ask lines. */
function goal(f: CaseFacts, who = f.name): string {
  if (f.type === "death") return `give ${who} a dignified farewell`;
  if (medical(f.type)) return `save ${who}`;
  return `help ${who}`;
}

// ---------- facts ----------

export const REQUIRED: { key: keyof CaseFacts; label: string; medicalOnly?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "problem", label: "What is happening (easy words)" },
  { key: "worstRisk", label: "What will be lost (the doctor's words)", medicalOnly: true },
  { key: "doctorLine", label: "What the doctor said (real words)", medicalOnly: true },
  { key: "proof", label: "Proof you have (report, hospital)" },
  { key: "amountLeft", label: "Amount left (Rs)" },
  { key: "askAmount", label: "Ask per person (Rs)" },
];

export function missingFacts(f: Partial<CaseFacts>): string[] {
  const type = f.type ?? "child";
  return REQUIRED.filter((r) => (!r.medicalOnly || medical(type)) && !(typeof f[r.key] === "number" ? (f[r.key] as number) > 0 : String(f[r.key] ?? "").trim())).map((r) => r.label);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, max: number) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n) : undefined;
};

/** Clean facts from the form. Anything odd is dropped, never invented. */
export function cleanFacts(raw: Record<string, unknown>): Partial<CaseFacts> {
  const doctor = str(raw.doctorLine, 200).replace(/^(?:the\s+)?doctors?\s+(?:said|say|says|told us|have said)\s*(?:that\s*)?:?\s*/i, "").replace(/[.\s]+$/, "");
  const items = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[]).map((i) => ({ item: str(i?.item, 40), period: str(i?.period, 30) || undefined, amount: num(i?.amount, 10_000_000) ?? 0 })).filter((i) => i.item && i.amount).slice(0, 8)
    : [];
  return {
    type: TYPES.includes(raw.type as CaseType) ? (raw.type as CaseType) : "child",
    name: str(raw.name, 40),
    gender: raw.gender === "f" ? "f" : "m",
    age: num(raw.age, 120),
    city: str(raw.city, 40) || undefined,
    problem: str(raw.problem, 300).replace(/[.\s]+$/, ""),
    illness: str(raw.illness, 60) || undefined,
    illnessMeaning: str(raw.illnessMeaning, 80).replace(/^\(|\)$/g, "") || undefined,
    worstRisk: str(raw.worstRisk, 120).replace(/[.\s]+$/, "") || undefined,
    riskWord: str(raw.riskWord, 20).replace(/[^A-Za-z]/g, "").toUpperCase() || undefined,
    doctorLine: doctor || undefined,
    proof: str(raw.proof, 140).replace(/\s+attached$/i, ""),
    amountLeft: num(raw.amountLeft, 100_000_000) ?? 0,
    askAmount: num(raw.askAmount, 1_000_000) ?? 0,
    deadline: str(raw.deadline, 60) || undefined,
    items: items.length ? items : undefined,
    familySaidPain: raw.familySaidPain === true,
  };
}

/** All numbers written in the details: "26,000", "26k", "2000". Used to check the AI did not invent amounts. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|hazar|hazaar)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(m[2] ? Math.round(n * 1000) : n);
  }
  return out;
}

/** The AI reads free text (English or Urdu) into the guide's inputs. Numbers and names must be in the text. */
export async function readDetails(details: string): Promise<{ facts: Partial<CaseFacts>; missing: string[]; notes: string[]; by: "ai" | "rules" }> {
  const text = details.slice(0, 4000);
  const nums = numbersIn(text);
  const notes: string[] = [];
  const r = await llm(
    "You read case details for GiveLife Foundation, a charity in Pakistan. The details may be in English, Urdu or Roman Urdu. " +
      "Return ONLY JSON with these keys. Use null for anything the details do not say. NEVER guess or invent.\n" +
      `type: one of ${TYPES.join(", ")} (child = sick child, adult = sick adult or elder, death = janazah/burial, orphans = orphans or family lost the earner, needs = fan, ration, rent).\n` +
      "name: real first name (or 'this family'). gender: 'm' or 'f'. age: number. city.\n" +
      "problem: what is happening, in very easy English a Class 8 reader understands, body words not medical words, max 20 words. For child/adult it must complete the sentence 'Helpless NAME is ...' (do not include the name or 'is'). For other types write one plain sentence.\n" +
      "illness: the illness name if given. illnessMeaning: what it means in 3-6 easy words (only if illness is given).\n" +
      "worstRisk: what can be lost if no help, only as said in the details. riskWord: ONE word for the thing at risk (LEG, KIDNEY, LIFE, HOME).\n" +
      "doctorLine: what the doctors said, close to their real words, never stronger. null if the details do not say what a doctor said.\n" +
      "proof: the documents/hospital named. amountLeft: money still needed (number). askAmount: amount per person if given.\n" +
      "deadline: only a real deadline given by the hospital or family. items: [{item, period, amount}] if costs are listed. familySaidPain: true only if the family said the pain is getting worse.",
    text,
    { json: true },
  );
  const j = parseJson<Record<string, unknown>>(r.text);
  if (!j) {
    // No AI: take only what plain rules can find for sure.
    const left = /(\d[\d,]*(?:\.\d+)?\s*k?)\s*(?:rs\.?|pkr)?\s*(?:left|remaining|needed|required|baqi)/i.exec(text);
    const facts = cleanFacts({ amountLeft: left ? numbersIn(left[1])[0] : undefined });
    return { facts, missing: missingFacts(facts), notes: ["The AI is not available. Please fill in the boxes."], by: "rules" };
  }
  const facts = cleanFacts(j);
  // A name or number the details never mention is a guess. Drop it.
  if (facts.name && !text.toLowerCase().includes(facts.name.toLowerCase().split(" ")[0]) && facts.name !== "this family") facts.name = "";
  for (const key of ["amountLeft", "askAmount", "age"] as const) {
    const v = facts[key];
    if (v && !nums.includes(v)) {
      if (key === "age") facts.age = undefined;
      else facts[key] = 0;
    }
  }
  if (facts.items) facts.items = facts.items.filter((i) => nums.includes(i.amount));
  if (facts.doctorLine && !/doctor|dr\b|daktar|dactor|hospital|specialist|surgeon/i.test(text)) facts.doctorLine = undefined;
  if (facts.deadline && !/\d|today|tonight|tomorrow|aaj|kal|subah|shaam|sham|raat/i.test(text)) facts.deadline = undefined;
  if (!facts.askAmount) {
    facts.askAmount = 2000;
    notes.push("Ask per person was not given, so it is set to Rs 2,000. Change it if you want.");
  }
  if (facts.illness && facts.illnessMeaning) notes.push(`Check the meaning of “${facts.illness}”: “${facts.illnessMeaning}”. The AI wrote it.`);
  if (facts.doctorLine) notes.push("Make sure the doctor's words are real. Never make them stronger.");
  if (facts.items?.length && facts.amountLeft && itemsTotal(facts as CaseFacts) < facts.amountLeft) notes.push(`The costs add up to Rs ${money(itemsTotal(facts as CaseFacts))}, but the amount left is Rs ${money(facts.amountLeft)}. Check both.`);
  return { facts, missing: missingFacts(facts), notes, by: "ai" };
}

// ---------- the written lines (hook + story) ----------

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

const factsText = (f: CaseFacts) => [f.problem, f.illness, f.illnessMeaning, f.worstRisk, f.doctorLine, f.deadline, f.proof, f.age, f.city, ...(f.items ?? []).map((i) => `${i.item} ${i.period ?? ""}`)].filter(Boolean).join(" ").toLowerCase();

/** Problems with a written line, or [] when it is fine. */
export function lineProblems(line: string, f: CaseFacts, part: "hook" | "story", avoid: string[] = []): string[] {
  const p: string[] = [];
  if (!line.trim()) return ["empty"];
  if (/\p{Extended_Pictographic}/u.test(line)) p.push("emoji");
  if (BANNED.test(line)) p.push("begging word");
  if (!f.deadline && DEADLINE_WORDS.test(line)) p.push("deadline word with no real deadline");
  const known = factsText(f);
  for (const m of line.matchAll(CLAIM_WORDS)) if (!known.includes(m[0].toLowerCase().replace(/s$/, ""))) p.push(`new claim “${m[0]}”`);
  const allowedNums = new Set([String(f.age ?? ""), ...numbersIn(known).map(String)]);
  for (const m of line.matchAll(/\d[\d,.]*/g)) if (!allowedNums.has(m[0].replace(/[,.]$/, "").replace(/,/g, ""))) p.push(`number ${m[0]} not in the facts`);
  if (/\bdoctor/i.test(line)) p.push("doctor words are added by the app");
  if (/[*_~]/.test(line)) p.push("formatting marks");
  const all = Object.values(REFERENCE).flat();
  if (all.some((r) => similarity(r, line) >= 0.8)) p.push("copied from an old case");
  if (avoid.some((h) => similarity(h, line) >= 0.6)) p.push("too close to a recent case");
  const wc = words(line).length;
  if (part === "hook") {
    const caps = line.match(/\b[A-Z]{2,}\b/g)?.filter((w) => !["PKR", "VP", "CT", "MRI", "BP"].includes(w)) ?? [];
    if (caps.length !== 1) p.push("needs exactly 1 word in CAPITALS");
    if (wc > 28) p.push("too long");
    if (f.name && f.name !== "this family" && medical(f.type) && !line.includes(f.name) && !/\bchild|boy|girl|mother|father|man|woman\b/i.test(line)) p.push("does not say who");
  } else {
    if (wc > 45) p.push("too long");
    if (f.name && !line.toLowerCase().includes(f.name.toLowerCase().split(" ")[0])) p.push("does not name the person");
    if (f.illness && !line.toLowerCase().includes(f.illness.toLowerCase())) p.push("illness name missing");
  }
  return [...new Set(p)];
}

/** Formula hooks (Part 3 and 5), used when the AI is off or its hook breaks a rule. The first one not used recently wins. */
export function fallbackHooks(f: CaseFacts): string[] {
  const { his, He } = pron(f);
  const risk = (f.riskWord || (f.type === "death" ? "FAREWELL" : f.type === "orphans" ? "HOME" : medical(f.type) ? "LIFE" : "NEEDS")).toUpperCase();
  const who = f.type === "child" ? f.name || "a child" : f.name;
  if (f.type === "death") return [`${f.name} has passed away. Now ${his} family cannot afford ${his} ${risk}.`, `This is not about money. This is about a dignified ${risk} for ${f.name}. You decide.`];
  if (f.type === "orphans") return [`This is not about money. This is about ${f.name} keeping their ${risk}. You decide.`, `Nobody chose this for ${f.name}. Their ${risk} is at risk now.`];
  if (f.type === "needs") return [`This is not about money. This is about ${f.name} and the most basic ${risk}. You decide.`, `${f.name} is missing the most basic ${risk}. You can change that in 10 seconds.`];
  return [
    `This is not about money. This is about ${who} keeping ${his} ${risk} or losing it. You decide.`,
    `${f.type === "child" ? "A child" : f.name} is at risk of losing ${his} ${risk}. You can help stop it in 10 seconds.`,
    `We could ask you to donate. But ${f.name} needs more than money right now. ${He} needs ${his} ${risk} saved.`,
  ];
}

export function fallbackStory(f: CaseFacts): string {
  const { He } = pron(f);
  const raw = f.problem.replace(/^(?:helpless|little)\s+/i, "").replace(/[.\s]+$/, "");
  if (!medical(f.type)) return raw.toLowerCase().includes(f.name.toLowerCase()) ? `${raw[0].toUpperCase()}${raw.slice(1)}.` : `This is ${f.name}. ${raw[0].toUpperCase()}${raw.slice(1)}.`;
  const p = raw.toLowerCase().startsWith(f.name.toLowerCase()) ? raw.slice(f.name.length).trim() : raw;
  const body = /^(?:is|has|was|cannot|can't|needs|lost)\b/i.test(p) ? p : `is ${p}`;
  return f.illness ? `Helpless ${f.name} has ${f.illness}${f.illnessMeaning ? ` (${f.illnessMeaning})` : ""}. ${He} ${body}.` : `Helpless ${f.name} ${body}.`;
}

/** The AI writes a new hook and story for these facts. Bad lines are replaced by the formula lines. */
export async function writeLines(f: CaseFacts, recentHooks: string[]): Promise<{ hook: string; story: string; by: "ai" | "rules"; dropped: string[] }> {
  const dropped: string[] = [];
  const r = await llm(
    "You write the first lines of a WhatsApp donation post for GiveLife Foundation (Pakistan). Very easy English (Class 8). Short lines.\n" +
      "Write two things:\n" +
      "hook: line 1, seen in the WhatsApp preview. Name the LOSS, not the money. One or two very short sentences, max 25 words. " +
      "Exactly ONE word in CAPITALS (the thing at risk). No emoji, no numbers except age, no * or _.\n" +
      `story: 1-2 sentences of what is happening, in body words a normal person feels.${medical(f.type) ? " Start with 'Helpless NAME' or 'Little NAME'." : ""} ` +
      `${f.illness ? "Include the illness name with its meaning in brackets. " : ""}Do NOT write what doctors said (the app adds it). No emoji, no * or _.\n` +
      "Rules: use ONLY the facts given. Never add a claim, a time, a number or a danger that is not in the facts. Never use: kindly, request, generous, contribution, needy. " +
      "The style examples are from OLD cases: learn the style, but NEVER copy them. Also do not repeat the recent hooks.\n" +
      'Return ONLY JSON: {"hook":"...","story":"..."}',
    JSON.stringify({ facts: f, case_type: TYPE_LABEL[f.type], style_examples_do_not_copy: REFERENCE[f.type], recent_hooks_do_not_repeat: recentHooks }),
    { json: true },
  );
  const j = parseJson<{ hook?: unknown; story?: unknown }>(r.text);
  let hook = typeof j?.hook === "string" ? j.hook.replace(/\s+/g, " ").trim() : "";
  let story = typeof j?.story === "string" ? j.story.replace(/\s+/g, " ").trim() : "";
  let by: "ai" | "rules" = j ? "ai" : "rules";
  const hp = hook ? lineProblems(hook, f, "hook", recentHooks) : ["no AI"];
  if (hp.length) {
    if (hook) dropped.push(`AI hook dropped (${hp.join(", ")})`);
    hook = fallbackHooks(f).find((h) => !recentHooks.some((x) => similarity(x, h) >= 0.6)) ?? fallbackHooks(f)[0];
    by = "rules";
  }
  const sp = story ? lineProblems(story, f, "story") : ["no AI"];
  if (sp.length) {
    if (story) dropped.push(`AI story dropped (${sp.join(", ")})`);
    story = fallbackStory(f);
    by = "rules";
  }
  return { hook, story, by, dropped };
}

// ---------- the texts ----------

function proofLines(f: CaseFacts): string[] {
  const out = [`${f.proof} attached`];
  if (f.items?.length) {
    for (const i of f.items) out.push(`• ${i.item}${i.period ? ` — ${i.period}` : ""} — PKR ${money(i.amount)}`);
    out.push(`Total — PKR ${money(itemsTotal(f))}`);
  }
  return out;
}

function askLine(c: CaseFile, dm: boolean): string[] {
  const f = c.facts;
  const a = fitAsk(f.amountLeft, f.askAmount);
  if (a.any) return [`- *_Any amount helps ${goal(f)}_*. 🤲`, ...(dm ? ["*Can you be one of them?*"] : [])];
  const line = `- *_${a.n} kind ${a.n === 1 ? "person" : "people"} donating ${money(a.ask)} is enough to ${goal(f)}_*.`;
  return dm ? [line, `*Can you be one of the ${a.n}?* 🤲`] : [`${line} 🤲`];
}

/** The main group post (Part 4 shape). With `dm`, the one-person version (Part 8). */
export function caseText(c: CaseFile, dm?: { greet: string }): string {
  const f = c.facts;
  const doctor = medical(f.type) && f.doctorLine ? ` Doctors said ${f.doctorLine}.` : "";
  const second = f.type === "death" ? `- *Help do a Muslim ${f.gender === "f" ? "sister" : "brother"}'s janazah.*` : "- *Allah is giving you this chance.*";
  const blocks: string[][] = [
    ...(dm ? [[dm.greet]] : []),
    [`*${c.hook}*`, `_${c.story.replace(/[.\s]+$/, ".")}${doctor}_ 💔`, ...proofLines(f), DIVIDER],
    [`${VERSES[c.verse] ?? VERSES[0]} ✅`, second],
    askLine(c, !!dm),
    [RETURN_LINE],
    PAY_BLOCK,
    [PROOF_ASK],
    [dm ? SIGN_OFF : `${SIGN_OFF} @all`],
  ];
  return blocks.map((b) => b.join("\n")).join("\n\n");
}

/** "Affan Bhai," / "Iqra Behen," / "Assalam o Alaikum," for a donor with no real name. */
export const dmGreeting = (first: string, female: boolean) => (first ? `${first} ${female ? "Behen" : "Bhai"},` : "Assalam o Alaikum,");

export type ReminderKind = Exclude<CasePost["kind"], "main" | "dm" | "closing">;
const ORDER: ReminderKind[] = ["number", "people", "feeling", "proof", "tag", "unity"];

export function reminderText(c: CaseFile, kind: ReminderKind, tags: string[] = []): string {
  const f = c.facts;
  const { him } = pron(f);
  const a = fitAsk(f.amountLeft, f.askAmount);
  const left = k(f.amountLeft);
  const thisOne = f.type === "child" ? "this child" : f.name;
  switch (kind) {
    case "number":
      return `${left} remaining`;
    case "people":
      return `*_Just ${money(a.ask)} by ${a.n} kind people can ${goal(f, him)}_*\nAllah has given you a chance to ${goal(f, him)} @all`;
    case "feeling":
      return `${f.name}'s pain is becoming unbearable.\nPlease come forward asap`;
    case "unity":
      return `${left} is left.\n*As Muslims, we should unite just to help ${thisOne} by donating whatever we can, brothers/sisters*\n${PAY_SHORT}`;
    case "proof":
      return "Please send screenshot whoever donates";
    case "lastpush":
      return `Just ${left} left.\n${a.n} ${a.n === 1 ? "person" : "people"} donating ${money(a.ask)} will ${goal(f, thisOne)} 💔\nYour 10 seconds can bring someone peace @all`;
    case "tag":
      return `${tags.slice(0, 4).map((t) => `@${t}`).join(" ")}\nRequesting all donors to please consider asap`;
  }
}

/** Which reminder fits now (Part 6): a small N gets the last push; a changed number gets posted; otherwise the next type in the mix. */
export function nextReminder(c: CaseFile, tags: string[]): { kind: ReminderKind; text: string } | null {
  if (c.status !== "open" || c.facts.amountLeft <= 0) return null;
  const f = c.facts;
  const last = c.posts[c.posts.length - 1];
  const recent = c.posts.slice(-3).map((p) => p.text);
  const a = fitAsk(f.amountLeft, f.askAmount);
  const numberPosted = c.posts.some((p) => (p.kind === "number" || p.kind === "main" || p.kind === "unity" || p.kind === "lastpush") && p.amountLeft === f.amountLeft);
  const allowed = (kind: ReminderKind) =>
    kind === "lastpush" ? !a.any && a.n <= 5
      : kind === "number" || kind === "unity" ? !numberPosted
        : kind === "feeling" ? !!f.familySaidPain
          : kind === "tag" ? tags.length > 0
            : kind === "people" ? !a.any
              : true;
  const fits = (kind: ReminderKind) => {
    if (!allowed(kind) || last?.kind === kind) return null;
    const text = reminderText(c, kind, tags);
    return recent.includes(text) ? null : { kind, text };
  };
  const push = fits("lastpush");
  if (push) return push;
  const start = last ? (ORDER.indexOf(last.kind as ReminderKind) + 1) % ORDER.length : 0;
  for (let i = 0; i < ORDER.length; i++) {
    const r = fits(ORDER[(start + i) % ORDER.length]);
    if (r) return r;
  }
  return null;
}

export function closingText(c: CaseFile): string {
  const f = c.facts;
  const end = f.type === "death" ? `grant ${f.name} Jannah` : medical(f.type) ? `bring complete shifa to ${f.name}` : `make things easy for ${f.name}`;
  return [
    `${boldUnicode(`${f.name.toUpperCase()}'S CASE IS COMPLETE.`)} 🤲`,
    `Alhamdulillah, with your help we completed the full ${medical(f.type) ? "treatment " : ""}amount.`,
    "",
    "JazakAllah Khair to everyone who donated, shared, made dua, or helped in any way.",
    "",
    `May Allah accept it from you, multiply your reward, and ${end}. ❤️`,
    "Proof and updates will be shared.",
    "",
    "— GiveLife Foundation @all",
  ].join("\n");
}

// ---------- checks (Part 10) ----------

export interface Check { ok: boolean; label: string }

export function checkText(c: CaseFile, text: string, kind: CasePost["kind"]): Check[] {
  const f = c.facts;
  const out: Check[] = [];
  const add = (ok: boolean, label: string) => out.push({ ok, label });
  if (kind !== "closing") add(c.status === "open", "Case is open");
  for (const m of text.matchAll(/(\d+) (?:kind )?(?:people|person) (?:donating|at) ([\d,]+)|Just ([\d,]+) by (\d+) kind people/g)) {
    const n = Number(m[1] ?? m[4]);
    const ask = Number((m[2] ?? m[3]).replace(/,/g, ""));
    add(n * ask >= f.amountLeft && (n - 1) * ask < f.amountLeft, `${n} × ${money(ask)} covers Rs ${money(f.amountLeft)} exactly`);
  }
  for (const m of text.matchAll(/([\d.]+k|\d+) (?:remaining|left|is left)/g)) add(m[1] === k(f.amountLeft), `Amount matches the latest (${k(f.amountLeft)})`);
  add(!!f.deadline || !DEADLINE_WORDS.test(text), "No deadline words (no real deadline)");
  add(!BANNED.test(text), "No begging words");
  const phones = text.match(/\b0\d{10}\b/g) ?? [];
  add(phones.every((p) => p === PAY_NUMBER) && (!/Easypaisa/i.test(text) || phones.length > 0), `Payment number is ${PAY_NUMBER}`);
  const refs = text.match(/— (?:Qur'an|Bukhari|Muslim|Tirmidhi)\b|Allah says in the Qur'an/g) ?? [];
  add(refs.length <= 1, "Only one verse or hadith");
  if (kind === "dm") add(!/@all/.test(text), "DM has no @all");
  if (kind === "main" || kind === "dm") {
    const emoji = text.match(/\p{Extended_Pictographic}/gu) ?? [];
    add(emoji.length <= 6, `${emoji.length} emoji (max 6)`);
    add(!text.split("\n").some((l) => /^\p{Extended_Pictographic}/u.test(l) && !/^(?:⚠️|📲)/u.test(l)), "No emoji at the start of a line");
    if (f.items?.length) add(true, `Costs add up to PKR ${money(itemsTotal(f))}`);
  }
  if (kind !== "main" && kind !== "dm") add(!c.posts.slice(-3).some((p) => p.text === text), "Not the same as the last 3 posts");
  return out;
}

/** Everything the case page shows. */
export function caseView(c: CaseFile, tags: string[]) {
  const main = caseText(c);
  const sampleDm = caseText(c, { greet: dmGreeting("Ali", false) });
  const next = nextReminder(c, tags);
  const a = fitAsk(c.facts.amountLeft, c.facts.askAmount);
  return {
    case: c,
    ask: a,
    main: { text: main, checks: checkText(c, main, "main") },
    dm: { text: sampleDm, checks: checkText(c, sampleDm, "dm") },
    reminder: next ? { ...next, checks: checkText(c, next.text, next.kind) } : null,
    closing: c.status === "closed" || c.facts.amountLeft <= 0 ? { text: closingText(c) } : null,
    tags,
  };
}
