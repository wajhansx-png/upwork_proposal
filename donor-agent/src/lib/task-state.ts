import type { Task } from "./types";

export function evidenceCount(task: Task) {
  return new Set((task.evidence ?? []).filter(e => e.verdict === "supported" && e.recipient).map(e => e.recipient!.toLowerCase().replace(/\W/g, ""))).size;
}

export function taskPhase(task: Task) {
  if (task.status !== "open") return task.status;
  if (task.blockedReason) return "blocked";
  if (!task.startedAt) return "awaiting-start";
  if ((task.reportedDone ?? 0) > evidenceCount(task)) return "awaiting-proof";
  return "working";
}

export function checkDelay(task: Task) {
  if (!task.startedAt) return 2;
  if (task.blockedReason) return 10;
  if (taskPhase(task) === "awaiting-proof") return 3;
  return Math.max(2, Math.min(task.checkEvery ?? 5, 10));
}

/** Minutes until the next report request. The manager's "check every N min" applies while she is working. */
export function nextDelayMin(task: Task): number {
  const phase = taskPhase(task);
  if (phase === "awaiting-start") return 3;
  if (phase === "blocked") return 10;
  if (phase === "awaiting-proof") return 5;
  return task.checkEvery ?? 5;
}

export function nextCheck(task: Task, now: number) {
  return new Date(now + checkDelay(task) * 60_000).toISOString();
}

export function liveUpdate(task: Task | null | undefined) {
  if (!task) return { title: "Ready for your next task", detail: "Tell the agent what you need. It will collect the details and contact Areeba.", phase: "idle" };
  const phase = taskPhase(task);
  const reported = task.reportedDone ?? 0;
  const supported = evidenceCount(task);
  const title = phase === "awaiting-start" ? "Waiting for Areeba to confirm she started"
    : phase === "blocked" ? "Areeba needs help"
    : phase === "awaiting-proof" ? `${reported} reported — checking proof`
    : phase === "review" ? "Work reported complete — ready for your review"
    : phase === "done" ? "Task completed"
    : phase === "missed" ? "Deadline passed — final update requested"
    : phase === "cancelled" ? "Task cancelled"
    : "Areeba has started — following her progress";
  const detail = task.blockedReason || (task.kind === "dms"
    ? `${reported} of ${task.target} DMs reported. Evidence supports ${supported} distinct recipient${supported === 1 ? "" : "s"}.`
    : task.note || task.brief || task.title);
  return { title, detail, phase };
}
