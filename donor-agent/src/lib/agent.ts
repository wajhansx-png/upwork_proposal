import { newId, readDb, withDb } from "./db";
import { kvGetImage } from "./db";
import { llm, parseJson, visionEnabled } from "./llm";
import { notify } from "./push";
import { checkProof, nameMatches, readScreenshot } from "./vision";
import { extractCheckEvery, fmtDuration, fmtMinutes, fmtWhen, parseDeadline, parseLocalStamp, parseTarget, zparts } from "./time";
import type { ChatMessage, Db, Role, Task } from "./types";

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

/** The last time the teammate did anything: a mark in the app or a chat message. */
function lastTeammateActivity(db: Db): string | undefined {
  return db.donors
    .map((d) => d.touchedAt)
    .concat(db.messages.filter((m) => m.owner === "teammate" && m.from === "user").map((m) => m.at))
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
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
  const checked = db.donors.filter((d) => d.proofCheck?.verdict === "match").length;
  const photos = db.donors.filter((d) => d.proofImg).length;
  if (photos) lines.push(`Screenshots: ${photos} received, ${checked} checked and matching.`);
  if (s.flagged) lines.push(`${s.flagged} sent mark(s) look unverified (open the donor list to see why).`);
  return lines.join("\n");
}

// ---------- messaging ----------

/** Minutes between check-ins for a task. */
function intervalMs(settingsMinutes: number, t: Task, leftMs: number) {
  return t.checkEvery ? t.checkEvery * MIN : Math.min(settingsMinutes * MIN, Math.max(10 * MIN, leftMs / 2));
}

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
  | { kind: "assign"; title: string; target: number | null; taskKind: "dms" | "general"; deadline: number | null; checkEvery: number | null }
  | { kind: "status" }
  | { kind: "relay"; text: string }
  | { kind: "cancel" }
  | { kind: "confirm" }
  | { kind: "chat"; reply?: string };

function ruleIntent(text: string, now: number, db: Db): Intent {
  const every = extractCheckEvery(text.trim());
  const t = every.rest;
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
    return { kind: "assign", title: isDm ? "" : t, target, taskKind: isDm ? "dms" : "general", deadline, checkEvery: every.minutes };
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
      `check_every_minutes (number, if the manager says how often to check on the teammate, like "check every 20 min", else null), ` +
      `relay_text (the message to pass on to the teammate, for relay), reply (one short sentence, only for chat). ` +
      `"assign" = the manager wants the teammate to do something. "status" = asks how things are going. ` +
      `"relay" = tell/remind/ask the teammate something that is not a task. Never invent a number or time the manager did not say.`,
    text,
    { json: true },
  );
  await recordLlm(res.status);
  const j = parseJson<{ intent?: string; title?: string; target?: number | null; kind?: string; deadline?: string | null; check_every_minutes?: number | null; relay_text?: string; reply?: string }>(res.text);
  const every = extractCheckEvery(text);
  const rule = ruleIntent(text, now, db);
  if (!j?.intent) return rule;
  switch (j.intent) {
    case "assign": {
      const deadline = (j.deadline ? parseLocalStamp(j.deadline, tz) : null) ?? parseDeadline(every.rest, now, tz, db.settings.workEndHour);
      const llmEvery = typeof j.check_every_minutes === "number" && j.check_every_minutes > 0 ? Math.min(240, Math.max(5, Math.round(j.check_every_minutes))) : null;
      const target = typeof j.target === "number" && j.target > 0 ? Math.round(j.target) : parseTarget(text);
      return {
        kind: "assign",
        title: (j.title || "").trim().slice(0, 120),
        target,
        taskKind: j.kind === "general" ? "general" : "dms",
        deadline,
        checkEvery: every.minutes ?? llmEvery,
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
  "You can tell me:\n" +
  "- Assign work: \"Send 20 DMs by 5pm, check every 20 min\" or \"Finish the thank-you list by 3pm tomorrow\"\n" +
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
          ...(intent.checkEvery ? { checkEvery: intent.checkEvery } : {}),
        };
        d.tasks.push(task);
        const when = fmtWhen(intent.deadline, now, tz);
        const todo = d.donors.filter((x) => x.status === "todo").length;
        const warn = intent.taskKind === "dms" && todo < target ? ` Warning: only ${todo} donors are waiting in the queue. Add more donors.` : "";
        const how = d.settings.requireProof
          ? 'Send each DM from "Next donors". Then press "Mark sent" and add a screenshot of the sent message.'
          : 'Send each DM from "Next donors". Then press "Mark sent".';
        const questions =
          intent.taskKind === "dms"
            ? "1. What time will you start?\n2. Do you have everything you need?\n3. Could anything get in the way?"
            : "1. What time will you start?\n2. What will you need?\n3. Could anything get in the way?";
        const cadence = intent.checkEvery ? `\n\nI will check in with you every ${fmtMinutes(intent.checkEvery)}.` : "";
        say(
          d,
          "teammate",
          `Hi ${name}, I hope your day is going well. Your manager asked me to help you with a new task:\n\n${title}\nDue: ${when}\n\nWhen you have a moment, could you tell me:\n${questions}\n\n${how}${cadence}`,
          "agent",
          { kind: "kickoff" },
        );
        pushes.push({ role: "teammate", title: "New task for you", body: `Hi ${name}, ${title}. Due ${when}. Please reply when you can.` });
        reply =
          `Done. I assigned ${name}: ${title}, due ${when}.` +
          (assumed ? ` You gave no number, so I used the default of ${target}.` : "") +
          warn +
          (intent.checkEvery
            ? ` I will check in with ${name} every ${fmtMinutes(intent.checkEvery)}, wait for her answers, and tell you what she says.`
            : ` I will check in with ${name}, wait for her answers, and tell you what she says.`) +
          ` Reply "cancel" if I misunderstood.`;
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

/** The manager writes straight into the teammate's chat. */
export async function handleManagerToTeammate(text: string): Promise<void> {
  const name = await withDb((d) => {
    say(d, "teammate", text, "manager");
    return d.settings.teammateName;
  });
  void name;
  await notify("teammate", "Message from your manager", text.slice(0, 160));
}

export interface ChatImage {
  id: string;
  hash: string;
  dataUrl: string;
}

export async function handleTeammateMessage(text: string, image?: ChatImage | null): Promise<void> {
  const now = Date.now();
  let duplicateOf = "";
  let managerTalking = false;
  const db = await withDb((d) => {
    const prev = [...d.messages].reverse().find((m) => m.owner === "teammate" && m.from !== "user");
    managerTalking = !!prev && prev.from === "manager" && now - ms(prev.at) < 30 * MIN;
    say(d, "teammate", text || "(screenshot)", "user", image ? { img: image.id } : {});
    d.agent.teammateLastSeenAt = new Date(now).toISOString();
    for (const t of d.tasks) if (t.status === "open") t.unanswered = 0;
    if (image) {
      const old = d.hashes[image.hash];
      if (old) duplicateOf = old;
      else d.hashes[image.hash] = "chat";
    }
    return structuredClone(d);
  });
  const name = db.settings.teammateName;
  const pushes: Push[] = [];

  // Read the screenshot, if there is one and an AI key is set.
  let shotNote = "";
  if (image) {
    if (visionEnabled()) {
      const { seen } = await readScreenshot(image.dataUrl);
      if (seen) {
        const donor = db.donors.find((x) => seen.person_name && nameMatches(seen.person_name, x));
        shotNote =
          `Screenshot: ${seen.summary ?? "could not describe it"}` +
          (seen.is_chat === false ? " It does not look like a chat." : donor ? ` It matches donor ${donor.name}.` : seen.person_name ? ` The chat is with "${seen.person_name}", who is not in the donor list.` : "");
      } else shotNote = "Screenshot saved. I could not read it.";
    } else shotNote = "Screenshot saved. No AI key is set, so I did not read it.";
    if (duplicateOf) shotNote += ` Warning: this is the same image as one sent before (${duplicateOf}).`;
  }

  // The manager is talking to her now. Stay quiet and tell the manager.
  if (managerTalking) {
    const msg = `${name} replied: "${text.slice(0, 300)}"${shotNote ? `\n${shotNote}` : ""}`;
    await withDb((d) => say(d, "manager", msg));
    await sendPushes([{ role: "manager", title: `${name} replied`, body: text || "Sent a screenshot" }]);
    return;
  }

  const task = db.tasks.find((t) => t.status === "open");
  const claim = extractClaim(text);
  // The agent's last question (task or check-in). Praise and other notes are not questions.
  const lastAgent = [...db.messages].reverse().find((m) => m.owner === "teammate" && m.from === "agent" && (m.kind === "checkin" || m.kind === "kickoff"));
  const answeringCheckin = lastAgent?.kind === "checkin" && now - ms(lastAgent.at) < 3 * 3_600_000;
  // Is this her first answer to the agent's last question? Then the manager hears what she said.
  const firstAnswer =
    !!lastAgent &&
    (lastAgent.kind === "checkin" || lastAgent.kind === "kickoff") &&
    !db.messages.some((m) => m.owner === "teammate" && m.from === "user" && m.at > lastAgent.at && m.at < new Date(now).toISOString());
  let managerAlert = "";
  let verdict = "";
  let mismatch = false;

  const promise = /\b(?:can|will|i'll|ill|going to|gonna|could)\b(?:(?!\b(?:at|by|around|after|before|until|till)\b)\D){0,20}?(\d{1,3})(?!\s*(?:am|pm|a\.m|p\.m|:|o'?clock|min|minutes|hours?|h\b))\b/i.exec(text);
  const isPromise = !!promise && task?.kind === "dms";
  if (claim !== null && task?.kind === "dms") {
    const p = taskProgress(db, task);
    if (claim > p.done) {
      mismatch = true;
      verdict = `Check: you said ${claim}, but the app shows only ${p.done} marked as sent for "${task.title}". I report what the app shows. Please mark the rest, or tell me what stopped you.`;
      managerAlert = `${name} said ${claim} DMs, but the app shows ${p.done} ("${task.title}"). Her words: "${text.slice(0, 200)}"`;
    } else {
      verdict =
        `Check: the app shows ${p.done} of ${p.target} marked sent for "${task.title}".` +
        (p.flagged ? ` ${p.flagged} look unverified. Your manager will see this.` : "");
    }
  } else if (answeringCheckin && task?.kind === "dms" && !BLOCKER.test(text) && !image && !isPromise) {
    verdict = "Thanks! How many DMs have you sent so far? Please write the number, and add a screenshot of your last DM.";
  }
  if (!managerAlert && BLOCKER.test(text)) managerAlert = `${name} has a problem: "${text.slice(0, 300)}"`;
  if (image) {
    managerAlert = `${managerAlert ? managerAlert + "\n" : ""}${name} sent a screenshot. ${shotNote}`;
  }
  let answerNote = "";
  if (!managerAlert && firstAnswer && text) answerNote = `${name} answered: "${text.slice(0, 300)}"`;

  const next = db.donors.filter((d) => d.status === "todo").slice(0, 3).map((d) => d.name);
  const wantsNext = /\b(next|who|queue|which)\b/i.test(text);
  // The AI sees no donor names and no numbers. Names for "what is next" are added by code.
  const res = text
    ? await llm(
        `You are a warm, friendly coworker helping ${name} finish donor outreach for a foundation. Talk like a kind person, not a robot. Reply in 1 or 2 short sentences. Use very simple English. No emojis. ` +
          `Do NOT write any numbers or counts. A checked summary is added after your reply. Never promise anything you cannot do. ` +
          `If she reports a problem, say you told her manager.`,
        `Task: ${task ? `"${task.title}"` : "none"}\nProblem reported to manager: ${BLOCKER.test(text) ? "yes" : "no"}\nShe wrote: ${text}`,
      )
    : { text: null, status: "off" };
  if (res.status !== "off") await recordLlm(res.status);

  let reply = res.text;
  if (!reply) {
    if (image && !text) reply = `Thanks, ${name}. I saved your screenshot.`;
    else if (BLOCKER.test(text) && !mismatch) reply = `Thank you for telling me, ${name}. I have let your manager know.`;
    else if (task) reply = `Thanks, ${name}! You have ${fmtDuration(ms(task.deadlineAt) - now)} left. Please mark each DM as sent in the app as you go.`;
    else reply = `Thanks, ${name}. There is no open task right now.`;
  }
  if (wantsNext && next.length) reply += ` Next in your list: ${next.join(", ")}.`;
  if (verdict) reply = `${reply}\n\n${verdict}`;
  if (shotNote) reply = `${reply}\n\n${shotNote}`;

  // Her own promise ("I can do 3 more") becomes her goal. People keep their own numbers better.
  let promised: { count: number; by: number } | null = null;
  if (promise && task?.kind === "dms" && !mismatch) {
    const done = taskProgress(db, task).done;
    const leftMs = ms(task.deadlineAt) - now;
    const by = task.goal && ms(task.goal.by) > now ? ms(task.goal.by) : Math.min(now + intervalMs(db.settings.checkinMinutes, task, leftMs), ms(task.deadlineAt));
    promised = { count: Math.min(task.target, done + Number(promise[1])), by };
    // Keep it short: a promise needs a clear "deal", not a lecture.
    reply = `Deal, ${name}: ${Number(promise[1])} more by ${fmtWhen(by, now, db.settings.timezone)}. I will check then.`;
    const next = nextNames(db, 2);
    if (next.length) reply += ` Start with ${next.join(" and ")}.`;
  }

  await withDb((d) => {
    if (promised && task) {
      const tk = d.tasks.find((x) => x.id === task.id);
      if (tk && tk.status === "open") tk.goal = { count: promised.count, by: new Date(promised.by).toISOString(), fromHer: true };
    }
    say(d, "teammate", reply);
    if (answerNote) {
      say(d, "manager", answerNote);
      pushes.push({ role: "manager", title: `${name} answered`, body: text.slice(0, 160) });
    }
    if (managerAlert) {
      say(d, "manager", managerAlert);
      pushes.push({
        role: "manager",
        title: mismatch ? "Update does not match the app" : image ? `${name} sent a screenshot` : `${name} has a problem`,
        body: managerAlert,
      });
    }
  });
  await sendPushes(pushes);
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
              (pr.flagged ? ` Note: ${pr.flagged} sent mark(s) look unverified.` : " No mark was flagged as wrong."),
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
          say(d, "teammate", `Hi ${name}, the time for "${tk.title}" is over. The app shows ${stateLine(d)}. No problem, please just tell me what happened so I can update your manager.`);
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
          say(d, "teammate", `Hi ${name}, 30 minutes left on "${tk.title}". You are at ${stateLine(d)}. You can do it. Please send me a quick update when you can.`);
          pushes.push({ role: "teammate", title: "30 minutes left", body: `Hi ${name}, 30 minutes left. You are at ${stateLine(d)}.` });
        },
      });
      continue;
    }

    // Regular check-in. The clock restarts whenever she replies or works, so the agent waits for her
    // instead of asking again right after she answered.
    const lastCheck = task.lastCheckAt ?? task.createdAt;
    const lastHer = lastTeammateActivity(db);
    const since = lastHer && lastHer > lastCheck ? lastHer : lastCheck;
    const interval = intervalMs(settings.checkinMinutes, task, left);
    if (nowMs - ms(since) >= interval) {
      labels.push(`checkin:${task.title}`);
      plans.push({
        guard: (d) => {
          const tk = find(d, id);
          return !!tk && tk.status === "open" && (tk.lastCheckAt ?? tk.createdAt) === lastCheck && lastTeammateActivity(d) === lastHer;
        },
        fallback: "",
        apply: (d, _text, pushes) => {
          const tk = find(d, id)!;
          const goalMet = !!tk.goal && taskProgress(d, tk).done >= tk.goal.count;
          const quiet = !teammateActiveSince(d, lastCheck) && !goalMet;
          tk.unanswered = quiet && tk.lastCheckAt ? tk.unanswered + 1 : 0;
          const n = (tk.unanswered + (tk.lastCheckAt ? 1 : 0)) % 2;
          tk.lastCheckAt = nowIso;
          const state = stateLine(d);
          const leftTxt = fmtDuration(ms(tk.deadlineAt) - nowMs);
          const heard = lastHer ? fmtWhen(ms(lastHer), nowMs, tz) : null;
          let body: string;
          let pushBody: string;
          if (tk.unanswered >= 3) {
            body =
              `Hi ${name}, just a gentle reminder. I still need a short update on "${tk.title}".\n` +
              `If now is not a good time, tell me when you will be free.`;
            pushBody = `Hi ${name}, a gentle reminder: please send a short update.`;
          } else if (tk.unanswered === 2) {
            body =
              `${name}, I am still waiting to hear from you. Even one line helps, like "3 sent, no problems".\n` +
              `If something came up, just tell me and I will let your manager know.`;
            pushBody = `${name}, still waiting for your update. One line is enough.`;
          } else if (quiet && tk.unanswered === 1) {
            body =
              `Hi ${name}, I have not heard from you${heard ? ` since ${heard}` : " yet"}. Is everything okay?\n` +
              `The app shows ${state}, with ${leftTxt} left. A short update is enough: how many you sent, any replies, any problem?`;
            pushBody = `Hi ${name}, is everything okay? Please send a short update.`;
          } else if (tk.kind === "dms") {
            body =
              n === 0
                ? `Hi ${name}, how is it going? I can see ${state} so far, with ${leftTxt} left.\n\nWhen you have a moment:\n1. How many DMs have you sent?\n2. Has anyone replied?\n3. Is anything in your way?\nA screenshot of your last DM would help too.`
                : `Hi ${name}, just checking in. You are at ${state}, and the deadline is in ${leftTxt}.\nHow many have you sent so far? Any replies? Anything I can help with?\nPlease add a screenshot of your last DM.`;
            pushBody = `Hi ${name}, how is it going? Please send a quick update.`;
          } else {
            body = `Hi ${name}, how is "${tk.title}" going? ${leftTxt} left.\n1. What have you done so far?\n2. How much is left?\n3. Is anything in your way?`;
            pushBody = `Hi ${name}, how is it going? Please send a quick update.`;
          }
          // Small goals: judge the last one, then set the next. This is what moves the work forward.
          if (tk.kind === "dms") {
            const done = taskProgress(d, tk).done;
            let before = "";
            if (tk.goal) {
              const g = tk.goal;
              if (done >= g.count) {
                tk.goalMisses = 0;
                before = g.fromHer ? `You kept your promise: ${done} done. Thank you!\n\n` : `Great job, you hit your goal: ${done} done!\n\n`;
              } else {
                tk.goalMisses = (tk.goalMisses ?? 0) + 1;
                before = `The goal was ${g.count} by ${fmtWhen(ms(g.by), nowMs, tz)}. You are at ${done}. Let's catch up.\n\n`;
                if (tk.goalMisses === 2) {
                  const w = `${name} missed her small goal twice on "${tk.title}". She is at ${stateLine(d)} with ${fmtDuration(ms(tk.deadlineAt) - nowMs)} left.`;
                  say(d, "manager", w);
                  pushes.push({ role: "manager", title: `${name} is falling behind`, body: w });
                }
              }
            }
            const leftMs = ms(tk.deadlineAt) - nowMs;
            const step = intervalMs(settings.checkinMinutes, tk, leftMs);
            const by = Math.min(nowMs + step, ms(tk.deadlineAt));
            const stepsLeft = Math.max(1, Math.ceil(leftMs / step));
            const need = Math.max(1, Math.ceil((tk.target - done) / stepsLeft));
            tk.goal = { count: Math.min(tk.target, done + need), by: new Date(by).toISOString() };
            const next = nextNames(d, 3);
            body =
              before +
              body +
              `\n\nYour next goal: ${need} more by ${fmtWhen(by, nowMs, tz)}. Can you do that? If you can do more, tell me the number.` +
              (next.length ? `\nStart with: ${next.join(", ")}.` : "");

            // Early warning: at this speed she will not finish on time.
            const elapsed = nowMs - ms(tk.createdAt);
            if (!tk.paceWarned && elapsed >= 30 * MIN && done < tk.target) {
              const projected = Math.floor(done + (done / elapsed) * leftMs);
              if (projected < tk.target * 0.8) {
                tk.paceWarned = true;
                const w = `Early warning: at her current speed, ${name} will finish about ${projected} of ${tk.target} by the deadline. She is at ${stateLine(d)}. I am pushing her with small goals.`;
                say(d, "manager", w);
                pushes.push({ role: "manager", title: "May miss the deadline", body: w });
              }
            }
          }
          say(d, "teammate", body, "agent", { kind: "checkin" });
          pushes.push({ role: "teammate", title: "Quick check-in", body: pushBody });
          if (tk.unanswered >= 2 && tk.unanswered % 2 === 0) {
            const warn = `${name} has not answered ${tk.unanswered} check-ins on "${tk.title}"${heard ? ` (last heard ${heard})` : ""}. The app shows ${state}. You may want to call her.`;
            say(d, "manager", warn);
            pushes.push({ role: "manager", title: `${name} is not answering`, body: warn });
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
