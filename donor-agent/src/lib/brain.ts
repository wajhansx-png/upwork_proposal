/**
 * The Case Brain. During a live case the manager sends short commands (LEFT 44000, 20 minutes passed, No donations, DONE);
 * the Brain decides what to do and writes the message in his style. It never sends anything.
 *
 * The rules are code: the people maths, when an UPDATE is due, angle rotation, the exact hadiths and the
 * fixed ending. The AI only writes the heart lines for an angle; any line with a new medical word, a banned
 * word, a made-up number or a worn-out opener is thrown away and a ready line in his style is used instead.
 */
import { llm, parseJson } from "./llm";
import { similarity } from "./case";
import type { Brain, BrainOut } from "./types";

export const ENDING = "03097458815 — Easypaisa / JazzCash\nWajdan Khan — GiveLife Foundation";
export const HADITHS = [
  "*\"Charity does not decrease wealth.\"* — Sahih Muslim",
  "*\"Allah helps His servant as long as the servant helps his brother.\"* — Sahih Muslim",
  "*\"Allah does not show mercy to those who do not show mercy to people.\"* — Bukhari & Muslim",
];
export const ANGLES = ["dua", "meal", "bedtime", "allahSees", "tooYoung", "helpless", "ownChild", "count", "waiting", "hadith"] as const;
export type Angle = (typeof ANGLES)[number];
const HOUR = 3_600_000;
const MAIN = "GiveLife Foundation";
const GROUPS = "Upwork Community 2026 and Fiverr Course 2026";

/** Words the manager never wants, and lines he is tired of. */
const NEVER = /\b(?:dying|die|dies|death|life[- ]threatening|extreme pain|critical|last chance|deadline|hours? left|days? left|before it'?s too late|kindly|generous|contribution|needy)\b/i;
const TIRED = /fluid is (?:pressing on|filling)/i;
/** Medical or danger words: allowed only when the same word is in his facts. */
const MEDICAL = /\b(?:surgery|surgeries|operation|ventilator|icu|cancer|tumou?r|infection|fever|bleeding|seizures?|coma|oxygen|blind\w*|paraly\w*|dialysis|transplant|brain|kidneys?|hernia|transfusion|blood|fluid|swollen|head|lungs?|heart|liver|pain\w*|hospital)\b/gi;

export const money = (n: number) => Math.round(n).toLocaleString("en-US");
export const people = (left: number) => ({ p2: Math.ceil(left / 2000), p1: Math.ceil(left / 1000) });

const pron = (b: Brain) => (b.gender === "f" ? { he: "She", him: "her", his: "her" } : { he: "He", him: "him", his: "his" });

/** "2-year-old", "8-month-old baby", "child". */
export const kidWord = (b: Brain) => (b.age ? `${b.age}-year-old` : b.ageLabel ? `${b.ageLabel.replace(/s$/, "").replace(" ", "-")}-old baby` : "child");

/** The heart lines of each angle in his own words. {N} name, {A} age, {P2} people at Rs. 2,000. */
function readyLines(b: Brain, angle: Angle, left: number): { first: string; line: string } {
  const N = b.name;
  const p = pron(b);
  const { p2 } = people(left);
  const age = b.age ? `${b.age}` : b.ageLabel ? `${b.ageLabel} old` : "small";
  const map: Record<Angle, { first: string; line: string }> = {
    dua: { first: `Every parent makes dua for their child. Today, you can be the answer to ${N}'s mother's dua.`, line: `${p.he} cannot even tell ${p.his} mother where it hurts.` },
    meal: { first: `One meal outside costs Rs. 2,000. For ${N}, the same Rs. 2,000 means treatment.`, line: `${N} is still waiting for that treatment.` },
    bedtime: { first: `Tonight, when you put your child to sleep, remember ${N}.`, line: `${p.he} cannot even tell ${p.his} mother where it hurts.` },
    allahSees: { first: `Allah sees who helped ${N} today.`, line: `And Allah sees who scrolled past.` },
    tooYoung: { first: `${p.he} is only ${age}. ${p.he} doesn't even know what a hospital is.`, line: `${p.he} only knows it hurts.` },
    helpless: { first: `${p.he} cannot even tell ${p.his} mother where it hurts.`, line: `${p.he} can only cry.` },
    ownChild: { first: `Imagine your own ${kidWord(b)} like this.`, line: `Now look at ${N} again.` },
    count: { first: `Only ${p2} more ${p2 === 1 ? "person" : "people"} needed. Be the next one.`, line: `${N} is still waiting for them.` },
    waiting: { first: `${N} is still lying there.`, line: `Waiting for people like you.` },
    hadith: { first: `${N} cannot help ${p.him}self. You can.`, line: `${p.he} cannot even tell ${p.his} mother where it hurts.` },
  };
  if ((b.round ?? 0) % 2 === 0) return map[angle];
  // Round 2, 4…: the same angles in other words, so a long case never repeats a message.
  const again: Record<Angle, { first: string; line: string }> = {
    dua: { first: `${N}'s mother prays for ${p.him} every night. Your Rs. 2,000 can be the answer.`, line: `Be the reason she smiles again.` },
    meal: { first: `We spend Rs. 2,000 without thinking. For ${N}, it is treatment.`, line: `Think of it once today.` },
    bedtime: { first: `Your child is safe in bed tonight. ${N} is not.`, line: `Remember ${p.him} when you say goodnight.` },
    allahSees: { first: `No one may know you helped ${N}. Allah will know.`, line: `That is enough.` },
    tooYoung: { first: `${p.he} is just ${age}. ${p.he} cannot ask for help, so we ask for ${p.him}.`, line: `${p.he} does not understand why it hurts.` },
    helpless: { first: `${N} cannot say "it hurts". ${p.he} can only cry.`, line: `${p.his.charAt(0).toUpperCase()}${p.his.slice(1)} mother can only watch.` },
    ownChild: { first: `Look at your own child for one second. Now think of ${N}.`, line: `Same age. Same small hands.` },
    count: { first: `${p2} ${p2 === 1 ? "person" : "people"}. That is all ${N} needs now.`, line: `One of them can be you.` },
    waiting: { first: `${N} is still waiting.`, line: `Every message we post, ${p.he} is still there.` },
    hadith: { first: `Helping ${N} is not only for ${p.him}. It is for you too.`, line: `${p.he} cannot even tell ${p.his} mother where it hurts.` },
  };
  return again[angle];
}

const YOU_LINES = [
  "If you are reading this, it's you.",
  "Don't think someone else will help. You be the one.",
  "If you are reading this, Allah is giving you this chance.",
  "If this reached you, Allah chose you for it.",
  "Don't scroll past. This one is for you.",
];

/** Problems with a line the AI wrote, or [] when it is fine. */
export function lineProblems(line: string, b: Brain, left: number): string[] {
  const p: string[] = [];
  const t = line.trim();
  if (!t) return ["empty"];
  if (t.split(/\s+/).length > 26) p.push("too long");
  if (NEVER.test(t)) p.push("banned word");
  if (TIRED.test(t)) p.push("tired opener");
  if (/[*_~]/.test(t)) p.push("formatting marks");
  if (/[“"]/.test(t)) p.push("quotes (hadiths are added by the app)");
  // Allowed words: his facts and the whole case post he pasted.
  const facts = `${b.facts.join(" ")} ${b.source ?? ""}`.toLowerCase();
  for (const m of t.matchAll(MEDICAL)) {
    const w = m[0].toLowerCase().replace(/s$/, "");
    if (!facts.includes(w) && w !== "hospital") p.push(`not in the facts: “${m[0]}”`);
  }
  const { p2, p1 } = people(left);
  const ok = new Set([String(b.age ?? ""), b.ageLabel?.split(" ")[0] ?? "", String(left), money(left), String(p2), String(p1), "2000", "2,000", "1000", "1,000"]);
  for (const m of t.matchAll(/\d[\d,]*/g)) if (!ok.has(m[0].replace(/,$/, ""))) p.push(`made-up number ${m[0]}`);
  return [...new Set(p)];
}

/** The AI writes the two heart lines for an angle; code checks them. Null = use the ready lines. */
async function aiLines(b: Brain, angle: Angle, left: number, avoid: string[], strong: boolean): Promise<{ first: string; line: string } | null> {
  const ready = readyLines(b, angle, left);
  const r = await llm(
    "You write 2 lines for a WhatsApp donation message for GiveLife Foundation (Pakistan). Very easy English, words a 10-year-old knows, 6 to 18 words per line.\n" +
      `Line "first": the opening, it must hit the heart, using this angle: ${angle} (idea: "${ready.first}"). Say it in a fresh way, do not copy the idea word for word.\n` +
      `Line "line": one more short line that adds feeling.${strong ? " The money has stopped coming: make it a little stronger, but never scary." : ""}\n` +
      "Use ONLY these facts. Never add a medical fact, a danger, a time or a number. Never write: dying, life-threatening, extreme pain, critical, last chance, deadline, kindly, generous. " +
      "Do not start with 'fluid is filling' or 'fluid is pressing'. No emoji, no * or _, no quotes, no hadith (the app adds those). Do not repeat the old messages.\n" +
      'Return ONLY JSON: {"first":"...","line":"..."}',
    JSON.stringify({ child: { name: b.name, age: b.age ?? b.ageLabel, gender: b.gender === "f" ? "girl" : "boy" }, facts: b.facts, case_post: b.source?.slice(0, 2500), old_messages_do_not_repeat: avoid.slice(-8) }),
    { json: true },
  );
  const j = parseJson<{ first?: unknown; line?: unknown }>(r.text);
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const first = clean(j?.first);
  const line = clean(j?.line);
  if (!first || !line || lineProblems(first, b, left).length || lineProblems(line, b, left).length) return null;
  if (avoid.some((a) => similarity(a, `${first} ${line}`) >= 0.5)) return null;
  return { first, line };
}

const now_ = (t: number) => new Date(t).toISOString();

/** The next angle: not used in this round, never the last one again. */
export function nextAngle(b: Brain, skip: Angle[] = []): Angle {
  const last = b.history.findLast((h) => h.angle)?.angle;
  let free = ANGLES.filter((a) => !b.angles.includes(a) && !skip.includes(a));
  if (!free.length) {
    b.angles = [];
    b.round = (b.round ?? 0) + 1;
    free = ANGLES.filter((a) => a !== last && !skip.includes(a));
  }
  const a = free[0];
  b.angles.push(a);
  return a;
}

function nextOf<T>(list: T[], idx: number | undefined): [T, number] {
  const i = ((idx ?? -1) + 1) % list.length;
  return [list[i], i];
}

/** One fact line, rotating, never his tired first line. */
function factLine(b: Brain): string {
  if (!b.facts.length) return "";
  const [f, i] = nextOf(b.facts, b.fact);
  b.fact = i;
  const s = f.trim().replace(/[.\s]+$/, "");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

function youLine(b: Brain): string {
  const [y, i] = nextOf(YOU_LINES, b.you);
  b.you = i;
  return y;
}

function hadithLine(b: Brain): string {
  const [h, i] = nextOf(HADITHS, b.hadith);
  b.hadith = i;
  return h;
}

const peopleShort = (left: number) => {
  const { p2, p1 } = people(left);
  return `🤲 *Rs. ${money(left)} left. ${p2} ${p2 === 1 ? "person" : "people"} at Rs. 2,000, or ${p1} at Rs. 1,000.*`;
};
const peopleLong = (left: number) => {
  const { p2, p1 } = people(left);
  return `* _*Only ${p2} more ${p2 === 1 ? "person" : "people"} donating Rs. 2,000, or ${p1} at Rs. 1,000, can finish this. Be the next one.*_🤲`;
};

async function heart(b: Brain, angle: Angle, left: number, strong = false) {
  if (b.noAi) return readyLines(b, angle, left);
  return (await aiLines(b, angle, left, b.history.map((h) => h.text), strong).catch(() => null)) ?? readyLines(b, angle, left);
}

async function writeUpdate(b: Brain, left: number, t: number): Promise<BrainOut> {
  const angle = nextAngle(b, ["count"]);
  const h = await heart(b, angle, left);
  const text = [`*ONLY Rs. ${money(left)} Remaining.*`, "", `${h.first} 💔`, "", peopleLong(left), "", youLine(b), "", ENDING].join("\n");
  return { kind: "update", do: `Send this in ${MAIN} with @all`, text, angle, at: now_(t) };
}

async function writeShort(b: Brain, left: number, t: number): Promise<BrainOut> {
  const angle = nextAngle(b);
  const h = await heart(b, angle, left);
  const lines = [`🤲 *${h.first}*`, "", `💔 ${angle === "hadith" ? factLine(b) : h.line}`];
  if (angle === "hadith") lines.push("", hadithLine(b));
  lines.push("", youLine(b), "", peopleShort(left), "", ENDING);
  return { kind: "short", do: `Send this in ${MAIN} with @all`, text: lines.join("\n"), angle, at: now_(t) };
}

/** Stronger "you" lines for "No donations", one set per level. */
const DRY_YOU = [
  ["If you are reading this, Allah sent this to you for a reason.", "Don't wait for someone else. You be the one."],
  ["Everyone is waiting for someone else. Please, let it be you.", "If not you, then who?"],
  ["We are asking you: please don't scroll past this one.", "You can be the reason this changes today."],
];

/**
 * "No donations": two messages, and each press since money last came is more emotional.
 * Level 1 = the amount and an angle. Level 2 = the money has stopped. Level 3 = please don't scroll past.
 * Level 4+ = we are asking one more time, with the mercy hadith. Never a banned word, never a new fact.
 */
async function writeDry(b: Brain, left: number, t: number): Promise<BrainOut[]> {
  const level = (b.dryLevel = (b.dryLevel ?? 0) + 1);
  const L = Math.min(level, 4);
  const p = pron(b);
  const angle = nextAngle(b, ["hadith"]);
  const h = await heart(b, angle, left, true);
  const you = DRY_YOU[Math.min(L, 3) - 1][level % 2];
  const kid = b.age ? `${b.age}-year-old child` : b.ageLabel ? kidWord(b) : "small child";
  let main: string[];
  if (L === 1) main = [`*Rs. ${money(left)} is still left for ${b.name}.*`, "", `${h.first} 💔`, factLine(b), "", you, "", peopleLong(left), "", ENDING];
  else if (L === 2) main = [`*The donations have stopped. ${b.name}'s need has not.*`, "", `${h.first} 💔`, factLine(b), "", you, "", peopleLong(left), "", ENDING];
  else if (L === 3) main = [`*Please don't scroll past ${b.name} again.* 💔`, "", `We have posted many times. Rs. ${money(left)} is still left.`, factLine(b), factLine(b), "", you, "", peopleLong(left), "", ENDING];
  else
    main = [
      `*${b.name} is only a ${kid}. ${p.he} cannot ask you for help, so we are asking one more time.* 💔`,
      "",
      factLine(b),
      factLine(b),
      "",
      HADITHS[2],
      "",
      you,
      "",
      peopleLong(left),
      "",
      ENDING,
    ];
  const groups = [
    L >= 3 ? `🤲 *A ${kid} still needs our help. Very few have come forward.*` : `🤲 *A ${kid} needs our help.*`,
    "",
    L >= 4 ? HADITHS[(b.hadith ?? 0) % 2] : hadithLine(b),
    "",
    `💔 ${factLine(b)}`,
    "",
    you,
    "",
    peopleShort(left),
    "",
    ENDING,
  ];
  const tag = `No donations · level ${level}`;
  return [
    { kind: "dry-main", do: `${tag}: send this in ${MAIN} with @all. Then: DM new people who saw the message, and ask donors to share the post.`, text: main.join("\n"), angle, at: now_(t) },
    { kind: "dry-groups", do: `${tag}: send this in ${GROUPS}.`, text: groups.join("\n"), at: now_(t) },
  ];
}

export function writeDone(b: Brain, t: number): BrainOut {
  const text = [`*Alhamdulillah! ${b.name}'s case is complete.* 🤲`, "JazakAllah Khair to every donor. Proof coming soon.", "— GiveLife Foundation"].join("\n");
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
  // Never the same message twice: change the "you" line (and then the fact line) until it is new.
  const fresh = (o: BrainOut): BrainOut => {
    for (let i = 0; i < YOU_LINES.length * 2 && b.history.some((h) => h.text === o.text); i++) {
      const lines = o.text.split("\n");
      const yi = lines.findIndex((l) => YOU_LINES.includes(l));
      if (yi >= 0) lines[yi] = youLine(b);
      if (i >= YOU_LINES.length) {
        const fi = lines.findIndex((l) => b.facts.some((f) => l.includes(f.replace(/[.\s]+$/, "").slice(1))));
        if (fi >= 0) lines[fi] = lines[fi].startsWith("💔 ") ? `💔 ${factLine(b)}` : factLine(b);
      }
      o = { ...o, text: lines.join("\n") };
    }
    return o;
  };
  const keep = (raw: BrainOut[]) => {
    const outs = raw.map(fresh);
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
      return keep([await writeUpdate(b, n, t)]);
    }
    if (n === b.left) return { reply: "Same amount as before. Saved. Wait.", outputs: [] };
    const drop = b.updateLeft - n;
    const quietFor = t - new Date(b.leftAt ?? 0).getTime();
    b.left = n;
    b.leftAt = now_(t);
    b.dryLevel = 0;
    if (drop >= 2000 || (drop >= 1500 && quietFor >= 2 * HOUR)) {
      b.updateLeft = n;
      return keep([await writeUpdate(b, n, t)]);
    }
    return { reply: `Saved. Wait. (Rs. ${money(drop)} since the last update.)`, outputs: [] };
  }
  if (b.left === undefined) return { reply: "Send me LEFT [amount] first.", outputs: [] };
  if (b.done) return { reply: "This case is complete. Start a new case.", outputs: [] };
  if (cmd.kind === "tick") return keep([await writeShort(b, b.left, t)]);
  return keep(await writeDry(b, b.left, t));
}

/**
 * The same message written again, with a different angle and different words (the "Regenerate" button).
 * Uses his writers, so the rules and the style stay the same. The "No donations" level does not go up.
 * Null for kinds that have no writer here (the case post, the closing message).
 */
export async function regenerate(b: Brain, kind: BrainOut["kind"], at: string, t: number): Promise<BrainOut | null> {
  const old = b.history.find((h) => h.kind === kind && h.at === at);
  if (!old || b.left === undefined) return null;
  const used = new Set(b.history.map((h) => h.text));
  for (let i = 0; i < 4; i++) {
    let out: BrainOut | undefined;
    if (kind === "short") out = await writeShort(b, b.left, t);
    else if (kind === "update") out = await writeUpdate(b, b.left, t);
    else if (kind === "dry-main" || kind === "dry-groups") {
      const level = b.dryLevel ?? 1;
      b.dryLevel = Math.max(0, level - 1);
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
