import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { withDb } from "@/lib/db";
import type { DonorStatus } from "@/lib/types";

const STATUSES: DonorStatus[] = ["todo", "sent", "replied", "skipped"];
const TOO_FAST_MS = 20_000;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { id } = await ctx.params;
  const { status, replyText } = (await req.json().catch(() => ({}))) as { status?: DonorStatus; replyText?: string };
  if (!status || !STATUSES.includes(status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
  const proof = String(replyText ?? "").trim().slice(0, 1000);
  if (status === "replied" && role === "teammate" && proof.length < 3)
    return NextResponse.json({ error: "Paste what the donor replied. This is the proof." }, { status: 400 });

  const result = await withDb((db) => {
    const d = db.donors.find((x) => x.id === id);
    if (!d) return "missing" as const;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    d.status = status;
    d.updatedAt = now;
    if (role === "teammate") d.touchedAt = now;

    if (status === "sent" && !d.sentAt) {
      d.sentAt = now;
      if (role === "teammate") {
        d.flags = [];
        if (!d.preparedAt) d.flags.push("marked sent without copying or opening the message");
        const recent = db.donors.some(
          (o) => o.id !== d.id && o.sentAt && o.touchedAt && nowMs - new Date(o.touchedAt).getTime() < TOO_FAST_MS && o.status !== "todo",
        );
        if (recent) d.flags.push("marked within 20 seconds of another donor");
        if (d.preparedAt && nowMs - new Date(d.preparedAt).getTime() < 5_000)
          d.flags.push("marked less than 5 seconds after opening the message");
      }
    }
    if (status === "replied") {
      d.sentAt ??= now;
      d.repliedAt = now;
      if (proof) d.replyText = proof;
    }
    if (status === "todo") {
      d.sentAt = undefined;
      d.repliedAt = undefined;
      d.replyText = undefined;
      d.preparedAt = undefined;
      d.flags = [];
    }
    return "ok" as const;
  });
  return result === "ok" ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (roleFromRequest(req) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { id } = await ctx.params;
  await withDb((db) => {
    db.donors = db.donors.filter((d) => d.id !== id);
  });
  return NextResponse.json({ ok: true });
}
