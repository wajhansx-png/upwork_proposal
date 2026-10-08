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
  /** "openai" gets high-detail images, so names and message text are read correctly. */
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

/** Most paid AI calls per day (AI_DAILY_LIMIT, default 400). A safety net only: normal work stays far below it. After that the app uses rules until tomorrow. */
const dailyLimit = () => Math.max(0, Number(process.env.AI_DAILY_LIMIT ?? 400) || 0);

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

export interface LlmResult {
  text: string | null;
  /** "off", "ok", or the error. */
  status: string;
  /** The model that answered. */
  model?: string;
}

/** Settings some models reject. If the API says so, the call is retried without them. */
type Body = Record<string, unknown>;
function adjustFor(error: string, body: Body, c: Cfg): boolean {
  const e = error.toLowerCase();
  if (/reasoning_effort|reasoning effort/.test(e) && "reasoning_effort" in body) {
    delete body.reasoning_effort;
    return true;
  }
  if (/temperature/.test(e) && "temperature" in body) {
    delete body.temperature;
    return true;
  }
  if (/max_tokens/.test(e) && "max_tokens" in body) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    return true;
  }
  if (/max_completion_tokens/.test(e) && "max_completion_tokens" in body) {
    body.max_tokens = Math.min(Number(body.max_completion_tokens) || 600, 1500);
    delete body.max_completion_tokens;
    return true;
  }
  if (/response_format|json_object|json mode/.test(e) && "response_format" in body) {
    delete body.response_format;
    return true;
  }
  // A wrong or retired model name: fall back to a cheap model that always exists.
  if (c.provider === "openai" && /model|does not exist|not found|do not have access/.test(e) && body.model !== "gpt-4o-mini") {
    body.model = "gpt-4o-mini";
    delete body.reasoning_effort;
    delete body.max_completion_tokens;
    body.temperature = 0.1;
    body.max_tokens = 600;
    return true;
  }
  return false;
}

export async function llm(system: string, user: string, opts: { json?: boolean; image?: string } = {}): Promise<LlmResult> {
  const c = cfg(!!opts.image);
  if (!c) return { text: null, status: "off" };
  if (c.kind === "key" && !(await takeCall())) return { text: null, status: "limit" };
  const userContent = opts.image
    ? [
        { type: "text", text: user },
        { type: "image_url", image_url: c.provider === "openai" ? { url: opts.image, detail: "high" } : { url: opts.image } },
      ]
    : user;
  // Newer GPT models (gpt-5, o-series) also spend tokens on hidden thinking. A small limit gives an EMPTY reply, so give room.
  const modern = /^(?:gpt-5|o\d)/.test(c.model);
  const body: Body = {
    model: c.model,
    ...(modern ? { max_completion_tokens: 2000, reasoning_effort: "low" } : { temperature: 0.1, max_tokens: opts.image ? 600 : 500 }),
    ...(opts.json && c.kind === "key" ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };
  let last = "error: no answer";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${c.base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.image ? 30_000 : 15_000),
      });
      if (!res.ok) {
        const err = (await res.text()).slice(0, 400);
        last = `error ${res.status}: ${err.slice(0, 160)}`;
        if (res.status === 400 || res.status === 404) {
          if (adjustFor(err, body, c)) continue;
          break;
        }
        if (res.status === 429 || res.status >= 500) {
          // Out of credit is not worth retrying.
          if (/insufficient_quota|billing|quota/i.test(err)) break;
          await new Promise((r) => setTimeout(r, 900));
          continue;
        }
        break;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return { text, status: "ok", model: String(body.model) };
      // An empty reply from a thinking model: give it more room once.
      last = "error: empty reply";
      if ("max_completion_tokens" in body && Number(body.max_completion_tokens) < 6000) {
        body.max_completion_tokens = 6000;
        continue;
      }
      break;
    } catch (e) {
      last = `error: ${(e as Error).message}`;
      if (attempt === 0) continue;
      break;
    }
  }
  return { text: null, status: last, model: String(body.model) };
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
