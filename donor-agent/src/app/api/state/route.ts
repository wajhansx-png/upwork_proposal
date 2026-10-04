import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { computeStats } from "@/lib/agent";
import { withDb } from "@/lib/db";
import { pushEnabled } from "@/lib/push";

export async function GET(req: NextRequest) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const db = await withDb((d) => {
    if (role === "teammate") d.agent.teammateLastSeenAt = new Date().toISOString();
    return structuredClone(d);
  });

  return NextResponse.json({
    role,
    settings: db.settings,
    donors: db.donors,
    // Each person only sees their own inbox.
    messages: db.messages.filter((m) => m.to === role || m.from === role).slice(-200),
    stats: computeStats(db),
    agent: role === "manager" ? db.agent : undefined,
    now: new Date().toISOString(),
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  });
}
