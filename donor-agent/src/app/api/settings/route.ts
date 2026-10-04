import { NextRequest, NextResponse } from "next/server";
import { roleFromRequest } from "@/lib/auth";
import { withDb } from "@/lib/db";

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export async function PUT(req: NextRequest) {
  if (roleFromRequest(req) !== "manager")
    return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const tz = String(b.timezone ?? "").trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return NextResponse.json({ error: "Unknown timezone. Example: Africa/Lagos" }, { status: 400 });
  }
  await withDb((db) => {
    const s = db.settings;
    s.teammateName = String(b.teammateName ?? s.teammateName).trim().slice(0, 60) || s.teammateName;
    s.dailyTarget = int(b.dailyTarget, 1, 500, s.dailyTarget);
    s.workStartHour = int(b.workStartHour, 0, 23, s.workStartHour);
    s.workEndHour = int(b.workEndHour, 1, 24, s.workEndHour);
    s.stallHours = int(b.stallHours, 1, 24, s.stallHours);
    s.timezone = tz;
    s.template = String(b.template ?? s.template).slice(0, 2000) || s.template;
  });
  return NextResponse.json({ ok: true });
}
