import { withDb } from "./db";
import { notify } from "./push";
import { runPlan } from "./groups";

/** One tick of the group plan: send what is due, push her when late. Safe to call often (the work happens under the db lock). */
export async function tickPlan(now = Date.now()): Promise<number> {
  const pushes = await withDb((d) => runPlan(d, now));
  for (const p of pushes) await notify(p.role, p.title, p.body, { persistent: p.persistent, tag: p.tag, url: p.url });
  return pushes.length;
}
