import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { computeStats } from "@/lib/agent";
import { readDb, usingRedis, withDb } from "@/lib/db";
import { llmEnabled } from "@/lib/llm";
import { pushEnabled } from "@/lib/push";

export async function GET(req: NextRequest) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  let db = await readDb();
  // Only write "last seen" about once a minute, to keep storage use low.
  if (role === "teammate") {
    const seen = db.agent.teammateLastSeenAt;
    if (!seen || Date.now() - new Date(seen).getTime() > 60_000) {
      db = await withDb((d) => {
        d.agent.teammateLastSeenAt = new Date().toISOString();
        return structuredClone(d);
      });
    }
  }

  const manager = role === "manager";
  return NextResponse.json({
    role,
    settings: db.settings,
    donors: manager ? db.donors : db.donors.filter((d) => d.status === "todo" || d.sentAt),
    tasks: db.tasks.slice(-30),
    messages: db.messages.filter((m) => m.owner === role).slice(-150),
    stats: computeStats(db),
    agent: manager ? db.agent : undefined,
    system: manager ? { llm: llmEnabled(), push: pushEnabled(), persistent: usingRedis() } : undefined,
    now: new Date().toISOString(),
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  });
}
