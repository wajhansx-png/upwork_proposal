import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { handleManagerMessage, handleTeammateMessage } from "@/lib/agent";

export async function POST(req: NextRequest) {
  const role = roleFromRequest(req);
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  await (role === "manager" ? handleManagerMessage(clean) : handleTeammateMessage(clean));
  return NextResponse.json({ ok: true });
}
