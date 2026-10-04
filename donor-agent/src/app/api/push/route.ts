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
  await withDb((db) => {
    db.subs = db.subs.filter((s) => s.sub.endpoint !== clean.endpoint);
    db.subs.push({ role, sub: clean });
  });
  return NextResponse.json({ ok: true });
}
