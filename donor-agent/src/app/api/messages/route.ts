import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { newId, withDb } from "@/lib/db";
import { notify } from "@/lib/push";
import type { Role } from "@/lib/types";

export async function POST(req: NextRequest) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  const to: Role = role === "manager" ? "teammate" : "manager";
  const name = await withDb((db) => {
    db.messages.push({ id: newId(), from: role, to, text: clean, at: new Date().toISOString() });
    return db.settings.teammateName;
  });
  await notify(to, role === "manager" ? "Message from your manager" : `Message from ${name}`, clean.slice(0, 140));
  return NextResponse.json({ ok: true });
}
