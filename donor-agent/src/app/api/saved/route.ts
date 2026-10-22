import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { newId, readDb, withDb } from "@/lib/db";
import { emotionalLines, markUsed, openCaseOf, removeMessage, saveMessage, withPayLine } from "@/lib/saved";
import type { Db } from "@/lib/types";

const view = (d: Db) => {
  const c = openCaseOf(d);
  return { items: d.saved ?? [], caseName: c?.facts.name ?? null, caseText: c?.ownText ?? null };
};

/** Saved messages. Both roles read the same list. */
export async function GET() {
  return NextResponse.json(view(await readDb()));
}

/**
 * Manager: { action: "save", text, title? } · { action: "remove", id } · { action: "lines" } 5 AI suggestions (nothing saved).
 * Both: { action: "used", id } a tap on Copy or Share.
 */
export async function POST(req: NextRequest) {
  const role = await getRole(req);
  const body = await readBody<{ action: string; text: string; title: string; id: string }>(req);
  const now = Date.now();
  if (body.action === "used") {
    if (role === "teammate") await withDb((d) => markUsed(d, String(body.id ?? ""), now));
    return NextResponse.json(view(await readDb()));
  }
  if (role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (body.action === "lines") {
    const d = await readDb();
    const c = openCaseOf(d);
    if (!c) return NextResponse.json({ error: "Open a case first (Case page). The AI writes from the case facts." }, { status: 400 });
    const r = await emotionalLines(c, (d.saved ?? []).map((m) => m.text));
    return NextResponse.json({ ...r, lines: r.lines.map((l) => withPayLine(c, l)) });
  }
  const err = await withDb((d) =>
    body.action === "save" ? saveMessage(d, String(body.text ?? ""), newId(), now, String(body.title ?? "")) : body.action === "remove" ? removeMessage(d, String(body.id ?? "")) : "Bad request",
  );
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json(view(await readDb()));
}
