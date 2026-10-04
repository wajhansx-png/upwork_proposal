import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { notify, pushEnabled } from "@/lib/push";

/** Sends a test push to the caller's own devices, so they can see it works with the browser closed. */
export async function POST(req: NextRequest) {
  const role = (await getRole(req));
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ error: "Server push keys (VAPID) are not set." }, { status: 400 });
  const devices = (await readDb()).subs.filter((s) => s.role === role).length;
  if (!devices) return NextResponse.json({ error: "No device is subscribed yet. Press 'Turn on notifications' first." }, { status: 400 });
  await notify(role, "Test notification", "It works. You can close the app now.");
  return NextResponse.json({ ok: true, devices });
}
