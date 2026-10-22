import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { newId, readDb, withDb } from "@/lib/db";
import { saveImage } from "@/lib/images";
import { emotionalLines, markUsed, openCaseOf, removeMessage, saveMessage, withPayLine } from "@/lib/saved";
import type { Db } from "@/lib/types";
import { GROUP_TIME_EVERY, groupTimeNext, setGroupTime } from "@/lib/group-time";
import { tickGroupTime } from "@/lib/group-time-tick";
import { ensureGroupTimeClock } from "@/lib/group-time-clock";

const view = (d: Db) => {
  const c = openCaseOf(d);
  const g = d.agent.groupTime;
  return {
    items: d.saved ?? [],
    caseName: c?.facts.name ?? null,
    caseText: c?.ownText ?? null,
    groupTime: { on: !!g?.on, everyMin: g?.everyMin ?? GROUP_TIME_EVERY, lastAt: g?.lastAt ?? null, lastId: g?.lastId ?? null, nextAt: groupTimeNext(d, Date.now()) },
  };
};

/** Saved messages. Both roles read the same list. */
export async function GET() {
  return NextResponse.json(view(await readDb()));
}

/**
 * Manager: { action: "save", text, title?, image? (data URL, shrunk by the browser) } · { action: "remove", id } · { action: "lines" } 5 AI suggestions (nothing saved).
 * Manager: { action: "groupTime", on } the "Group Time" push to her every 20 minutes.
 * Both: { action: "used", id } a tap on Copy or Share.
 */
export async function POST(req: NextRequest) {
  const role = await getRole(req);
  const body = await readBody<{ action: string; text: string; title: string; id: string; image: string; on: boolean }>(req);
  const now = Date.now();
  if (body.action === "used") {
    if (role === "teammate") await withDb((d) => markUsed(d, String(body.id ?? ""), now));
    return NextResponse.json(view(await readDb()));
  }
  if (role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (body.action === "groupTime") {
    await withDb((d) => setGroupTime(d, !!body.on));
    if (body.on) {
      await tickGroupTime(now);
      await ensureGroupTimeClock(now).catch((e) => console.error(e));
    }
    return NextResponse.json(view(await readDb()));
  }
  if (body.action === "lines") {
    const d = await readDb();
    const c = openCaseOf(d);
    if (!c) return NextResponse.json({ error: "Open a case first (Case page). The AI writes from the case facts." }, { status: 400 });
    const r = await emotionalLines(c, (d.saved ?? []).map((m) => m.text));
    return NextResponse.json({ ...r, lines: r.lines.map((l) => withPayLine(c, l)) });
  }
  let imageId = "";
  if (body.action === "save" && body.image) {
    try {
      imageId = (await saveImage(body.image)).id;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  const err = await withDb((d) =>
    body.action === "save" ? saveMessage(d, String(body.text ?? ""), newId(), now, String(body.title ?? ""), imageId) : body.action === "remove" ? removeMessage(d, String(body.id ?? "")) : "Bad request",
  );
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json(view(await readDb()));
}
