import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { runAgent } from "@/lib/agent";

/** Called every minute by a scheduler (Authorization: Bearer CRON_SECRET, or ?key=CRON_SECRET), or by the manager. */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const ok =
    (!!secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret)) ||
    (await getRole(req)) === "manager";
  if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return NextResponse.json(await runAgent());
}

export const POST = handle;
// Free schedulers like cron-job.org send GET by default.
export const GET = handle;
