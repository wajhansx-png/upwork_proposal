import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { clearChatsAndTasks } from "@/lib/agent";

/** Manager only: delete all chats and tasks. The body must say {"confirm":"CLEAR"}, so a stray call cannot wipe anything. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ confirm: string }>(req);
  if (body.confirm !== "CLEAR") return NextResponse.json({ error: "Not confirmed." }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await clearChatsAndTasks()) });
}
