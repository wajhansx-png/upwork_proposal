import { sleep } from "workflow";
import { readDb, withDb } from "../lib/db";
import { planPending } from "../lib/groups";
import { tickPlan } from "../lib/plan-tick";

async function check(caseId: string) {
  "use step";
  const c = (await readDb()).cases.find((x) => x.id === caseId);
  // The case closed, or every message is posted: the clock stops. A new message starts a new clock.
  if (!c || !planPending(c)) return false;
  await tickPlan(Date.now());
  await withDb((d) => {
    const cur = d.cases.find((x) => x.id === caseId);
    if (cur) cur.planWorkerAt = new Date().toISOString();
  });
  return true;
}

export async function followPlan(caseId: string) {
  "use workflow";
  // At most 14 days, like a task.
  for (let minute = 0; minute < 20_160; minute++) {
    if (!(await check(caseId))) return;
    await sleep("1m");
  }
}
