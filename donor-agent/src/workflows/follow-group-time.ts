import { sleep } from "workflow";
import { readDb, withDb } from "../lib/db";
import { tickGroupTime } from "../lib/group-time-tick";

async function check() {
  "use step";
  if (!(await readDb()).agent.groupTime?.on) return false;
  await tickGroupTime(Date.now());
  await withDb((d) => {
    if (d.agent.groupTime) d.agent.groupTime.workerAt = new Date().toISOString();
  });
  return true;
}

/** The one-minute clock of Group Time. Stops when the manager turns it off; at most 14 days, then a new one starts. */
export async function followGroupTime() {
  "use workflow";
  for (let minute = 0; minute < 20_160; minute++) {
    if (!(await check())) return;
    await sleep("1m");
  }
}
