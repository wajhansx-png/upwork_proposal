import { newId, readDb, withDb } from "./db";
import { notify } from "./push";
import { extractCheckEvery, fmtDuration, fmtMinutes, fmtWhen, parseDeadline, parseTarget, zparts } from "./time";
import { extractGap, extractInstructions, managerCommand, parseManager, type ManagerCommand } from "./nlp";
import { simplifyTask, understandManager, understandTeammate, type Intent, type Understood } from "./understand";
import type { TeammateFacts } from "./prompts";
import type { CaseFile, ChatMessage, Db, Donor, PendingAssignment, Role, Task } from "./types";
import { evidenceCount, nextDelayMin, nextPlannedCheckin, taskPhase } from "./task-state";
import { applyDonorAction, cleanPhone, donorLabel, groupOf, todayPicks, type DonorAction } from "./donors";
import { planCounter, type CounterEvent } from "./counter";

/** Runs work after the reply has been sent. In a request this is Next's after(); elsewhere it runs inline. */
export type Defer = (fn: () => Promise<void>) => void;

const MIN = 60_000;
const ms = (iso: string) => new Date(iso).getTime();

// ---------- facts ----------

/** The last time she wrote anything. */
function lastTeammateActivity(db: Db): string | undefined {
  return db.messages.filter((m) => m.owner === "teammate" && m.from === "user").at(-1)?.at;
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
    .slice(0, 1000)
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
  const found = noExtra ? undefined : extractInstructions(text, db.settings.teammateName);
  // One stray word is not an instruction.
  const instructions = noExtra ? undefined : found && found.split(/\s+/).length >= 2 ? found : draft.instructions;
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
      case "sendHeld": {
        const held = d.agent.heldAnswer;
        d.agent.heldAnswer = undefined;
        if (!held) {
          reply = "There is nothing waiting to be sent.";
          break;
        }
        const words = toHer(held, name);
        say(d, "teammate", `Your manager says: ${words}`, "agent", { kind: "update" });
        pushes.push({ role: "teammate", title: "Your manager answered", body: words, persistent: true, tag: `mgr-${t?.id ?? "x"}`, taskId: t?.id });
        if (t) t.pendingAsk = undefined;
        reply = `Sent to ${name}: “${words}”`;
        break;
      }
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
        if (cmd.target < 1 || cmd.target > 5000) {
          reply = "The number must be between 1 and 5000.";
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
  // A held answer is only sent by "send to her"; any other message drops it.
  if (db.agent.heldAnswer && cmd?.kind !== "sendHeld") await withDb((d) => { d.agent.heldAnswer = undefined; });
  if (cmd) {
    await runManagerCommand(cmd, text, now, opts.defer);
    return;
  }
  // An unfinished assignment takes the manager's next answer ("100, 6pm"), but only when that answer adds something to it.
  // A complete new task ("send 50 DMs by 9pm") replaces an old unfinished draft; it is never merged into it.
  const fullNewTask = parsed.isRequest && conversationTarget(extractCheckEvery(text).rest) !== null && conversationDeadline(extractCheckEvery(text).rest, now, db) !== null;
  const merged = draftNow && !fullNewTask ? mergeDraft(draftNow, text, now, db) : null;
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
  // Make the task look easy: short title, at most 3 tiny steps, very simple words.
  let simple: { title: string; steps: string[] } | null = null;
  if (intent.kind === "assign" && intent.deadline && (intent.taskKind !== "dms" || intent.target)) {
    const baseTitle = intent.title || `Send ${intent.target} DMs`;
    simple = await simplifyTask(baseTitle, intent.brief, text);
  }
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
        const title = simple?.title || intent.title || `Send ${target} DMs`;
        const steps = simple?.steps ?? [];
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
          ...(intent.brief ? { brief: steps.length ? steps.join("; ") : intent.brief } : {}),
          ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}),
          ...(intent.gapMinutes ? { gapMinutes: intent.gapMinutes } : {}),
          remindersEnabled: true,
          timerEnabled: true,
          lastReportAt: new Date(now).toISOString(),
        };
        d.tasks.push(task);
        d.agent.pendingAssignment = undefined;
        const when = fmtWhen(deadline, now, tz);
        const bullets = [...steps, ...(intent.gapMinutes ? [`Wait ${fmtMinutes(intent.gapMinutes)} between DMs`] : [])].map((x) => `• ${x}`).join("\n");
        say(
          d,
          "teammate",
          `New task\n${title}\nBy ${when}${bullets ? `\n\n${bullets}` : ""}\n\nTap “I started” to begin.`,
          "agent",
          { kind: "kickoff" },
        );
        pushes.push({ role: "teammate", title: "New task", body: `${title}. By ${when}.` });
        const pace = intent.taskKind === "dms" ? feasibility(target, deadline, now, null).perDm : Infinity;
        reply =
          `Done. Sent to ${name}:\n${title} · by ${when}${bullets ? `\n${bullets}` : ""}\nI'll push her until she replies.` +
          (pace < 1 ? `\nNote: under 1 minute per DM. Very tight.` : "");
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
          // Never send unclear text to her by itself: hold it until the manager confirms.
          d.agent.heldAnswer = text.slice(0, 1000);
          reply = `${name} asked: “${asking.pendingAsk!.text.slice(0, 160)}”\nShould I send her your message as the answer? Tap “Send to ${name}”, or just type something else.`;
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
  /** Goal / milestone lines after new progress. */
  coach?: string[];
  /** She promised "N in M minutes". */
  promised?: boolean;
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

/** A small, doable next goal: the share of what is left that fits the next half hour (or 20 min when late). */
function makeGoal(t: Task, now: number): { count: number; by: string } | undefined {
  if (t.kind !== "dms") return undefined;
  const done = t.reportedDone ?? 0;
  const remaining = t.target - done;
  if (remaining <= 0) return undefined;
  const minsLeft = (ms(t.deadlineAt) - now) / MIN;
  const window = minsLeft > 45 ? 30 : minsLeft > 10 ? Math.round(minsLeft) : 20;
  // The pace the deadline needs...
  const needed = minsLeft > 10 ? Math.ceil((remaining * window) / minsLeft) : remaining;
  // ...her own speed so far, stretched a little (a goal should pull, not coast)...
  const workedMin = t.startedAt ? (now - ms(t.startedAt)) / MIN : 0;
  const ownPace = workedMin >= 15 && done > 0 ? Math.ceil((done / workedMin) * window * 1.1) : 0;
  // ...and never less than 5 per half hour.
  const floor = Math.ceil((5 * window) / 30);
  const step = Math.max(needed, ownPace, floor);
  return { count: done + Math.max(1, Math.min(remaining, step)), by: iso(now + window * MIN) };
}

function goalLine(t: Task, now: number, tz: string): string {
  if (!t.goal) return "";
  const more = t.goal.count - (t.reportedDone ?? 0);
  return more > 0 ? `Next goal: reach ${t.goal.count} by ${fmtWhen(ms(t.goal.by), now, tz)} (just ${more} more).` : "";
}

/** Honest encouragement when she crosses a real milestone. */
function milestoneCheer(prev: number, done: number, target: number): string {
  const pct = (n: number) => (n / Math.max(1, target)) * 100;
  if (done >= target) return "";
  if (target - done <= 10 && target - prev > 10) return `Only ${target - done} left. You are almost there!`;
  if (pct(prev) < 75 && pct(done) >= 75) return "Three quarters done. Strong finish now!";
  if (pct(prev) < 50 && pct(done) >= 50) return "Halfway! The second half always goes faster.";
  if (pct(prev) < 25 && pct(done) >= 25) return "A quarter done. Good rhythm, keep it going.";
  return "";
}

/** After new progress: praise a reached goal, cheer milestones, and set the next small goal. Returns lines for her. */
function progressCoach(t: Task, prev: number, now: number, tz: string): string[] {
  if (t.kind !== "dms" || t.status !== "open") return [];
  const done = t.reportedDone ?? 0;
  const lines: string[] = [];
  if (t.goal && done >= t.goal.count) {
    const early = ms(t.goal.by) - now;
    lines.push(early > 2 * MIN ? `Goal reached ${fmtDuration(early)} early. Excellent!` : "Goal reached. Well done!");
    t.goal = undefined;
    t.goalMisses = 0;
  }
  const cheer = milestoneCheer(prev, done, t.target);
  if (cheer) lines.push(cheer);
  if (!t.goal || ms(t.goal.by) <= now) t.goal = makeGoal(t, now);
  const g = goalLine(t, now, tz);
  if (g) lines.push(g);
  return lines;
}

/** "I'll send 5 in the next 20 minutes": her own promise becomes her goal. */
function herPromise(text: string): { more: number; minutes: number } | null {
  const m = /\b(?:i'?ll|i will|will|can)\s+(?:do|send|finish|complete)?\s*(\d{1,3})\s*(?:more|dms?|messages?)?\s*(?:in|within)\s+(?:the\s+)?(?:next\s+)?(\d{1,3})\s*(?:min|mins|minutes|m)\b/i.exec(text)
    || /^\s*(\d{1,3})\s*(?:more\s+)?in\s+(\d{1,3})\s*(?:min|mins|minutes|m)\b/i.exec(text);
  return m ? { more: Number(m[1]), minutes: Number(m[2]) } : null;
}

/** "Who do I message?" answered from the donor list: the first 3 picks and where the messages are. */
function donorHelp(t: Task, d: Db, now: number): string {
  if (t.kind !== "dms") return "";
  const picks = todayPicks(d.donors ?? [], now, 3, openCase(d));
  if (!picks.length) return "";
  const names = picks.map((p) => donorLabel(d.donors.find((x) => x.id === p.id)!)).join(", ");
  return `Open “Donors” at the top. Start with: ${names}.\nEach one has the message ready. Tap “Sent” after each one — it counts for you, so no need to tap + too.`;
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
  if (u.question === "howto") {
    const list = donorHelp(t, d, now);
    if (list) return [t.brief ? `Your manager's instructions: ${t.brief}.` : "", list].filter(Boolean).join("\n");
    return t.brief ? `Your manager's instructions: ${t.brief}.` : "I do not have that detail. I am asking your manager now and will tell you here. Meanwhile, keep going with the donors you already have.";
  }
  if (u.question === "next") return [nextStep(t), t.brief ? `Your manager's instructions: ${t.brief}.` : ""].filter(Boolean).join("\n");
  if (u.question === "break") return "I am asking your manager now and will tell you here. Until they answer, please keep going.";
  if (u.question === "extension") return `I am asking your manager for more time. Until they answer, the deadline is still ${due}, so please keep going.`;

  if (u.greeting) return `Hi ${name}!${notStarted ? ` Your task: ${t.title}, due ${due}.\n${startAsk}` : `\n${statusLine(t, now, tz)}`}`;
  if (u.cantFinish) {
    const g = makeGoal(t, now);
    if (g) t.goal = g;
    return `Thank you for being honest, I am telling your manager. Don't think about all of them. Just ${g ? `get to ${g.count} by ${fmtWhen(ms(g.by), now, tz)}` : "do the next few"}, then we see.`;
  }
  if (u.delay && open && !u.blocked)
    return `Starting is the hardest part. Send just 1 DM now and tap +, then decide.\n${t.kind === "dms" ? `${Math.max(0, t.target - (t.reportedDone ?? 0))} are still left` : "This task is still open"} and the deadline is ${due}${left > 0 ? ` (${fmtDuration(left)} left)` : ""}. If something is really stopping you, tell me what it is.`;
  if (info.promised && t.goal) return `Deal: ${t.goal.count - (t.reportedDone ?? 0)} more by ${fmtWhen(ms(t.goal.by), now, tz)}. I will check then. You can do this!`;
  if (info.resuming && !info.reportedNow && !u.question && !u.blocked) return `Good, keep going.\n${statusLine(t, now, tz)}`;
  if (u.mood && !u.blocked) {
    const small = t.kind === "dms" ? Math.min(3, Math.max(1, t.target - (t.reportedDone ?? 0))) : 0;
    return `I hear you, it is a lot. Let's make it small: ${small ? `just ${small} more DM${small === 1 ? "" : "s"}, then` : "finish one small part, then"} take 5 minutes for yourself. You have already done ${t.reportedDone ?? 0}, that counts.`;
  }

  const parts: string[] = [u.sentence ?? ruleSentence(u, info.reportedNow)];
  if (info.reportedNow && t.kind === "dms") {
    if (info.clampedFrom) parts.push(`You wrote ${info.clampedFrom}, but the task is ${t.target}. I recorded ${t.target}.`);
    if (info.coach?.length) {
      const praise = info.coach.find((l) => l.startsWith("Goal reached"));
      if (praise) parts[0] = praise;
      parts.push(`${t.reportedDone ?? 0} of ${t.target} done, ${Math.max(0, t.target - (t.reportedDone ?? 0))} to go.`);
      parts.push(...info.coach.filter((l) => l !== praise));
    } else parts.push(statusLine(t, now, tz));
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

      const prevDone = t.reportedDone ?? 0;
      const promise = t.kind === "dms" && t.status === "open" ? herPromise(text) : null;
      if (promise) {
        t.goal = { count: Math.min(t.target, prevDone + promise.more), by: iso(now + promise.minutes * MIN), fromHer: true };
        t.startedAt ??= iso(now);
        info.promised = true;
      }
      if (t.kind === "dms" && t.status !== "review" && !promise) {
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

      if (info.reportedNow) info.coach = progressCoach(t, prevDone, now, d.settings.timezone);
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
      if (info.promised && t.goal) {
        managerLine = `${name} promised: reach ${t.goal.count} by ${fmtWhen(ms(t.goal.by), now, d.settings.timezone)}.`;
        managerPush = { title: `${name} made a promise`, body: managerLine };
      }
      const askKind = u.cantFinish ? "cantfinish" : u.question === "break" || u.question === "extension" || u.question === "other" ? u.question : u.question === "howto" && !t.brief && !donorHelp(t, d, now) ? "howto" : null;
      if (askKind) t.pendingAsk = { kind: askKind, text: text.slice(0, 300), at: iso(now) };
      const phaseNote = u.blocked
        ? { line: `${name} needs help: “${t.blockedReason}”`, push: { title: `${name} needs help`, body: t.blockedReason ?? text } }
        : u.cantFinish
        ? { line: `${name} says she cannot finish: ${quoted}`, push: { title: `${name} can't finish`, body: text.slice(0, 140) } }
        : u.delay && t.status === "open"
        ? { line: `${name} is putting it off: ${quoted}. I told her to start now.`, push: { title: `${name} is delaying`, body: text.slice(0, 140) } }
        : u.question === "howto" && !t.brief && !donorHelp(t, d, now)
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
export async function setProgress(total: number | ((current: number) => number), opts: { defer?: Defer } = {}): Promise<void> {
  const now = Date.now();
  const pushes: Push[] = [];
  await withDb((d) => {
    const name = d.settings.teammateName;
    const t = [...d.tasks].reverse().find((x) => (x.status === "open" || x.status === "missed") && x.kind === "dms");
    if (!t) throw new Error("There is no DM task.");
    const want = typeof total === "function" ? total(t.reportedDone ?? 0) : total;
    const next = Math.max(0, Math.min(t.target, Math.round(want)));
    d.agent.teammateLastSeenAt = iso(now);
    t.unanswered = 0;
    t.noUpdateMsgId = undefined;
    t.silentSince = undefined;
    if (next === (t.reportedDone ?? 0)) return;
    const prev = t.reportedDone ?? 0;
    t.reportedDone = next;
    t.startedAt ??= iso(now);
    t.lastProgressAt = iso(now);
    t.lastReportAt = iso(now);
    t.nextCheckAt = iso(now + nextDelayMin(t) * MIN);
    const line = `${name}: ${next} of ${t.target} sent.`;
    const last = [...d.messages].reverse().find((m) => m.owner === "manager");
    if (last && last.kind === "progress") {
      last.text = line;
      last.at = iso(now);
    } else say(d, "manager", line, "agent", { kind: "progress" });
    pushes.push({ role: "manager", title: `${name}: ${next}/${t.target} sent`, body: t.title, tag: `progress-${t.id}` });
    // Coach her only at moments that matter: a goal reached, a milestone, or her first goal.
    if (next > prev) {
      const hadGoal = !!t.goal;
      const lines = progressCoach(t, prev, now, d.settings.timezone);
      if (lines.some((l) => !l.startsWith("Next goal")) || (!hadGoal && lines.length)) say(d, "teammate", lines.join("\n"), "agent", { kind: "update" });
    }
    afterProgress(d, t, now, pushes, name, "");
  });
  await sendPushes(pushes, opts.defer);
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

    // 2b. Her small goal ran out: one firm, specific push, then a smaller new goal.
    if (task.kind === "dms" && task.goal && task.startedAt && nowMs >= ms(task.goal.by)) {
      const done = task.reportedDone ?? 0;
      const goal = task.goal;
      if (done >= goal.count) {
        task.goal = makeGoal(task, nowMs);
      } else {
        const short = goal.count - done;
        task.goalMisses = (task.goalMisses ?? 0) + 1;
        task.goal = makeGoal(task, nowMs);
        const msg = `${name}, time check: the goal was ${goal.count} and you are at ${done}.${goal.fromHer ? " This was your own promise." : ""} Send the ${short} missing now and tap + after each one.${task.goal ? `\nNew goal: ${task.goal.count} by ${fmtWhen(ms(task.goal.by), nowMs, tz)}.` : ""}`;
        say(d, "teammate", msg, "agent", { kind: "checkin" });
        task.lastReminderAt = nowIso;
        task.unanswered = Math.max(1, task.unanswered);
        pushes.push({ role: "teammate", title: "Goal check", body: msg, persistent: true, tag: `check-${task.id}`, taskId: task.id });
        actions.push("goal-missed");
        return { pushes, actions };
      }
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

// ---------- donors page ----------

/** The case being raised for now: the newest open one. */
export const openCase = (d: Db): CaseFile | null => [...(d.cases ?? [])].reverse().find((c) => c.status === "open") ?? null;

/** She (or the manager) marks one donor. Her "Sent" adds 1 to her open DM task; undo takes it back. A gift alerts the manager. */
export async function markDonor(role: Role, id: string, action: DonorAction, opts: { amount?: number; defer?: Defer } = {}): Promise<Donor> {
  const now = Date.now();
  const pushes: Push[] = [];
  const { donor, delta } = await withDb((d) => {
    const donor = d.donors.find((x) => x.id === id);
    if (!donor) throw new Error("That donor is not in the list.");
    const task = [...d.tasks].reverse().find((x) => (x.status === "open" || x.status === "missed") && x.kind === "dms");
    const open = openCase(d);
    const undo = donor.undo;
    const wasStatus = donor.status;
    // Her "Sent" counts only while her task still has room; a full count stays full.
    const counts = role === "teammate" && !!task && (task.reportedDone ?? 0) < task.target;
    let delta = applyDonorAction(donor, action, iso(now), { amount: opts.amount, counts, caseId: open?.id, taskId: task?.id });
    // Undo takes 1 back only from the same task it was added to.
    if (action === "undo" && delta < 0 && undo?.taskId !== task?.id) delta = 0;
    // A gift lowers the open case's amount left; undo adds that gift back (a newer amount the manager typed is kept).
    let caseLine = "";
    if (open && action === "donated" && opts.amount && opts.amount > 0 && donor.undo) {
      const before = open.facts.amountLeft;
      open.facts.amountLeft = Math.max(0, before - Math.round(opts.amount));
      donor.undo.caseGift = before - open.facts.amountLeft;
      caseLine = open.facts.amountLeft > 0 ? ` ${open.facts.name}: Rs ${open.facts.amountLeft.toLocaleString("en-US")} left.` : ` ${open.facts.name}'s case is fully funded. Open “Case” to send the closing post.`;
    }
    if (action === "undo" && undo && wasStatus === "donated") {
      if (open && undo.caseGift) open.facts.amountLeft += undo.caseGift;
      say(d, "manager", `↩️ The gift from ${donorLabel(donor)} was a mistake and is removed.${open && undo.caseGift ? ` ${open.facts.name}: Rs ${open.facts.amountLeft.toLocaleString("en-US")} left.` : ""}`, "agent");
    }
    if (action === "donated") {
      const name = d.settings.teammateName;
      const line = `🎉 ${donorLabel(donor)} gave${opts.amount && opts.amount > 0 ? ` Rs ${Math.round(opts.amount).toLocaleString("en-US")}` : ""}${role === "teammate" ? ` (marked by ${name})` : ""}.${caseLine}`;
      say(d, "manager", line, "agent");
      if (role === "teammate") pushes.push({ role: "manager", title: "New gift", body: line, tag: `gift-${donor.id}` });
    }
    return { donor: structuredClone(donor), delta };
  });
  if (delta) await setProgress((c) => c + delta, opts).catch(() => undefined);
  await sendPushes(pushes, opts.defer);
  return donor;
}

/** The manager adds a donor or fixes a phone number. */
export async function saveDonor(input: { id?: string; name?: string; phone?: string }): Promise<Donor> {
  return withDb((d) => {
    const name = String(input.name ?? "").trim().slice(0, 80);
    const phone = cleanPhone(input.phone);
    if (input.phone && !phone) throw new Error("That phone number does not look right. Use the country code, like +923001234567.");
    const old = input.id ? d.donors.find((x) => x.id === input.id) : undefined;
    if (input.id && !old) throw new Error("That donor is not in the list.");
    if (phone && d.donors.some((x) => x.phone === phone && x.id !== old?.id)) throw new Error("A donor with this number is already in the list.");
    if (old) {
      if (name) old.name = name;
      if (input.phone !== undefined) old.phone = phone;
      old.group = groupOf(old.name, old.phone);
      old.updatedAt = new Date().toISOString();
      return structuredClone(old);
    }
    if (!name && !phone) throw new Error("Write a name or a phone number.");
    const donor: Donor = { id: newId(), name, phone, group: groupOf(name, phone), status: "new", sends: 0, updatedAt: new Date().toISOString() };
    d.donors.push(donor);
    return structuredClone(donor);
  });
}

// ---------- WhatsApp counter add-on ----------

const randToken = () => `gc_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Turn the add-on on (making a token the first time), off, or make a fresh token. Manager only. */
export async function setCounter(action: "on" | "off" | "new"): Promise<{ on: boolean; token: string }> {
  return withDb((d) => {
    const c = (d.agent.counter ??= {});
    if (action === "new" || (action === "on" && !c.token)) c.token = randToken();
    if (action !== "off") c.on = true;
    else c.on = false;
    return { on: !!c.on, token: c.token ?? "" };
  });
}

export interface CounterResult { ok: boolean; on: boolean; counted: number; replied: number; unknown: number }

/**
 * The add-on sends what it saw. We match donors, mark them, and move her task count — the same as if she
 * tapped "Sent", but automatic. The add-on only watches; she sends every DM by hand, so the number stays safe.
 */
export async function recordCounterEvents(token: string, from: Role, events: CounterEvent[], opts: { defer?: Defer } = {}): Promise<CounterResult> {
  const now = Date.now();
  const pushes: Push[] = [];
  const clean = (Array.isArray(events) ? events : [])
    .filter((e): e is CounterEvent => !!e && typeof e.id === "string" && (e.dir === "out" || e.dir === "in"))
    .slice(0, 500)
    .map((e) => ({ id: String(e.id).slice(0, 120), phone: typeof e.phone === "string" ? e.phone.slice(0, 24) : undefined, name: typeof e.name === "string" ? e.name.slice(0, 80) : undefined, dir: e.dir, at: Number.isFinite(e.at) ? Math.min(now, Math.max(0, e.at)) : now }));

  const { delta, result } = await withDb((d) => {
    const c = d.agent.counter;
    // The token is the add-on's key. A wrong token, or the switch off, means do nothing.
    if (!c?.token || token !== c.token || !c.on) return { delta: 0, result: { ok: false, on: !!c?.on, counted: 0, replied: 0, unknown: 0 } };
    const plan = planCounter(clean, d.donors, c.seen ?? []);
    c.seen = plan.seen;
    c.lastAt = iso(now);
    c.lastFrom = from;
    const task = [...d.tasks].reverse().find((x) => (x.status === "open" || x.status === "missed") && x.kind === "dms");
    // Only HER add-on moves HER task count. His own DMs mark donors sent but never touch her count.
    const room = task && from === "teammate" ? Math.max(0, task.target - (task.reportedDone ?? 0)) : 0;
    const open = openCase(d);
    let delta = 0;
    for (const id of plan.sent) {
      const donor = d.donors.find((x) => x.id === id);
      if (!donor) continue;
      const counts = delta < room;
      delta += applyDonorAction(donor, "sent", iso(now), { counts, caseId: open?.id, taskId: task?.id });
    }
    for (const id of plan.replied) {
      const donor = d.donors.find((x) => x.id === id);
      if (donor) applyDonorAction(donor, "replied", iso(now));
    }
    // Tell the manager about replies: these are the hottest leads.
    if (plan.replied.length) {
      const names = plan.replied.map((id) => donorLabel(d.donors.find((x) => x.id === id)!)).slice(0, 5).join(", ");
      say(d, "manager", `💬 Reply from ${names}. Answer first — most likely to give.`, "agent");
      pushes.push({ role: "manager", title: plan.replied.length === 1 ? "A donor replied" : `${plan.replied.length} donors replied`, body: names, tag: "ext-reply" });
    }
    const day = zparts(now, d.settings.timezone).day;
    if (c.day !== day) {
      c.day = day;
      c.sentToday = 0;
    }
    c.sentToday = (c.sentToday ?? 0) + plan.sent.length;
    return { delta, result: { ok: true, on: true, counted: plan.sent.length, replied: plan.replied.length, unknown: plan.unknown } };
  });
  if (delta) await setProgress((cur) => cur + delta, opts).catch(() => undefined);
  await sendPushes(pushes, opts.defer);
  return result;
}
