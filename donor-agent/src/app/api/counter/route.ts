import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { recordCounterEvents } from "@/lib/agent";
import type { CounterEvent } from "@/lib/counter";
import type { Role } from "@/lib/types";

// The add-on posts here from its own background page (host permission), so no browser CORS step is needed.
// Auth is the secret token, not a cookie: the add-on is not a signed-in page.
export async function POST(req: NextRequest) {
  const body = await readBody<{ token: string; from: Role; events: CounterEvent[] }>(req);
  if (typeof body.token !== "string" || !body.token) return NextResponse.json({ ok: false, error: "No token" }, { status: 401 });
  const from: Role = body.from === "manager" ? "manager" : "teammate";
  const r = await recordCounterEvents(body.token, from, Array.isArray(body.events) ? body.events : []);
  // A wrong token or the switch being off returns ok:false, so the add-on knows to go quiet.
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
