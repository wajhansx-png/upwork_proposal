import { newId, readDb, withDb } from "./db";
import { llm, parseJson } from "./llm";
import { notify } from "./push";
import { fmtDuration, fmtWhen, parseDeadline, parseLocalStamp, parseTarget, zparts } from "./time";
import type { Db, Role, Task } from "./types";

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
  return { done: mine.length, target: t.target, flagged: mine.filter((d) => d.flags.length).length };
}

function teammateActiveSince(db: Db, sinceIso: string) {
  return (
    db.donors.some((d) => d.touchedAt && d.touchedAt > sinceIso) ||
    db.messages.some((m) => m.owner === "teammate" && m.from === "user" && m.at > sinceIso)
  );
}

function taskLine(db: Db, t: Task, now: number) {
  const p = taskProgress(db, t);
  const tz = db.settings.timezone;
  const left = ms(t.deadlineAt) - now;
  const when = left > 0 ? `due ${fmtWhen(ms(t.deadlineAt), now, tz)} (in ${fmtDuration(left)})` : "past deadline";
  const flag = p.flagged ? `, ${p.flagged} look unverified` : "";
  return `${t.title}: ${p.done} of ${p.target} done${flag}, ${when}${t.status === "review" ? ", waiting for your confirmation" : ""}`;
}

/** The plain facts. Used for status answers and as the model's only source of truth. */
export function summarize(db: Db, now = Date.now()): string {
  const s = computeStats(db, now);
  const name = db.settings.teammateName;
  const active = db.tasks.filter((t) => t.status === "open" || t.status === "review");
  const ago = (iso?: string) => (iso ? `${fmtDuration(now - ms(iso))} ago` : "never");
  const lines = [
    active.length ? `Open tasks:\n${active.map((t) => `- ${taskLine(db, t, now)}`).join("\n")}` : "No open task right now.",
    `Today: ${name} marked ${s.sentToday} DMs as sent. In total ${s.sent} sent, ${s.replied} replied, ${s.todo} waiting.`,
    `Last real work in the app: ${ago(s.lastActivityAt)}. Last opened the app: ${ago(db.agent.teammateLastSeenAt)}.`,
  ];
  if (s.flagged) lines.push(`${s.flagged} sent mark(s) look unverified (open the donor list to see why).`);
  return lines.join("\n");
}

// ---------- messaging ----------

function say(db: Db, owner: Role, text: string, from: "agent" | "user" = "agent") {
  db.messages.push({ id: newId(), owner, from, text, at: new Date().toISOString() });
  if (db.messages.length > 400) db.messages = db.messages.slice(-400);
}

interface Push {
  role: Role;
  title: string;
  body: string;
}

async function sendPushes(pushes: Push[]) {
  await Promise.all(pushes.map((p) => notify(p.role, p.title, p.body.slice(0, 160))));
}

async function recordLlm(status: string) {
  await withDb((d) => {
    if (d.agent.llmStatus !== status) d.agent.llmStatus = status;
  });
}

// ---------- manager messages ----------

type Intent =
  | { kind: "assign"; title: string; target: number | null; taskKind: "dms" | "general"; deadline: number | null }
  | { kind: "status" }
  | { kind: "relay"; text: string }
  | { kind: "cancel" }
  | { kind: "confirm" }
  | { kind: "chat"; reply?: string };

function ruleIntent(text: string, now: number, db: Db): Intent {
  const t = text.trim();
  const name = db.settings.teammateName.toLowerCase();
  const lower = t.toLowerCase();
  if (/^(cancel|undo|stop)\b/.test(lower)) return { kind: "cancel" };
  if (/^(confirm|approve|accept|looks good|ok done)\b/.test(lower)) return { kind: "confirm" };
  const who = ["her", "him", "them", "the team", "teammate", name.replace(/[^a-z0-9 ]/g, "")].filter(Boolean).join("|");
  const relay = new RegExp(`^(?:tell|message|remind|ask|ping)\\s+(?:${who})[\\s,:]+(?:to\\s+|that\\s+)?([\\s\\S]+)`, "i").exec(t);
  const deadline = parseDeadline(t, now, db.settings.timezone, db.settings.workEndHour);
  const target = parseTarget(t);
  const isDm = target !== null || /\b(dm|dms|message|messages|donors?|reach out|outreach)\b/i.test(t);
  // A task is a deadline plus an action, or a count of DMs with no deadline (the agent then asks "by when?").
  const looksLikeTask =
    (deadline !== null && (target !== null || /\b(send|do|finish|complete|prepare|follow ?up|reach|call|write)\b/i.test(t))) ||
    (target !== null && /\b(send|dm|dms|message|messages|contact|reach)\b/i.test(t));
  if (looksLikeTask) {
    return { kind: "assign", title: isDm ? "" : t, target, taskKind: isDm ? "dms" : "general", deadline };
  }
  if (relay) return { kind: "relay", text: relay[1].trim() };
  if (/\b(status|update|progress|how is|how's|how are|doing|report|done yet)\b/i.test(t)) return { kind: "status" };
  return { kind: "chat" };
}

async function classifyManager(text: string, now: number, db: Db): Promise<Intent> {
  const tz = db.settings.timezone;
  const p = zparts(now, tz);
  const local = `${p.day} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  const res = await llm(
    `You turn a foundation manager's chat message into JSON for a task assistant. The teammate is ${db.settings.teammateName}. ` +
      `Current local time: ${local} (${tz}). Return ONLY a JSON object with keys: ` +
      `intent ("assign" | "status" | "relay" | "cancel" | "confirm" | "chat"), ` +
      `title (short task name, for assign), target (number of DMs, or null), kind ("dms" if the task is sending messages to donors, else "general"), ` +
      `deadline (local time as "YYYY-MM-DD HH:mm", or null if the manager gave no time), ` +
      `relay_text (the message to pass on to the teammate, for relay), reply (one short sentence, only for chat). ` +
      `"assign" = the manager wants the teammate to do something. "status" = asks how things are going. ` +
      `"relay" = tell/remind/ask the teammate something that is not a task. Never invent a number or time the manager did not say.`,
    text,
    true,
  );
  await recordLlm(res.status);
  const j = parseJson<{ intent?: string; title?: string; target?: number | null; kind?: string; deadline?: string | null; relay_text?: string; reply?: string }>(res.text);
  const rule = ruleIntent(text, now, db);
  if (!j?.intent) return rule;
  switch (j.intent) {
    case "assign": {
      const deadline = (j.deadline ? parseLocalStamp(j.deadline, tz) : null) ?? parseDeadline(text, now, tz, db.settings.workEndHour);
      const target = typeof j.target === "number" && j.target > 0 ? Math.round(j.target) : parseTarget(text);
      return {
        kind: "assign",
        title: (j.title || "").trim().slice(0, 120),
        target,
        taskKind: j.kind === "general" ? "general" : "dms",
        deadline,
      };
    }
    case "status":
    case "cancel":
    case "confirm":
      return { kind: j.intent };
    case "relay":
      return j.relay_text?.trim() ? { kind: "relay", text: j.relay_text.trim() } : rule;
    default:
      return rule.kind === "assign" || rule.kind === "relay" ? rule : { kind: "chat", reply: j.reply };
  }
}

const HELP =
  "I can do these:\n" +
  "- Assign work: \"Send 20 DMs by 5pm\" or \"Finish the thank-you list by 3pm tomorrow\"\n" +
  "- Check progress: \"How is she doing?\"\n" +
  "- Pass on a message: \"Tell her to call the Reed family today\"\n" +
  "- Cancel the latest task: \"cancel\"\n" +
  "I will chase her, check her updates against the app, and tell you what is real.";

export async function handleManagerMessage(text: string): Promise<void> {
  const now = Date.now();
  const db = await withDb((d) => {
    say(d, "manager", text, "user");
    return structuredClone(d);
  });
  const intent = await classifyManager(text, now, db);
  const tz = db.settings.timezone;
  const name = db.settings.teammateName;
  const pushes: Push[] = [];
  let reply = HELP;

  await withDb((d) => {
    switch (intent.kind) {
      case "assign": {
        if (!intent.deadline) {
          reply = `I understood the task, but not the deadline. By when? For example: "by 5pm" or "in 3 hours".`;
          break;
        }
        if (intent.deadline <= now + 5 * MIN) {
          reply = "That deadline is too close or already passed. Give me a time at least 10 minutes from now.";
          break;
        }
        if (intent.deadline > now + 14 * 86_400_000) {
          reply = "That deadline is more than 14 days away. Please give a closer time.";
          break;
        }
        const target = intent.taskKind === "dms" ? intent.target ?? d.settings.dailyTarget : 1;
        const assumed = intent.taskKind === "dms" && intent.target === null;
        const title = intent.title || `Send ${target} donor DMs`;
        const task: Task = {
          id: newId(),
          title,
          kind: intent.taskKind,
          target,
          createdAt: new Date(now).toISOString(),
          deadlineAt: new Date(intent.deadline).toISOString(),
          status: "open",
          unanswered: 0,
        };
        d.tasks.push(task);
        const when = fmtWhen(intent.deadline, now, tz);
        const todo = d.donors.filter((x) => x.status === "todo").length;
        const warn = intent.taskKind === "dms" && todo < target ? ` Warning: only ${todo} donors are waiting in the queue. Add more donors.` : "";
        say(
          d,
          "teammate",
          `New task from your manager: ${title}. Due ${when}. Open "Next donors", send each DM, and press "Mark sent" after each one. I will check in and verify your progress.`,
        );
        pushes.push({ role: "teammate", title: "New task", body: `${title}. Due ${when}.` });
        reply =
          `Done. I assigned ${name}: ${title}, due ${when}.` +
          (assumed ? ` You gave no number, so I used the default of ${target}.` : "") +
          warn +
          ` I will chase ${name} and report to you. Reply "cancel" if I misunderstood.`;
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
        reply = intent.reply ? `${intent.reply}\n\n${HELP}` : HELP;
    }
    say(d, "manager", reply);
  });
  await sendPushes(pushes);
}

// ---------- teammate messages ----------

/** A number the teammate says she finished, e.g. "I sent 10 DMs" or "done 7". */
function extractClaim(text: string): number | null {
  const m = /(?:sent|done|finished|completed|did|messaged|contacted|reached)\D{0,12}(\d{1,4})|(\d{1,4})\s*(?:dms?|messages?|donors?|people)?\s*(?:are |were |is )?(?:sent|done|finished|completed)/i.exec(text);
  const n = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(n) ? n : null;
}

const BLOCKER = /\b(can't|cannot|couldn't|stuck|blocked|problem|issue|not working|no access|no network|sick|unwell|ill|emergency|struggl\w+|need help|help me)\b/i;

export async function handleTeammateMessage(text: string): Promise<void> {
  const now = Date.now();
  const db = await withDb((d) => {
    say(d, "teammate", text, "user");
    d.agent.teammateLastSeenAt = new Date(now).toISOString();
    for (const t of d.tasks) if (t.status === "open") t.unanswered = 0;
    return structuredClone(d);
  });
  const name = db.settings.teammateName;
  const task = db.tasks.find((t) => t.status === "open");
  const claim = extractClaim(text);
  const pushes: Push[] = [];
  let managerAlert = "";
  let verdict = "";
  let mismatch = false;

  if (claim !== null && task?.kind === "dms") {
    const p = taskProgress(db, task);
    if (claim > p.done) {
      mismatch = true;
      verdict = `Check: you said ${claim}, but the app shows only ${p.done} marked as sent for "${task.title}". The app is what I report to your manager, so please mark the rest, or tell me what stopped you.`;
      managerAlert = `${name} told me she did ${claim}, but the app shows ${p.done} marked sent ("${task.title}"). Her words: "${text.slice(0, 200)}"`;
    } else {
      verdict =
        `Check: the app shows ${p.done} of ${p.target} marked sent for "${task.title}".` +
        (p.flagged ? ` ${p.flagged} of them look unverified, so your manager will see that.` : "");
    }
  }
  if (!managerAlert && BLOCKER.test(text)) managerAlert = `${name} reported a problem: "${text.slice(0, 300)}"`;

  const facts = task
    ? `Open task: "${task.title}", due in ${fmtDuration(ms(task.deadlineAt) - now)}.`
    : "No open task right now.";
  const next = db.donors.filter((d) => d.status === "todo").slice(0, 3).map((d) => d.name);
  const res = await llm(
    `You are a calm assistant who helps ${name} finish donor outreach for a foundation. Reply in 1 to 3 short sentences, plain English, no emojis. ` +
      `Do NOT state any numbers or counts: a verified check is added to your reply separately. Do not promise anything you cannot do. ` +
      `If she reports a problem, acknowledge it and say you told her manager. If she asks what to do next, point her to "Next donors" in the app.`,
    `${facts}\nProblem reported to manager: ${managerAlert ? "yes" : "no"}\nNext donors: ${next.join(", ") || "none"}\nShe wrote: ${text}`,
  );
  await recordLlm(res.status);

  let reply = res.text;
  if (!reply) {
    if (managerAlert && !mismatch) reply = "Thank you for telling me. I passed this to your manager.";
    else if (/\b(next|who|queue|which)\b/i.test(text) && next.length) reply = `Next in your queue: ${next.join(", ")}. Open "Next donors" to send.`;
    else if (task) reply = `Noted. The task is due in ${fmtDuration(ms(task.deadlineAt) - now)}. Mark each DM as sent in the app as you go.`;
    else reply = "Noted. There is no open task right now.";
  }
  if (verdict) reply = `${reply}\n\n${verdict}`;

  await withDb((d) => {
    say(d, "teammate", reply);
    if (managerAlert) {
      say(d, "manager", managerAlert);
      pushes.push({ role: "manager", title: mismatch ? "Update does not match the app" : `${name} reported a problem`, body: managerAlert });
    }
  });
  await sendPushes(pushes);
}

// ---------- the clock: runs every minute ----------

interface Plan {
  /** Re-checked against fresh data before applying, so a double run does nothing. */
  guard: (d: Db) => boolean;
  /** Ask the model to word the message. Falls back to `fallback`. */
  prompt?: string;
  fallback: string;
  apply: (d: Db, text: string, pushes: Push[]) => void;
}

export interface RunResult {
  actions: string[];
}

export async function runAgent(nowMs = Date.now()): Promise<RunResult> {
  const db = await readDb();
  const { settings } = db;
  const tz = settings.timezone;
  const name = settings.teammateName;
  const t = zparts(nowMs, tz);
  const plans: Plan[] = [];
  const labels: string[] = [];
  const nowIso = new Date(nowMs).toISOString();

  const find = (d: Db, id: string) => d.tasks.find((x) => x.id === id);

  for (const task of db.tasks.filter((x) => x.status === "open")) {
    const p = taskProgress(db, task);
    const deadline = ms(task.deadlineAt);
    const window = deadline - ms(task.createdAt);
    const left = deadline - nowMs;
    const id = task.id;
    const stateLine = (d: Db) => {
      const tk = find(d, id)!;
      const pr = taskProgress(d, tk);
      return `${pr.done} of ${pr.target}${pr.flagged ? ` (${pr.flagged} unverified)` : ""}`;
    };

    if (task.kind === "dms" && p.done >= p.target) {
      labels.push(`done:${task.title}`);
      plans.push({
        guard: (d) => find(d, id)?.status === "open",
        fallback: "",
        apply: (d, _x, pushes) => {
          const tk = find(d, id)!;
          tk.status = "done";
          tk.closedAt = nowIso;
          const pr = taskProgress(d, tk);
          say(d, "teammate", `Target reached: ${stateLine(d)} for "${tk.title}". Thank you, great work.`);
          say(
            d,
            "manager",
            `Finished: ${name} completed "${tk.title}" (${stateLine(d)}) before the deadline.` +
              (pr.flagged ? ` Note: ${pr.flagged} sent mark(s) look unverified.` : " All marks look genuine."),
          );
          pushes.push({ role: "manager", title: "Task finished", body: `${name} completed: ${tk.title}` });
          pushes.push({ role: "teammate", title: "Target reached", body: "Thank you, great work." });
        },
      });
      continue;
    }

    if (left <= 0) {
      labels.push(`missed:${task.title}`);
      plans.push({
        guard: (d) => find(d, id)?.status === "open",
        fallback: "",
        apply: (d, _x, pushes) => {
          const tk = find(d, id)!;
          tk.status = "missed";
          tk.closedAt = nowIso;
          say(d, "teammate", `The deadline for "${tk.title}" has passed. The app shows ${stateLine(d)}. Please tell me what happened and finish what is left.`);
          say(d, "manager", `Deadline missed: "${tk.title}". The app shows ${stateLine(d)}. ${name} was told. Ask me for a status or assign a new deadline.`);
          pushes.push({ role: "manager", title: "Deadline missed", body: `${tk.title}: ${stateLine(d)}` });
          pushes.push({ role: "teammate", title: "Deadline passed", body: tk.title });
        },
      });
      continue;
    }

    // Heads-up to the manager at the halfway point.
    if (!task.midpointSent && window >= 30 * MIN && nowMs >= ms(task.createdAt) + window / 2) {
      labels.push(`halfway:${task.title}`);
      plans.push({
        guard: (d) => find(d, id)?.status === "open" && !find(d, id)!.midpointSent,
        fallback: "",
        apply: (d, _x, pushes) => {
          const tk = find(d, id)!;
          tk.midpointSent = true;
          const behind = taskProgress(d, tk).done / tk.target < 0.4;
          const msg = `Halfway: "${tk.title}" is ${stateLine(d)} with ${fmtDuration(ms(tk.deadlineAt) - nowMs)} left.${behind ? ` ${name} looks behind.` : ""}`;
          say(d, "manager", msg);
          pushes.push({ role: "manager", title: behind ? "Behind schedule" : "Halfway update", body: msg });
        },
      });
    }

    // Last warning 30 minutes before the deadline.
    if (!task.preDeadlineSent && window >= 60 * MIN && left <= 30 * MIN) {
      labels.push(`predeadline:${task.title}`);
      plans.push({
        guard: (d) => find(d, id)?.status === "open" && !find(d, id)!.preDeadlineSent,
        fallback: "",
        apply: (d, _x, pushes) => {
          const tk = find(d, id)!;
          tk.preDeadlineSent = true;
          tk.lastCheckAt = nowIso;
          say(d, "teammate", `30 minutes left for "${tk.title}". The app shows ${stateLine(d)}. Please send an update and finish what you can.`);
          pushes.push({ role: "teammate", title: "30 minutes left", body: `${tk.title}: ${stateLine(d)}` });
        },
      });
      continue;
    }

    // Regular check-in.
    const since = task.lastCheckAt ?? task.createdAt;
    const interval = Math.min(settings.checkinMinutes * MIN, Math.max(10 * MIN, left / 2));
    if (nowMs - ms(since) >= interval) {
      const active = teammateActiveSince(db, since);
      labels.push(`checkin:${task.title}`);
      plans.push({
        guard: (d) => {
          const tk = find(d, id);
          return !!tk && tk.status === "open" && (tk.lastCheckAt ?? tk.createdAt) === since;
        },
        prompt:
          `Write a short check-in from a foundation's assistant to ${name}. Task: "${task.title}", due in ${fmtDuration(left)}. ` +
          `${active ? "She has been working." : "She has shown no activity since the last check."} ` +
          `Ask for a short update and ask her to say so if something blocks her. 2 sentences, warm, not pushy, no emojis. Do not state numbers.`,
        fallback: "",
        apply: (d, text, pushes) => {
          const tk = find(d, id)!;
          const quiet = !teammateActiveSince(d, since);
          tk.unanswered = quiet && tk.lastCheckAt ? tk.unanswered + 1 : 0;
          tk.lastCheckAt = nowIso;
          const base = text ||
            (quiet
              ? `I have not seen any activity on "${tk.title}" for a while. Are you ok? Please reply with a short update.`
              : `Check-in on "${tk.title}". Please reply with a short update, and tell me if something blocks you.`);
          const body = `${base}\n\nThe app shows ${stateLine(d)}. Due in ${fmtDuration(ms(tk.deadlineAt) - nowMs)}.`;
          say(d, "teammate", body);
          pushes.push({ role: "teammate", title: "Check-in", body: `${tk.title}: ${stateLine(d)}. Please reply with an update.` });
          if (tk.unanswered >= 2 && tk.unanswered % 2 === 0) {
            const warn = `${name} has not responded to ${tk.unanswered} check-ins on "${tk.title}". The app shows ${stateLine(d)}. You may want to call her.`;
            say(d, "manager", warn);
            pushes.push({ role: "manager", title: `${name} is not responding`, body: warn });
          }
        },
      });
    }
  }

  // Ask the manager to assign work if nothing is set for today.
  const hasOpen = db.tasks.some((x) => x.status === "open" || x.status === "review");
  const madeToday = db.tasks.some((x) => zparts(ms(x.createdAt), tz).day === t.day);
  if (
    !hasOpen &&
    !madeToday &&
    t.h >= settings.workStartHour + 1 &&
    t.h < settings.workEndHour &&
    db.agent.lastNoTaskPromptDay !== t.day &&
    db.donors.some((d) => d.status === "todo")
  ) {
    labels.push("no-task-prompt");
    plans.push({
      guard: (d) => d.agent.lastNoTaskPromptDay !== t.day && !d.tasks.some((x) => x.status === "open"),
      fallback: "",
      apply: (d, _x, pushes) => {
        d.agent.lastNoTaskPromptDay = t.day;
        const todo = d.donors.filter((x) => x.status === "todo").length;
        const msg = `No task is assigned to ${name} today and ${todo} donors are waiting. Tell me what to assign, for example: "${name}, send ${Math.min(20, todo)} DMs by 5pm".`;
        say(d, "manager", msg);
        pushes.push({ role: "manager", title: "Nothing assigned today", body: msg });
      },
    });
  }

  // End-of-day report for the manager.
  if (t.h >= settings.workEndHour && db.agent.lastDigestDay !== t.day) {
    labels.push("digest");
    plans.push({
      guard: (d) => d.agent.lastDigestDay !== t.day,
      fallback: "",
      apply: (d, _x, pushes) => {
        d.agent.lastDigestDay = t.day;
        const today = d.tasks.filter((x) => zparts(ms(x.createdAt), tz).day === t.day);
        const lines = today.map((x) => `- ${x.title}: ${x.status} (${taskProgress(d, x).done}/${taskProgress(d, x).target})`);
        const msg = `End of day report\n${lines.length ? lines.join("\n") + "\n" : "No tasks today.\n"}${summarize(d, nowMs)}`;
        say(d, "manager", msg);
        pushes.push({ role: "manager", title: "End of day report", body: `${computeStats(d, nowMs).sentToday} DMs marked sent today.` });
      },
    });
  }

  if (!plans.length) {
    await withDb((d) => {
      d.agent.lastRunAt = nowIso;
    });
    return { actions: [] };
  }

  // Word messages with the model first (no lock held), then apply everything at once.
  const texts = await Promise.all(
    plans.map(async (pl) => {
      if (!pl.prompt) return pl.fallback;
      const r = await llm("You write short, kind workplace messages. Output only the message text.", pl.prompt);
      if (r.status !== "off") await recordLlm(r.status);
      return r.text ?? pl.fallback;
    }),
  );

  const pushes: Push[] = [];
  const applied: string[] = [];
  await withDb((d) => {
    d.agent.lastRunAt = nowIso;
    plans.forEach((pl, i) => {
      if (!pl.guard(d)) return;
      pl.apply(d, texts[i], pushes);
      applied.push(labels[i]);
    });
  });
  await sendPushes(pushes);
  return { actions: applied };
}
