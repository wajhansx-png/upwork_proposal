import { getRun, start } from "workflow/api";
import { followPlan } from "../workflows/follow-plan";
import { readDb, withDb } from "./db";
import { openCaseOf, planPending } from "./groups";
import type { CaseFile } from "./types";

const MIN = 60_000;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

/** Is the plan's clock still going? Same rules as a task's follow-up. */
async function alive(c: CaseFile, now: number): Promise<boolean> {
  if (!c.planRunId) return false;
  if (c.planRunId === "starting") return now - ms(c.planStartedAt) < 2 * MIN;
  try {
    const status = await getRun(c.planRunId).status;
    return status === "pending" || status === "running";
  } catch (error) {
    if ((error as Error)?.name === "WorkflowRunNotFoundError") return false;
    return now - Math.max(ms(c.planWorkerAt), ms(c.planStartedAt)) < 5 * MIN;
  }
}

/** Make sure an open case with messages still to go has a live one-minute clock. A dead one is replaced. */
export async function ensurePlanClock(now = Date.now()) {
  const seen = openCaseOf(await readDb());
  if (!seen || !planPending(seen) || (await alive(seen, now))) return;
  const claimed = await withDb((d) => {
    const c = d.cases.find((x) => x.id === seen.id);
    if (!c || !planPending(c) || c.planRunId !== seen.planRunId) return null;
    c.planRunId = "starting";
    c.planStartedAt = new Date(now).toISOString();
    return c.id;
  });
  if (!claimed) return;
  try {
    const run = await start(followPlan, [claimed]);
    await withDb((d) => {
      const c = d.cases.find((x) => x.id === claimed);
      if (c) c.planRunId = run.runId;
    });
  } catch (error) {
    console.error("The group plan clock could not start:", error);
    await withDb((d) => {
      const c = d.cases.find((x) => x.id === claimed);
      if (c) c.planRunId = undefined;
    });
  }
}
