import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";

/** Makes a new link for the teammate. The old link and her old session stop working. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  await withDb((db) => {
    db.settings.teammateKeyVersion += 1;
    db.subs = db.subs.filter((s) => s.role !== "teammate");
  });
  return NextResponse.json({ ok: true });
}
