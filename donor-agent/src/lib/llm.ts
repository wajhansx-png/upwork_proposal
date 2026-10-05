/**
 * AI is optional and free.
 * OPENAI_API_KEY (GPT, paid by use) reads chat and screenshots. Model: OPENAI_MODEL, default gpt-4o-mini.
 * Free option: GEMINI_API_KEY (aistudio.google.com). It also reads chat and screenshots.
 * Also works: GROQ_API_KEY (console.groq.com), or any OpenAI-compatible LLM_BASE_URL + LLM_API_KEY + LLM_MODEL.
 * With no key, text chat tries a free shared service (no screenshots), then falls back to plain rules.
 * Set FREE_SHARED_AI=off to never use the shared service.
 */
import { withDb } from "./db";

interface Cfg {
  /** "openai" gets low-detail images (about 9x cheaper per screenshot). */
  provider?: "openai";
  base: string;
  key: string;
  model: string;
  vision: boolean;
  kind: "key" | "shared";
}

function cfg(needVision = false): Cfg | null {
  const e = process.env;
  const list: Cfg[] = [];
  if (e.LLM_API_KEY && e.LLM_BASE_URL && e.LLM_MODEL)
    list.push({ base: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL, vision: e.LLM_VISION === "1", kind: "key" });
  if (e.OPENAI_API_KEY)
    list.push({
      base: e.OPENAI_BASE_URL || "https://api.openai.com/v1",
      key: e.OPENAI_API_KEY,
      model: e.OPENAI_MODEL || "gpt-4o-mini",
      vision: true,
      kind: "key",
      provider: "openai",
    });
  if (e.GEMINI_API_KEY)
    list.push({
      base: "https://generativelanguage.googleapis.com/v1beta/openai",
      key: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL || "gemini-2.5-flash",
      vision: true,
      kind: "key",
    });
  if (e.GROQ_API_KEY)
    list.push({
      base: "https://api.groq.com/openai/v1",
      key: e.GROQ_API_KEY,
      model: needVision ? e.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct" : e.GROQ_MODEL || "llama-3.3-70b-versatile",
      vision: true,
      kind: "key",
    });
  if (!needVision && e.FREE_SHARED_AI !== "off")
    list.push({ base: "https://text.pollinations.ai/openai", key: "", model: "openai", vision: false, kind: "shared" });
  return list.find((c) => !needVision || c.vision) ?? null;
}

export type AiKind = "key" | "shared" | "off";
export const aiKind = (): AiKind => cfg()?.kind ?? "off";
export const visionEnabled = () => cfg(true) !== null;

export interface LlmResult {
  text: string | null;
  /** "off", "ok", or the error. */
  status: string;
}

/** Most paid AI calls per day (AI_DAILY_LIMIT, default 100). After that the app uses rules until tomorrow. */
const dailyLimit = () => Math.max(0, Number(process.env.AI_DAILY_LIMIT ?? 100) || 0);

/** Counts a paid call. Returns false when today's limit is reached. */
async function takeCall(): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  return withDb((d) => {
    if (d.agent.aiDay !== today) {
      d.agent.aiDay = today;
      d.agent.aiCalls = 0;
    }
    if ((d.agent.aiCalls ?? 0) >= dailyLimit()) return false;
    d.agent.aiCalls = (d.agent.aiCalls ?? 0) + 1;
    return true;
  });
}

export async function llm(system: string, user: string, opts: { json?: boolean; image?: string } = {}): Promise<LlmResult> {
  const c = cfg(!!opts.image);
  if (!c) return { text: null, status: "off" };
  if (c.kind === "key" && !(await takeCall())) return { text: null, status: "limit" };
  try {
    const userContent = opts.image
      ? [
          { type: "text", text: user },
          { type: "image_url", image_url: c.provider === "openai" ? { url: opts.image, detail: "low" } : { url: opts.image } },
        ]
      : user;
    const res = await fetch(`${c.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}), "content-type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.2,
        max_tokens: opts.image ? 250 : 200,
        ...(opts.json && c.kind === "key" ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(opts.image ? 30_000 : 15_000),
    });
    if (!res.ok) return { text: null, status: `error ${res.status}: ${(await res.text()).slice(0, 120)}` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ? { text, status: "ok" } : { text: null, status: "error: empty reply" };
  } catch (e) {
    return { text: null, status: `error: ${(e as Error).message}` };
  }
}

export function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
