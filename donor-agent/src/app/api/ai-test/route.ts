import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { withDb } from "@/lib/db";
import { aiKind, llm, parseJson } from "@/lib/llm";

/** A real GPT call, so the manager can see on his phone that the AI works. */
export async function POST(req: NextRequest) {
  if ((await getRole(req)) !== "manager") return NextResponse.json({ error: "Managers only" }, { status: 403 });
  if (aiKind() === "off") return NextResponse.json({ ok: false, message: "No AI key is set on the server." });
  const started = Date.now();
  const r = await llm(
    'Reply with ONLY this JSON: {"ok":true,"count":4}',
    'Areeba wrote: "main ne 4 bhej diye". How many DMs did she send?',
    { json: true },
  );
  const ms = Date.now() - started;
  await withDb((d) => {
    d.agent.llmStatus = r.status;
  });
  const j = parseJson<{ ok?: boolean; count?: number }>(r.text);
  if (r.status === "ok" && j)
    return NextResponse.json({ ok: true, message: `AI is working. Model: ${r.model}. Answered in ${(ms / 1000).toFixed(1)}s${j.count === 4 ? " and read the Urdu message correctly" : ""}.` });
  const why = /401|api key/i.test(r.status)
    ? "The API key is wrong or was deleted. Make a new key at platform.openai.com and put it in Vercel as OPENAI_API_KEY."
    : /quota|billing|429/i.test(r.status)
      ? "The OpenAI account has no credit. Add credit at platform.openai.com → Billing."
      : r.status === "limit"
        ? "Today's AI limit in this app is reached. It resets tomorrow."
        : "OpenAI did not answer.";
  return NextResponse.json({ ok: false, message: `${why} (${r.status})` });
}
