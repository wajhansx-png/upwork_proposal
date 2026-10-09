import { after, NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { handleManagerMessage, handleManagerToTeammate, handleTeammateMessage, type ChatImage } from "@/lib/agent";
import { saveImage } from "@/lib/images";
import { ensureFollowup } from "@/lib/start-followup";
import { evaluatePending } from "@/lib/evaluate";

export async function POST(req: NextRequest) {
  const role = await getRole(req);
  if (!role) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const body = await readBody<{ text: string; image: string; to: string }>(req);
  const text = String(body.text ?? "").trim().slice(0, 2000);
  const imageData = typeof body.image === "string" ? body.image : undefined;
  if (!text && !imageData) return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  // Slow work (phone alerts, reading screenshots, reviews) runs after the reply, so nobody waits for it.
  const defer = (fn: () => Promise<void>) => after(() => fn().catch((e) => console.error("background work failed", e)));
  try {
    if (role === "manager") {
      if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
      await (body.to === "teammate" ? handleManagerToTeammate(text, { defer }) : handleManagerMessage(text, { defer }));
    } else {
      const image: ChatImage | null = imageData ? await saveImage(imageData) : null;
      await handleTeammateMessage(text, image, { defer });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  defer(async () => {
    await ensureFollowup().catch(() => undefined);
    // A task that just became ready for review gets its quality review.
    await evaluatePending();
  });
  return NextResponse.json({ ok: true });
}
