/**
 * Changing a written message on the case screen: edit one line from the manager's instruction, 5 versions of a line,
 * and regenerate the whole message. The AI writes; code checks every result against his facts and his rules:
 * no new numbers, no medical words that are not in his post, none of the words he never uses.
 */
import { llm, parseJson, type LlmResult } from "./llm";
import { styleBlock } from "./style";
import type { Brain } from "./types";

/** How he writes: his guide and real messages (style.ts). Every AI call here gets it. */
const STYLE = styleBlock();

/** Words he never uses (from his WhatsApp export). */
const NEVER = /\b(?:kindly|generous|needy)\b/i;
const MEDICAL = /\b(?:surgery|surgeries|operation|ventilator|icu|cancer|tumou?r|infection|fever|bleeding|seizures?|coma|oxygen|blind\w*|paraly\w*|dialysis|transplant|brain|kidneys?|hernia|transfusion|blood|fluid|swollen|lungs?|heart|liver|eyesight|amputat\w*)\b/gi;
const nums = (s: string) => new Set([...s.matchAll(/\d[\d,]*/g)].map((m) => m[0].replace(/,/g, "").replace(/^0+(?=\d)/, "")));

/** Problems with new text, judged against what is allowed: the message it lives in, his facts and his post. [] = fine. */
export function editProblems(text: string, b: Brain, message: string): string[] {
  const p: string[] = [];
  if (!text.trim()) return ["empty"];
  const nev = NEVER.exec(text);
  if (nev) p.push(`banned word “${nev[0]}”`);
  const allowed = `${message} ${b.facts.join(" ")} ${b.source ?? ""}`.toLowerCase();
  for (const m of text.matchAll(MEDICAL)) {
    const w = m[0].toLowerCase().replace(/s$/, "");
    if (!allowed.includes(w)) p.push(`“${m[0]}” is not in your post`);
  }
  const ok = nums(`${message} ${b.facts.join(" ")} ${b.source ?? ""} ${b.left ?? ""} ${b.total}`);
  for (const n of nums(text)) if (!ok.has(n)) p.push(`new number ${n}`);
  return [...new Set(p)];
}

/** A plain reason when the AI gave nothing. */
const aiFail = (r: LlmResult) =>
  new Error(r.status === "off" ? "The AI is off (no AI key), so this needs the AI." : r.status === "limit" ? "Today's AI limit is used up. Try tomorrow." : "The AI did not answer. Try again.");
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim() : "");
const context = (b: Brain, message: string) =>
  JSON.stringify({ child: { name: b.name, age: b.age ?? b.ageLabel, gender: b.gender === "f" ? "girl" : "boy" }, facts: b.facts, his_case_post_for_style: b.source?.slice(0, 2500), the_whole_message: message });

/** One line (or a few lines) changed the way he asked. Warnings are shown to him; the change is not blocked (he asked for it). */
export async function editLine(b: Brain, message: string, line: string, instruction: string): Promise<{ text: string; warnings: string[] }> {
  const r = await llm(
    `${STYLE}\nChange ONLY the given part of the message, exactly as the manager asks. Keep its WhatsApp marks (*, _) and emojis unless he asks otherwise. ` +
      "Keep the same number of lines. Do not explain. Return ONLY JSON: {\"text\":\"...\"}",
    `${context(b, message)}\n\nPART TO CHANGE:\n${line}\n\nWHAT THE MANAGER WANTS:\n${instruction}`,
    { json: true },
  );
  const text = clean(parseJson<{ text?: unknown }>(r.text)?.text);
  if (!text) throw aiFail(r);
  return { text, warnings: editProblems(text, b, message) };
}

/** 5 different versions of one line in his style. Versions with a problem are dropped. */
export async function lineVersions(b: Brain, message: string, line: string): Promise<string[]> {
  const r = await llm(
    `${STYLE}\nWrite 5 different versions of the given part of the message. Same meaning and the same facts, fresh words each time, each one should hit the heart. ` +
      "Keep its WhatsApp marks (*, _) and emojis. Keep the same number of lines. Return ONLY JSON: {\"versions\":[\"...\",\"...\",\"...\",\"...\",\"...\"]}",
    `${context(b, message)}\n\nPART TO REWRITE:\n${line}`,
    { json: true },
  );
  const list = parseJson<{ versions?: unknown[] }>(r.text)?.versions;
  if (!Array.isArray(list)) throw aiFail(r);
  const seen = new Set([line.trim()]);
  const out: string[] = [];
  for (const v of list.map(clean)) {
    if (!v || seen.has(v) || editProblems(v, b, message).length) continue;
    seen.add(v);
    out.push(v);
  }
  if (!out.length) throw new Error("The AI versions broke your rules (new numbers or words). Try again.");
  return out.slice(0, 5);
}

/** The whole message written again in his style. Numbers, the hadith and the payment lines stay word for word. */
export async function rewriteMessage(b: Brain, message: string): Promise<string> {
  // Lines that must not change: payment / contact, hadith quotes.
  const fixed = message.split("\n").filter((l) => /\d{7,}|Easypaisa|JazzCash|GiveLife Foundation$|Sahih|Bukhari|Muslim\b/.test(l));
  const r = await llm(
    `${STYLE}\nWrite this WhatsApp message again: a fresh opening that hits the heart, the same facts, the same amounts, about the same length and the same shape (blank lines between parts). ` +
      "These lines must stay exactly the same, word for word, in the same order: " + JSON.stringify(fixed) + ". Return ONLY JSON: {\"text\":\"...\"}",
    context(b, message),
    { json: true },
  );
  const text = clean(parseJson<{ text?: unknown }>(r.text)?.text);
  if (!text) throw aiFail(r);
  const missing = fixed.filter((l) => !text.includes(l.trim()));
  const problems = editProblems(text, b, message);
  if (missing.length || problems.length) throw new Error(`The AI broke your rules (${[...problems, ...missing.map(() => "changed a fixed line")].slice(0, 2).join(", ")}). Press Regenerate again.`);
  if (text.length < message.length * 0.5 || text.length > message.length * 1.6) throw new Error("The AI changed the length too much. Press Regenerate again.");
  return text;
}

/**
 * The whole message changed the way he asks ("more urgent", "more dangerous", "shorter", anything).
 * His instruction wins over the usual style limits (banned words, tone). Facts stay true: the AI is told
 * never to invent a medical fact, a danger or a number, and anything that looks invented comes back as a
 * warning (shown, not blocked). Payment and hadith lines are kept unless he asks to change them.
 */
export async function rewriteWithInstruction(b: Brain, message: string, instruction: string): Promise<{ text: string; warnings: string[] }> {
  const fixed = message.split("\n").filter((l) => /\d{7,}|Easypaisa|JazzCash|GiveLife Foundation$|Sahih|Bukhari|Muslim\b/.test(l));
  const r = await llm(
    `${STYLE}\n\nYou rewrite one of his messages.\n` +
      "Follow the manager's instruction fully and exactly, for the WHOLE message. If he asks for more urgency, more danger, more emotion, shorter, longer, a different opening, " +
      "you may use strong and urgent words to do it. His instruction is more important than any usual style rule.\n" +
      "Only one hard limit: every fact must stay true. Use only the facts, numbers and medical words already in the message, the facts list or his case post. " +
      "Never invent a new illness, danger, time limit, number or amount.\n" +
      `Keep these lines word for word unless his instruction is about them: ${JSON.stringify(fixed)}.\n` +
      'Return ONLY JSON: {"text":"the whole new message"}',
    `${context(b, message)}\n\nTHE MANAGER'S INSTRUCTION FOR THE WHOLE MESSAGE:\n${instruction}`,
    { json: true },
  );
  const text = clean(parseJson<{ text?: unknown }>(r.text)?.text);
  if (!text) throw aiFail(r);
  // Style words he asked for are not warned about; invented facts and dropped payment lines are.
  const warnings = editProblems(text, b, message).filter((p) => !p.startsWith("banned word"));
  if (fixed.some((l) => /\d{7,}|Easypaisa|JazzCash/.test(l)) && !fixed.filter((l) => /\d{7,}|Easypaisa|JazzCash/.test(l)).every((l) => text.includes(l.trim()))) warnings.push("the payment line changed");
  return { text, warnings };
}
