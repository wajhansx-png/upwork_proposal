import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { runAgent } from "@/lib/agent";
import { ensureFollowup } from "@/lib/start-followup";
import { evaluatePending } from "@/lib/evaluate";

/** Called every minute by a scheduler (Authorization: Bearer CRON_SECRET, or ?key=CRON_SECRET), or by the manager. */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const role = await getRole(req);
  const ok =
    (!!secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret)) ||
    !!role;
  if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  await ensureFollowup();
  const result = await runAgent();
  await evaluatePending();
  return NextResponse.json(result);
}

export const POST = handle;
// Free schedulers like cron-job.org send GET by default.
export const GET = handle;
