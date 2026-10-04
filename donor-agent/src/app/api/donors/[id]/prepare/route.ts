import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";

/** The teammate copied or opened the message for this donor. Needed to trust a later "sent" mark. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if ((await getRole(req)) !== "teammate") return NextResponse.json({ error: "Teammate only" }, { status: 403 });
  const { id } = await ctx.params;
  await withDb((db) => {
    const d = db.donors.find((x) => x.id === id);
    if (d && d.status === "todo") d.preparedAt = new Date().toISOString();
  });
  return NextResponse.json({ ok: true });
}
