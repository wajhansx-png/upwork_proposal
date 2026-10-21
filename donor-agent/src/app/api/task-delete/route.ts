import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { deleteTask } from "@/lib/agent";

/** Manager only: delete one task by id. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ id: string }>(req);
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "Say which task." }, { status: 400 });
  const r = await deleteTask(body.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
