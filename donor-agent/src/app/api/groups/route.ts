import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { newId, readDb, withDb } from "@/lib/db";
import { changePlan, emotionalLines, markPosted, openCaseOf, planView, type PlanChange } from "@/lib/groups";
import { tickPlan } from "@/lib/plan-tick";
import { ensurePlanClock } from "@/lib/plan-clock";

/** The group plan. Both roles read it (Areeba sees only messages whose time came). */
export async function GET(req: NextRequest) {
  const role = (await getRole(req)) === "manager" ? "manager" : "teammate";
  const now = Date.now();
  // Every open screen also moves the clock, as a backup to the workflow.
  await tickPlan(now).catch(() => 0);
  return NextResponse.json(planView(await readDb(), role, now));
}

/**
 * Manager: { action: "lines" } five emotional texts (nothing saved) · "add" {kind, text?, at} · "edit" {id, text?, at?} · "remove" {id} · "now" {id}.
 * Areeba: { action: "posted", id } she posted it in all groups.
 */
export async function POST(req: NextRequest) {
  const role = (await getRole(req)) === "manager" ? "manager" : "teammate";
  const body = await readBody<{ action: string; id: string; kind: string; text: string; at: string }>(req);
  const now = Date.now();
  if (body.action === "posted") {
    if (role !== "teammate") return NextResponse.json({ error: "Only Areeba marks a message as posted." }, { status: 403 });
    const err = await withDb((d) => markPosted(d, String(body.id ?? ""), now));
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json(planView(await readDb(), role, now));
  }
  if (role !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (body.action === "lines") {
    const c = openCaseOf(await readDb());
    if (!c) return NextResponse.json({ error: "There is no open case. Write a case first." }, { status: 400 });
    return NextResponse.json(await emotionalLines(c));
  }
  let ch: PlanChange;
  const id = String(body.id ?? "");
  if (body.action === "add") ch = { action: "add", kind: body.kind === "case" ? "case" : "line", text: body.text, at: String(body.at ?? ""), id: newId() };
  else if (body.action === "edit") ch = { action: "edit", id, text: typeof body.text === "string" ? body.text : undefined, at: typeof body.at === "string" ? body.at : undefined };
  else if (body.action === "remove") ch = { action: "remove", id };
  else if (body.action === "now") ch = { action: "now", id };
  else return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const err = await withDb((d) => changePlan(d, ch, now));
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  await tickPlan(now);
  await ensurePlanClock(now).catch((e) => console.error(e));
  return NextResponse.json(planView(await readDb(), role, now));
}
