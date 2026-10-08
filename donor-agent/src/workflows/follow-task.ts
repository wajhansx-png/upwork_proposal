import { sleep } from "workflow";
import { readDb, withDb } from "../lib/db";
import { runAgent } from "../lib/agent";

async function check(taskId: string) {
  "use step";
  const before = await readDb();
  const task = before.tasks.find(t => t.id === taskId);
  if (!task || !["open", "review"].includes(task.status)) return false;
  await runAgent(Date.now(), taskId);
  await withDb(d => {
    const current = d.tasks.find(t => t.id === taskId);
    if (current) current.lastWorkerAt = new Date().toISOString();
  });
  return true;
}

export async function followTask(taskId: string) {
  "use workflow";
  // Assignment deadlines are bounded to 14 days. A cancelled/completed task exits early.
  for (let minute = 0; minute < 20_160; minute++) {
    if (!(await check(taskId))) return;
    await sleep("1m");
  }
}
