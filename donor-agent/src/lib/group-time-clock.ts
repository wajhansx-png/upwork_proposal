import { getRun, start } from "workflow/api";
import { followGroupTime } from "../workflows/follow-group-time";
import { readDb, withDb } from "./db";
import type { GroupTime } from "./types";

const MIN = 60_000;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

async function alive(g: GroupTime, now: number): Promise<boolean> {
  if (!g.runId) return false;
  if (g.runId === "starting") return now - ms(g.startedAt) < 2 * MIN;
  try {
    const status = await getRun(g.runId).status;
    return status === "pending" || status === "running";
  } catch (error) {
    if ((error as Error)?.name === "WorkflowRunNotFoundError") return false;
    return now - Math.max(ms(g.workerAt), ms(g.startedAt)) < 5 * MIN;
  }
}

/** While Group Time is on, keep one live one-minute clock. A dead one is replaced. Same rules as a task's follow-up. */
export async function ensureGroupTimeClock(now = Date.now()) {
  const seen = (await readDb()).agent.groupTime;
  if (!seen?.on || (await alive(seen, now))) return;
  const claimed = await withDb((d) => {
    const g = d.agent.groupTime;
    if (!g?.on || g.runId !== seen.runId) return false;
    g.runId = "starting";
    g.startedAt = new Date(now).toISOString();
    return true;
  });
  if (!claimed) return;
  try {
    const run = await start(followGroupTime, []);
    await withDb((d) => {
      if (d.agent.groupTime) d.agent.groupTime.runId = run.runId;
    });
  } catch (error) {
    console.error("The Group Time clock could not start:", error);
    await withDb((d) => {
      if (d.agent.groupTime) d.agent.groupTime.runId = undefined;
    });
  }
}
