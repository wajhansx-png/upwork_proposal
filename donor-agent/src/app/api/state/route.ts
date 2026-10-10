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
    // The "already counted" id list can be 2,000 long; the phone never needs it.
    agent: manager ? { ...db.agent, counter: db.agent.counter ? { ...db.agent.counter, seen: undefined } : undefined } : undefined,
    system: manager ? { ai: aiKind(), vision: visionEnabled(), push: pushEnabled(), persistent: usingPersistentStore() } : undefined,
    // Counter status. The manager sees the token (to pair the add-on); Areeba only sees on/off + last seen.
    counter: (() => {
      const c = db.agent.counter;
      const base = { on: !!c?.on, lastAt: c?.lastAt, sentToday: c?.sentToday ?? 0 };
      return manager ? { ...base, token: c?.token ?? "", linked: !!c?.lastAt } : base;
    })(),
    now: new Date().toISOString(),
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  });
}
