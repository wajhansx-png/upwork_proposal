import { newId, readDb, withDb } from "./db";
import { notify } from "./push";
import type { Db, Donor } from "./types";

const HOUR = 3_600_000;

function parts(date: Date, tz: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return parts(date, "UTC");
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export interface Stats {
  total: number;
  todo: number;
  sent: number;
  replied: number;
  skipped: number;
  sentToday: number;
  target: number;
  lastActivityAt?: string;
}

export function computeStats(db: Db, now = new Date()): Stats {
  const tz = db.settings.timezone;
  const today = parts(now, tz).day;
  const count = (s: Donor["status"]) => db.donors.filter((d) => d.status === s).length;
  const sentToday = db.donors.filter((d) => d.sentAt && parts(new Date(d.sentAt), tz).day === today).length;
  // Only the teammate's own actions count as work. Opening the app or the manager
  // adding donors does not.
  const work = db.donors
    .map((d) => d.touchedAt)
    .concat(db.messages.filter((m) => m.from === "teammate").map((m) => m.at))
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  return {
    total: db.donors.length,
    todo: count("todo"),
    sent: count("sent") + count("replied"),
    replied: count("replied"),
    skipped: count("skipped"),
    sentToday,
    target: db.settings.dailyTarget,
    lastActivityAt: work,
  };
}

/** Plain-text status, used as the agent's fallback answer and as LLM context. */
export function summarize(db: Db, now = new Date()): string {
  const s = computeStats(db, now);
  const name = db.settings.teammateName;
  const last = s.lastActivityAt
    ? `${Math.round((now.getTime() - new Date(s.lastActivityAt).getTime()) / 60000)} minutes ago`
    : "never";
  const seen = db.agent.teammateLastSeenAt
    ? `${Math.round((now.getTime() - new Date(db.agent.teammateLastSeenAt).getTime()) / 60000)} minutes ago`
    : "never";
  return [
    `${name} sent ${s.sentToday} of ${s.target} DMs today.`,
    `Overall: ${s.sent} sent, ${s.replied} replied, ${s.todo} still waiting, ${s.skipped} skipped (${s.total} donors).`,
    `Last real activity: ${last}. Last opened the app: ${seen}.`,
    `Unanswered agent nudges: ${db.agent.unansweredNudges}.`,
  ].join("\n");
}

async function llm(system: string, user: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return data.content?.find((c) => c.type === "text")?.text?.trim() || null;
  } catch {
    return null;
  }
}

export async function askAgent(question: string): Promise<string> {
  const db = await readDb();
  const facts = summarize(db);
  const answer = await llm(
    "You are the assistant of a foundation manager. You track a teammate who sends DMs to donors. " +
      "Answer using only the facts given. Be short, plain and direct. Do not invent numbers. " +
      "Say clearly if the facts do not answer the question.",
    `Facts:\n${facts}\n\nQuestion: ${question}`,
  );
  return answer ?? facts;
}

async function say(db: Db, to: "manager" | "teammate", text: string) {
  db.messages.push({ id: newId(), from: "agent", to, text, at: new Date().toISOString() });
}

export interface RunResult {
  action: "skipped" | "none" | "nudged" | "escalated" | "digest";
  reason: string;
}

/** One check. Safe to call often: it decides by itself whether to act. */
export async function runAgent(now = new Date()): Promise<RunResult> {
  const db = await readDb();
  const { settings, agent } = db;
  const t = parts(now, settings.timezone);
  const stats = computeStats(db, now);
  const out: RunResult[] = [];
  const pushes: [Parameters<typeof notify>[0], string, string][] = [];

  const result = await withDb(async (d) => {
    d.agent.lastRunAt = now.toISOString();

    // New activity resets the nudge counter.
    const lastWork = stats.lastActivityAt ? new Date(stats.lastActivityAt).getTime() : 0;
    const lastNudge = agent.lastNudgeAt ? new Date(agent.lastNudgeAt).getTime() : 0;
    if (lastWork > lastNudge) d.agent.unansweredNudges = 0;

    // End-of-day digest for the manager, once per day.
    if (t.hour >= settings.workEndHour && d.agent.lastDigestDay !== t.day) {
      d.agent.lastDigestDay = t.day;
      const text = `End of day report\n${summarize(d, now)}`;
      await say(d, "manager", text);
      pushes.push(["manager", "Daily report", text.split("\n")[1]]);
      return { action: "digest", reason: "end-of-day digest sent" } as RunResult;
    }

    if (t.hour < settings.workStartHour || t.hour >= settings.workEndHour)
      return { action: "skipped", reason: "outside work hours" } as RunResult;
    if (stats.todo === 0) return { action: "none", reason: "no donors waiting" } as RunResult;
    if (stats.sentToday >= settings.dailyTarget)
      return { action: "none", reason: "daily target reached" } as RunResult;

    // Silence is measured from the last real work, or the start of the work day.
    const quietSince = Math.max(lastWork, lastNudge, now.getTime() - 24 * HOUR);
    if (now.getTime() - quietSince < settings.stallHours * HOUR)
      return { action: "none", reason: "recent activity" } as RunResult;

    const left = settings.dailyTarget - stats.sentToday;
    const fallback =
      d.agent.unansweredNudges === 0
        ? `Hi ${settings.teammateName}, quick check-in. ${stats.sentToday} of ${settings.dailyTarget} donor DMs are done today and ${left} to go. Could you send the next few and mark them as sent? If something is blocking you, reply here.`
        : `Hi ${settings.teammateName}, I have not seen any DMs marked as sent for a while. ${left} are left for today. If you are stuck or busy, please reply so your manager knows.`;
    const text =
      (await llm(
        "You write short check-in messages from a foundation's assistant to a teammate who sends DMs to donors. " +
          "Tone: warm, respectful, not pushy. 2 to 3 sentences. Plain English. No emojis. Ask her to reply if something blocks her.",
        `Teammate: ${settings.teammateName}\nDone today: ${stats.sentToday} of ${settings.dailyTarget}\nStill waiting: ${stats.todo}\n` +
          `Nudges already ignored: ${d.agent.unansweredNudges}`,
      )) ?? fallback;

    await say(d, "teammate", text);
    pushes.push(["teammate", "Check-in", text.slice(0, 140)]);
    d.agent.lastNudgeAt = now.toISOString();
    d.agent.unansweredNudges += 1;

    if (d.agent.unansweredNudges >= 2) {
      const warn = `${settings.teammateName} has not responded to ${d.agent.unansweredNudges} check-ins. ${summarize(d, now)}`;
      await say(d, "manager", warn);
      pushes.push(["manager", "Teammate is quiet", warn.slice(0, 140)]);
      return { action: "escalated", reason: "teammate ignored 2+ nudges" } as RunResult;
    }
    return { action: "nudged", reason: "teammate quiet" } as RunResult;
  });
  out.push(result);

  // Push after the db write, because notify() reads the db too.
  await Promise.all(pushes.map(([r, title, body]) => notify(r, title, body)));
  return out[0];
}
