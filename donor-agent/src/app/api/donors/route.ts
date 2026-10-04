import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { newId, withDb } from "@/lib/db";
import type { Channel, Donor } from "@/lib/types";

const CHANNELS: Channel[] = ["whatsapp", "email", "instagram", "linkedin", "other"];

/** One donor per line: name, channel, contact, optional note. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager")
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { lines } = (await req.json().catch(() => ({}))) as { lines?: string };
  const now = new Date().toISOString();
  const added: Donor[] = [];
  for (const raw of String(lines ?? "").split("\n")) {
    const [name, channel, contact, ...note] = raw.split(",").map((x) => x.trim());
    if (!name || !contact) continue;
    const ch = CHANNELS.includes(channel as Channel) ? (channel as Channel) : "other";
    added.push({
      id: newId(),
      name,
      channel: ch,
      contact,
      note: note.join(", "),
      flags: [],
      status: "todo",
      updatedAt: now,
    });
  }
  if (!added.length)
    return NextResponse.json(
      { error: "No valid lines. Use: name, channel, contact, note" },
      { status: 400 },
    );
  await withDb((db) => {
    db.donors.push(...added);
  });
  return NextResponse.json({ added: added.length });
}
