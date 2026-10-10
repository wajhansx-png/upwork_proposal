import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { getRole } from "@/lib/auth";
import { newId, readDb, withDb } from "@/lib/db";
import { openCase } from "@/lib/agent";
import { caseView, checkText, cleanFacts, closingText, missingFacts, readDetails, writeLines } from "@/lib/case";
import { parseAmount } from "@/lib/money";
import type { CaseFacts, CasePost, Db } from "@/lib/types";

/** Past donors to @tag in the group: named, biggest gifts first, max 4 (guide Part 6). */
const tagsFor = (db: Db) =>
  db.donors.filter((d) => d.name && (d.status === "donated" || d.amount)).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 4).map((d) => d.name);

const view = (db: Db) => {
  const c = openCase(db) ?? db.cases[db.cases.length - 1] ?? null;
  return { current: c ? caseView(c, tagsFor(db)) : null, past: db.cases.slice(-10).reverse().map((x) => ({ id: x.id, name: x.facts.name, status: x.status, createdAt: x.createdAt })) };
};

export async function GET(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  return NextResponse.json(view(await readDb()));
}

const KINDS: CasePost["kind"][] = ["main", "dm", "number", "people", "feeling", "unity", "proof", "lastpush", "tag", "closing"];

/**
 * { action: "read", details }   AI reads free text into the guide's inputs (nothing is saved).
 * { action: "write", facts, replace? }  writes the case text; a new case, or the open one rewritten with new facts.
 * { action: "amount", amountLeft }      the real amount left now.
 * { action: "posted", kind, text }      the manager copied this text (so reminders never repeat).
 * { action: "close" }                   case complete: closing post, no more reminders.
 */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const body = await readBody<{ action: string; details: string; facts: Record<string, unknown>; replace: boolean; amountLeft: number | string; kind: string; text: string; index: number }>(req);
  try {
    if (body.action === "read") {
      const details = String(body.details ?? "").trim();
      if (details.length < 10) return NextResponse.json({ error: "Write the case details first." }, { status: 400 });
      return NextResponse.json(await readDetails(details));
    }
    if (body.action === "write") {
      const facts = cleanFacts(body.facts && typeof body.facts === "object" ? body.facts : {});
      const missing = missingFacts(facts);
      if (missing.length) return NextResponse.json({ error: `Please fill in: ${missing.join(", ")}.` }, { status: 400 });
      const db = await readDb();
      const open = openCase(db);
      const same = open && open.facts.name.toLowerCase() === facts.name!.toLowerCase();
      if (open && !same && !body.replace) return NextResponse.json({ error: `${open.facts.name}'s case is still open.`, needsReplace: true }, { status: 409 });
      const recent = db.cases.filter((c) => !same || c.id !== open!.id).slice(-3).map((c) => c.hook);
      const lines = await writeLines(facts as CaseFacts, recent);
      const now = new Date().toISOString();
      await withDb((d) => {
        const cur = openCase(d);
        if (cur && same && cur.id === open!.id) {
          Object.assign(cur, { facts, hook: lines.hook, story: lines.story, by: lines.by, options: lines.options });
          return;
        }
        if (cur) Object.assign(cur, { status: "closed", closedAt: now });
        // A different verse from the last case, so posts do not look copy-pasted.
        const lastVerse = d.cases[d.cases.length - 1]?.verse ?? -1;
        const verses = facts.type === "child" || facts.type === "adult" ? [0, 1] : [0, 2];
        d.cases.push({ id: newId(), facts: facts as CaseFacts, status: "open", createdAt: now, hook: lines.hook, story: lines.story, options: lines.options, verse: verses.find((v) => v !== lastVerse) ?? 0, by: lines.by, posts: [] });
        d.cases = d.cases.slice(-30);
      });
      return NextResponse.json({ ...view(await readDb()), dropped: lines.dropped });
    }
    if (body.action === "amount") {
      // "19k", "19,000", "0" (fully funded) all work.
      const n = /^\s*0+\s*$/.test(String(body.amountLeft)) ? 0 : parseAmount(body.amountLeft);
      if (n === undefined || n > 100_000_000) return NextResponse.json({ error: "Write the amount left in rupees, like 19000 or 19k." }, { status: 400 });
      await withDb((d) => {
        const c = openCase(d);
        if (!c) throw new Error("There is no open case.");
        c.facts.amountLeft = Math.round(n);
      });
      return NextResponse.json(view(await readDb()));
    }
    if (body.action === "posted") {
      const kind = body.kind as CasePost["kind"];
      const text = String(body.text ?? "").slice(0, 5000);
      if (!KINDS.includes(kind) || !text) return NextResponse.json({ error: "Bad request" }, { status: 400 });
      await withDb((d) => {
        const c = openCase(d) ?? d.cases[d.cases.length - 1];
        if (!c) throw new Error("There is no case.");
        const failed = checkText(c, text, kind).filter((x) => !x.ok && kind !== "closing");
        if (failed.length) throw new Error(`This text failed a check: ${failed[0].label}.`);
        c.posts.push({ kind, text, at: new Date().toISOString(), amountLeft: c.facts.amountLeft });
        c.posts = c.posts.slice(-40);
      });
      return NextResponse.json(view(await readDb()));
    }
    if (body.action === "pick") {
      await withDb((d) => {
        const c = openCase(d);
        const o = c?.options?.[Number(body.index)];
        if (!c || !o) throw new Error("That opening is not there.");
        c.hook = o.hook;
        c.story = o.story;
      });
      return NextResponse.json(view(await readDb()));
    }
    if (body.action === "close") {
      let text = "";
      await withDb((d) => {
        const c = openCase(d);
        if (!c) throw new Error("There is no open case.");
        c.status = "closed";
        c.closedAt = new Date().toISOString();
        text = closingText(c);
      });
      return NextResponse.json({ ...view(await readDb()), closing: text });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
