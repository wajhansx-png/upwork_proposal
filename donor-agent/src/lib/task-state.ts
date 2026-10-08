import type { Task } from "./types";

export function evidenceCount(task: Task) {
  return new Set((task.evidence ?? []).filter(e => e.verdict === "supported" && e.recipient).map(e => e.recipient!.toLowerCase().replace(/\W/g, ""))).size;
}

export function taskPhase(task: Task) {
  if (task.status !== "open") return task.status;
  if (task.blockedReason) return "blocked";
  if (!task.startedAt) return "awaiting-start";
  return "working";
}

export function checkDelay(task: Task) {
  if (!task.startedAt) return 2;
  if (task.blockedReason) return 10;
  return Math.max(2, Math.min(task.checkEvery ?? 5, 10));
}

/** Minutes until the next report request. The manager's "check every N min" applies while she is working. */
export function nextDelayMin(task: Task): number {
  const phase = taskPhase(task);
  if (phase === "awaiting-start") return 3;
  if (phase === "blocked") return 10;
  return task.checkEvery ?? 5;
}

/**
 * The planned check-ins across a task's whole window.
 * 5 pushes to her: start, 1/3, 2/3, 30 min before deadline, deadline.
 * These are the only pushes she gets when things are going well. Silent-retry pushes are extra.
 */
export function plannedCheckins(task: Task): number[] {
  const start = new Date(task.createdAt).getTime();
  const deadline = new Date(task.deadlineAt).getTime();
  const span = Math.max(0, deadline - start);
  const points = [
    start + 3 * 60_000,
    start + Math.round(span / 3),
    start + Math.round((2 * span) / 3),
    Math.max(start + 3 * 60_000, deadline - 30 * 60_000),
    deadline,
  ];
  // Dedupe (short tasks collapse points) and sort.
  return [...new Set(points.filter(t => t >= start))].sort((a, b) => a - b);
}

/** The next planned check-in that has not fired yet. Returns null when the deadline has passed. */
export function nextPlannedCheckin(task: Task, lastFiredAt: string | undefined, now: number): number | null {
  const last = lastFiredAt ? new Date(lastFiredAt).getTime() : 0;
  const planned = plannedCheckins(task);
  // A planned point that is due now (<= now) and hasn't fired yet.
  const dueNow = [...planned].reverse().find(t => t <= now && t > last);
  if (dueNow) return dueNow;
  // Otherwise, the next future one.
  const upcoming = planned.find(t => t > now);
  return upcoming ?? null;
}

export function nextCheck(task: Task, now: number) {
  return new Date(now + checkDelay(task) * 60_000).toISOString();
}

export function liveUpdate(task: Task | null | undefined) {
  if (!task) return { title: "Ready for your next task", detail: "Tell the agent what you need. It will collect the details and contact Areeba.", phase: "idle" };
  const phase = taskPhase(task);
  const reported = task.reportedDone ?? 0;
  const title = phase === "awaiting-start" ? "Waiting for Areeba to confirm she started"
    : phase === "blocked" ? "Areeba needs help"
    : phase === "review" ? "Work reported complete — ready for your review"
    : phase === "done" ? "Task completed"
    : phase === "missed" ? "Deadline passed — final update requested"
    : phase === "cancelled" ? "Task cancelled"
    : "Areeba has started — following her progress";
  const detail = task.blockedReason || (task.kind === "dms"
    ? `${reported} of ${task.target} DMs sent.`
    : task.note || task.brief || task.title);
  return { title, detail, phase };
}
