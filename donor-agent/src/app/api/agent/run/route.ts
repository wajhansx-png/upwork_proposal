import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { runAgent } from "@/lib/agent";

/** Called by a scheduler (Authorization: Bearer CRON_SECRET) or by the manager. */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
  if (!(secret && bearer) && roleFromRequest(req) !== "manager")
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return NextResponse.json(await runAgent());
}
