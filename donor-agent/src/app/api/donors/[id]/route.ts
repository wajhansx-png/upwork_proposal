import { after, NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { verifyProof } from "@/lib/agent";
import { readDb, withDb } from "@/lib/db";
import { saveImage, type Saved } from "@/lib/images";
import { visionEnabled } from "@/lib/llm";
import type { DonorStatus } from "@/lib/types";

const STATUSES: DonorStatus[] = ["todo", "sent", "replied", "skipped"];
const TOO_FAST_MS = 20_000;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: DonorStatus; replyText?: string; image?: string };
  const status = body.status;
  if (!status || !STATUSES.includes(status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
  const proof = String(body.replyText ?? "").trim().slice(0, 1000);
  if (status === "replied" && role === "teammate" && proof.length < 3)
    return NextResponse.json({ error: "Paste what the donor replied. This is the proof." }, { status: 400 });

  const settings = (await readDb()).settings;
  let shot: Saved | null = null;
  if (status === "sent" && role === "teammate") {
    if (!body.image && settings.requireProof)
      return NextResponse.json({ error: "Add a screenshot of the sent message first." }, { status: 400 });
    try {
      if (body.image) shot = await saveImage(body.image);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

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
        // With a screenshot, the screenshot is the evidence. Behavior hints are only used without one.
        if (!shot && !d.preparedAt) d.flags.push("marked sent without copying or opening the message");
        const recent = !shot && db.donors.some(
          (o) => o.id !== d.id && o.sentAt && o.touchedAt && nowMs - new Date(o.touchedAt).getTime() < TOO_FAST_MS && o.status !== "todo",
        );
        if (recent) d.flags.push("marked within 20 seconds of another donor");
        if (!shot && d.preparedAt && nowMs - new Date(d.preparedAt).getTime() < 5_000)
          d.flags.push("marked less than 5 seconds after opening the message");
        if (shot) {
          const old = db.hashes[shot.hash];
          if (old && old !== `donor:${d.id}`) d.flags.push(`this screenshot was already used (${old.replace("donor:", "donor ")})`);
          else db.hashes[shot.hash] = `donor:${d.id}`;
          d.proofImg = shot.id;
          d.proofCheck = visionEnabled()
            ? { verdict: "unchecked", reason: "Checking the screenshot…" }
            : { verdict: "unchecked", reason: "No AI key, so the screenshot was saved but not read." };
        }
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
      d.proofImg = undefined;
      d.proofCheck = undefined;
      d.flags = [];
    }
    return "ok" as const;
  });
  if (result !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Read the screenshot after replying, so the button does not wait for the AI.
  if (shot && visionEnabled()) {
    const sid = shot.id;
    after(() => verifyProof(id, sid));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { id } = await ctx.params;
  await withDb((db) => {
    db.donors = db.donors.filter((d) => d.id !== id);
  });
  return NextResponse.json({ ok: true });
}
