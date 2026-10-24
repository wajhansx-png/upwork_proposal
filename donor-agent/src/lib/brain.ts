/**
 * The Case Brain. During a live case the manager presses 20 minutes passed / No donations / Case complete, or types
 * the amount left; the Brain writes the next message the way he writes in his WhatsApp groups. It never sends anything.
 *
 * Every template here is taken from his real group messages (export Aug–Oct 2026, see style.ts):
 * short pushes most of the time ("Just 8k left. 4 people donating 2000 will…"), a full repost in his layout every
 * other time (bold hook, _facts_💔, ___________, Qur'an/hadith ✅, "Allah is giving you this chance", people maths,
 * "No bank gives that return", "Takes only 10 seconds", payment, team line, @all), his four update styles, his
 * "Sadly, no donations yet" escalation and his exact closing message. Unicode bold (𝗟𝗜𝗞𝗘 𝗧𝗛𝗜𝗦) as he uses it.
 *
 * Rules that stay code: the people maths (ceil left/2000, /1500, /1000), when an UPDATE is due, the verses and
 * hadiths word for word with their source, the payment lines, never the same message twice. Facts come only from
 * his case post. The AI (optional) only writes the bold hook line, shown his real messages; a hook with a new
 * number or an illness word that is not in his post is thrown away.
 */
import { llm, parseJson } from "./llm";
import { similarity } from "./case";
import { styleBlock } from "./style";
import type { Brain, BrainOut } from "./types";

export const PHONE = "03097458815";
/** His full payment lines. */
export const ENDING = `📲 ${PHONE} — Easypaisa/JazzCash\n👤 Wajdan Khan — GiveLife Foundation`;
/** His short payment line (quick posts). */
const PAY_SHORT = `Donate now:\n${PHONE} - Easypaisa/JazzCash - Wajdan Khan (GiveLife Foundation account)`;
const TEAM = "- Wajdan Khan Team - GiveLife Foundation";
const ALL = "@all";
const HOUR = 3_600_000;
const MAIN = "GiveLife Foundation";
const GROUPS = "Upwork Community 2026 and Fiverr Course 2026";

/** The verses and hadiths he uses, word for word, with their source. */
export const QUOTES = {
  loan: "“Who will lend Allah a good loan, so He may multiply it many times?” — Qur’an 2:245 ✅",
  relieve: "*“Whoever relieves a believer of a hardship in this world, Allah will relieve him of a hardship on the Day of Judgement.”*\n— Sahih Muslim ✅",
  spend: "✨ Allah says in a Hadith Qudsi:\n*“O son of Adam! Spend in charity, and I shall spend on you.”* — Sahih al-Bukhari 5352",
  mercy: "*As the Prophet ﷺ said:*\n“The merciful are shown mercy by the Most Merciful. Be merciful to those on earth, and the One above the heavens will have mercy upon you.” — Tirmidhi ✅",
  date: "As the Prophet ﷺ said:\n“Protect yourself from the Fire, even if by giving half a date in charity.” — Sahih al-Bukhari ✅",
  charity: "*“Charity does not decrease wealth.”* — Sahih Muslim ✅",
  orphan: "The Prophet ﷺ said:\n*“I and the caretaker of an orphan will be in Jannah like these two.”* — Sahih al-Bukhari ✅",
  kafan: "The Prophet ﷺ said:\n*“Whoever wraps a dead person in burial cloth, Allah will give them beautiful clothes in Paradise.”* — Sahih al-Jami 6403 ✅",
} as const;
export const HADITHS: string[] = Object.values(QUOTES);
const QUOTES_BY_TYPE: Record<string, (keyof typeof QUOTES)[]> = {
  child: ["loan", "relieve", "spend", "mercy", "date", "charity"],
  adult: ["loan", "relieve", "spend", "mercy", "date", "charity"],
  orphans: ["orphan", "relieve", "loan", "spend"],
  death: ["kafan", "spend", "date", "relieve"],
  needs: ["relieve", "spend", "loan", "charity"],
};

/** Words he never uses. (He does say urgent, extreme pain, risk, helpless — those are allowed.) */
const NEVER = /\b(?:kindly|generous|needy)\b/i;
const TIRED = /fluid is (?:pressing on|filling)/i;
/** Medical or danger words: allowed only when the same word is in his facts or his post. */
const MEDICAL = /\b(?:surgery|surgeries|operation|ventilator|icu|cancer|tumou?r|infection|fever|bleeding|seizures?|coma|oxygen|blind\w*|paraly\w*|dialysis|transplant|brain|kidneys?|hernia|transfusion|blood|fluid|swollen|lungs?|heart|liver|amputat\w*)\b/gi;

export const money = (n: number) => Math.round(n).toLocaleString("en-US");
export const people = (left: number) => ({ p2: Math.ceil(left / 2000), p1: Math.ceil(left / 1000), p15: Math.ceil(left / 1500) });
/** "26k", "17.4k", "Rs. 800" — how he writes amounts in quick posts. */
export const kAmount = (n: number) => (n < 1000 ? `Rs. ${money(n)}` : `${Math.round(n / 100) / 10}k`);

/** Unicode bold (Mathematical Sans-Serif Bold), the way he writes headlines: 𝗢𝗡𝗟𝗬 𝗥𝘀. 𝟮𝟲,𝟬𝟬𝟬 𝗟𝗘𝗙𝗧. */
export function ub(s: string): string {
  return [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
      return ch;
    })
    .join("");
}
/** Unicode bold back to plain letters (for checks and tests). */
export function plain(s: string): string {
  return [...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 0x1d5d4 && c <= 0x1d5ed) return String.fromCharCode(65 + c - 0x1d5d4);
      if (c >= 0x1d5ee && c <= 0x1d607) return String.fromCharCode(97 + c - 0x1d5ee);
      if (c >= 0x1d7ec && c <= 0x1d7f5) return String.fromCharCode(48 + c - 0x1d7ec);
      return ch;
    })
    .join("");
}

const pron = (b: Brain) => (b.gender === "f" ? { he: "she", He: "She", him: "her", his: "her", His: "Her" } : { he: "he", He: "He", him: "him", his: "his", His: "His" });

/** "2-year-old", "8-month-old baby", "child". */
export const kidWord = (b: Brain) => (b.age ? `${b.age}-year-old` : b.ageLabel ? `${b.ageLabel.replace(/s$/, "").replace(" ", "-")}-old baby` : "child");

const poss = (x: string) => (/s$/i.test(x) ? `${x}'` : `${x}'s`);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * The words that change with the kind of case. subj = who is waiting, is/needs = the verb for it (plural names like
 * "these orphans" get are/need), hard = whose hardship, the = "this helpless child" etc.
 */
function words(b: Brain) {
  const N = b.name;
  const type = b.type ?? "child";
  const baby = !!b.ageLabel || (b.age !== undefined && b.age < 1);
  const many = /^these\b/i.test(N) || (type === "orphans" && /s$/i.test(N));
  const v = { is: many ? "are" : "is", needs: many ? "need" : "needs" };
  if (type === "death") return { who: "family", goal: `complete ${N}'s Janazah`, need: "a respectful Janazah", kid: false, win: "A RESPECTFUL JANAZAH", subj: `${poss(N)} family`, is: "is", needs: "needs", hard: "this grieving family's", the: "this grieving family" };
  if (type === "orphans") return { who: "orphans", goal: "help these orphans", need: "help", kid: false, win: "ORPHANS HELPED TODAY", subj: N, ...v, hard: poss(N), the: "these helpless orphans" };
  if (type === "needs") return { who: "family", goal: "help this family", need: "help", kid: false, win: "A FAMILY HELPED TODAY", subj: N, ...v, hard: poss(N), the: "this helpless family" };
  if (type === "adult") return { who: "person", goal: `save ${N}`, need: "treatment", kid: false, win: "ONE LIFE GIVEN A CHANCE", subj: N, ...v, hard: poss(N), the: N };
  return { who: baby ? "baby" : "child", goal: `save ${N}`, need: "treatment", kid: true, win: "ONE LIFE GIVEN A CHANCE", subj: N, ...v, hard: poss(N), the: `this helpless ${baby ? "baby" : "child"}` };
}

/** In Pakistan time: Fajr (4–6 am) gets his "Fajr time reminder". */
const pkHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Karachi" }).format(t));
const isFajr = (t: number) => {
  const h = pkHour(t);
  return h >= 4 && h < 6;
};

/** His hook lines (the "angles"). Each needs certain facts; the ones that do not fit this case are skipped. */
export const ANGLES = ["someoneElse", "cannotTell", "notMoney", "lunch", "blessed", "deal", "muslims", "someonesChild", "burden", "chance"] as const;
export type Angle = (typeof ANGLES)[number];
const fits = (b: Brain, a: Angle) => (a === "cannotTell" || a === "someonesChild" ? words(b).kid : a === "notMoney" ? !!b.risk && words(b).kid : true);

function readyHook(b: Brain, a: Angle): string {
  const N = b.name;
  const p = pron(b);
  const w = words(b);
  switch (a) {
    case "someoneElse": return `💔 ${ub("Please don't think someone else will help.")}`;
    case "cannotTell": return `🥺 *This little ${w.who} cannot even tell anyone how much pain ${p.he} is in.*`;
    case "notMoney": return `*💔 This is not about money. This is about whether a child keeps ${p.his} ${(b.risk ?? "").toUpperCase()} or loses it. You decide.*`;
    case "lunch": return `💔 *Rs. 2,000 might be one lunch for us, but for ${w.subj}, it could mean ${w.need === "help" ? "so much" : w.need}.*`;
    case "blessed": return `💔 *Allah has blessed us with so much, while ${w.subj} ${w.is} still waiting for ${w.need}.*`;
    case "deal": return `🚨 ${ub("IT IS YOUR DEAL WITH ALLAH")}: help relieve ${w.hard} hardship.`;
    case "muslims": return `* *As Muslims, we should unite to help ${N} by donating whatever we can, brothers/sisters.*`;
    case "someonesChild": return `💔 ${ub("IF YOU'RE SEEING THIS, THIS IS SOMEONE'S CHILD.")}`;
    case "burden": return `*Nobody has to carry this burden alone.* 🤲`;
    case "chance": return `*Allah has given you a chance to ${w.goal}.* 🤲`;
  }
}

/** Problems with an AI hook line, or [] when it is fine. */
export function lineProblems(line: string, b: Brain, left: number): string[] {
  const p: string[] = [];
  const t = line.trim();
  if (!t) return ["empty"];
  if (t.split(/\s+/).length > 28) p.push("too long");
  if (NEVER.test(t)) p.push("banned word");
  if (TIRED.test(t)) p.push("tired opener");
  if (/[“"]/.test(t)) p.push("quotes (verses are added by the app)");
  const facts = `${b.facts.join(" ")} ${b.source ?? ""}`.toLowerCase();
  for (const m of t.matchAll(MEDICAL)) {
    const w = m[0].toLowerCase().replace(/s$/, "");
    if (!facts.includes(w)) p.push(`not in the facts: “${m[0]}”`);
  }
  const { p2, p1, p15 } = people(left);
  const ok = new Set([String(b.age ?? ""), b.ageLabel?.split(" ")[0] ?? "", String(left), money(left), String(p2), String(p1), String(p15), "2000", "2,000", "1000", "1,000", "1500", "1,500", "10"]);
  for (const m of t.matchAll(/\d[\d,]*/g)) if (!ok.has(m[0].replace(/,$/, ""))) p.push(`made-up number ${m[0]}`);
  return [...new Set(p)];
}

/** The AI writes the bold hook in his voice (shown his real messages); code checks it. Null = use his ready hook. */
async function aiHook(b: Brain, a: Angle, left: number, avoid: string[]): Promise<string | null> {
  const r = await llm(
    `${styleBlock()}\n\nWrite ONE hook line (the first line of a full repost) for this case, in his voice, 8 to 22 words. ` +
      `Idea to use: "${plain(readyHook(b, a)).replace(/[*_💔🥺🚨🤲]/g, "").trim()}". Say it fresh, do not copy it. ` +
      "Only the facts given. No new illness, danger, time or number. No quotes, no hadith (the app adds it). No emoji, no * or _ (the app adds them). " +
      'Return ONLY JSON: {"hook":"..."}',
    JSON.stringify({ child: { name: b.name, age: b.age ?? b.ageLabel, gender: b.gender === "f" ? "girl" : "boy", case_type: b.type ?? "child" }, facts: b.facts, case_post: b.source?.slice(0, 2500), old_messages_do_not_repeat: avoid.slice(-6) }),
    { json: true },
  );
  const hook = typeof parseJson<{ hook?: unknown }>(r.text)?.hook === "string" ? String(parseJson<{ hook: string }>(r.text)!.hook).replace(/\s+/g, " ").replace(/[*_]/g, "").trim() : "";
  if (!hook || lineProblems(hook, b, left).length) return null;
  if (avoid.some((x) => similarity(x, hook) >= 0.5)) return null;
  return `*💔 ${hook}*`;
}

const now_ = (t: number) => new Date(t).toISOString();

/** The next hook: one that fits this case, not used in this round, never the last one again. */
export function nextAngle(b: Brain, skip: Angle[] = []): Angle {
  const last = b.history.findLast((h) => h.angle)?.angle;
  const usable = ANGLES.filter((a) => fits(b, a) && !skip.includes(a));
  let free = usable.filter((a) => !b.angles.includes(a));
  if (!free.length) {
    b.angles = [];
    b.round = (b.round ?? 0) + 1;
    free = usable.filter((a) => a !== last);
  }
  const a = free[0] ?? usable[0] ?? "someoneElse";
  b.angles.push(a);
  return a;
}

async function hook(b: Brain, a: Angle, left: number) {
  if (b.noAi) return readyHook(b, a);
  return (await aiHook(b, a, left, b.history.map((h) => h.text)).catch(() => null)) ?? readyHook(b, a);
}

/** Next index in a rotation stored on the brain. */
function turn(b: Brain, key: "fact" | "hadith" | "you" | "upd", size: number): number {
  const i = (((b[key] ?? -1) + 1) % size + size) % size;
  b[key] = i;
  return i;
}

/** His facts in italics, two at a time, ending with 💔. */
function factsLine(b: Brain): string {
  if (!b.facts.length) return "";
  const s = (f: string) => {
    const t = f.trim().replace(/[.\s]+$/, "");
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  };
  const a = b.facts[turn(b, "fact", b.facts.length)];
  const c = b.facts.length > 1 ? b.facts[turn(b, "fact", b.facts.length)] : "";
  return `_${[s(a), c && s(c)].filter(Boolean).join(" ")}_💔`;
}

function quote(b: Brain): string {
  const keys = QUOTES_BY_TYPE[b.type ?? "child"] ?? QUOTES_BY_TYPE.child;
  return QUOTES[keys[turn(b, "hadith", keys.length)]];
}

const plural = (n: number) => (n === 1 ? "person" : "people");

/** His people-maths lines. */
function peopleLine(b: Brain, left: number, i: number): string {
  const { p2, p1, p15 } = people(left);
  const g = words(b).goal;
  return [
    `- *_${p2} kind ${plural(p2)} donating 2,000 can ${g}_*.🤲`,
    `🤲 *Just ${p2} ${plural(p2)} × Rs. 2,000 can ${g}.*`,
    `* *_Just ${p15} ${plural(p15)} donating 1,500 can ${g}._🤲*`,
    `* _*Only ${p2} more ${plural(p2)} donating Rs. 2,000, or ${p1} at Rs. 1,000, can finish this. Be the next one.*_🤲`,
  ][i % 4];
}

/** His amount lines. */
function amountLine(left: number, i: number): string {
  return [`⚠️${kAmount(left)} remaining`, `🚨 ${kAmount(left)} left`, `🚨 ${ub(`ONLY Rs. ${money(left)} LEFT.`)}`, `*${kAmount(left)} left ONLY*`][i % 4];
}

/** His full repost (Affan / Yousuf layout). */
async function writeFull(b: Brain, left: number, t: number, opts: { all?: boolean; angle?: Angle } = {}): Promise<{ text: string; angle: Angle }> {
  const angle = opts.angle ?? nextAngle(b);
  const h = await hook(b, angle, left);
  const i = turn(b, "you", 4);
  const facts = factsLine(b);
  const lines = [
    ...(isFajr(t) ? [`🚨💔 ${ub("FAJR TIME REMINDER")}`, ""] : []),
    h,
    "",
    ...(facts ? [facts] : []),
    "___________",
    "",
    quote(b),
    "- *Allah is giving you this chance.*",
    "",
    peopleLine(b, left, i),
    "",
    amountLine(left, i),
    "",
    "_Allah will multiply what you give. No bank gives that return._",
    "",
    "⚠️ Takes only 10 seconds",
    ENDING,
    "",
    ...(i % 2 === 1 ? ["*Please send a screenshot when you do your part.*", ""] : []),
    `${TEAM}${opts.all === false ? "" : ` ${ALL}`}`,
  ];
  return { text: lines.join("\n"), angle };
}

/** His short pushes between reposts. */
function writeQuick(b: Brain, left: number, t: number): string {
  const N = b.name;
  const p = pron(b);
  const w = words(b);
  const { p2, p15 } = people(left);
  const k = kAmount(left);
  const night = pkHour(t) >= 20 || pkHour(t) < 4;
  const fajr = isFajr(t) ? "Fajr time reminder\n\n" : "";
  const list = [
    `*_Just 2000 by ${p2} kind ${plural(p2)} can ${w.goal}${night ? " tonight" : ""}_*\n\nAllah has given you a chance to ${w.goal} ${ALL}`,
    `Just ${k} is left, please come forward all and donate for ${w.the} ${ALL}`,
    `Just ${k} left.\n\n${p2} ${plural(p2)} donating 2000 will ${w.goal} 💔\n\nYour 10 seconds can bring someone peace ${ALL}`,
    `*${p15} ${plural(p15)} donating 1500 will ${w.goal}*\n\n${PAY_SHORT} ${ALL}`,
    `🚨 Just ${k} remaining. ${cap(w.subj)} ${w.is} still waiting for ${w.need}.\n\nJust 1000 - 2000 from your end can ${w.goal}\n\n*Donate Now*:\n${PHONE} - Easypaisa/JazzCash - Wajdan Khan (GiveLife Foundation account) ${ALL}`,
    `🤲 The Prophet ﷺ said:\n${QUOTES.relieve}\n\nPlease come forward and help ${N}\n\n${PAY_SHORT}`,
    `_Just ${k} left for ${N}, we request all to please put part and share it if you know a group or person who can help_ ${ALL}`,
    `*_Just ${k} is left, which ${p15} ${plural(p15)} by donating 1500 can complete right now_*\n\n_Be the one to ${w.goal}_ ${ALL}`,
    `${ub(`JUST ${p2} PEOPLE DONATING Rs. 2,000 CAN RAISE THE FULL AMOUNT.`)}\n\nPlease don't think someone else will do it. ${ub(`You can be one of those ${p2}.`)} 🤲💔\n\n${ENDING} ${ALL}\n\n✅ Verified by Admins`,
    `${k} left.\n\n${p.He} needs your support as this is a deal with Allah 🤲💔\n\nPlease send ss when you put part ${ALL}`,
  ];
  if (!w.kid) list[9] = `${k} left.\n\n${cap(w.the)} ${w.needs} your support as this is a deal with Allah 🤲💔\n\nPlease send ss when you put part ${ALL}`;
  // After every round of his short pushes, the next round adds one of his closing lines, so nothing repeats.
  const closers = ["Please send ss when you put part", "✅ Verified by admins", "Requesting all donors to please consider asap", "Your 10 seconds can bring someone peace", "It takes only 10 seconds to donate", "_Allah is giving you this chance._"];
  const q = (b.quick = (b.quick ?? -1) + 1);
  const cycle = Math.floor(q / list.length);
  return fajr + list[q % list.length] + (cycle > 0 ? `\n\n${closers[(cycle - 1) % closers.length]}` : "");
}

/** Money came: one of his four update styles. */
async function writeUpdate(b: Brain, left: number, t: number): Promise<BrainOut> {
  const N = b.name;
  const w = words(b);
  const { p2, p1 } = people(left);
  const collected = b.total > left ? b.total - left : 0;
  const v = turn(b, "upd", collected ? 4 : 3);
  const styles = [
    `*ONLY Rs. ${money(left)} Remaining.*\n\n${cap(w.subj)} ${w.is} still waiting for ${w.need}.💔\n\n* _*Only ${p2} more ${plural(p2)} donating Rs. 2,000, or ${p1} at Rs. 1,000, can finish this. Be the next one.*_🤲\n\n${ENDING} ${ALL}`,
    `${kAmount(left)} remaining ${ALL}\n\n🤲 *Just Rs. 2,000 from you can be one of those ${p2}.*\n\n_Be the one to ${w.goal}_\n\n📲 *${PHONE}* — Easypaisa / JazzCash\n👤 Wajdan Khan — GiveLife Foundation`,
    `🚨 ${ub("UPDATE:")} ${ub(`Rs. ${money(left)} IS STILL PENDING`)} for ${N}.\n\nNobody has to carry this burden alone.\n\n* _*${ub(`JUST Rs. 2000 FROM ${p2} PEOPLE`)} can complete the amount and ${w.goal}. 🤲*_\n\nIt takes only ${ub("10 SECONDS")} to donate\n\n${ub("IT IS YOUR DEAL WITH ALLAH")}: help relieve ${w.hard} hardship.\n\n${ENDING} ${ALL}`,
    `*Collected : ${kAmount(collected)}*\n*Remaining : ${kAmount(left)}*\n\n_${N} needs YOU — ${p2} ${plural(p2)} × Rs. 2,000 can ${w.goal}_💔\n\nDonate Now:\n${PHONE} - Easypaisa/JazzCash - Wajdan Khan (GiveLife Foundation account)\n\nVerified by admins ✅ ${ALL}`,
  ];
  return { kind: "update", do: `Send this in ${MAIN} with @all`, text: styles[v], angle: undefined, at: now_(t) };
}

/** 20 minutes passed: a short push, and every other time his full repost. */
async function writeShort(b: Brain, left: number, t: number, full: boolean): Promise<BrainOut> {
  if (full) {
    const f = await writeFull(b, left, t);
    return { kind: "short", do: `Send this in ${MAIN} with @all (full repost)`, text: f.text, angle: f.angle, at: now_(t) };
  }
  return { kind: "short", do: `Send this in ${MAIN} with @all`, text: writeQuick(b, left, t), at: now_(t) };
}

/**
 * "No donations": his escalation. Each press since money last came is one step stronger:
 * 1 "Sadly, no donations yet", 2 "Sadly, no one has put part yet", 3 "Please don't think someone else will help",
 * 4+ "We are Muslims…" (and from 5 his "Sadly, no one has come forward… May Allah save us").
 * Plus a full repost for the freelancer groups.
 */
async function writeDry(b: Brain, left: number, t: number): Promise<BrainOut[]> {
  const level = (b.dryLevel = (b.dryLevel ?? 0) + 1);
  const N = b.name;
  const p = pron(b);
  const w = words(b);
  const { p2, p1 } = people(left);
  const k = kAmount(left);
  const facts = factsLine(b);
  const He = w.kid || b.type === "adult" ? p.He : cap(w.the);
  const heNeeds = w.kid || b.type === "adult" ? "needs" : w.needs;
  // His wordings for each step; Regenerate (dryAlt) moves to the next one of the same step.
  const steps: string[][] = [
    [
      `Sadly, no donations yet\n\n${k} still remaining for ${N}.\n\n${He} ${heNeeds} your contribution as this is a deal with Allah 🤲💔\n\nCome forward and contribute now\n\n${PHONE} - Easypaisa/JazzCash - Wajdan Khan (GiveLife Foundation account) ${ALL}`,
      `Sadly, no funds collected yet. Please take it urgent and support ${N}.\n\n${k} is still remaining. *_Just 2000 by ${p2} ${plural(p2)} can ${w.goal}_* 🤲\n\n${PAY_SHORT} ${ALL}`,
      `💔 Sadly, no one has come forward yet for ${N}.\n\nJust ${k} left. Your small support can change this today.\n\n${PAY_SHORT} ${ALL}`,
    ],
    [
      `💔 Sadly, no one has put part yet\n\n_*For us, Rs. 1,000 can disappear in a day. For ${N}, ${p1} such people can change what tonight looks like.*_\n\n🤲 Help ${N} as a Muslim today ${ALL}`,
      `💔 Sadly, no one has put part yet\n\n_*Rs. 2,000 might be one lunch for us. For ${w.subj}, ${p2} such people can mean ${w.need === "help" ? "so much" : w.need}.*_\n\n🤲 Please be one of them today ${ALL}`,
      `💔 Sadly, still no donations.\n\n_*${p1} people giving just Rs. 1,000 can ${w.goal}. That is all it takes.*_\n\n🤲 Help as a Muslim today ${ALL}`,
    ],
    [
      [`💔 ${ub("PLEASE DON'T THINK SOMEONE ELSE WILL HELP.")}`, "", ...(facts ? [facts, ""] : []), `🚨 ${ub(`ONLY Rs. ${money(left)} LEFT.`)}`, `${ub(`${p2} PEOPLE × Rs. 2,000 = ${w.win}.`)} 🤲`, "", `${ub(`YOU CAN BE ONE OF THOSE ${p2}.`)} ${ub("PLEASE DON'T SCROLL PAST.")}`, "", ENDING, "", `✅ Verified by Admins ${ALL}`].join("\n"),
      [`💔 ${ub("Please don't think someone else will help.")}`, "", `If everyone waits for someone else, ${w.subj} ${w.is.replace("are", "keep").replace("is", "keeps")} waiting for the ${w.need === "help" ? "help" : w.need.replace(/^a /, "")} ${w.kid ? `${p.he} urgently needs` : "they urgently need"}.`, "", `🤲 If you can help, please step forward today. Even Rs. 2,000 can make a difference.`, "", `🚨 ${ub(`ONLY Rs. ${money(left)} LEFT.`)}`, "", ENDING, "", `✅ Verified by Admins ${ALL}`].join("\n"),
    ],
    [
      [`💔 ${ub(`WE ARE MUSLIMS — IT'S HEARTBREAKING THAT ${w.subj.toUpperCase()} ${w.is.toUpperCase()} STILL WAITING FOR JUST Rs. ${money(left)}.`)}`, "", w.kid ? `This is someone's ${w.who}. ${p.His} ${w.need} can go on if we raise this amount.` : `This is someone's family. They can get through this if we raise this amount.`, "", `🚨 ${ub(`JUST ${p2} PEOPLE DONATING Rs. 2,000 EACH = Rs. ${money(left)}.`)}`, "", quote(b), "", `🤲 Please be one of the ${p2}. Don't let ${w.subj} keep waiting because we didn't act.`, "", `${ENDING} ${ALL}`].join("\n"),
      [`💔 ${ub(`IF YOU'RE SEEING THIS, THIS IS SOMEONE'S ${w.kid ? w.who.toUpperCase() : "FAMILY"}.`)}`, "", ...(facts ? [facts, ""] : []), `🚨 ${ub(`ONLY Rs. ${money(left)} LEFT.`)}`, `${ub(`${p2} PEOPLE × Rs. 2,000 = ${w.win}.`)} 🤲`, "", `${ub(`YOU CAN BE ONE OF THOSE ${p2}. PLEASE DON'T SCROLL PAST.`)}`, "", ENDING, "", `✅ Verified by Admins ${ALL}`].join("\n"),
    ],
    [
      `Sadly, no one has come forward for ${N}. Just imagine ${w.kid ? `${p.his} family's` : "their"} pain, May Allah save us.\n\n${k} still remaining. Your small support can end this one stress.\n\n*_Just 2000 by ${p2} ${plural(p2)} can ${w.goal}_*🤲\n\n${PAY_SHORT} ${ALL}`,
      `Requesting all donors to please consider asap 🤲\n\n${k} is still left for ${N}. *_Just 2000 by ${p2} ${plural(p2)} can ${w.goal}_*\n\n${PAY_SHORT} ${ALL}`,
    ],
  ];
  // Steps 1-3, then 4 and 5 take turns ("We are Muslims…" / "Sadly, no one has come forward…").
  const step = steps[level <= 3 ? level - 1 : level % 2 === 0 ? 3 : 4];
  const main = step[(b.dryAlt ?? 0) % step.length];
  const groups = await writeFull(b, left, t, { all: false });
  const tag = `No donations · level ${level}`;
  return [
    { kind: "dry-main", do: `${tag}: send this in ${MAIN} with @all. Then tag your donors ("Requesting all donors to please consider asap") and DM new people who saw it.`, text: main, at: now_(t) },
    { kind: "dry-groups", do: `${tag}: send this in ${GROUPS}.`, text: groups.text, angle: groups.angle, at: now_(t) },
  ];
}

/** His closing message, word for word, for the kind of case. */
export function writeDone(b: Brain, t: number): BrainOut {
  const N = b.name;
  const type = b.type ?? "child";
  const text =
    type === "orphans" || type === "needs"
      ? `🌿 ${ub("Alhamdulillah! This case is now closed.")}\n\nJazakum Allahu Khayran to everyone who donated, shared, and made du'a. 🤲\n\nMay Allah ﷻ accept every donation, reward you abundantly, and place barakah in your wealth and families. Ameen. 💚 ${ALL}`
      : [
          `${ub(`${N.toUpperCase()}’S CASE IS COMPLETE.`)} 🤲`,
          "",
          type === "death" ? `Alhamdulillah, with your help we completed the full amount for ${N}'s Janazah.` : "Alhamdulillah, with your help we completed the full treatment amount.",
          "",
          "JazakAllah Khair to everyone who donated, shared, made dua, or helped in any way.",
          "",
          type === "death" ? `May Allah accept it from you, multiply your reward, and grant ${N} a high rank in Jannah. ❤️` : `May Allah accept it from you, multiply your reward, and bring complete shifa to ${N}. ❤️`,
          "",
          "Proof and updates will be shared.",
          "",
          `— GiveLife Foundation ${ALL}`,
        ].join("\n");
  return { kind: "done", do: `Send this in ${MAIN} and in ${GROUPS}.`, text, at: now_(t) };
}

export type Command = { kind: "left"; amount: number } | { kind: "tick" } | { kind: "dry" } | { kind: "done" };

/** "LEFT 44000", "left 44k", "44,000", "20 MIN", "20min", "dry", "done". */
export function parseCommand(input: string): Command | null {
  const t = input.trim().toLowerCase();
  if (/^20\s*min(?:ute)?s?(?:\s*passed)?$/.test(t) || t === "20" || /^update\s*(?:the\s*)?group$/.test(t)) return { kind: "tick" };
  if (/^(?:dry|no\s*donations?|no\s*money)$/.test(t)) return { kind: "dry" };
  if (/^done$/.test(t)) return { kind: "done" };
  const m = /^(?:left\s*)?(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? { kind: "left", amount: Math.round(n) } : null;
}

export interface BrainResult { reply?: string; outputs: BrainOut[] }

/** Apply one command. Changes the brain; returns a short reply and/or the messages to send. */
export async function runCommand(b: Brain, cmd: Command, t: number): Promise<BrainResult> {
  const used = () => new Set(b.history.map((h) => h.text));
  // Never the same message twice: the writers rotate, so writing again gives a new one.
  const unique = async (write: () => Promise<BrainOut[]>) => {
    let outs = await write();
    for (let i = 0; i < 12 && outs.some((o) => used().has(o.text)); i++) outs = await write();
    return outs;
  };
  const keep = (outs: BrainOut[]) => {
    b.history.push(...outs);
    b.history = b.history.slice(-60);
    return { outputs: outs };
  };
  if (cmd.kind === "done") {
    b.done = true;
    return keep([writeDone(b, t)]);
  }
  if (cmd.kind === "left") {
    const n = cmd.amount;
    if (b.left !== undefined && n > b.left) return { reply: "Amount went up, please check.", outputs: [] };
    if (n === 0) {
      b.left = 0;
      b.done = true;
      return { reply: "Rs. 0 left: the case is complete.", ...keep([writeDone(b, t)]) };
    }
    if (b.left === undefined || b.updateLeft === undefined) {
      b.left = n;
      b.leftAt = now_(t);
      b.updateLeft = n;
      return keep(await unique(async () => [await writeUpdate(b, n, t)]));
    }
    if (n === b.left) return { reply: "Same amount as before. Saved. Wait.", outputs: [] };
    const drop = b.updateLeft - n;
    const quietFor = t - new Date(b.leftAt ?? 0).getTime();
    b.left = n;
    b.leftAt = now_(t);
    b.dryLevel = 0;
    if (drop >= 2000 || (drop >= 1500 && quietFor >= 2 * HOUR)) {
      b.updateLeft = n;
      return keep(await unique(async () => [await writeUpdate(b, n, t)]));
    }
    return { reply: `Saved. Wait. (Rs. ${money(drop)} since the last update.)`, outputs: [] };
  }
  if (b.left === undefined) return { reply: "Send me LEFT [amount] first.", outputs: [] };
  if (b.done) return { reply: "This case is complete. Start a new case.", outputs: [] };
  if (cmd.kind === "tick") {
    // Decided once per press, so writing again (for a repeat) keeps the same shape.
    b.ticks = (b.ticks ?? 0) + 1;
    const full = b.ticks % 2 === 0;
    return keep(await unique(async () => [await writeShort(b, b.left!, t, full)]));
  }
  const level = b.dryLevel ?? 0;
  b.dryAlt = -1;
  return keep(
    await unique(async () => {
      b.dryLevel = level;
      b.dryAlt = (b.dryAlt ?? -1) + 1; // a repeat moves to his next wording of the same step
      return writeDry(b, b.left!, t);
    }),
  );
}

/**
 * The same message written again, with different words (the "Regenerate" button).
 * Uses his writers, so the rules and the style stay the same. The "No donations" level does not go up.
 * Null for kinds that have no writer here (the case post, the closing message).
 */
export async function regenerate(b: Brain, kind: BrainOut["kind"], at: string, t: number): Promise<BrainOut | null> {
  const old = b.history.find((h) => h.kind === kind && h.at === at);
  if (!old || b.left === undefined) return null;
  const used = new Set(b.history.map((h) => h.text));
  for (let i = 0; i < 12; i++) {
    let out: BrainOut | undefined;
    if (kind === "short") {
      // Keep the same shape: a short push stays short, a full repost stays full.
      const full = old.text.includes("___________");
      if (full) {
        const f = await writeFull(b, b.left, t);
        out = { ...old, text: f.text, angle: f.angle };
      } else out = { ...old, text: writeQuick(b, b.left, t) };
    } else if (kind === "update") out = await writeUpdate(b, b.left, t);
    else if (kind === "dry-main" || kind === "dry-groups") {
      const level = b.dryLevel ?? 1;
      b.dryLevel = Math.max(0, level - 1);
      b.dryAlt = (b.dryAlt ?? 0) + 1;
      out = (await writeDry(b, b.left, t)).find((o) => o.kind === kind);
      b.dryLevel = level;
    } else return null;
    if (out && !used.has(out.text)) {
      old.text = out.text;
      old.angle = out.angle;
      return old;
    }
  }
  return null;
}

export const newBrain = (p: Partial<Brain> & { name: string; total: number }): Brain => ({
  gender: "m",
  facts: [],
  angles: [],
  history: [],
  ...p,
});
