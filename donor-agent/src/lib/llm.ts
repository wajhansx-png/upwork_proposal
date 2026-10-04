/**
 * Free-tier friendly. Any OpenAI-compatible endpoint works.
 * Set GROQ_API_KEY (free at console.groq.com) or GEMINI_API_KEY (free at aistudio.google.com),
 * or LLM_BASE_URL + LLM_API_KEY + LLM_MODEL for anything else.
 * With no key the agent still works using plain rules.
 */
interface Cfg {
  base: string;
  key: string;
  model: string;
}

function cfg(): Cfg | null {
  const e = process.env;
  if (e.LLM_API_KEY && e.LLM_BASE_URL && e.LLM_MODEL) return { base: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL };
  if (e.GROQ_API_KEY)
    return { base: "https://api.groq.com/openai/v1", key: e.GROQ_API_KEY, model: e.GROQ_MODEL || "llama-3.3-70b-versatile" };
  if (e.GEMINI_API_KEY)
    return {
      base: "https://generativelanguage.googleapis.com/v1beta/openai",
      key: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL || "gemini-2.5-flash",
    };
  return null;
}

export const llmEnabled = () => cfg() !== null;

export interface LlmResult {
  text: string | null;
  /** "off", "ok", or the error. */
  status: string;
}

export async function llm(system: string, user: string, json = false): Promise<LlmResult> {
  const c = cfg();
  if (!c) return { text: null, status: "off" };
  try {
    const res = await fetch(`${c.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.3,
        max_tokens: 400,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
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
