import { llm, parseJson, visionEnabled } from "./llm";
import type { Donor } from "./types";

export interface Check {
  verdict: "match" | "mismatch" | "unclear" | "unchecked";
  reason: string;
}

interface Seen {
  is_chat?: boolean;
  person_name?: string | null;
  message_sent?: boolean;
  message_text?: string | null;
  summary?: string;
}

const PROMPT =
  "You check a screenshot that someone says shows a direct message (DM) they sent to a person. " +
  "Return ONLY JSON with keys: is_chat (true if it is a chat or email screen), person_name (the contact name or phone number shown at the top, or null), " +
  "message_sent (true if you can see an outgoing message sent by the user), message_text (the outgoing message text, shortened, or null), " +
  "summary (one short plain sentence about what the screenshot shows). Do not guess. Use null if you cannot read it.";

const digits = (s: string) => s.replace(/\D/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9À-￿ ]/g, " ");

export function nameMatches(seen: string, d: Donor): boolean {
  const s = norm(seen);
  const parts = norm(d.name).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.some((p) => s.includes(p))) return true;
  const dc = digits(d.contact);
  const ds = digits(seen);
  return dc.length >= 6 && ds.length >= 6 && ds.endsWith(dc.slice(-6));
}

export async function readScreenshot(image: string): Promise<{ seen: Seen | null; status: string }> {
  const r = await llm(PROMPT, "Read this screenshot.", { json: true, image });
  return { seen: parseJson<Seen>(r.text), status: r.status };
}

/** Does this screenshot really show a sent DM to this donor? */
export async function checkProof(image: string, donor: Donor): Promise<Check> {
  if (!visionEnabled()) return { verdict: "unchecked", reason: "No AI key, so the screenshot was saved but not read." };
  const { seen, status } = await readScreenshot(image);
  if (!seen) return { verdict: "unchecked", reason: `Could not read the screenshot (${status}).` };
  if (seen.is_chat === false) return { verdict: "mismatch", reason: `This does not look like a chat. ${seen.summary ?? ""}`.trim() };
  if (!seen.person_name) return { verdict: "unclear", reason: `The contact name is not visible. ${seen.summary ?? ""}`.trim() };
  if (!nameMatches(seen.person_name, donor))
    return { verdict: "mismatch", reason: `The chat is with "${seen.person_name}", not ${donor.name}.` };
  if (seen.message_sent === false) return { verdict: "unclear", reason: `The chat is with ${donor.name} but no sent message is visible.` };
  return { verdict: "match", reason: `Chat with "${seen.person_name}"${seen.message_text ? `: "${seen.message_text.slice(0, 80)}"` : ""}.` };
}
