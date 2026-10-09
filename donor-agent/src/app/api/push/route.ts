import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const role = (await getRole(req));
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const sub = await readBody<{ endpoint: unknown; keys: { p256dh?: unknown; auth?: unknown } }>(req);
  const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 2000;
  const endpoint = sub.endpoint;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (!ok(endpoint) || !endpoint.startsWith("https://") || !ok(p256dh) || !ok(auth))
    return NextResponse.json({ error: "Bad subscription" }, { status: 400 });
  const clean = { endpoint, keys: { p256dh, auth } };
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
