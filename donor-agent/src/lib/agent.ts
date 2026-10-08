import { newId, readDb, withDb } from "./db";
import { kvGetImage } from "./db";
import { visionEnabled } from "./llm";
import { notify } from "./push";
import { checkProof, readScreenshot } from "./vision";
import { fmtDuration, fmtMinutes, fmtWhen, parseDeadline, parseTarget, zparts } from "./time";
import { extractCheckEvery } from "./time";
import { extractGap, extractInstructions, isAck, parseManager } from "./nlp";
import { understandManager, understandTeammate, type Intent, type Understood } from "./understand";
import type { TeammateFacts } from "./prompts";
import type { ChatMessage, Db, PendingAssignment, Role, Task } from "./types";
import { evidenceCount, nextDelayMin, taskPhase } from "./task-state";

/** Runs work after the reply has been sent. In a request this is Next's after(); elsewhere it runs inline. */
export type Defer = (fn: () => Promise<void>) => void;

const MIN = 60_000;
const ms = (iso: string) => new Date(iso).getTime();

// ---------- facts ----------

export interface Stats {
  total: number;
  todo: number;
  sent: number;
  replied: number;
  skipped: number;
  flagged: number;
  sentToday: number;
  lastActivityAt?: string;
}

export function computeStats(db: Db, now = Date.now()): Stats {
  const tz = db.settings.timezone;
  const today = zparts(now, tz).day;
  const sentDonors = db.donors.filter((d) => d.sentAt);
  const work = db.donors
    .map((d) => d.touchedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  return {
    total: db.donors.length,
    todo: db.donors.filter((d) => d.status === "todo").length,
    sent: sentDonors.length,
    replied: db.donors.filter((d) => d.status === "replied").length,
    skipped: db.donors.filter((d) => d.status === "skipped").length,
    flagged: sentDonors.filter((d) => d.flags.length).length,
    sentToday: sentDonors.filter((d) => zparts(ms(d.sentAt!), tz).day === today).length,
    lastActivityAt: work,
  };
}

export function taskProgress(db: Db, t: Task) {
  if (t.kind === "general") {
    const done = t.status === "review" || t.status === "done" ? 1 : 0;
    return { done, target: 1, flagged: 0 };
  }
  const mine = db.donors.filter((d) => d.sentAt && d.sentAt >= t.createdAt);
  const done = Math.max(t.reportedDone ?? 0, mine.length);
  return { done: Math.min(t.target, done), target: t.target, flagged: mine.filter((d) => d.flags.length).length };
}

/** The last time the teammate did anything: a mark in the app or a chat message. */
function lastTeammateActivity(db: Db): string | undefined {
  return db.donors
    .map((d) => d.touchedAt)
    .concat(db.messages.filter((m) => m.owner === "teammate" && m.from === "user").map((m) => m.at))
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
}

/** The manager's status answer. Every line is a fact from the app. */
export function summarize(db: Db, now = Date.now()): string {
  const name = db.settings.teammateName;
  const tz = db.settings.timezone;
  const task = [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "review") ?? db.tasks.at(-1);
  if (!task) return `No task yet. Tell me what ${name} should do and by when.`;
  const lines: string[] = [];
  const state = task.status === "open" ? "in progress" : task.status === "review" ? "reported done, waiting for you" : task.status;
  lines.push(`${task.title}: ${state}.`);
  if (task.kind === "dms") {
    const proven = evidenceCount(task);
    const reported = task.reportedDone ?? 0;
    lines.push(`${name} says she sent ${reported} of ${task.target}. Proven by screenshot: ${proven}.${reported > proven ? ` ${reported - proven} not proven yet.` : ""}`);
  } else if (task.note) lines.push(`Her note: “${task.note}”`);
  const left = ms(task.deadlineAt) - now;
  lines.push(left > 0 ? `Due ${fmtWhen(ms(task.deadlineAt), now, tz)}, ${fmtDuration(left)} left.` : `The deadline passed ${fmtDuration(-left)} ago.`);
  if (task.status === "open") {
    lines.push(task.startedAt ? `Started ${fmtWhen(ms(task.startedAt), now, tz)}.` : `She has not confirmed that she started.`);
    if (task.blockedReason) lines.push(`She is blocked: “${task.blockedReason}”`);
    const heard = lastTeammateActivity(db);
    lines.push(heard ? `Last message from her: ${fmtDuration(now - ms(heard))} ago.` : "She has not written yet.");
    if (task.nextCheckAt) lines.push(`Next check-in: ${fmtWhen(ms(task.nextCheckAt), now, tz)}.`);
  }
  if (task.evaluation) lines.push(`Review: ${task.evaluation.score}/10 (${task.evaluation.verdict}). ${task.evaluation.advice}`);
  return lines.join("\n");
}

// ---------- messaging ----------

const nextNames = (db: Db, n: number) => db.donors.filter((d) => d.status === "todo").slice(0, n).map((d) => d.name);

/** After she marks a DM as sent: quick praise and the next step. Called inside the same db write. */
export function cheerAfterMark(d: Db) {
  const t = d.tasks.find((x) => x.status === "open" && x.kind === "dms");
  if (!t) return;
  const done = taskProgress(d, t).done;
  const next = nextNames(d, 1)[0];
  const tz = d.settings.timezone;
  let line: string;
  if (done >= t.target) line = `That is the last one. ${done} of ${t.target} done. Amazing work, ${d.settings.teammateName}!`;
  else {
    line = `Nice work! ${done} of ${t.target} done.`;
    if (t.goal && done < t.goal.count) line += ` ${t.goal.count - done} more to reach your goal by ${fmtWhen(ms(t.goal.by), Date.now(), tz)}.`;
    else if (t.goal && done >= t.goal.count) line += " You reached your goal. Keep going!";
    if (next) line += ` Next: ${next}.`;
  }
  say(d, "teammate", line);
}


function say(db: Db, owner: Role, text: string, from: "agent" | "user" | "manager" = "agent", extra: Partial<ChatMessage> = {}) {
  db.messages.push({ id: newId(), owner, from, text, at: new Date().toISOString(), ...extra });
  if (db.messages.length > 400) db.messages = db.messages.slice(-400);
}

interface Push {
  role: Role;
  title: string;
  body: string;
  persistent?: boolean;
  tag?: string;
  receiptId?: string;
  taskId?: string;
}

async function sendPushes(pushes: Push[], defer?: Defer) {
  if (!pushes.length) return;
  const run = async () => {
    await Promise.all(pushes.map((p) => notify(
    p.role,
    p.title,
    p.body.slice(0, 160),
    p.role === "teammate" ? { persistent: p.persistent ?? true, tag: p.tag ?? "donor-desk-action", url: "/", receiptId: p.receiptId, taskId: p.taskId } : {},
    )));
  };
  // Alerts go out after the reply, so nobody waits for the phone network.
  if (defer) defer(run);
  else await run();
}

const confirmedCount = (task: Task) => Math.max(task.reportedDone ?? 0, evidenceCount(task));

function milestoneText(task: Task, now: number, tz: string) {
  const confirmed = confirmedCount(task);
  const verified = evidenceCount(task);
  const elapsed = Math.max(1, now - ms(task.createdAt));
  const rate = confirmed / elapsed;
  const remaining = Math.max(0, task.target - confirmed);
  const eta = rate > 0 ? new Date(now + remaining / rate) : null;
  const onTrack = eta ? eta.getTime() <= ms(task.deadlineAt) : false;
  return `${confirmed}/${task.target} reported, ${verified} proven by screenshot, ${onTrack ? "on track" : "behind"}${eta ? `, finish about ${fmtWhen(eta.getTime(), now, tz)}` : ""}`;
}

// ---------- manager messages ----------

function conversationDeadline(text: string, now: number, db: Db): number | null {
  const direct = parseDeadline(text, now, db.settings.timezone, db.settings.workEndHour);
  if (direct) return direct;
  // A reply to a clarification is often just "6pm" or "100, 6pm".
  const bare = /(?:^|[,;]\s*)(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))(?:\b|$)/i.exec(text);
  return bare ? parseDeadline(`by ${bare[1]}`, now, db.settings.timezone, db.settings.workEndHour) : null;
}

function conversationTarget(text: string): number | null {
  const labelled = parseTarget(text);
  if (labelled !== null) return labelled;
  for (const match of text.matchAll(/\b(\d{1,4})\b/g)) {
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 14);
    const before = text.slice(Math.max(0, (match.index ?? 0) - 10), match.index ?? 0);
    if (/^\s*(?::\d{2}|am|pm|a\.m|p\.m|minutes?|mins?|hours?|hrs?)/i.test(after)) continue;
    if (/\b(?:by|at|before|until|till|every)\s*$/i.test(before)) continue;
    const n = Number(match[1]);
    if (n > 0) return n;
  }
  return null;
}

/** Only checked when the manager sets a gap between DMs. Without a gap there is no rule to break. */
function feasibility(target: number, deadline: number, now: number, gap: number | null) {
  const minutesLeft = Math.max(0, Math.floor((deadline - now) / MIN));
  if (gap === null) return { possible: true, minutesLeft, minutesNeeded: 0, gap: 0, perDm: minutesLeft / Math.max(1, target) };
  const minutesNeeded = target * gap;
  return { possible: minutesNeeded <= minutesLeft, minutesLeft, minutesNeeded, gap, perDm: minutesLeft / Math.max(1, target) };
}

function missingDraft(draft: PendingAssignment): string[] {
  const missing: string[] = [];
  if (draft.kind === "dms" && !draft.target) missing.push("how many DMs");
  if (!draft.deadlineAt) missing.push("the finish time");
  return missing;
}

function clarificationFor(draft: PendingAssignment, name: string): string {
  const missing = missingDraft(draft);
  const question = missing.length === 2
    ? `How many DMs should ${name} send, and by what time?`
    : missing[0] === "how many DMs"
      ? `How many DMs should ${name} send?`
      : `By what time should ${name} finish?`;
  return `I have saved this as a draft and have not sent anything to ${name} yet. ${question}\nYou can answer in one line, for example: “100 by 6pm, only previous donors.”`;
}

function mergeDraft(draft: PendingAssignment, text: string, now: number, db: Db): PendingAssignment {
  const every = extractCheckEvery(text);
  const target = conversationTarget(every.rest) ?? draft.target;
  const deadline = conversationDeadline(every.rest, now, db) ?? (draft.deadlineAt ? ms(draft.deadlineAt) : null);
  const gapMinutes = extractGap(text) ?? draft.gapMinutes;
  const noExtra = /\b(no (?:special )?(?:instructions|precautions)|nothing else|no precautions)\b/i.test(text);
  const instructions = noExtra ? undefined : extractInstructions(text, db.settings.teammateName) ?? draft.instructions;
  return {
    ...draft,
    request: `${draft.request}\n${text}`.trim().slice(0, 3000),
    ...(target ? { target } : {}),
    ...(deadline ? { deadlineAt: new Date(deadline).toISOString() } : {}),
    ...(every.minutes ? { checkEvery: every.minutes } : {}),
    ...(gapMinutes ? { gapMinutes } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

const HELP =
  "Tell me what Areeba should do and by when. For example:\n" +
  "- \"Send 20 DMs by 5pm, check every 20 min\"\n" +
  "- \"Message 30 previous donors only before 6pm\"\n" +
  "Or ask: \"How is she doing?\" / Tell me to pass on a message / say \"cancel\".";

export async function handleManagerMessage(text: string, opts: { defer?: Defer } = {}): Promise<void> {
  const now = Date.now();
  const db = await readDb();
  const userMessage = { kind: "manager-input" as const };
  const parsed = parseManager(text, db.settings.teammateName);
  const openTask = [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "review");
  let intent: Intent;
  let aiStatus = "off";
  const draftNow = db.agent.pendingAssignment;
  // An unfinished assignment takes the manager's next answer ("100, 6pm"), but not thanks, questions, or other commands.
  const answersDraft = !!draftNow && !parsed.isCancel && !parsed.isStatus && !parsed.isConfirm && !parsed.relay && !isAck(text) && !/^(?:hi|hello|hey|thanks|thank you)\b/i.test(text);
  if (draftNow && answersDraft) {
    const draft = mergeDraft(draftNow, text, now, db);
    const missing = missingDraft(draft);
    if (missing.length) {
      await withDb((d) => {
        say(d, "manager", text, "user", userMessage);
        d.agent.pendingAssignment = draft;
        say(d, "manager", clarificationFor(draft, d.settings.teammateName), "agent", { kind: "clarification" });
      });
      return;
    }
    intent = {
      kind: "assign",
      taskKind: draft.kind,
      title: draft.title ?? "",
      target: draft.target ?? null,
      deadline: draft.deadlineAt ? ms(draft.deadlineAt) : null,
      checkEvery: draft.checkEvery ?? null,
      gapMinutes: draft.gapMinutes ?? null,
      brief: draft.instructions,
    };
  } else {
    const u = await understandManager(text, now, db, { openTask, draft: draftNow });
    intent = u.intent;
    aiStatus = u.status;
  }
  const tz = db.settings.timezone;
  const name = db.settings.teammateName;
  const pushes: Push[] = [];
  let reply = HELP;
  let managerReplyKind: ChatMessage["kind"];
  const replacingCurrent = /\b(replace|switch tasks?|replace current|cancel old|stop old)\b/i.test(text);

  await withDb((d) => {
    pushes.length = 0;
    say(d, "manager", text, "user", userMessage);
    if (aiStatus !== "off" && d.agent.llmStatus !== aiStatus) d.agent.llmStatus = aiStatus;
    switch (intent.kind) {
      case "assign": {
        const missing = [
          ...(intent.taskKind === "dms" && !intent.target ? ["how many DMs"] : []),
          ...(!intent.deadline ? ["the finish time"] : []),
        ];
        if (missing.length) {
          const draft: PendingAssignment = {
            kind: intent.taskKind,
            request: text,
            title: intent.title || undefined,
            ...(intent.target ? { target: intent.target } : {}),
            ...(intent.deadline ? { deadlineAt: new Date(intent.deadline).toISOString() } : {}),
            ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}),
            ...(intent.gapMinutes ? { gapMinutes: intent.gapMinutes } : {}),
            ...(intent.brief ? { instructions: intent.brief } : {}),
            createdAt: new Date(now).toISOString(),
          };
          d.agent.pendingAssignment = draft;
          reply = clarificationFor(draft, name);
          managerReplyKind = "clarification";
          break;
        }
        const deadline = intent.deadline!;
        if (deadline <= now + 5 * MIN) {
          reply = "That deadline is too close or already passed. Give me a time at least 10 minutes from now.";
          break;
        }
        if (deadline > now + 14 * 86_400_000) {
          reply = "That deadline is more than 14 days away. Please give a closer time.";
          break;
        }
        if (intent.taskKind === "dms") {
          const check = feasibility(intent.target!, deadline, now, intent.gapMinutes);
          if (!check.possible) {
            const max = Math.max(1, Math.floor(check.minutesLeft / check.gap));
            const draft: PendingAssignment = {
              kind: "dms", request: text, target: intent.target ?? undefined, deadlineAt: new Date(deadline).toISOString(),
              ...(intent.gapMinutes ? { gapMinutes: intent.gapMinutes } : {}), ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}), createdAt: new Date(now).toISOString(),
            };
            d.agent.pendingAssignment = draft;
            reply = `Not possible: ${intent.target} DMs with ${check.gap} min gap needs ${fmtDuration(check.minutesNeeded * MIN)}, you have ${fmtDuration(check.minutesLeft * MIN)}. Options: ${Math.max(1, Math.floor(check.minutesLeft / intent.target!))} min gap, or ${max} DMs. Tell me which one to use.`;
            managerReplyKind = "clarification";
            break;
          }
        }
        const active = [...d.tasks].reverse().find((x) => x.status === "open" || x.status === "review");
        if (active && !replacingCurrent) {
          d.agent.pendingAssignment = {
            kind: intent.taskKind,
            request: intent.brief || text,
            title: intent.title || undefined,
            ...(intent.target ? { target: intent.target } : {}),
            deadlineAt: new Date(deadline).toISOString(),
            ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}),
            ...(intent.gapMinutes ? { gapMinutes: intent.gapMinutes } : {}),
            ...(intent.brief ? { instructions: intent.brief } : {}),
            createdAt: new Date(now).toISOString(),
          };
          reply = `${name} already has an active task: “${active.title}”. I saved the new task privately and sent nothing. Reply “replace current task” to switch, or “cancel” to discard the draft.`;
          managerReplyKind = "clarification";
          break;
        }
        if (active && replacingCurrent) {
          active.status = "cancelled";
          active.closedAt = new Date(now).toISOString();
          say(d, "teammate", `Your manager replaced the previous task: ${active.title}. Please use the new task below.`);
        }
        const target = intent.taskKind === "dms" ? intent.target! : 1;
        const title = intent.title || `Send ${target} donor DMs`;
        const task: Task = {
          id: newId(),
          title,
          kind: intent.taskKind,
          target,
          createdAt: new Date(now).toISOString(),
          deadlineAt: new Date(deadline).toISOString(),
          status: "open",
          unanswered: 0,
          // A new assignment needs a quick start/progress signal; later reports are paced at five minutes.
          nextCheckAt: new Date(now + 3 * MIN).toISOString(),
          ...(intent.brief ? { brief: intent.brief } : {}),
          ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}),
          ...(intent.gapMinutes ? { gapMinutes: intent.gapMinutes } : {}),
          remindersEnabled: true,
          timerEnabled: true,
          lastReportAt: new Date(now).toISOString(),
        };
        d.tasks.push(task);
        d.agent.pendingAssignment = undefined;
        const when = fmtWhen(deadline, now, tz);
        const how = intent.taskKind === "dms"
          ? "Send the DMs in WhatsApp using the list and instructions your manager already gave you. Report your total here; you do not need to add donors to this app."
          : "Complete the task and report your result here.";
        const cadence = intent.gapMinutes ? `\n\nYour DM timer is on: one reminder every ${fmtMinutes(intent.gapMinutes)}.` : "";
        const extra = intent.brief ? `\nSpecial instructions: ${intent.brief}` : "";
        say(
          d,
          "teammate",
          `NEW TASK\n\n${title}\nDue: ${when}${extra}\n\n${how}${cadence}\n\nReply “I started” when you begin. For each update, tell me how many you have sent in total and attach a screenshot of a sent message. If anything blocks you, tell me here.`,
          "agent",
          { kind: "kickoff" },
        );
        pushes.push({ role: "teammate", title: "New task for you", body: `Hi ${name}, ${title}. Due ${when}. Please reply when you can.` });
        const pace = intent.taskKind === "dms" ? feasibility(target, deadline, now, null).perDm : Infinity;
        reply =
          `Sent to ${name}.\n${title}\nDue: ${when}` +
          (intent.brief ? `\nInstructions I gave her: ${intent.brief}` : "") +
          (intent.gapMinutes ? `\nShe must wait ${fmtMinutes(intent.gapMinutes)} between DMs.` : "") +
          `\nI will ask her to confirm she started within 3 minutes, then ask for a report every ${intent.checkEvery ?? 5} minutes. A DM only counts as proven when she sends a screenshot. I will alert you at every 10 DMs, and review the task when it ends.` +
          (pace < 1 ? `\nNote: that is less than 1 minute per DM. It is very tight.` : "");
        managerReplyKind = "task";
        break;
      }
      case "status":
        reply = summarize(d, now);
        break;
      case "relay":
        say(d, "teammate", `Message from your manager: ${intent.text}`);
        pushes.push({ role: "teammate", title: "Message from your manager", body: intent.text });
        reply = `Sent to ${name}: "${intent.text}"`;
        break;
      case "cancel": {
        if (d.agent.pendingAssignment) {
          d.agent.pendingAssignment = undefined;
          reply = "Draft discarded. Nothing was sent to Areeba.";
          break;
        }
        const t = [...d.tasks].reverse().find((x) => x.status === "open" || x.status === "review");
        if (!t) {
          reply = "There is no open task to cancel.";
          break;
        }
        t.status = "cancelled";
        t.closedAt = new Date(now).toISOString();
        say(d, "teammate", `Your manager cancelled the task: ${t.title}.`);
        pushes.push({ role: "teammate", title: "Task cancelled", body: t.title });
        reply = `Cancelled: ${t.title}.`;
        break;
      }
      case "confirm": {
        const t = d.tasks.find((x) => x.status === "review");
        if (!t) {
          reply = "Nothing is waiting for your confirmation.";
          break;
        }
        t.status = "done";
        t.closedAt = new Date(now).toISOString();
        say(d, "teammate", `Your manager confirmed: ${t.title}. Thank you.`);
        pushes.push({ role: "teammate", title: "Confirmed", body: t.title });
        reply = `Confirmed: ${t.title}.`;
        break;
      }
      case "chat":
        reply =
          intent.reply ||
          (/^\s*(?:thanks?|thank you|thx|ok(?:ay)?|great|good|nice|perfect)\b/i.test(text)
            ? "You're welcome."
            : /^\s*(?:hi|hello|hey|good (?:morning|evening|afternoon))\b/i.test(text)
              ? `Hello. Tell me what ${name} should do, or ask me how she is doing.`
              : HELP);
    }
    say(d, "manager", reply, "agent", { kind: managerReplyKind ?? "agent" });
  });
  await sendPushes(pushes, opts.defer);
}

// ---------- teammate messages ----------

/** The manager writes straight into the teammate's chat. */
export async function handleManagerToTeammate(text: string, opts: { defer?: Defer } = {}): Promise<void> {
  await withDb((d) => {
    say(d, "teammate", text, "manager");
  });
  await sendPushes([{ role: "teammate", title: "Message from your manager", body: text }], opts.defer);
}

export interface ChatImage {
  id: string;
  hash: string;
  dataUrl: string;
}

const iso = (t: number) => new Date(t).toISOString();
const normName = (s: string) => s.toLowerCase().replace(/\W/g, "");

/** Plain facts for the AI: no internal fields, times in words, nothing to guess. */
function teammateFacts(task: Task | undefined, db: Db, now: number, lastAsk?: string): TeammateFacts {
  const tz = db.settings.timezone;
  const p = zparts(now, tz);
  const nowText = `${p.day} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")} (${tz})`;
  if (!task) return { now: nowText, task: null, lastAsk };
  const left = ms(task.deadlineAt) - now;
  return {
    now: nowText,
    task: task.title,
    instructions: task.brief,
    target: task.kind === "dms" ? task.target : undefined,
    reported: task.reportedDone ?? 0,
    proven: evidenceCount(task),
    due: fmtWhen(ms(task.deadlineAt), now, tz),
    left: left > 0 ? fmtDuration(left) : "none, the deadline passed",
    started: !!task.startedAt,
    blocked: task.blockedReason ?? null,
    lastAsk,
  };
}

/** What she should do now. Always specific to where the task is. */
function nextStep(task: Task | undefined): string {
  if (!task) return "";
  switch (taskPhase(task)) {
    case "awaiting-start":
      return "Please tell me when you start.";
    case "blocked":
      return "Tell me when the problem is fixed, or what you need from your manager.";
    case "awaiting-proof":
      return "Please send a screenshot that shows the person and your sent message.";
    case "missed":
      return "Please send your final total and a screenshot, or tell me what is unfinished.";
    case "review":
      return "Your manager is reviewing your work.";
    default:
      return task.kind === "dms" ? "When you send more, tell me your total and add a screenshot of a sent message." : "Tell me when it is done and what you did.";
  }
}

/** A friendly sentence when there is no AI, or when the AI sentence is not safe to show. */
function ruleSentence(u: Understood, hadReport: boolean): string {
  if (u.blocked) return "Thank you for telling me. I am letting your manager know.";
  if (u.resolved) return "Good, I am glad it is fixed.";
  if (u.question === "break") return "I will ask your manager and tell you.";
  if (u.question === "extension") return "I will ask your manager for more time and tell you what they say.";
  if (u.question === "other") return "I cannot answer that myself, so I am asking your manager.";
  if (u.start === "started") return "Thanks, I noted that you started.";
  if (u.start === "will-start") return "Okay. Please tell me when you start.";
  if (u.start === "not-started") return "Please start as soon as you can. Tell me if something is stopping you.";
  if (u.all) return "Thanks, I noted that you finished.";
  if (hadReport) return "Thanks for the update.";
  if (u.ack) return "Okay.";
  return "Thanks, I saved your message.";
}

interface ReplyInfo {
  reportedNow: boolean;
  clampedFrom?: number;
  imageChecking?: boolean;
  imageRejectedNow?: string;
}

/** The reply to her: a human sentence (AI or rules), then facts the app wrote itself, then one clear next step. */
function buildReply(u: Understood, t: Task | undefined, d: Db, now: number, info: ReplyInfo): string {
  const tz = d.settings.timezone;
  if (!t) return u.sentence && !u.question ? `${u.sentence}\nThere is no active task right now. Your manager will send the next one here.` : "There is no active task right now. Your manager will send the next one here.";
  const left = ms(t.deadlineAt) - now;
  const reported = t.reportedDone ?? 0;
  const proven = evidenceCount(t);

  // Questions the app can answer exactly are answered from facts, never by the AI.
  if (u.question === "deadline")
    return left > 0 ? `Your deadline is ${fmtWhen(ms(t.deadlineAt), now, tz)}. You have ${fmtDuration(left)} left.` : `The deadline passed ${fmtDuration(-left)} ago. ${nextStep({ ...t, status: "missed" })}`;
  if (u.question === "next") return [nextStep(t), t.brief ? `Your manager's instructions: ${t.brief}.` : ""].filter(Boolean).join("\n");
  if (u.question === "progress")
    return t.kind === "dms"
      ? `You told me ${reported} of ${t.target}. Proven by screenshot: ${proven}.${reported > proven ? ` ${nextStep(t)}` : ""}`
      : `Your task is ${t.status === "review" ? "waiting for your manager" : "still open"}. ${nextStep(t)}`;

  const parts: string[] = [u.sentence ?? ruleSentence(u, info.reportedNow)];
  if (info.reportedNow && t.kind === "dms") {
    parts.push(
      info.clampedFrom ? `You wrote ${info.clampedFrom}, but the task is ${t.target}. I recorded ${t.target}.` : `Recorded: ${reported} of ${t.target} DMs.`,
    );
    parts.push(`Proven by screenshot: ${proven}.`);
  }
  if (info.imageRejectedNow) parts.push(info.imageRejectedNow);
  else if (info.imageChecking) parts.push("I am checking your screenshot now.");
  else if (t.kind === "dms" && reported > proven && !u.blocked) parts.push("Please send a screenshot that shows the person and your sent message.");
  else if (u.start === "started") parts.push(`I will check in again in ${fmtMinutes(nextDelayMin(t))}.`);
  else if (!u.blocked && !u.question && !u.ack) {
    const step = nextStep(t);
    if (step && !parts[0].includes(step)) parts.push(step);
  } else if (u.blocked) parts.push(nextStep(t));
  return parts.filter(Boolean).join("\n");
}

/** After any progress: alert the manager at every 10 DMs, and move a finished task to review. */
function afterProgress(d: Db, t: Task, now: number, pushes: Push[], name: string, text: string) {
  if (t.kind !== "dms") return;
  const confirmed = confirmedCount(t);
  const milestone = Math.floor(confirmed / 10) * 10;
  if (milestone >= 10 && milestone > (t.lastMilestone ?? 0)) {
    t.lastMilestone = milestone;
    const update = milestoneText(t, now, d.settings.timezone);
    say(d, "manager", update, "agent", { kind: "update" });
    pushes.push({ role: "manager", title: `${milestone}/${t.target} reported, ${evidenceCount(t)} proven`, body: update });
  }
  if (t.status !== "open" || confirmed < t.target) return;
  const proven = evidenceCount(t);
  const canVerify = visionEnabled();
  if (proven >= t.target || !canVerify) {
    t.status = "review";
    t.reviewAt ??= iso(now);
    t.note = text.trim() ? text.trim().slice(0, 300) : canVerify ? "All DMs are proven by screenshot." : "The AI is off: screenshots are saved but were not checked.";
    pushes.push({ role: "manager", title: `${name} finished`, body: `${t.title}: ${proven} of ${t.target} proven.` });
  } else {
    t.note = "She says it is complete, but the screenshots do not prove every DM yet.";
  }
}

export async function handleTeammateMessage(text: string, image?: ChatImage | null, opts: { defer?: Defer } = {}): Promise<void> {
  const now = Date.now();
  const db = await readDb();
  const name = db.settings.teammateName;
  // She can say "cancel" or "stop" to ask her manager to cancel the task.
  if (/^(cancel|stop|discard|forget it|never mind)\b/i.test(text.trim()) && !image) {
    const t = [...db.tasks].reverse().find((x) => x.status === "open" || x.status === "review");
    const pushes: Push[] = [];
    await withDb((d) => {
      say(d, "teammate", text, "user");
      say(d, "teammate", t ? `I passed your cancel request to your manager. They will reply.` : "There is no task to cancel right now.");
      if (t) {
        say(d, "manager", `${name} asked to cancel the task "${t.title}". Reply "cancel" to confirm, or write to her.`, "agent", { kind: "update" });
        pushes.push({ role: "manager", title: `${name} wants to cancel`, body: t.title });
      }
    });
    await sendPushes(pushes, opts.defer);
    return;
  }
  const task =
    [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "review") ?? (db.tasks.at(-1)?.status === "missed" ? db.tasks.at(-1) : undefined);
  const lastAsk = [...db.messages].reverse().find((m) => m.owner === "teammate" && m.from === "agent" && (m.kind === "checkin" || m.kind === "kickoff" || m.kind === "clarification"))?.text;
  // One AI call reads the message and writes a friendly sentence. Screenshots are read after the reply.
  const u = await understandTeammate(text, teammateFacts(task, db, now, lastAsk), name);

  const pushes: Push[] = [];
  let screenshotTask: string | undefined;
  await withDb((d) => {
    if (u.status !== "off" && d.agent.llmStatus !== u.status) d.agent.llmStatus = u.status;
    say(d, "teammate", text || "(screenshot)", "user", image ? { img: image.id } : {});
    d.agent.teammateLastSeenAt = iso(now);
    const t = task && d.tasks.find((x) => x.id === task.id && ["open", "review", "missed"].includes(x.status));
    const info: ReplyInfo = { reportedNow: false };
    const hadStarted = !!t?.startedAt;
    let managerLine = "";
    let managerPush: { title: string; body: string } | null = null;

    if (t) {
      // Any message from her means she is answering, so she is not "silent".
      t.unanswered = 0;
      t.escalationSent = false;
      if (u.blocked) {
        t.blockedReason = (u.blocker ?? text).slice(0, 300);
        t.reminderPausedUntil = iso(now + 10 * MIN);
      } else if (u.resolved) t.blockedReason = undefined;
      if (u.start === "started") t.startedAt ??= iso(now);

      if (t.kind === "dms") {
        let total = u.total;
        if (u.all) total = t.target;
        if (total === undefined && u.more !== undefined) total = (t.reportedDone ?? 0) + u.more;
        if (total !== undefined) {
          if (total > t.target) info.clampedFrom = total;
          t.reportedDone = Math.min(t.target, total);
          t.lastProgressAt = iso(now);
          t.lastReportAt = iso(now);
          t.startedAt ??= iso(now);
          info.reportedNow = true;
        }
      } else if (u.all && t.status === "open") {
        t.status = "review";
        t.reviewAt ??= iso(now);
        t.note = text.slice(0, 300);
        managerPush = { title: `${name} says it is done`, body: `${t.title}: “${text.slice(0, 100)}”` };
        managerLine = `${name} says this is done: “${text.slice(0, 300)}”. Confirm it, or ask her for more.`;
      }

      if (image) {
        const duplicate = !!d.hashes[image.hash];
        if (!duplicate) d.hashes[image.hash] = t.id;
        if (duplicate) {
          info.imageRejectedNow = "I already received this exact image, so it does not count. Please send a new screenshot.";
          t.evidence = [...(t.evidence ?? []), { imageId: image.id, at: iso(now), verdict: "rejected" as const, reason: "This image was already submitted." }].slice(-300);
          t.proofCount = t.evidence.length;
        } else if (visionEnabled()) {
          info.imageChecking = true;
          screenshotTask = t.id;
        } else {
          info.imageRejectedNow = "I saved your screenshot for your manager. The AI is off, so I cannot check it myself.";
          t.evidence = [...(t.evidence ?? []), { imageId: image.id, at: iso(now), verdict: "unclear" as const, reason: "Saved, not checked: the AI is off." }].slice(-300);
          t.proofCount = t.evidence.length;
        }
        t.lastProofAt = iso(now);
      }

      // The next report request follows the phase she is in now.
      if (u.start === "started" || u.blocked || u.resolved || info.reportedNow) t.nextCheckAt = iso(now + nextDelayMin(t) * MIN);

      const phaseNote = u.blocked
        ? { line: `${name} needs help: “${t.blockedReason}”`, push: { title: `${name} needs help`, body: t.blockedReason ?? text } }
        : u.question === "break" || u.question === "extension" || u.question === "other"
          ? { line: `${name} asks${u.question === "break" ? " for a break" : u.question === "extension" ? " for more time" : ""}: “${text.slice(0, 300)}”`, push: { title: `${name} has a question`, body: text.slice(0, 140) } }
          : !hadStarted && t.startedAt && u.start === "started"
            ? { line: `${name} confirmed she started: ${t.title}.`, push: { title: `${name} started`, body: t.title } }
            : null;
      if (phaseNote) {
        managerLine = phaseNote.line;
        managerPush = phaseNote.push;
      } else if (info.reportedNow && !managerLine) {
        managerLine = `${name} reports ${t.reportedDone} of ${t.target} DMs. Proven by screenshot: ${evidenceCount(t)}.`;
      }
      if (u.resolved && !u.blocked) managerLine = managerLine || `${name} says the problem is fixed.`;
      afterProgress(d, t, now, pushes, name, u.all ? text : "");
    } else if (u.question === "break" || u.question === "extension" || u.question === "other" || u.blocked) {
      managerLine = `${name} wrote: “${text.slice(0, 300)}”`;
      managerPush = { title: `${name} wrote`, body: text.slice(0, 140) };
    }

    say(d, "teammate", buildReply(u, t, d, now, info));
    if (managerLine) {
      say(d, "manager", managerLine, "agent", { kind: "update", ...(image && !info.imageChecking ? { img: image.id } : {}) });
      if (managerPush) pushes.push({ role: "manager", title: managerPush.title, body: managerPush.body });
    }
  });
  await sendPushes(pushes, opts.defer);

  if (screenshotTask && image) {
    const taskId = screenshotTask;
    const finish = () => checkScreenshot(taskId, image, opts.defer);
    if (opts.defer) opts.defer(finish);
    else await finish();
  }
}

/** Reads one screenshot (the slow part), then records what it shows and tells both people. */
async function checkScreenshot(taskId: string, image: ChatImage, defer?: Defer): Promise<void> {
  const db = await readDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const name = db.settings.teammateName;
  const scan = await readScreenshot(image.dataUrl, `${task.title}${task.brief ? `. Instructions: ${task.brief}` : ""}`);
  const seen = scan.seen;
  const supported = seen?.is_chat === true && seen.message_sent === true && !!seen.person_name && !!seen.message_text;
  const quality = supported && typeof seen!.message_quality === "number" ? Math.min(5, Math.max(1, Math.round(seen!.message_quality))) : undefined;
  const issues = supported && Array.isArray(seen!.quality_issues) ? seen!.quality_issues.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 3) : [];
  const now = Date.now();
  const pushes: Push[] = [];
  await withDb((d) => {
    if (scan.status !== "off" && d.agent.llmStatus !== scan.status) d.agent.llmStatus = scan.status;
    const t = d.tasks.find((x) => x.id === taskId && ["open", "review", "missed"].includes(x.status));
    if (!t) return;
    const already = supported && (t.evidence ?? []).some((e) => e.verdict === "supported" && e.recipient && normName(e.recipient) === normName(seen!.person_name!));
    const verdict: "supported" | "rejected" | "unclear" = already ? "rejected" : supported ? "supported" : seen?.is_chat === false || seen?.message_sent === false ? "rejected" : "unclear";
    const reason = already
      ? `${seen!.person_name} was already counted, so this does not add a new DM. Please send a screenshot of a different person.`
      : supported
        ? `I can see a sent message to ${seen!.person_name}. That counts as one proven DM.`
        : seen?.summary
          ? `This does not prove a sent DM: ${seen.summary.replace(/[.\s]+$/, "")}. Please send a screenshot that shows the person's name and your sent message.`
          : "I could not read this image. Please send a clearer screenshot that shows the person's name and your sent message.";
    t.evidence = [
      ...(t.evidence ?? []),
      { imageId: image.id, at: iso(now), verdict, reason, ...(verdict === "supported" && seen?.person_name ? { recipient: seen.person_name } : {}), ...(quality !== undefined ? { quality } : {}), ...(issues.length ? { issues } : {}) },
    ].slice(-300);
    t.proofCount = t.evidence.length;
    t.lastProofAt = iso(now);
    if (verdict === "supported") {
      t.startedAt ??= iso(now);
      t.lastProgressAt = iso(now);
      t.nextCheckAt = iso(now + nextDelayMin(t) * MIN);
    }
    afterProgress(d, t, now, pushes, name, "");
    const proven = evidenceCount(t);
    const tip = verdict === "supported" && quality !== undefined && quality <= 2 && issues.length ? ` About your message: ${issues[0].replace(/[.\s]+$/, "")}.` : "";
    say(d, "teammate", `${reason} Proven so far: ${proven} of ${t.target}.${tip}`);
    const line = `${name} sent a screenshot. ${verdict === "supported" ? `Proven: ${seen!.person_name}${quality !== undefined ? `, message quality ${quality}/5` : ""}.` : `Not counted: ${reason}`} Proven so far: ${proven} of ${t.target}.`;
    say(d, "manager", line, "agent", { kind: "update", img: image.id });
    pushes.push({ role: "manager", title: verdict === "supported" ? `${name}: ${proven}/${t.target} proven` : `${name}: screenshot not counted`, body: line });
  });
  await sendPushes(pushes, defer);
}

/** Runs after "Mark sent". Reads the screenshot and records whether it shows that donor. */
export async function verifyProof(donorId: string, imageId: string): Promise<void> {
  const url = await kvGetImage(imageId);
  const db = await readDb();
  const donor = db.donors.find((d) => d.id === donorId);
  if (!url || !donor || donor.proofImg !== imageId) return;
  const check = await checkProof(url, donor);
  const pushes: Push[] = [];
  await withDb((d) => {
    pushes.length = 0;
    const x = d.donors.find((y) => y.id === donorId);
    if (!x || x.proofImg !== imageId) return;
    x.proofCheck = check;
    const name = d.settings.teammateName;
    if (check.verdict === "mismatch" || check.verdict === "unclear") {
      const flag = check.verdict === "mismatch" ? `screenshot does not match: ${check.reason}` : `screenshot unclear: ${check.reason}`;
      if (!x.flags.includes(flag)) x.flags.push(flag);
    }
    if (check.verdict === "mismatch") {
      say(d, "teammate", `The screenshot for ${x.name} does not match. ${check.reason}\nPlease send the right screenshot, or tell me what happened.`);
      say(d, "manager", `Screenshot problem: ${name} marked ${x.name} as sent, but ${check.reason}`);
      pushes.push({ role: "teammate", title: "Screenshot does not match", body: `${x.name}: ${check.reason}` });
      pushes.push({ role: "manager", title: "Screenshot does not match", body: `${x.name}: ${check.reason}` });
    } else if (check.verdict === "unclear") {
      say(d, "teammate", `I could not confirm the screenshot for ${x.name}. ${check.reason}\nPlease send a clearer one. Show the contact name and your sent message.`);
      pushes.push({ role: "teammate", title: "Please send a clearer screenshot", body: x.name });
    }
  });
  await sendPushes(pushes);
}

// ---------- the clock: runs every minute ----------

export interface RunResult {
  actions: string[];
}

export async function runAgent(nowMs = Date.now(), taskId?: string): Promise<RunResult> {
  const result = await withDb((d) => {
    const task = [...d.tasks].reverse().find(t => t.status === "open" && (!taskId || t.id === taskId));
    d.agent.lastRunAt = new Date(nowMs).toISOString();
    const pushes: Push[] = [];
    const actions: string[] = [];
    if (!task) return { pushes, actions };
    const name = d.settings.teammateName;
    const now = new Date(nowMs).toISOString();
    if (!d.subs.some(s => s.role === "teammate") && !task.alertsProblemAt) {
      task.alertsProblemAt = now;
      const line = `${name}'s phone has no working alerts. She may be offline or have alerts off.`;
      say(d, "manager", line, "agent", { kind: "update" });
      pushes.push({ role: "manager", title: "Areeba alerts are off", body: line });
    }
    for (const receipt of task.pushReceipts ?? []) {
      if (!receipt.receivedAt && !receipt.missingAlertedAt && nowMs >= ms(receipt.issuedAt) + 2 * MIN) {
        receipt.missingAlertedAt = now;
        const line = `${name}'s phone did not receive ${receipt.label}. She may be offline or have alerts off.`;
        say(d, "manager", line, "agent", { kind: "update" });
        pushes.push({ role: "manager", title: "Alert not received", body: line });
      }
    }
    if (task.gapMinutes && task.timerEnabled !== false && nowMs < ms(task.deadlineAt) && nowMs >= ms(task.lastTimerAt ?? task.startedAt ?? task.createdAt) + task.gapMinutes * MIN) {
      task.lastTimerAt = now;
      const next = Math.min(task.target, confirmedCount(task) + 1);
      const receiptId = newId();
      task.pushReceipts = [...(task.pushReceipts ?? []), { id: receiptId, label: `DM timer alert`, issuedAt: now }].slice(-80);
      pushes.push({ role: "teammate", title: "Time to send the next DM", body: `Time to send DM ${next} of ${task.target}.`, persistent: true, tag: `dm-timer-${task.id}`, receiptId, taskId: task.id });
      actions.push("timer");
    }
    if (task.remindersEnabled === false) return { pushes, actions };
    if (task.reminderPausedUntil && nowMs < ms(task.reminderPausedUntil)) return { pushes, actions };
    const due = task.nextCheckAt ?? new Date(ms(task.lastReportAt ?? task.startedAt ?? task.createdAt) + 3 * MIN).toISOString();
    if (nowMs < ms(due)) return { pushes, actions };
    if (ms(task.deadlineAt) <= nowMs) {
      if ((task.finalRequests ?? 0) >= 3) {
        task.status = "missed";
        task.closedAt = now;
        say(d, "teammate", `The task “${task.title}” is closed as missed. You can still send proof here; your manager will see it.`, "agent", { kind: "update" });
        say(d, "manager", `${name}: “${task.title}” closed as missed. ${evidenceCount(task)} of ${task.target} proven${task.reportedDone ? `, ${task.reportedDone} reported` : ""}. A review follows.`, "agent", { kind: "update" });
        pushes.push({ role: "manager", title: "Task missed", body: `${task.title}: ${evidenceCount(task)} of ${task.target} proven.` });
        actions.push("missed");
        return { pushes, actions };
      }
      task.finalRequests = (task.finalRequests ?? 0) + 1;
      if (!task.deadlineAlerted) {
        task.deadlineAlerted = true;
        say(d, "teammate", "The deadline has passed. Send your final total and proof, or explain what is unfinished.", "agent", { kind: "checkin" });
        say(d, "manager", `${name}: deadline passed; final total and proof requested.`, "agent", { kind: "update" });
        pushes.push({role:"manager", title:"Deadline passed", body:`${name}: final total and proof requested.`});
      }
      pushes.push({role:"teammate", title:"Urgent: final report", body:"The deadline passed. Send your final total and proof now.", persistent:true, tag:`deadline-${task.id}`, receiptId:newId(), taskId:task.id});
      task.nextCheckAt = new Date(nowMs + 10 * MIN).toISOString();
      actions.push("deadline");
      return { pushes, actions };
    }
    const phase = taskPhase(task);
    const n = task.unanswered + 1;
    const message = phase === "awaiting-start"
      ? `Hi ${name}, can you start “${task.title}” now? Reply “I started” when you begin, or tell me what is stopping you.`
      : phase === "blocked"
      ? "Your manager has been told about the blocker. Has it been resolved, or do you still need help?"
      : phase === "awaiting-proof"
      ? `You reported ${task.reportedDone} DMs. Please send readable proof showing the recipient and sent message. Evidence currently supports ${evidenceCount(task)} distinct recipients.`
      : task.kind === "dms"
      ? (() => {
          const elapsed = Math.max(1, nowMs - ms(task.createdAt));
          const expected = Math.min(task.target, Math.floor((elapsed / Math.max(1, ms(task.deadlineAt) - ms(task.createdAt))) * task.target));
          const behind = Math.max(0, expected - confirmedCount(task));
          return behind > 0
            ? `You are ${behind} DMs behind pace. Please send ${Math.max(1, Math.ceil(behind + task.target / Math.max(1, (ms(task.deadlineAt) - nowMs) / (10 * MIN))))} DMs in the next 10 minutes, then report your total or a problem.`
            : `Quick update, ${name}: how many DMs have you sent in total? Add a screenshot of your latest sent message. Let me know if anything is blocking you.`;
        })()
      : `How is “${task.title}” going? Tell me what is finished and what remains. Attach proof if available.`;
    say(d, "teammate", message, "agent", { kind:"checkin" });
    task.lastCheckAt = new Date(nowMs).toISOString();
    task.unanswered = n;
    // Back off after repeated unanswered requests; keep the outstanding request visible.
    task.lastReminderAt = now;
    task.nextCheckAt = new Date(nowMs + nextDelayMin(task) * MIN).toISOString();
    task.reminderCount = (task.reminderCount ?? 0) + 1;
    const receiptId = newId();
    task.pushReceipts = [...(task.pushReceipts ?? []), { id: receiptId, label: `reminder ${task.reminderCount}`, issuedAt: now }].slice(-80);
    pushes.push({role:"teammate",title:phase === "awaiting-start" ? "Please confirm you started" : phase === "awaiting-proof" ? "Proof still needed" : "Report due",body:message,persistent:true,tag:`report-${task.id}`,receiptId,taskId:task.id});
    if (n >= 2 && (!task.lastSilentAlertAt || nowMs >= ms(task.lastSilentAlertAt) + 10 * MIN)) {
      task.lastSilentAlertAt = now;
      const note = `${name} is not answering, call her.`;
      say(d,"manager",note,"agent",{kind:"update"});
      pushes.push({role:"manager",title:"Your attention is needed",body:note});
    }
    actions.push(phase);
    return { pushes, actions };
  });
  await sendPushes(result.pushes);
  return { actions: result.actions };
}
