import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { newId, withDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "teammate") return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { kind?: "received" | "opened"; receiptId?: string; taskId?: string } | null;
  if (!body?.receiptId || !body.taskId || (body.kind !== "received" && body.kind !== "opened")) return NextResponse.json({ error: "Bad receipt" }, { status: 400 });
  await withDb((db) => {
    const task = db.tasks.find((item) => item.id === body.taskId);
    const receipt = task?.pushReceipts?.find((item) => item.id === body.receiptId);
    if (!task || !receipt) return;
    const at = new Date().toISOString();
    const name = db.settings.teammateName;
    if (body.kind === "received" && !receipt.receivedAt) {
      receipt.receivedAt = at;
      db.messages.push({ id: newId(), owner: "manager", from: "agent", at, kind: "update", text: `${name} received ${receipt.label} (${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}).` });
    }
    if (body.kind === "opened" && !receipt.openedAt) {
      receipt.openedAt = at;
      db.messages.push({ id: newId(), owner: "manager", from: "agent", at, kind: "update", text: `${name} opened ${receipt.label} (${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}).` });
    }
  });
  return NextResponse.json({ ok: true });
}
