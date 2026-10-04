import { NextRequest, NextResponse } from "next/server";
import { authenticate, teammateKey } from "@/lib/auth";
import { computeStats } from "@/lib/agent";
import { readDb, usingRedis, withDb } from "@/lib/db";
import { aiKind, visionEnabled } from "@/lib/llm";
import { pushEnabled } from "@/lib/push";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { role } = auth;

  let db = auth.db ?? (await readDb());
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
    // The manager has two threads: with the agent, and the teammate's own chat.
    messages: db.messages.filter((m) => m.owner === role).slice(-150),
    teammateMessages: manager ? db.messages.filter((m) => m.owner === "teammate").slice(-150) : undefined,
    stats: computeStats(db),
    agent: manager ? db.agent : undefined,
    system: manager ? { ai: aiKind(), vision: visionEnabled(), push: pushEnabled(), persistent: usingRedis() } : undefined,
    teammateKey: manager ? teammateKey(db.settings.teammateKeyVersion) : undefined,
    now: new Date().toISOString(),
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  });
}
