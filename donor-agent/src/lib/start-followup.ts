import { getRun, start } from "workflow/api";
import { followTask } from "../workflows/follow-task";
import { withDb, readDb } from "./db";
import type { Task } from "./types";

const MIN = 60_000;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
const running = (t?: Task) => !!t && (t.status === "open" || t.status === "review");

/** Is the background follow-up of this task still going? "starting" is trusted for 2 minutes only. */
async function followupAlive(t: Task, now: number): Promise<boolean> {
  if (!t.workflowRunId) return false;
  if (t.workflowRunId === "starting") return now - ms(t.workflowStartedAt) < 2 * MIN;
  try {
    const status = await getRun(t.workflowRunId).status;
    return status === "pending" || status === "running";
  } catch (error) {
    // The run is gone: replace it. Any other error is a short problem asking; judge by its heartbeat, written every minute.
    if ((error as Error)?.name === "WorkflowRunNotFoundError") return false;
    return now - Math.max(ms(t.lastWorkerAt), ms(t.workflowStartedAt)) < 5 * MIN;
  }
}

/**
 * Make sure the running task has a live follow-up, the one-minute clock that pushes her.
 * A follow-up that finished, failed or vanished is replaced, so the clock cannot stop silently.
 */
export async function ensureFollowup(now = Date.now()) {
  const seen = [...(await readDb()).tasks].reverse().find(running);
  if (!seen || (await followupAlive(seen, now))) return;
  const claimed = await withDb((d) => {
    const t = d.tasks.find((x) => x.id === seen.id);
    // Someone else claimed it between our read and now: leave it to them.
    if (!running(t) || t!.workflowRunId !== seen.workflowRunId) return null;
    t!.workflowRunId = "starting";
    t!.workflowStartedAt = new Date(now).toISOString();
    return t!.id;
  });
  if (!claimed) return;
  try {
    const run = await start(followTask, [claimed]);
    await withDb((d) => {
      const t = d.tasks.find((x) => x.id === claimed);
      if (t) t.workflowRunId = run.runId;
    });
  } catch (error) {
    console.error("The background follow-up could not start:", error);
    await withDb((d) => {
      const t = d.tasks.find((x) => x.id === claimed);
      if (t) t.workflowRunId = undefined;
    });
    throw error;
  }
}
