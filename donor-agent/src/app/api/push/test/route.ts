import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { notify, pushEnabled } from "@/lib/push";

/** Sends a test push. A manager may also test the teammate's subscribed phone. */
export async function POST(req: NextRequest) {
  const role = (await getRole(req));
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { to?: "manager" | "teammate" };
  const target = role === "manager" && body.to === "teammate" ? "teammate" : role;
  if (!pushEnabled()) return NextResponse.json({ error: "Server push keys (VAPID) are not set." }, { status: 400 });
  const db = await readDb();
  const devices = db.subs.filter((s) => s.role === target).length;
  if (!devices) {
    const who = target === "teammate" ? db.settings.teammateName : "this device";
    return NextResponse.json({ error: `${who} has no subscribed phone yet. Open Donor Desk on that phone and press “Turn on alerts” first.` }, { status: 400 });
  }
  const delivery = await notify(
    target,
    target === "teammate" ? "Donor Desk test from your manager" : "Donor Desk test",
    target === "teammate" ? "Notifications are working. No action is needed for this test." : "Notifications are working, even when the app is closed.",
  );
  if (!delivery.accepted) return NextResponse.json({ error: "The push service did not accept this alert. Re-enable alerts on the receiving device and try again." }, { status: 502 });
  return NextResponse.json({ ok: true, devices, accepted: delivery.accepted });
}
