import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { aiKind, llm, parseJson } from "@/lib/llm";
import { donorStats, ruleIdeas } from "@/lib/donors";

/** The AI reads the donor numbers and gives a few short ideas. Falls back to the plain rules. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const db = await readDb();
  const now = Date.now();
  const rules = ruleIdeas(db.donors, now);
  if (aiKind() === "off") return NextResponse.json({ ideas: rules, by: "rules" });
  const s = donorStats(db.donors);
  const facts = {
    donors: s.total,
    with_whatsapp_number: s.withPhone,
    status_counts: s.byStatus,
    raised_rupees: s.raised,
    groups: s.groups,
    known_facts: rules,
  };
  const r = await llm(
    "You advise the manager of a small charity in Pakistan. A volunteer messages donors on WhatsApp. " +
      "Using ONLY the numbers given, give 3 to 5 ideas to raise more money this week. Each idea: one short sentence, very easy English, a clear action. " +
      'Never invent donors, amounts or facts that are not in the numbers. Return ONLY JSON: {"ideas":["..."]}',
    JSON.stringify(facts),
    { json: true },
  );
  const ideas = parseJson<{ ideas?: unknown }>(r.text)?.ideas;
  const clean = Array.isArray(ideas) ? ideas.filter((x): x is string => typeof x === "string" && x.trim().length > 5).map((x) => x.trim().slice(0, 220)).slice(0, 5) : [];
  return NextResponse.json(clean.length ? { ideas: clean, by: "ai" } : { ideas: rules, by: "rules" });
}
