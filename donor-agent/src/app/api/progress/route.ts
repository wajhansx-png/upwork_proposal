import { after, NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { setProgress } from "@/lib/agent";

export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "teammate") return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = await readBody<{ total: number }>(req);
  if (typeof body.total !== "number" || !Number.isFinite(body.total)) return NextResponse.json({ error: "Bad number" }, { status: 400 });
  const defer = (fn: () => Promise<void>) => after(() => fn().catch((e) => console.error("background work failed", e)));
  try {
    await setProgress(body.total, { defer });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
