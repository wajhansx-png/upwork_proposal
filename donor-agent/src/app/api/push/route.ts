import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const role = (await getRole(req));
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const sub = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)
    return NextResponse.json({ error: "Bad subscription" }, { status: 400 });
  const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  // One browser = one person. The manager's phone is never saved as Areeba's.
  const taken = await withDb((db) => {
    const owner = db.subs.find((s) => s.sub.endpoint === clean.endpoint)?.role;
    if (role === "teammate" && owner === "manager") return true;
    db.subs = db.subs.filter((s) => s.sub.endpoint !== clean.endpoint);
    db.subs.push({ role, sub: clean });
    return false;
  });
  if (taken) return NextResponse.json({ error: "This phone already gets the manager's alerts. Open this page on Areeba's own phone." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
