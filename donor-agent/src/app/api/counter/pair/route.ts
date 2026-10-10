import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { setCounter } from "@/lib/agent";

/** Manager turns the counter on/off or makes a fresh token. The token is shown only to the manager. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ action: string }>(req);
  const action = body.action === "off" ? "off" : body.action === "new" ? "new" : "on";
  const r = await setCounter(action);
  return NextResponse.json(r);
}
