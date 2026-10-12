import { withDb } from "./db";
import type { Db, Task } from "./types";

const WRITE_EVERY = 30_000;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

/** The task the manager's screen shows. */
const managerTask = (tasks: Task[]) => [...tasks].reverse().find((t) => t.status === "open" || t.status === "review") ?? tasks.at(-1);
/** The task Areeba's screen shows. */
const herTask = (tasks: Task[]) => [...tasks].reverse().find((t) => t.status === "open" || t.status === "review") ?? (tasks.at(-1)?.status === "missed" ? tasks.at(-1) : undefined);

/**
 * The manager's screen just loaded her count: remember which count he saw, and when.
 * Called on every refresh of his visible screen, so it writes at most every 30 seconds, or at once when the count he sees changed.
 */
export async function noteManagerSeen(db: Db, now: number): Promise<Db> {
  const t = managerTask(db.tasks);
  if (!t || t.kind !== "dms") return db;
  const s = db.agent.managerSeen;
  if (s && s.taskId === t.id && s.done === (t.reportedDone ?? 0) && now - ms(s.at) < WRITE_EVERY) return db;
  return withDb((d) => {
    const x = managerTask(d.tasks);
    if (x && x.kind === "dms") d.agent.managerSeen = { at: new Date(now).toISOString(), taskId: x.id, done: x.reportedDone ?? 0 };
    return structuredClone(d);
  });
}

/** When the manager last saw the count Areeba is looking at right now, or null. A newer count is "not seen yet". */
export function managerSeenAt(db: Db): string | null {
  const t = herTask(db.tasks);
  const s = db.agent.managerSeen;
  if (!t || t.kind !== "dms" || !s) return null;
  return s.taskId === t.id && s.done === (t.reportedDone ?? 0) ? s.at : null;
}
