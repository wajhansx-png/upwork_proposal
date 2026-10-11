import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";

const hour = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : undefined);

/** Manager only: quiet hours (no pushes to her at night). Anything not valid is ignored, never half-saved. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ quietEnabled: boolean; quietStartHour: number; quietEndHour: number }>(req);
  const start = hour(body.quietStartHour);
  const end = hour(body.quietEndHour);
  if ((body.quietStartHour !== undefined && start === undefined) || (body.quietEndHour !== undefined && end === undefined))
    return NextResponse.json({ error: "Hours must be whole numbers from 0 to 23." }, { status: 400 });
  const settings = await withDb((d) => {
    const nextStart = start ?? d.settings.quietStartHour;
    const nextEnd = end ?? d.settings.quietEndHour;
    if (nextStart === nextEnd) throw new Error("The start and the end of quiet time cannot be the same hour.");
    if (typeof body.quietEnabled === "boolean") d.settings.quietEnabled = body.quietEnabled;
    d.settings.quietStartHour = nextStart;
    d.settings.quietEndHour = nextEnd;
    return structuredClone(d.settings);
  }).catch((e: Error) => e);
  if (settings instanceof Error) return NextResponse.json({ error: settings.message }, { status: 400 });
  return NextResponse.json({ ok: true, settings });
}
