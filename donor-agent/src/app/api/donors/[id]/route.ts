import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { withDb } from "@/lib/db";
import type { DonorStatus } from "@/lib/types";

const STATUSES: DonorStatus[] = ["todo", "sent", "replied", "skipped"];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { id } = await ctx.params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: DonorStatus };
  if (!status || !STATUSES.includes(status))
    return NextResponse.json({ error: "Bad status" }, { status: 400 });

  const found = await withDb((db) => {
    const d = db.donors.find((x) => x.id === id);
    if (!d) return false;
    const now = new Date().toISOString();
    d.status = status;
    d.updatedAt = now;
    if (role === "teammate") d.touchedAt = now;
    if (status === "sent" && !d.sentAt) d.sentAt = now;
    if (status === "replied") {
      d.sentAt ??= now;
      d.repliedAt = now;
    }
    if (status === "todo") {
      d.sentAt = undefined;
      d.repliedAt = undefined;
    }
    return true;
  });
  return found ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (roleFromRequest(req) !== "manager")
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { id } = await ctx.params;
  await withDb((db) => {
    db.donors = db.donors.filter((d) => d.id !== id);
  });
  return NextResponse.json({ ok: true });
}
