import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { handleManagerMessage, handleManagerToTeammate, handleTeammateMessage, type ChatImage } from "@/lib/agent";
import { saveImage } from "@/lib/images";

export async function POST(req: NextRequest) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { text?: string; image?: string; to?: string };
  const text = String(body.text ?? "").trim().slice(0, 2000);
  if (!text && !body.image) return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  try {
    if (role === "manager") {
      if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
      await (body.to === "teammate" ? handleManagerToTeammate(text) : handleManagerMessage(text));
    } else {
      const image: ChatImage | null = body.image ? await saveImage(body.image) : null;
      await handleTeammateMessage(text, image);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
