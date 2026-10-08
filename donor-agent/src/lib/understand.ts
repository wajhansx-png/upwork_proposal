import { llm, parseJson } from "./llm";
import {
  blockSignal, cleanTitle, extractGap, extractInstructions, isAck, isCantFinish, isDelay, isGreeting, isMood, numbersIn, overlap, parseManager, parseReport, questionKind, startSignal,
  type Question, type StartSignal,
} from "./nlp";
import { factsBlock, managerPrompt, teammatePrompt, type TeammateFacts } from "./prompts";
import { extractCheckEvery, parseDeadline, parseLocalStamp, parseTarget, zparts } from "./time";
import type { Db, PendingAssignment, Task } from "./types";

const DAY = 86_400_000;

// ---------- the manager ----------

export type Intent =
  | { kind: "assign"; title: string; target: number | null; taskKind: "dms" | "general"; deadline: number | null; checkEvery: number | null; gapMinutes: number | null; brief?: string }
  | { kind: "status" }
  | { kind: "relay"; text: string }
  | { kind: "cancel" }
  | { kind: "confirm" }
  | { kind: "chat"; reply?: string };

interface AssignFields {
  taskKind: "dms" | "general";
  target: number | null;
  deadline: number | null;
  checkEvery: number | null;
  gapMinutes: number | null;
  brief?: string;
  title: string;
}

/** Everything the rules can read from a work request. */
export function assignFields(text: string, now: number, db: Db): AssignFields {
  const name = db.settings.teammateName;
  const every = extractCheckEvery(text.trim());
  const t = every.rest;
  const target = parseTarget(t);
  const dms =
    target !== null ||
    /\bdms?\b/i.test(t) ||
    /\b(?:message|messaging|contact|reach out to|email|whatsapp|text)\s+(?:the\s+|all\s+|some\s+|our\s+)?(?:donors?|people|contacts?|supporters?)\b/i.test(t);
  const taskKind = dms ? "dms" : "general";
  return {
    taskKind,
    target,
    deadline: parseDeadline(t, now, db.settings.timezone, db.settings.workEndHour),
    checkEvery: every.minutes,
    gapMinutes: extractGap(text),
    brief: dms ? extractInstructions(text, name) : undefined,
    title: dms ? "" : cleanTitle(text, name),
  };
}

export function ruleIntent(text: string, now: number, db: Db): Intent {
  const p = parseManager(text, db.settings.teammateName);
  if (p.isCancel) return { kind: "cancel" };
  if (p.isConfirm) return { kind: "confirm" };
  if (p.relay) return { kind: "relay", text: p.relay };
  if (p.isStatus) return { kind: "status" };
  if (p.isRequest) return { kind: "assign", ...assignFields(text, now, db) };
  return { kind: "chat" };
}

interface ManagerJson {
  intent?: string;
  kind?: string | null;
  title?: string | null;
  target?: number | null;
  deadline?: string | null;
  check_every_minutes?: number | null;
  gap_minutes?: number | null;
  instructions?: string | null;
  relay_text?: string | null;
  reply?: string | null;
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

/**
 * Reads the manager's message. The AI understands the meaning; the rules check its numbers and times.
 * A number the AI returns must really be in the message. Instructions and relays must use the manager's own words.
 */
export async function understandManager(
  text: string,
  now: number,
  db: Db,
  ctx: { openTask?: Task; draft?: PendingAssignment } = {},
): Promise<{ intent: Intent; status: string }> {
  const rules = ruleIntent(text, now, db);
  // Fast path, no AI call: plain cancel/confirm, a status question, or a clear DM task with a count and a time.
  // The rules read these exactly (see scripts/nlp-regression.cjs), and the answer is instant.
  const clearTask = rules.kind === "assign" && rules.taskKind === "dms" && rules.target !== null && rules.deadline !== null;
  if ((rules.kind === "cancel" || rules.kind === "confirm" || rules.kind === "status" || clearTask) && process.env.AI_ALWAYS !== "on") return { intent: rules, status: "off" };

  const tz = db.settings.timezone;
  const p = zparts(now, tz);
  const context = {
    now_local: `${p.day} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
    timezone: tz,
    teammate: db.settings.teammateName,
    open_task: ctx.openTask ? { title: ctx.openTask.title, target: ctx.openTask.target } : null,
    unfinished_draft: ctx.draft ? { request: ctx.draft.request.slice(0, 300), missing: [!ctx.draft.target && ctx.draft.kind === "dms" ? "count" : null, !ctx.draft.deadlineAt ? "time" : null].filter(Boolean) } : null,
  };
  const res = await llm(managerPrompt(db.settings.teammateName), `Context: ${JSON.stringify(context)}\nManager's message: ${text}`, { json: true });
  const j = parseJson<ManagerJson>(res.text);
  if (!j?.intent) return { intent: rules, status: res.status };

  const fields = assignFields(text, now, db);
  const everyText = extractCheckEvery(text);
  const textNumbers = new Set(numbersIn(text));
  const explicit = rules.kind === "assign" && rules.target !== null && rules.deadline !== null;

  switch (j.intent) {
    case "assign": {
      if (rules.kind === "status" || rules.kind === "relay") {
        // A clear question or "tell her ..." from the rules wins over an assign guess, unless it carries work with a count or time.
        if (!(fields.target !== null || fields.deadline !== null)) return { intent: rules, status: res.status };
      }
      const llmTarget = int(j.target);
      const target = fields.target ?? (llmTarget !== null && textNumbers.has(llmTarget) ? llmTarget : null);
      let deadline = fields.deadline;
      if (deadline === null && j.deadline) {
        const d = parseLocalStamp(j.deadline, tz);
        if (d !== null && d > now && d < now + 14 * DAY) deadline = d;
      }
      const every = everyText.minutes ?? (int(j.check_every_minutes) !== null && /\b(?:every|each|check|follow|remind|ping|update)\b/i.test(text) ? Math.min(240, Math.max(5, int(j.check_every_minutes)!)) : null);
      const gap = fields.gapMinutes ?? (int(j.gap_minutes) !== null && /\b(?:gap|between|apart|wait)\b/i.test(text) ? int(j.gap_minutes) : null);
      const taskKind = j.kind === "general" ? "general" : j.kind === "dms" ? "dms" : fields.taskKind;
      const llmBrief = typeof j.instructions === "string" && j.instructions.trim() && overlap(j.instructions, text) >= 0.6 ? j.instructions.trim().slice(0, 300) : undefined;
      const title =
        taskKind === "general"
          ? typeof j.title === "string" && j.title.trim() && overlap(j.title, text) >= 0.5
            ? j.title.trim().slice(0, 90)
            : fields.title || cleanTitle(text, db.settings.teammateName)
          : "";
      return {
        intent: {
          kind: "assign",
          title,
          target: taskKind === "dms" ? target : null,
          taskKind,
          deadline,
          checkEvery: every,
          gapMinutes: gap,
          brief: taskKind === "dms" ? llmBrief ?? fields.brief : undefined,
        },
        status: res.status,
      };
    }
    case "status":
      return { intent: explicit ? rules : { kind: "status" }, status: res.status };
    case "relay": {
      const t = typeof j.relay_text === "string" && j.relay_text.trim() && overlap(j.relay_text, text) >= 0.4 ? j.relay_text.trim().slice(0, 600) : rules.kind === "relay" ? rules.text : text.trim();
      return { intent: explicit ? rules : { kind: "relay", text: t }, status: res.status };
    }
    case "cancel":
    case "confirm":
      return { intent: { kind: j.intent }, status: res.status };
    default:
      // The AI says it is just chat. A clear work request with a count and a time still counts as work.
      return { intent: explicit ? rules : { kind: "chat", reply: typeof j.reply === "string" && j.reply.trim() ? j.reply.trim().slice(0, 240) : undefined }, status: res.status };
  }
}

// ---------- the teammate ----------

export interface Understood {
  start: StartSignal;
  /** Her total, if she clearly gave one. */
  total?: number;
  /** "3 more": add to the recorded total. */
  more?: number;
  all: boolean;
  blocked: boolean;
  resolved: boolean;
  blocker?: string;
  question: Question;
  ack: boolean;
  /** Putting the work off ("later", "kal"). */
  delay: boolean;
  /** Tired or low, but not blocked. */
  mood: boolean;
  greeting: boolean;
  /** "I can't do all of them": a capacity problem, not a broken phone. */
  cantFinish: boolean;
  /** A short friendly sentence from the AI. Checked: no digits, short, no false promises. */
  sentence?: string;
  source: "ai" | "rules";
  status: string;
}

interface TeammateJson {
  started?: string | null;
  reported_total?: number | null;
  total_kind?: string | null;
  all_done?: boolean;
  blocked?: boolean;
  blocker?: string | null;
  resolved?: boolean;
  question?: string | null;
  delay?: boolean;
  sentence?: string | null;
}

const FUTURE_OR_NEG = /\b(?:will|shall|going to|gonna|plan to|about to|want to|need to|have to|should|could|would|can|might|may|haven'?t|hasn'?t|didn'?t|did not|not yet|never|won'?t|cannot|can'?t)\b/i;

/** Is the AI's sentence safe to show? No numbers (the app adds the facts), short, and no promises it cannot keep. */
export function safeSentence(s: unknown, allowManagerMention: boolean): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || /\d/.test(t) || t.split(" ").length > 45 || /https?:|www\./i.test(t)) return undefined;
  if (/\b(?:verified|proven|proof is|confirmed your|guarantee)\b/i.test(t)) return undefined;
  if (!allowManagerMention && /\bmanager\b/i.test(t)) return undefined;
  // The agent never sends her away from the work unless something is really wrong.
  if (!allowManagerMention && /\b(?:rest|stop working|come back later|message me when you can|when you feel better|tomorrow|take the day)\b/i.test(t)) return undefined;
  return t;
}

export async function understandTeammate(text: string, facts: TeammateFacts, name: string): Promise<Understood> {
  const report = parseReport(text);
  const cantFinish = isCantFinish(text);
  const block = cantFinish ? { blocked: false, resolved: false, reason: undefined } : blockSignal(text);
  const start = startSignal(text);
  const base: Understood = {
    start,
    total: report.total,
    more: report.more,
    all: !!report.all,
    blocked: block.blocked,
    resolved: block.resolved,
    blocker: block.reason,
    question: questionKind(text),
    ack: isAck(text),
    delay: isDelay(text) && start !== "started" && report.total === undefined,
    mood: isMood(text),
    greeting: isGreeting(text),
    cantFinish,
    source: "rules",
    status: "off",
  };
  // Nothing to read, or a plain "ok/thanks": no AI call needed.
  if (!text.trim() || base.ack || base.greeting || (report.total !== undefined && /^\s*\d/.test(text))) return base;

  const res = await llm(teammatePrompt(name), `${factsBlock(facts)}\n\n${name}'s message: ${text}`, { json: true });
  const j = parseJson<TeammateJson>(res.text);
  if (!j) return { ...base, status: res.status };

  const out: Understood = { ...base, source: "ai", status: res.status };

  // Started: the AI may add "started" when the rules saw nothing, but never against a clear "not yet" or "will start".
  const s = j.started === "started" ? "started" : j.started === "will_start" ? "will-start" : j.started === "not_started" ? "not-started" : null;
  if (!out.start && s && (s !== "started" || /\b(?:start|began|begin|working|sending|on it|doing|going)\b/i.test(text))) out.start = s;

  // Total: only a number she really wrote, not a question, not a plan, not a denial.
  if (out.total === undefined && out.more === undefined && !out.all) {
    const n = typeof j.reported_total === "number" && Number.isInteger(j.reported_total) && j.reported_total >= 0 ? j.reported_total : null;
    if (n !== null && report.seen.includes(n) && !report.notDms.includes(n) && !/\?\s*$/.test(text.trim()) && !FUTURE_OR_NEG.test(text)) {
      if (j.total_kind === "more") out.more = n;
      else out.total = n;
    }
    if (j.all_done === true && !FUTURE_OR_NEG.test(text) && !/\?\s*$/.test(text.trim())) out.all = true;
  }

  // Blocked: either the rules or the AI can raise it (a missed blocker is worse than a false alarm), unless she clearly said "no problem".
  if (!out.blocked && !out.cantFinish && j.blocked === true && !/\b(?:no|not a|without any|zero|none)\s+(?:problems?|issues?|trouble)\b|\bnot blocked\b/i.test(text)) {
    out.blocked = true;
    out.blocker = (typeof j.blocker === "string" && j.blocker.trim() ? j.blocker.trim() : text.trim()).slice(0, 300);
  }
  if (j.resolved === true && /\b(?:solved|resolved|fixed|working|sorted|back|continue|okay now|ok now)\b/i.test(text)) out.resolved = true;
  if (out.resolved && !/\bstill\b/i.test(text)) out.blocked = false;

  // Question: rules first; the AI can name break/extension/other.
  if (!out.question && typeof j.question === "string" && ["deadline", "next", "progress", "task", "identity", "howto", "break", "extension", "other"].includes(j.question)) out.question = j.question as Question;
  if (j.delay === true && !out.start && out.total === undefined && out.more === undefined && !out.all) out.delay = true;

  const needsManager = out.blocked || out.cantFinish || out.delay || out.question === "break" || out.question === "extension" || out.question === "other" || (out.question === "howto" && !facts.instructions);
  let sentence = safeSentence(j.sentence, needsManager);
  // When the app passes something to the manager, her reply MUST say so. If the AI's sentence does not, use the app's own.
  if (needsManager && sentence && !/\bmanager\b/i.test(sentence)) sentence = undefined;
  out.sentence = sentence;
  return out;
}
