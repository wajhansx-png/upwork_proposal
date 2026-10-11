import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { setOldDonors } from "@/lib/agent";

/** Manager only: the "old donors" switch on the running DM task. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ oldDonors: boolean }>(req);
  if (typeof body.oldDonors !== "boolean") return NextResponse.json({ error: "Say true or false." }, { status: 400 });
  const r = await setOldDonors(body.oldDonors);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
