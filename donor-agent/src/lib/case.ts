/**
 * Case texts by the GiveLife writing guide. Code builds the fixed blocks, the numbers and the checks;
 * the AI only writes the hook and the story lines, and code throws them away if they break a rule.
 */
import { llm, parseJson } from "./llm";
import {
  BANNED, CLAIM_WORDS, DEADLINE_WORDS, DIVIDER, PAY_BLOCK, PAY_NUMBER, PAY_SHORT, PROOF_ASK, REFERENCE, RETURN_LINE, SIGN_OFF, TYPE_LABEL, VERSES,
} from "./case-guide";
import { parseAmount } from "./money";
import type { CaseFacts, CaseFile, CasePost, CaseType } from "./types";

const TYPES: CaseType[] = ["child", "adult", "death", "orphans", "needs"];
export const MAX_PEOPLE = 25;

// ---------- numbers ----------

/** 19000 -> "19k", 17400 -> "17.4k", 950 -> "950". An amount like 19,950 stays exact ("19,950"), never rounded up. */
export function k(n: number): string {
  const r = Math.round(n);
  if (r < 1000 || r % 100 !== 0) return r.toLocaleString("en-US");
  return `${r / 1000}k`;
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

const rupees = (v: unknown, max: number) => {
  const n = parseAmount(v);
  return n && n <= max ? n : undefined;
};

/** Clean facts from the form. Anything odd is dropped, never invented. */
export function cleanFacts(raw: Record<string, unknown>): Partial<CaseFacts> {
  const doctor = str(raw.doctorLine, 200).replace(/^(?:the\s+)?doctors?\s+(?:said|say|says|told us|have said)\s*(?:that\s*)?:?\s*/i, "").replace(/[.\s]+$/, "");
  const items = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[]).map((i) => ({ item: str(i?.item, 40), period: str(i?.period, 30) || undefined, amount: rupees(i?.amount, 10_000_000) ?? 0 })).filter((i) => i.item && i.amount).slice(0, 8)
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
    amountLeft: rupees(raw.amountLeft, 100_000_000) ?? 0,
    askAmount: rupees(raw.askAmount, 1_000_000) ?? 0,
    deadline: str(raw.deadline, 60) || undefined,
    items: items.length ? items : undefined,
    familySaidPain: raw.familySaidPain === true,
  };
}

/** All numbers written in the details: "26,000", "26k", "2000". Used to check the AI did not invent amounts. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|hazar|hazaar|lakhs?\b|lac\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(m[2] ? Math.round(n * (/^la/i.test(m[2]) ? 100_000 : 1000)) : n);
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

/** Words that make a post read like a form or a report. */
const HARD = /^(?:unfortunately|currently|approximately|assistance|financial|condition|situation|individual|requires?|required|immediate(?:ly)?|extremely|desperately|severely|therefore|however|regarding|kindly|deteriorat\w*|undergo\w*|treatment's)$/i;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
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
  // Extremely easy English: short sentences, words a 10-year-old knows.
  const longest = Math.max(...sentences(line).map((x) => words(x).length));
  if (longest > (part === "hook" ? 12 : 16)) p.push("sentence too long");
  if (part === "story" && words(sentences(line)[0] ?? "").length > 14) p.push("first sentence too long");
  const knownWords = `${known} ${f.name} ${f.city ?? ""}`.toLowerCase();
  for (const w of line.match(/[A-Za-z']+/g) ?? []) if ((w.length >= 11 || HARD.test(w)) && !knownWords.includes(w.toLowerCase())) p.push(`hard word “${w}”`);
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

/** How strongly an opening stops a scrolling reader. Short punches, "you", the thing at risk, present tense. */
export function gripScore(hook: string, story: string, f: CaseFacts): number {
  let score = 10 - Math.max(0, words(hook).length - 14);
  if (/\byou(?:r)?\b/i.test(hook)) score += 2;
  if (sentences(hook).some((x) => words(x).length <= 5)) score += 2;
  if (f.riskWord && hook.includes(f.riskWord.toUpperCase())) score += 1;
  if (/\b(?:is|are|cannot|can't)\b/i.test(hook)) score += 1;
  if (words(sentences(story)[0] ?? "").length <= 10) score += 1;
  if (/\bmoney\b/i.test(hook) && !/not about money/i.test(hook)) score -= 2;
  return score;
}

export interface Opening { hook: string; story: string }

/**
 * The AI writes 4 openings, each with a different mind trigger. Code drops any that break a rule
 * (new claims, hard words, long sentences, copies), ranks the rest, and keeps the best 3.
 * With no good AI opening, the guide's formula is used.
 */
export async function writeLines(f: CaseFacts, recentHooks: string[]): Promise<{ hook: string; story: string; options: Opening[]; by: "ai" | "rules"; dropped: string[] }> {
  const dropped: string[] = [];
  const r = await llm(
    "You write the first 2 lines of a WhatsApp donation post for GiveLife Foundation (Pakistan). People scroll fast. These 2 lines must STOP them, hold their mind, and make them feel they must give NOW.\n" +
      "ENGLISH: extremely easy. Words a 10-year-old knows. Sentences of 3 to 10 words. Present tense. No long words, no report words (condition, situation, financial, assistance, currently, unfortunately).\n" +
      "LINE 1 (hook): the WhatsApp preview line. Name the LOSS, never the money. Max 2 short sentences. Exactly ONE word in CAPITALS: the thing at risk. No emoji, no numbers except age, no * or _, no 'please'.\n" +
      `LINE 2 (story): 1-2 sentences. The first sentence is one picture the reader can SEE (the body, the home, the child), max 10 words.${medical(f.type) ? " Start with 'Helpless NAME' or 'Little NAME'." : ""}` +
      `${f.illness ? " Include the illness name with its meaning in easy words in brackets." : ""} Do NOT write what doctors said (the app adds it). No emoji, no * or _.\n` +
      "Write 4 openings. Each uses a different trigger:\n" +
      "1. loss: what will be lost, and put the choice on the reader ('You decide.').\n" +
      "2. contrast: the reader's normal moment next to this person's moment.\n" +
      "3. now: one true picture of what is happening right now.\n" +
      "4. you: break 'someone else will help' — speak to the reader directly.\n" +
      "HONESTY (strict): use ONLY the facts given. Never add a claim, a time, a number, a danger or a feeling that is not in the facts. Never use: kindly, request, generous, contribution, needy. " +
      "The style examples are from OLD cases: learn the style, NEVER copy them. Do not repeat the recent hooks.\n" +
      'Return ONLY JSON: {"openings":[{"trigger":"loss","hook":"...","story":"..."}, ...]}',
    JSON.stringify({ facts: f, case_type: TYPE_LABEL[f.type], style_examples_do_not_copy: REFERENCE[f.type], recent_hooks_do_not_repeat: recentHooks }),
    { json: true },
  );
  const j = parseJson<{ openings?: unknown; hook?: unknown; story?: unknown }>(r.text);
  const raw = Array.isArray(j?.openings) ? (j!.openings as Record<string, unknown>[]) : j ? [j as Record<string, unknown>] : [];
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const good: (Opening & { score: number })[] = [];
  const goodStories: string[] = [];
  for (const o of raw.slice(0, 6)) {
    const hook = clean(o?.hook);
    const story = clean(o?.story);
    const hp = lineProblems(hook, f, "hook", recentHooks);
    const sp = lineProblems(story, f, "story");
    if (!sp.length) goodStories.push(story);
    if (hp.length) dropped.push(`AI opening dropped: “${hook.slice(0, 60)}” (${hp.join(", ")})`);
    else if (sp.length) dropped.push(`AI story dropped (${sp.join(", ")})`);
    if (!hp.length) good.push({ hook, story: sp.length ? goodStories[0] ?? fallbackStory(f) : story, score: 0 });
  }
  for (const g of good) g.score = gripScore(g.hook, g.story, f);
  good.sort((a, b) => b.score - a.score);
  const options = good.filter((g, i) => good.findIndex((x) => similarity(x.hook, g.hook) >= 0.8) === i).slice(0, 3).map(({ hook, story }) => ({ hook, story }));
  if (options.length) return { ...options[0], options, by: "ai", dropped };
  const hook = fallbackHooks(f).find((h) => !recentHooks.some((x) => similarity(x, h) >= 0.6)) ?? fallbackHooks(f)[0];
  return { hook, story: goodStories[0] ?? fallbackStory(f), options: [], by: "rules", dropped };
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
  const him = f.type === "orphans" || f.type === "needs" ? f.name : pron(f).him;
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
  if (kind !== "closing") add(f.amountLeft > 0, "Amount left is more than 0 (else close the case)");
  for (const m of text.matchAll(/(\d+) (?:kind )?(?:people|person) (?:donating|at) ([\d,]+)|Just ([\d,]+) by (\d+) kind people/g)) {
    const n = Number(m[1] ?? m[4]);
    const ask = Number((m[2] ?? m[3]).replace(/,/g, ""));
    add(n * ask >= f.amountLeft && (n - 1) * ask < f.amountLeft, `${n} × ${money(ask)} covers Rs ${money(f.amountLeft)} exactly`);
  }
  for (const m of text.matchAll(/([\d.]+k|[\d,]+) (?:remaining|left|is left)/g)) add(m[1] === k(f.amountLeft), `Amount matches the latest (${k(f.amountLeft)})`);
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
