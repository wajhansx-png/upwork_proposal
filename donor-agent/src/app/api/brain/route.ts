import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { readDb, withDb } from "@/lib/db";
import { newBrain, parseCommand, runCommand, type BrainResult } from "@/lib/brain";
import { brainFromCase, casePost } from "@/lib/brain-case";
import { openCase } from "@/lib/agent";
import type { Brain, CaseFile, Db } from "@/lib/types";

/** This case's brain: from `brains`, or the old single brain if it belonged to it. */
const brainOf = (d: Db, id: string): Brain | undefined => d.brains?.[id] ?? (d.brain?.caseId === id ? d.brain : undefined);

function putBrain(d: Db, b: Brain) {
  if (!b.caseId) return;
  d.brains ??= {};
  d.brains[b.caseId] = b;
  if (d.brain?.caseId === b.caseId) d.brain = undefined;
  // Keep brains only for cases that still exist.
  const ids = new Set(d.cases.map((c) => c.id));
  for (const id of Object.keys(d.brains)) if (!ids.has(id)) delete d.brains[id];
}

/** The case asked for (by id), else the open case. */
const pick = (d: Db, id?: string | null): CaseFile | null => (id ? d.cases.find((c) => c.id === id) ?? null : openCase(d));

/** Every case for the list: newest first, with its amount and how many messages were written. */
const list = (d: Db) =>
  [...d.cases].reverse().map((c) => ({
    id: c.id,
    name: c.facts.name,
    status: c.status,
    amountLeft: brainOf(d, c.id)?.left ?? c.facts.amountLeft,
    createdAt: c.createdAt,
    closedAt: c.closedAt,
    messages: brainOf(d, c.id)?.history.length ?? 0,
  }));

/** GET ?case=<id> one case's brain (made from the saved case the first time); no id = the open case. ?list=1 all cases. */
export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const db = await readDb();
  if (req.nextUrl.searchParams.get("list")) return NextResponse.json({ cases: list(db) });
  const c = pick(db, req.nextUrl.searchParams.get("case"));
  if (!c) return NextResponse.json({ brain: null, post: null, open: false });
  let b = brainOf(db, c.id);
  if (!b) {
    const fresh = await brainFromCase(c);
    if (c.status !== "open") fresh.done = true;
    b = await withDb((d) => {
      const have = brainOf(d, c.id);
      if (have) return have;
      putBrain(d, fresh);
      return fresh;
    });
  }
  return NextResponse.json({ brain: b, post: casePost(c), open: c.status === "open" });
}

/**
 * All take { caseId }.
 * { action: "setup", name, age?, gender, total, facts } edit the facts (keeps the amount and the messages).
 * { action: "ai", on } AI wording on/off.
 * { action: "cmd", text } "LEFT 44000", "20 MIN", "DRY", "DONE".
 */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ caseId: string; on: boolean; action: string; name: string; age: number | string; gender: string; total: number | string; facts: string; text: string }>(req);
  const db = await readDb();
  const c = pick(db, body.caseId);
  const prev = c ? brainOf(db, c.id) : undefined;
  if (!c || !prev) return NextResponse.json({ error: "Open the case first." }, { status: 400 });
  if (body.action === "setup") {
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const total = Math.round(Number(String(body.total ?? "").replace(/[^\d.]/g, "")));
    const age = Number(String(body.age ?? "").replace(/[^\d.]/g, "")) || undefined;
    const facts = String(body.facts ?? "").split("\n").map((f) => f.replace(/^[-•*\s]+/, "").trim()).filter(Boolean).slice(0, 15);
    if (!name) return NextResponse.json({ error: "Write the name." }, { status: 400 });
    if (!total || total < 100) return NextResponse.json({ error: "Write the total amount." }, { status: 400 });
    if (!facts.length) return NextResponse.json({ error: "Write the facts, one per line. Only these will be used." }, { status: 400 });
    const ageLabel = /month/i.test(String(body.age ?? "")) ? `${age} months` : undefined;
    // Editing the facts keeps the amount, the messages already written and the angles used.
    const b: Brain = { ...prev, ...newBrain({ caseId: c.id, name, total, age: !ageLabel && age && age < 120 ? age : undefined, ageLabel, gender: body.gender === "f" ? "f" : "m", facts, source: prev.source }), left: prev.left, updateLeft: prev.updateLeft, leftAt: prev.leftAt, history: prev.history, angles: prev.angles };
    await withDb((d) => putBrain(d, b));
    return NextResponse.json({ brain: b });
  }
  if (body.action === "ai") {
    const b = { ...prev, noAi: !body.on };
    await withDb((d) => putBrain(d, b));
    return NextResponse.json({ brain: b });
  }
  if (body.action === "cmd") {
    if (c.status !== "open") return NextResponse.json({ error: "This case is complete. You can still copy its messages." }, { status: 400 });
    const cmd = parseCommand(String(body.text ?? ""));
    if (!cmd) return NextResponse.json({ error: "Send LEFT 44000, 20 MIN, DRY or DONE." }, { status: 400 });
    // The AI is slow: write outside the lock, then save only if nobody changed this brain meanwhile.
    const work = structuredClone(prev);
    const result: BrainResult = await runCommand(work, cmd, Date.now());
    const saved = await withDb((d) => {
      const now = brainOf(d, c.id);
      if (!now || now.history.length !== prev.history.length || now.left !== prev.left) return false;
      putBrain(d, work);
      // One amount everywhere: the case (saved messages, DMs) follows what he typed here.
      const cc = d.cases.find((x) => x.id === c.id && x.status === "open");
      if (cc && work.left !== undefined) cc.facts.amountLeft = work.left;
      if (cc && work.done) Object.assign(cc, { status: "closed", closedAt: new Date().toISOString() });
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Something changed at the same time. Please send it again." }, { status: 409 });
    return NextResponse.json({ ...result, brain: work });
  }
  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}
