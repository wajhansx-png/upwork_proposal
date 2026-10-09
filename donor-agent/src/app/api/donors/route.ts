import { after, NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { markDonor, openCase, saveDonor } from "@/lib/agent";
import { caseText, dmGreeting, fitAsk } from "@/lib/case";
import { donorStats, draftMessage, ruleIdeas, todayPicks, type DonorAction } from "@/lib/donors";

const ACTIONS: DonorAction[] = ["sent", "replied", "donated", "no", "undo"];

/** All donors, who to message today (with the message ready), and the numbers. */
export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const db = await readDb();
  const now = Date.now();
  const task = [...db.tasks].reverse().find((t) => t.status === "open" && t.kind === "dms");
  // Today's list fits what is left of her task, 5 to 15 donors.
  const n = task ? Math.min(15, Math.max(5, task.target - (task.reportedDone ?? 0))) : 10;
  const name = db.settings.teammateName;
  const c = openCase(db);
  const caseDm = c ? (first: string, female: boolean) => caseText(c, { greet: dmGreeting(first, female) }) : undefined;
  const picks = todayPicks(db.donors, now, n, c).map((p) => ({ ...p, message: draftMessage(db.donors.find((d) => d.id === p.id)!, p.why, name, caseDm) }));
  return NextResponse.json({
    role,
    teammate: name,
    donors: db.donors.map((d) => ({ ...d, undo: undefined, canUndo: !!d.undo })),
    picks,
    stats: donorStats(db.donors),
    ideas: role === "manager" ? ruleIdeas(db.donors, now) : undefined,
    task: task ? { title: task.title, done: task.reportedDone ?? 0, target: task.target } : null,
    case: c ? { name: c.facts.name, amountLeft: c.facts.amountLeft, ...fitAsk(c.facts.amountLeft, c.facts.askAmount), sent: db.donors.filter((d) => d.caseId === c.id).length } : null,
  });
}

/** { id, action, amount? } marks a donor. Manager only: { add: { name, phone } } or { id, phone } adds or fixes a donor. */
export async function POST(req: NextRequest) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = await readBody<{ id: string; action: string; amount: number; phone: string; name: string; add: { name?: string; phone?: string } }>(req);
  const defer = (fn: () => Promise<void>) => after(() => fn().catch((e) => console.error("background work failed", e)));
  try {
    if (body.add || (body.id && body.action === undefined)) {
      if (role !== "manager") return NextResponse.json({ error: "Only the manager can change the list." }, { status: 403 });
      const input = body.add ? { name: body.add.name, phone: body.add.phone } : { id: String(body.id), name: body.name, phone: body.phone };
      return NextResponse.json({ ok: true, donor: await saveDonor(input) });
    }
    if (typeof body.id !== "string" || !ACTIONS.includes(body.action as DonorAction)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount : undefined;
    return NextResponse.json({ ok: true, donor: await markDonor(role, body.id, body.action as DonorAction, { amount, defer }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
