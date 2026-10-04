import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { askAgent } from "@/lib/agent";

export async function POST(req: NextRequest) {
  if (roleFromRequest(req) !== "manager")
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  const q = String(question ?? "").trim().slice(0, 500);
  if (!q) return NextResponse.json({ error: "Empty question" }, { status: 400 });
  return NextResponse.json({ answer: await askAgent(q) });
}
