import { withDb } from "./db";
import { notify } from "./push";
import { groupTimeDue } from "./group-time";

/** One tick of Group Time: send the reminder if it is due. Safe to call often (decided under the db lock). */
export async function tickGroupTime(now = Date.now()): Promise<boolean> {
  const push = await withDb((d) => groupTimeDue(d, now));
  if (!push) return false;
  await notify("teammate", push.title, push.body, { persistent: true, tag: push.tag, url: push.url });
  return true;
}
