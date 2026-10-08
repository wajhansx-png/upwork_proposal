import { newId, readDb, withDb } from "./db";
import { kvGetImage } from "./db";
import { notify } from "./push";
import { checkProof } from "./vision";
import { fmtDuration, fmtMinutes, fmtWhen, parseDeadline, parseTarget, zparts } from "./time";
import { extractCheckEvery } from "./time";
import { extractGap, extractInstructions, managerCommand, parseManager, type ManagerCommand } from "./nlp";
import { understandManager, understandTeammate, type Intent, type Understood } from "./understand";
import type { TeammateFacts } from "./prompts";
import type { ChatMessage, Db, PendingAssignment, Role, Task } from "./types";
import { evidenceCount, nextDelayMin, nextPlannedCheckin, taskPhase } from "./task-state";

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

/** The manager's status answer: short, every line a fact, and what (if anything) waits for him. */
export function summarize(db: Db, now = Date.now()): string {
  const name = db.settings.teammateName;
  const tz = db.settings.timezone;
  const task = [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "review") ?? db.tasks.at(-1);
  if (!task) return `No task yet. Tell me what ${name} should do and by when, like “${name} send 100 DMs by 9pm”.`;
  const lines: string[] = [];
  const done = task.reportedDone ?? 0;
  const left = ms(task.deadlineAt) - now;
  const state =
    task.status === "review" ? "Finished, waiting for your OK" :
    task.status === "done" ? "Done" :
    task.status === "missed" ? "Missed the deadline" :
    task.status === "cancelled" ? "Cancelled" :
    task.blockedReason ? `Blocked: “${task.blockedReason}”` :
    !task.startedAt ? "Not started yet" :
    task.unanswered >= 2 ? "Not replying" : "Working";
  lines.push(task.kind === "dms" ? `${name}: ${done} of ${task.target} sent (${Math.max(0, task.target - done)} to go). ${state}.` : `${name}: ${task.title}. ${state}.`);
  if (task.status === "open") {
    lines.push(left > 0 ? `Due ${fmtWhen(ms(task.deadlineAt), now, tz)}, ${fmtDuration(left)} left.` : `The deadline passed ${fmtDuration(-left)} ago.`);
    if (task.kind === "dms" && left > 0 && done < task.target) {
      const perHour = Math.ceil((task.target - done) / Math.max(left / 3_600_000, 1 / 60));
      const startedMs = task.startedAt ? ms(task.startedAt) : null;
      const rate = startedMs && now - startedMs > 10 * MIN ? done / ((now - startedMs) / 3_600_000) : null;
      lines.push(`She needs about ${perHour} per hour${rate !== null ? `; her speed so far is about ${Math.round(rate)} per hour${rate >= perHour ? " (on track)" : " (too slow)"}` : ""}.`);
    }
  }
  const heard = lastTeammateActivity(db);
  const lastWords = [...db.messages].reverse().find((m) => m.owner === "teammate" && m.from === "user" && m.text && m.at >= task.createdAt);
  lines.push(heard ? `Last heard ${now - ms(heard) < MIN ? "just now" : `${fmtDuration(now - ms(heard))} ago`}${lastWords ? `: “${lastWords.text.slice(0, 120)}”` : ""}.` : "She has not replied yet. I push her every 4 minutes until she does.");
  if (task.status === "open" && task.unanswered >= 2) lines.push(`I have asked ${task.unanswered} times. I keep pushing her every 4 minutes.`);
  if (task.pendingAsk) lines.push(`She is waiting for your answer: “${task.pendingAsk.text.slice(0, 120)}”. Reply “yes”, “no”, or your answer.`);
  if (task.evaluation) lines.push(`Review: ${task.evaluation.score}/10 (${task.evaluation.verdict}). ${task.evaluation.advice}`);
  return lines.join("\n");
}

/** "tell her to send her update" -> "send your update". */
function toHer(text: string, name: string) {
  return text
    .replace(/\bshe is\b/gi, "you are")
    .replace(/\bshe has\b/gi, "you have")
    .replace(/\bshe was\b/gi, "you were")
    .replace(/\bherself\b/gi, "yourself")
    .replace(/\bher\b/gi, "your")
    .replace(/\bshe\b/gi, "you")
    .replace(new RegExp(`\\b${name}\\b,?\\s*`, "gi"), "")
    .replace(/^\s*\w/, (c) => c.toUpperCase());
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
    p.role === "teammate" ? { persistent: p.persistent ?? true, tag: p.tag ?? "donor-desk-action", url: "/areeba", receiptId: p.receiptId, taskId: p.taskId } : { tag: p.tag, url: "/manager" },
    )));
  };
  // Alerts go out after the reply, so nobody waits for the phone network.
  if (defer) defer(run);
  else await run();
}

const confirmedCount = (task: Task) => Math.max(task.reportedDone ?? 0, evidenceCount(task));

function milestoneText(task: Task, now: number, tz: string) {
  const claimed = task.reportedDone ?? 0;
  const verified = evidenceCount(task);
  // Rate from when she really started, not when the task was created.
  const startedAt = task.startedAt ? ms(task.startedAt) : ms(task.createdAt);
  const elapsed = Math.max(1, now - startedAt);
  const rate = claimed / elapsed;
  const remaining = Math.max(0, task.target - claimed);
  const etaMs = rate > 0 ? now + remaining / rate : null;
  const onTrack = etaMs !== null && etaMs <= ms(task.deadlineAt);
  // Only show an ETA that is in the future and inside this task's window.
  const etaText = etaMs !== null && etaMs > now && etaMs <= ms(task.deadlineAt) + 24 * 3600_000 ? `, finish about ${fmtWhen(etaMs, now, tz)}` : "";
  void verified;
  return `${claimed}/${task.target} sent, ${onTrack ? "on track" : "behind"}${etaText}`;
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
  const noExtra = /\b(no (?:special )?(?:instructions|precautions)|nothing else|no precautions)\b/i.test(text) || /^\s*(?:yes,?\s*)?(?:replace|switch)\b/i.test(text);
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

/** Commands about the running task: change time or target, push her now, answer her question, status. */
async function runManagerCommand(cmd: ManagerCommand, text: string, now: number, defer?: Defer): Promise<void> {
  const pushes: Push[] = [];
  await withDb((d) => {
    const name = d.settings.teammateName;
    const tz = d.settings.timezone;
    say(d, "manager", text, "user", { kind: "manager-input" });
    const t = [...d.tasks].reverse().find((x) => x.status === "open" || x.status === "missed" || x.status === "review");
    const tell = (msg: string, title: string) => {
      say(d, "teammate", msg, "agent", { kind: "update" });
      pushes.push({ role: "teammate", title, body: msg, persistent: true, tag: `mgr-${t?.id ?? "x"}`, taskId: t?.id });
    };
    const reopen = (task: Task) => {
      if (task.status === "missed") {
        task.status = "open";
        task.closedAt = undefined;
        task.evaluation = undefined;
      }
      task.finalRequests = 0;
      task.deadlineAlerted = false;
      task.lastCheckAt = iso(now);
    };
    let reply: string;
    switch (cmd.kind) {
      case "identity":
        reply = `I am ${AGENT_NAME}, your assistant. I give ${name} her tasks, push her until she replies, answer her questions, and tell you the moment she replies.`;
        break;
      case "status":
        reply = summarize(d, now);
        break;
      case "herwords": {
        const hers = d.messages.filter((m) => m.owner === "teammate" && m.from === "user" && m.text).slice(-4);
        reply = hers.length ? `${name}'s last messages:\n${hers.map((m) => `${fmtWhen(ms(m.at), now, tz)}: “${m.text.slice(0, 160)}”`).join("\n")}` : `${name} has not written anything yet.`;
        break;
      }
      case "nudge": {
        if (!t || t.status === "review") {
          reply = t ? `${name} already finished. Nothing to push.` : `There is no task to push. Give ${name} a task first.`;
          break;
        }
        tell(`${name}, your manager wants your update now. ${statusLine(t, now, tz)}\nReply here or tap +.`, "Your manager wants an update");
        t.unanswered = Math.max(1, t.unanswered);
        t.lastReminderAt = iso(now);
        t.reminderPausedUntil = undefined;
        reply = `Done. I pushed ${name} now. I keep pushing every 4 minutes until she replies, and I will tell you when she does.`;
        break;
      }
      case "deadline":
      case "extend": {
        if (!t) {
          reply = "There is no task to change.";
          break;
        }
        const next = cmd.kind === "extend"
          ? Math.max(now, ms(t.deadlineAt)) + cmd.minutes * MIN
          : parseDeadline(/^\s*(?:by|before|at|until|till|in|within)\b/i.test(cmd.rest) ? cmd.rest : `by ${cmd.rest}`, now, tz, d.settings.workEndHour);
        if (!next || next <= now + 5 * MIN) {
          reply = "Tell me the new time, like “change deadline to 10pm” or “give her 1 more hour”.";
          break;
        }
        t.deadlineAt = iso(next);
        reopen(t);
        if (t.pendingAsk?.kind === "extension") t.pendingAsk = undefined;
        tell(`Update from your manager: your new deadline is ${fmtWhen(next, now, tz)} (${fmtDuration(next - now)} left).${t.kind === "dms" ? `\n${statusLine(t, now, tz, false)}` : ""}`, "New deadline");
        reply = `Done. New deadline: ${fmtWhen(next, now, tz)}. I told ${name}.`;
        break;
      }
      case "target": {
        if (!t || t.kind !== "dms") {
          reply = "There is no DM task to change.";
          break;
        }
        t.target = cmd.target;
        t.title = `Send ${cmd.target} donor DMs`;
        if (t.status === "review" && (t.reportedDone ?? 0) < cmd.target) {
          t.status = "open";
          t.reviewAt = undefined;
          t.evaluation = undefined;
        }
        tell(`Update from your manager: your target is now ${cmd.target} DMs.\n${statusLine(t, now, tz)}`, "New target");
        afterProgress(d, t, now, pushes, name, "");
        reply = `Done. Target is now ${cmd.target}. I told ${name}.`;
        break;
      }
      case "yes":
      case "no": {
        const ask = t?.pendingAsk;
        if (!t || !ask) {
          reply = summarize(d, now);
          break;
        }
        t.pendingAsk = undefined;
        if (cmd.kind === "no") {
          tell(
            ask.kind === "break" ? "Your manager says no break right now. Please keep going."
              : ask.kind === "extension" ? `Your manager says the deadline stays ${fmtWhen(ms(t.deadlineAt), now, tz)}. Please keep going.`
              : `Your manager says: ${toHer(cmd.rest, name)}`,
            "Your manager answered",
          );
          reply = `Told ${name}: no.`;
          break;
        }
        if (ask.kind === "break") {
          const mins = cmd.minutes ?? 15;
          t.reminderPausedUntil = iso(now + mins * MIN);
          t.breakUntil = iso(now + mins * MIN);
          tell(`Your manager says yes: take a ${mins}-minute break. I will remind you when it ends.`, "Break approved");
          reply = `Told ${name} she can take ${mins} minutes. I pause the reminders until then.`;
        } else if (ask.kind === "extension") {
          if (!cmd.minutes) {
            t.pendingAsk = ask;
            reply = "How much more time? Say, for example, “yes 1 hour” or “give her 30 min”.";
            break;
          }
          const next = Math.max(now, ms(t.deadlineAt)) + cmd.minutes * MIN;
          t.deadlineAt = iso(next);
          reopen(t);
          tell(`Your manager says yes: your new deadline is ${fmtWhen(next, now, tz)}.`, "More time approved");
          reply = `Done. New deadline: ${fmtWhen(next, now, tz)}. I told ${name}.`;
        } else {
          tell(`Your manager says: ${toHer(cmd.rest, name)}`, "Your manager answered");
          reply = `Sent to ${name} as your answer.`;
        }
        break;
      }
    }
    say(d, "manager", reply, "agent", { kind: "agent" });
  });
  await sendPushes(pushes, defer);
}

export async function handleManagerMessage(text: string, opts: { defer?: Defer } = {}): Promise<void> {
  const now = Date.now();
  const db = await readDb();
  const userMessage = { kind: "manager-input" as const };
  const parsed = parseManager(text, db.settings.teammateName);
  const openTask = [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "review");
  let intent: Intent;
  let aiStatus = "off";
  const draftNow = db.agent.pendingAssignment;
  const running = [...db.tasks].reverse().find((t) => t.status === "open" || t.status === "missed" || t.status === "review");
  const cmd = managerCommand(text, db.settings.teammateName, !!running?.pendingAsk);
  if (cmd && (cmd.kind === "identity" || cmd.kind === "status" || running)) {
    await runManagerCommand(cmd, text, now, opts.defer);
    return;
  }
  // An unfinished assignment takes the manager's next answer ("100, 6pm"), but only when that answer adds something to it.
  const merged = draftNow ? mergeDraft(draftNow, text, now, db) : null;
  const addsToDraft = !!draftNow && !!merged && (
    merged.target !== draftNow.target || merged.deadlineAt !== draftNow.deadlineAt || merged.instructions !== draftNow.instructions ||
    merged.checkEvery !== draftNow.checkEvery || merged.gapMinutes !== draftNow.gapMinutes || /\b(replace|switch tasks?|replace current|cancel old|stop old)\b/i.test(text));
  const answersDraft = addsToDraft && !parsed.isCancel && !parsed.isStatus && !parsed.isConfirm && !parsed.relay;
  if (draftNow && answersDraft) {
    const draft = merged!;
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
        const cadence = intent.gapMinutes ? `\n\nYour DM timer is on: one reminder every ${fmtMinutes(intent.gapMinutes)}.` : "";
        const extra = intent.brief ? `\nSpecial instructions: ${intent.brief}` : "";
        say(
          d,
          "teammate",
          `New task: ${title}\nDue ${when}${extra}${cadence}\n\nTap “I started” when you begin. Tap + for each DM.`,
          "agent",
          { kind: "kickoff" },
        );
        pushes.push({ role: "teammate", title: "New task for you", body: `Hi ${name}, ${title}. Due ${when}. Please reply when you can.` });
        const pace = intent.taskKind === "dms" ? feasibility(target, deadline, now, null).perDm : Infinity;
        reply =
          `Sent to ${name}.\n${title}\nDue: ${when}` +
          (intent.brief ? `\nInstructions I gave her: ${intent.brief}` : "") +
          (intent.gapMinutes ? `\nShe must wait ${fmtMinutes(intent.gapMinutes)} between DMs.` : "") +
          `\nI will ask her to confirm she started within 3 minutes, then keep asking until she replies. You get an alert only when she replies.` +
          (pace < 1 ? `\nNote: that is less than 1 minute per DM. It is very tight.` : "");
        managerReplyKind = "task";
        break;
      }
      case "status":
        reply = summarize(d, now);
        break;
      case "relay": {
        const words = toHer(intent.text, name);
        say(d, "teammate", `Message from your manager: ${words}`);
        pushes.push({ role: "teammate", title: "Message from your manager", body: words });
        const open = [...d.tasks].reverse().find((x) => x.status === "open" || x.status === "missed");
        if (open) open.pendingAsk = undefined;
        reply = `Sent to ${name}: “${words}”`;
        break;
      }
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
      case "chat": {
        const asking = [...d.tasks].reverse().find((x) => (x.status === "open" || x.status === "missed") && x.pendingAsk);
        if (asking && !/^\s*(?:thanks?|thank you|thx|hi|hello|hey)\b/i.test(text)) {
          const words = toHer(text, name);
          say(d, "teammate", `Your manager says: ${words}`);
          pushes.push({ role: "teammate", title: "Your manager answered", body: words });
          asking.pendingAsk = undefined;
          reply = `Sent to ${name} as your answer: “${words}”`;
          break;
        }
        reply =
          intent.reply ||
          (/^\s*(?:thanks?|thank you|thx|ok(?:ay)?|great|good|nice|perfect)\b/i.test(text)
            ? "You're welcome."
            : /^\s*(?:hi|hello|hey|good (?:morning|evening|afternoon))\b/i.test(text)
              ? `Hello. Tell me what ${name} should do, or ask me how she is doing.`
              : HELP);
        break;
      }
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
    case "missed":
      return "Please send your final total, or tell me what is unfinished.";
    case "review":
      return "Your manager is reviewing your work.";
    default:
      return task.kind === "dms" ? "When you send more, press + or tell me your total." : "Tell me when it is done and what you did.";
  }
}

/** A friendly sentence when there is no AI, or when the AI sentence is not safe to show. */
function ruleSentence(u: Understood, hadReport: boolean): string {
  if (u.blocked) return "Thank you for telling me. I am letting your manager know.";
  if (u.resolved) return "Good, I am glad it is fixed.";
  if (u.question === "break") return "I will ask your manager and tell you.";
  if (u.question === "extension") return "I will ask your manager for more time and tell you what they say.";
  if (u.question === "other") return "I cannot answer that myself, so I am asking your manager now.";
  if (u.start === "started") return "Thanks, I noted that you started.";
  if (u.start === "will-start") return "Okay. Please tell me when you start.";
  if (u.start === "not-started") return "Please start as soon as you can. Tell me if something is stopping you.";
  if (u.all) return "Thanks, I noted that you finished.";
  if (hadReport) return "Great, thank you.";
  if (u.ack) return "Okay.";
  return "Got it, I passed this to your manager.";
}

interface ReplyInfo {
  reportedNow: boolean;
  /** She is back from a break or says she keeps working. */
  resuming?: boolean;
  clampedFrom?: number;
  imageChecking?: boolean;
  imageRejectedNow?: string;
}

const AGENT_NAME = "Wajdan";

/** Where she stands, in one or two short lines: count, what is left, time left, and the pace she needs. */
function statusLine(t: Task, now: number, tz: string, withTime = true): string {
  const left = ms(t.deadlineAt) - now;
  const due = fmtWhen(ms(t.deadlineAt), now, tz);
  if (t.kind !== "dms") return left > 0 ? `Due ${due} (${fmtDuration(left)} left).` : `The deadline passed ${fmtDuration(-left)} ago.`;
  const done = t.reportedDone ?? 0;
  const remaining = Math.max(0, t.target - done);
  if (!remaining) return `All ${t.target} done.`;
  if (left <= 0) return `${done} of ${t.target} done, ${remaining} to go. The deadline passed, so please finish as many as you can now.`;
  const hours = left / 3_600_000;
  const perHour = Math.ceil(remaining / Math.max(hours, 1 / 60));
  const pace = hours >= 1 ? ` You need about ${perHour} per hour.` : ` That is about ${Math.ceil(remaining / Math.max(1, Math.round(left / MIN)))} per minute.`;
  return `${done} of ${t.target} done, ${remaining} to go.${withTime ? ` ${fmtDuration(left)} left.` : ""}${pace}`;
}

/** The reply to her. Every message gets a real answer: facts from the app first, then one clear next step. */
function buildReply(u: Understood, t: Task | undefined, d: Db, now: number, info: ReplyInfo): string {
  const tz = d.settings.timezone;
  const name = d.settings.teammateName;
  if (u.question === "identity")
    return `I am ${AGENT_NAME}, the assistant your manager set up. I keep track of your task, answer your questions, and pass your messages to your manager.${t ? `\n${statusLine(t, now, tz)}` : ""}`;
  if (!t) {
    if (u.greeting) return `Hi ${name}! There is no task right now. Your manager will send the next one here.`;
    return u.question === "other" || u.blocked ? "There is no active task right now. I passed your message to your manager." : "There is no active task right now. Your manager will send the next one here.";
  }
  const left = ms(t.deadlineAt) - now;
  const due = fmtWhen(ms(t.deadlineAt), now, tz);
  const open = t.status === "open" || t.status === "missed";
  const notStarted = open && !t.startedAt && !info.reportedNow;
  const startAsk = "Please start now and tap “I started”.";

  // Questions the app can answer exactly are answered from facts, never by the AI.
  if (u.question === "deadline") return left > 0 ? `Your deadline is ${due}. You have ${fmtDuration(left)} left.${t.kind === "dms" ? `\n${statusLine(t, now, tz, false)}` : ""}` : `The deadline passed ${fmtDuration(-left)} ago. ${nextStep({ ...t, status: "missed" })}`;
  if (u.question === "task") return `Your task: ${t.title}. Due ${due}${left > 0 ? ` (${fmtDuration(left)} left)` : ""}.${t.brief ? `\nInstructions: ${t.brief}.` : ""}\n${statusLine(t, now, tz, false)}`;
  if (u.question === "progress") return `${statusLine(t, now, tz)}${notStarted ? `\n${startAsk}` : ""}`;
  if (u.question === "howto")
    return t.brief ? `Your manager's instructions: ${t.brief}.` : "I do not have that detail. I am asking your manager now and will tell you here. Meanwhile, keep going with the donors you already have.";
  if (u.question === "next") return [nextStep(t), t.brief ? `Your manager's instructions: ${t.brief}.` : ""].filter(Boolean).join("\n");
  if (u.question === "break") return "I am asking your manager now and will tell you here. Until they answer, please keep going.";
  if (u.question === "extension") return `I am asking your manager for more time. Until they answer, the deadline is still ${due}, so please keep going.`;

  if (u.greeting) return `Hi ${name}!${notStarted ? ` Your task: ${t.title}, due ${due}.\n${startAsk}` : `\n${statusLine(t, now, tz)}`}`;
  if (u.cantFinish) return `Thank you for being honest. I am telling your manager. Do as many as you can by ${due}, and tell me your count as you go.`;
  if (u.delay && open && !u.blocked)
    return `${t.kind === "dms" ? `${Math.max(0, t.target - (t.reportedDone ?? 0))} DMs are still left` : "This task is still open"} and the deadline is ${due}${left > 0 ? ` (${fmtDuration(left)} left)` : ""}. Please ${t.startedAt ? "continue" : "start"} now, even a few. If something is stopping you, tell me what it is.`;
  if (info.resuming && !info.reportedNow && !u.question && !u.blocked) return `Good, keep going.\n${statusLine(t, now, tz)}`;
  if (u.mood && !u.blocked) return `I understand. Take a short pause if you need it, then keep going. You are doing well.\n${statusLine(t, now, tz)}`;

  const parts: string[] = [u.sentence ?? ruleSentence(u, info.reportedNow)];
  if (info.reportedNow && t.kind === "dms") {
    if (info.clampedFrom) parts.push(`You wrote ${info.clampedFrom}, but the task is ${t.target}. I recorded ${t.target}.`);
    parts.push(statusLine(t, now, tz));
  }
  if (info.imageRejectedNow) parts.push(info.imageRejectedNow);
  else if (u.blocked) parts.push(nextStep(t));
  else if (u.start === "started") parts.push(`${statusLine(t, now, tz)} Tap + for each DM.`);
  else if (info.reportedNow) {
    /* the status line already says it */
  } else if (notStarted) parts.push(startAsk);
  else if (u.question === "other") {
    /* passed to the manager */
  } else if (open && t.kind === "dms" && !t.blockedReason) parts.push(statusLine(t, now, tz));
  else {
    const step = nextStep(t);
    if (step && !parts[0].includes(step)) parts.push(step);
  }
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
    void update;
  }
  if (t.status !== "open" || confirmed < t.target) return;
  t.status = "review";
  t.reviewAt ??= iso(now);
  t.note = text.trim() ? text.trim().slice(0, 300) : `All ${t.target} sent.`;
  say(d, "manager", `${name} finished: ${t.target} of ${t.target} sent.`, "agent", { kind: "update" });
  pushes.push({ role: "manager", title: `${name} finished`, body: `${t.title}: ${t.target} of ${t.target} sent.` });
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

      if (t.kind === "dms" && t.status !== "review") {
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
        } else {
          info.imageRejectedNow = "Saved. Your manager can see it.";
          t.evidence = [...(t.evidence ?? []), { imageId: image.id, at: iso(now), verdict: "unclear" as const, reason: "Saved for the manager." }].slice(-300);
          t.proofCount = t.evidence.length;
        }
        t.lastProofAt = iso(now);
      }

      // Reporting progress means she is working again.
      if (info.reportedNow && !u.blocked && t.blockedReason) t.blockedReason = undefined;
      if (!u.blocked && /\b(?:i'?m back|i am back|back now|continu\w*|resum\w*|sending (?:more|now)|working (?:again|now|on it)|on it|keep going)\b/i.test(text)) info.resuming = true;
      if (info.resuming || info.reportedNow || u.start === "started") {
        t.breakUntil = undefined;
        t.reminderPausedUntil = undefined;
      }
      // The next report request follows the phase she is in now.
      if (u.start === "started" || u.blocked || u.resolved || info.reportedNow) t.nextCheckAt = iso(now + nextDelayMin(t) * MIN);

      const quoted = `“${text.slice(0, 300)}”`;
      const askKind = u.cantFinish ? "cantfinish" : u.question === "break" || u.question === "extension" || u.question === "other" ? u.question : u.question === "howto" && !t.brief ? "howto" : null;
      if (askKind) t.pendingAsk = { kind: askKind, text: text.slice(0, 300), at: iso(now) };
      const phaseNote = u.blocked
        ? { line: `${name} needs help: “${t.blockedReason}”`, push: { title: `${name} needs help`, body: t.blockedReason ?? text } }
        : u.cantFinish
        ? { line: `${name} says she cannot finish: ${quoted}`, push: { title: `${name} can't finish`, body: text.slice(0, 140) } }
        : u.delay && t.status === "open"
        ? { line: `${name} is putting it off: ${quoted}. I told her to start now.`, push: { title: `${name} is delaying`, body: text.slice(0, 140) } }
        : u.question === "howto" && !t.brief
        ? { line: `${name} asks: ${quoted}. Reply here and I will pass it on.`, push: { title: `${name} has a question`, body: text.slice(0, 140) } }
        : u.question === "break" || u.question === "extension" || u.question === "other"
          ? { line: `${name} asks${u.question === "break" ? " for a break" : u.question === "extension" ? " for more time" : ""}: “${text.slice(0, 300)}”`, push: { title: `${name} has a question`, body: text.slice(0, 140) } }
          : !hadStarted && t.startedAt && u.start === "started"
            ? { line: `${name} confirmed she started: ${t.title}.`, push: { title: `${name} started`, body: t.title } }
            : null;
      if (phaseNote) {
        managerLine = phaseNote.line;
        managerPush = phaseNote.push;
      } else if (info.reportedNow && !managerLine) {
        managerLine = `${name}: ${t.reportedDone} of ${t.target} sent.`;
      }
      if (u.resolved && !u.blocked) managerLine = managerLine || `${name} says the problem is fixed.`;
      if (!managerLine) managerLine = image && !text.trim() ? `${name} sent a picture.` : `${name}: “${text.slice(0, 300)}”`;
      if (!managerPush) managerPush = { title: `${name} replied`, body: info.reportedNow && t.kind === "dms" ? `${t.reportedDone} of ${t.target} sent. “${text.slice(0, 100)}”` : text.slice(0, 140) || "Sent a picture." };
      t.noUpdateMsgId = undefined;
      t.silentSince = undefined;
      const wasOpen = t.status === "open";
      afterProgress(d, t, now, pushes, name, u.all ? text : "");
      // afterProgress already told the manager she finished.
      if (wasOpen && t.status === "review") {
        managerLine = "";
        managerPush = null;
      }
    } else {
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
}

/** The + and − buttons. Sets her total without chat noise. The manager gets one alert that updates in place. */
export async function setProgress(total: number, opts: { defer?: Defer } = {}): Promise<void> {
  const now = Date.now();
  const pushes: Push[] = [];
  await withDb((d) => {
    const name = d.settings.teammateName;
    const t = [...d.tasks].reverse().find((x) => (x.status === "open" || x.status === "missed") && x.kind === "dms");
    if (!t) throw new Error("There is no DM task.");
    const next = Math.max(0, Math.min(t.target, Math.round(total)));
    d.agent.teammateLastSeenAt = iso(now);
    t.unanswered = 0;
    t.noUpdateMsgId = undefined;
    t.silentSince = undefined;
    if (next === (t.reportedDone ?? 0)) return;
    t.reportedDone = next;
    t.startedAt ??= iso(now);
    t.lastProgressAt = iso(now);
    t.lastReportAt = iso(now);
    t.nextCheckAt = iso(now + nextDelayMin(t) * MIN);
    const line = `${name}: ${next} of ${t.target} sent.`;
    const last = d.messages.at(-1);
    if (last && last.owner === "manager" && last.kind === "progress") {
      last.text = line;
      last.at = iso(now);
    } else say(d, "manager", line, "agent", { kind: "progress" });
    pushes.push({ role: "manager", title: `${name}: ${next}/${t.target} sent`, body: t.title, tag: `progress-${t.id}` });
    afterProgress(d, t, now, pushes, name, "");
  });
  await sendPushes(pushes, opts.defer);
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
    const nowIso = new Date(nowMs).toISOString();
    const tz = d.settings.timezone;
    const span = Math.max(1, ms(task.deadlineAt) - ms(task.createdAt));
    const elapsed = Math.max(0, nowMs - ms(task.createdAt));
    const confirmed = confirmedCount(task);
    const expected = task.kind === "dms" ? Math.min(task.target, Math.floor((elapsed / span) * task.target)) : 0;
    const behindBy = Math.max(0, expected - confirmed);

    if (task.remindersEnabled === false) return { pushes, actions };
    if (task.breakUntil && nowMs >= ms(task.breakUntil)) {
      task.breakUntil = undefined;
      task.reminderPausedUntil = undefined;
      const msg = `${name}, your break is over. Please continue now. ${statusLine(task, nowMs, tz)}`;
      say(d, "teammate", msg, "agent", { kind: "checkin" });
      task.lastReminderAt = nowIso;
      task.unanswered = Math.max(1, task.unanswered);
      pushes.push({ role: "teammate", title: "Break is over", body: msg, persistent: true, tag: `check-${task.id}`, taskId: task.id });
      actions.push("break-over");
      return { pushes, actions };
    }
    if (task.reminderPausedUntil && nowMs < ms(task.reminderPausedUntil)) return { pushes, actions };

    // 1. Deadline passed: 3 final-report requests 10 min apart, then close.
    if (ms(task.deadlineAt) <= nowMs) {
      if ((task.finalRequests ?? 0) >= 3) {
        task.status = "missed";
        task.closedAt = nowIso;
        say(d, "teammate", `The task "${task.title}" is closed as missed. You can still send your total here; your manager will see it.`, "agent", { kind: "update" });
        say(d, "manager", `${name}: "${task.title}" closed as missed. ${task.reportedDone ?? 0} of ${task.target} sent.`, "agent", { kind: "update" });
        actions.push("missed");
        return { pushes, actions };
      }
      const due = ms(task.lastReminderAt ?? task.deadlineAt) + 4 * MIN;
      if (nowMs < due && (task.finalRequests ?? 0) > 0) return { pushes, actions };
      task.finalRequests = (task.finalRequests ?? 0) + 1;
      task.lastReminderAt = nowIso;
      if (!task.deadlineAlerted) {
        task.deadlineAlerted = true;
        say(d, "teammate", "The deadline passed. Please send your final total now.", "agent", { kind: "checkin" });
        say(d, "manager", `${name}: deadline passed; final total requested.`, "agent", { kind: "update" });
      }
      pushes.push({ role: "teammate", title: "Final report please", body: "The deadline passed. Please send your final total now.", persistent: true, tag: `deadline-${task.id}`, receiptId: newId(), taskId: task.id });
      actions.push("deadline");
      return { pushes, actions };
    }

    // 2. She has not answered: push her every 4 minutes until she replies or the deadline. No limit.
    //    The manager is not pushed. One "No update" line in his chat keeps the count.
    if (task.unanswered >= 1 && taskPhase(task) !== "blocked") {
      const lastSent = ms(task.lastReminderAt ?? task.lastCheckAt ?? task.createdAt);
      if (nowMs < lastSent + 4 * MIN) return { pushes, actions };
      const n = task.unanswered + 1;
      const ask = !task.startedAt ? `Have you started "${task.title}"?` : task.kind === "dms" ? "How many DMs have you sent?" : `How is "${task.title}" going?`;
      const lines = [
        `${name}, please reply. ${ask}`,
        `${name}, still no reply. ${ask}`,
        `${name}, I am waiting. One line is enough.`,
        `${name}, your manager is waiting for your update. Reply now.`,
      ];
      const retryText = `${lines[(n - 2) % lines.length]} (asked ${n} times)`;
      say(d, "teammate", retryText, "agent", { kind: "checkin" });
      task.unanswered = n;
      task.lastReminderAt = nowIso;
      task.reminderCount = (task.reminderCount ?? 0) + 1;
      const receiptId = newId();
      task.pushReceipts = [...(task.pushReceipts ?? []), { id: receiptId, label: `nudge ${n}`, issuedAt: nowIso }].slice(-80);
      pushes.push({ role: "teammate", title: "Reply please", body: retryText, persistent: true, tag: `silent-${task.id}`, receiptId, taskId: task.id });
      task.silentSince ??= new Date(lastSent).toISOString();
      const since = new Date(task.silentSince).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
      const noUpdate = `No update from ${name}. Asked ${n} times since ${since}.`;
      const existing = task.noUpdateMsgId && d.messages.find((m) => m.id === task.noUpdateMsgId);
      if (existing) existing.text = noUpdate;
      else {
        say(d, "manager", noUpdate, "agent", { kind: "update" });
        task.noUpdateMsgId = d.messages.at(-1)!.id;
      }
      actions.push("retry");
      return { pushes, actions };
    }

    // 3. Behind pace: tell the manager at once, don't wait for the next check-in. One alert per task.
    // Only alert about pace once she has actually started and had time to make progress.
    if (task.kind === "dms" && !task.paceWarned && task.startedAt && (nowMs - ms(task.startedAt)) >= 20 * MIN && behindBy >= Math.max(5, Math.round(task.target * 0.2))) {
      task.paceWarned = true;
      const line = `${name} is behind pace. Expected about ${expected}/${task.target} by now, has ${confirmed}.`;
      say(d, "manager", line, "agent", { kind: "update" });
      actions.push("pace");
    }

    // 4. Planned check-in: start, 1/3, 2/3, 30 min before deadline. Only 4 or 5 across the whole task.
    const nextAt = nextPlannedCheckin(task, task.lastCheckAt, nowMs);
    if (nextAt === null || nowMs < nextAt) return { pushes, actions };
    const minutesLeft = Math.round((ms(task.deadlineAt) - nowMs) / MIN);
    const phase = taskPhase(task);
    const beforeStart = !task.startedAt;
    const almostDone = minutesLeft <= 35;
    const message = beforeStart
      ? `Hi ${name}, can you start "${task.title}" now? Reply "I started" when you begin.`
      : phase === "blocked"
      ? "Your manager has been told about the blocker. Has it been resolved?"
      : almostDone
      ? `${name}, ${minutesLeft} min left. What is your total count?`
      : task.kind === "dms"
      ? (behindBy > 0
        ? `${name}, you are behind pace. What is your count now?`
        : `Quick update, ${name}: how many have you sent?`)
      : `How is "${task.title}" going? Tell me what is finished and what remains.`;
    say(d, "teammate", message, "agent", { kind: "checkin" });
    task.lastCheckAt = nowIso;
    task.lastReminderAt = nowIso;
    task.unanswered = 1;  // start the silent-retry clock from this check-in
    task.reminderCount = (task.reminderCount ?? 0) + 1;
    const receiptId = newId();
    task.pushReceipts = [...(task.pushReceipts ?? []), { id: receiptId, label: `check-in ${task.reminderCount}`, issuedAt: nowIso }].slice(-80);
    pushes.push({ role: "teammate", title: beforeStart ? "Please confirm you started" : almostDone ? "Final push" : "Quick update", body: message, persistent: true, tag: `check-${task.id}`, receiptId, taskId: task.id });

    // Alert the manager if she didn't start on time (first planned push already fired, but no startedAt).
    if (beforeStart && !task.alertsProblemAt && elapsed >= 15 * MIN) {
      task.alertsProblemAt = nowIso;
      const line = `${name} has not confirmed she started. ${minutesLeft} min left on the task.`;
      say(d, "manager", line, "agent", { kind: "update" });
    }

    void tz;
    actions.push(phase);
    return { pushes, actions };
  });
  await sendPushes(result.pushes);
  return { actions: result.actions };
}
