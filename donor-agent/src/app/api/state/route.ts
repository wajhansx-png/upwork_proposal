import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { readDb, usingPersistentStore, withDb } from "@/lib/db";
import { aiKind, visionEnabled } from "@/lib/llm";
import { pushEnabled } from "@/lib/push";

export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });

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
    tasks: db.tasks.slice(-30),
    // The manager has two threads: with the agent, and the teammate's own chat.
    messages: db.messages.filter((m) => m.owner === role).slice(-150),
    teammateMessages: manager ? db.messages.filter((m) => m.owner === "teammate").slice(-150) : undefined,
    agent: manager ? db.agent : undefined,
    system: manager ? { ai: aiKind(), vision: visionEnabled(), push: pushEnabled(), persistent: usingPersistentStore() } : undefined,
    now: new Date().toISOString(),
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  });
}
