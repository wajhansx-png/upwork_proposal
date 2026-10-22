/**
 * Group Time: while the manager has it on, Areeba gets a push every 20 minutes (not at night) naming the next
 * saved message to post in all groups. The messages rotate: never-used first, then the one used longest ago,
 * never the same one twice in a row. Pure functions: they change the db and return the push to send.
 */
import { quietUntil } from "./quiet";
import type { Db, SavedMessage } from "./types";

export const GROUP_TIME_EVERY = 20;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

export interface GroupTimePush { title: string; body: string; url: string; tag: string }

export function setGroupTime(d: Db, on: boolean): void {
  const g = (d.agent.groupTime ??= { on: false, everyMin: GROUP_TIME_EVERY });
  g.on = on;
  g.everyMin = GROUP_TIME_EVERY;
  // Turning it on sends the first reminder at once; turning it off forgets the clock's timing.
  if (on) g.lastAt = undefined;
}

/** The message to suggest now. */
export function nextMessage(saved: SavedMessage[], lastId?: string): SavedMessage | null {
  const pool = saved.length > 1 ? saved.filter((m) => m.id !== lastId) : saved;
  return [...pool].sort((a, b) => ms(a.usedAt) - ms(b.usedAt) || ms(a.at) - ms(b.at))[0] ?? null;
}

const label = (m: SavedMessage) => (m.title || m.text.split("\n").find((l) => l.trim())?.replace(/[*_]/g, "").trim() || "the picture").slice(0, 70);

/** Is a reminder due now? If so, record it and return the push. */
export function groupTimeDue(d: Db, now: number): GroupTimePush | null {
  const g = d.agent.groupTime;
  if (!g?.on || !d.saved?.length) return null;
  if (g.lastAt && now - ms(g.lastAt) < g.everyMin * 60_000) return null;
  if (quietUntil(d.settings, now, Number.MAX_SAFE_INTEGER)) return null;
  const m = nextMessage(d.saved, g.lastId);
  if (!m) return null;
  g.lastAt = new Date(now).toISOString();
  g.lastId = m.id;
  g.sent = (g.sent ?? 0) + 1;
  return { title: "📢 Group Time", body: `Post this in all groups now: “${label(m)}”`, url: `/areeba/messages?m=${m.id}`, tag: "group-time" };
}

/** When the next reminder goes, for the screens. Null when off or nothing is saved. */
export function groupTimeNext(d: Db, now: number): string | null {
  const g = d.agent.groupTime;
  if (!g?.on || !d.saved?.length) return null;
  const due = g.lastAt ? ms(g.lastAt) + g.everyMin * 60_000 : now;
  const night = quietUntil(d.settings, Math.max(due, now), Number.MAX_SAFE_INTEGER);
  return new Date(night ?? Math.max(due, now)).toISOString();
}
