import { after, NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { askForUpdate } from "@/lib/agent";

/** Manager only: ask Areeba for an update now (a message and a phone alert, worded differently each time). */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const defer = (fn: () => Promise<void>) => after(() => fn().catch((e) => console.error("background work failed", e)));
  const r = await askForUpdate({ defer });
  return NextResponse.json(r, { status: r.ok ? 200 : r.waitSeconds ? 429 : 400 });
}
