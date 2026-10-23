import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { readDb, withDb } from "@/lib/db";
import { newBrain, parseCommand, runCommand, type BrainResult } from "@/lib/brain";
import { readCase } from "@/lib/brain-read";
import type { Brain } from "@/lib/types";

/** The Case Brain. Manager only. */
export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  return NextResponse.json({ brain: (await readDb()).brain ?? null });
}

/**
 * { action: "paste", text } his whole case post: read and started.
 * { action: "setup", name, age?, gender, total, facts } a new case (forgets the old one).
 * { action: "ai", on } AI wording on/off (off = only the ready lines).
 * { action: "cmd", text } "LEFT 44000", "20 MIN", "DRY", "DONE".
 */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ on: boolean; action: string; name: string; age: number | string; gender: string; total: number | string; facts: string; text: string }>(req);
  if (body.action === "paste") {
    // His whole case post: read it, start the case if everything is there, else send back what was read.
    const source = String(body.text ?? "").replace(/\r/g, "").trim().slice(0, 6000);
    if (source.length < 30) return NextResponse.json({ error: "Paste the full case post." }, { status: 400 });
    const read = await readCase(source);
    if (read.missing.length) return NextResponse.json({ error: `I could not find: ${read.missing.join(", ")}. Please fill it in.`, read }, { status: 422 });
    const b: Brain = newBrain({ name: read.name, total: read.total!, age: read.age, ageLabel: read.ageLabel, gender: read.gender, facts: read.facts, source });
    await withDb((d) => {
      d.brain = b;
    });
    return NextResponse.json({ brain: b, read });
  }
  if (body.action === "setup") {
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const total = Math.round(Number(String(body.total ?? "").replace(/[^\d.]/g, "")));
    const age = Number(String(body.age ?? "").replace(/[^\d.]/g, "")) || undefined;
    const facts = String(body.facts ?? "").split("\n").map((f) => f.replace(/^[-•*\s]+/, "").trim()).filter(Boolean).slice(0, 15);
    if (!name) return NextResponse.json({ error: "Write the child's name." }, { status: 400 });
    if (!total || total < 100) return NextResponse.json({ error: "Write the total amount." }, { status: 400 });
    if (!facts.length) return NextResponse.json({ error: "Write the facts, one per line. Only these will be used." }, { status: 400 });
    const source = String(body.text ?? "").trim().slice(0, 6000) || undefined;
    const ageLabel = /month/i.test(String(body.age ?? "")) ? `${age} months` : undefined;
    const b: Brain = newBrain({ name, total, age: !ageLabel && age && age < 120 ? age : undefined, ageLabel, gender: body.gender === "f" ? "f" : "m", facts, source });
    await withDb((d) => {
      d.brain = b;
    });
    return NextResponse.json({ brain: b });
  }
  if (body.action === "ai") {
    const b = await withDb((d) => {
      if (d.brain) d.brain.noAi = !body.on;
      return d.brain ?? null;
    });
    return NextResponse.json({ brain: b });
  }
  if (body.action === "cmd") {
    const cmd = parseCommand(String(body.text ?? ""));
    if (!cmd) return NextResponse.json({ error: "Send LEFT 44000, 20 MIN, DRY or DONE." }, { status: 400 });
    const start = (await readDb()).brain;
    if (!start) return NextResponse.json({ error: "Set up the case first." }, { status: 400 });
    // The AI is slow: write outside the lock, then save only if nobody changed the brain meanwhile.
    const work = structuredClone(start);
    const result: BrainResult = await runCommand(work, cmd, Date.now());
    const saved = await withDb((d) => {
      if (!d.brain || d.brain.history.length !== start.history.length || d.brain.left !== start.left) return false;
      d.brain = work;
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Something changed at the same time. Please send it again." }, { status: 409 });
    return NextResponse.json({ ...result, brain: work });
  }
  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}
