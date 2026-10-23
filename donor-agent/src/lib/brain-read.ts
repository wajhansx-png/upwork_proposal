/**
 * Reads a pasted case post (his own style) into the Case Brain's setup: name, age, boy/girl, total and the facts.
 * Plain rules always run. The AI may give a cleaner fact list, but every AI fact must be built from the words of
 * the post (no new words, no new numbers), or it is thrown away.
 */
import { llm, parseJson } from "./llm";

export interface CaseRead {
  name: string;
  age?: number;
  ageLabel?: string;
  gender: "m" | "f";
  total?: number;
  facts: string[];
  by: "ai" | "rules";
  missing: string[];
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
const plain = (s: string) => s.replace(EMOJI, "").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
const STOP = new Set(["the", "a", "an", "and", "is", "are", "was", "were", "his", "her", "he", "she", "has", "had", "have", "to", "of", "in", "on", "so", "it", "for", "with", "that", "this", "be", "been", "very", "both", "inside", "into", "back", "them"]);

/** Rupee amounts: "Rs. 70,000", "70k", "70,000/-", "1.5 lakh". */
export function amounts(text: string): { n: number; at: number; around: string }[] {
  const out: { n: number; at: number; around: string }[] = [];
  for (const m of text.matchAll(/(?:rs\.?|pkr)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand|lakh|lac)?/gi)) {
    const raw = m[1].replace(/,/g, "");
    if (raw.length >= 10) continue; // a phone number
    let n = Number(raw) * (m[2] ? (/^l/i.test(m[2]) ? 100_000 : 1000) : 1);
    if (!/rs|pkr/i.test(m[0]) && !m[2] && !m[1].includes(",") && n < 1000) continue; // ages, counts
    n = Math.round(n);
    out.push({ n, at: m.index ?? 0, around: text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40).toLowerCase() });
  }
  return out;
}

/** The plain rules: always run, never guess. */
export function readByRules(text: string): CaseRead {
  const t = text.replace(/\r/g, "");
  const flat = plain(t);
  // Name: "Little Yousuf", "Helpless Ayesha", "baby Ali", "for Ahmed", "Ahmed is …"
  const cap = "([A-Z][a-z]{2,})";
  const nm =
    new RegExp(`\\b(?:[Ll]ittle|[Hh]elpless|[Bb]aby|[Ii]nnocent|[Yy]oung|[Bb]rother|[Ss]ister|[Uu]ncle|[Aa]unty|[Bb]hai|[Bb]ehen)\\s+${cap}\\b`).exec(flat)?.[1] ??
    new RegExp(`(?:^|[.!?]\\s+)${cap}(?:'s|’s)\\s`).exec(flat)?.[1] ??
    new RegExp(`(?:^|[.!?]\\s+)${cap}\\s+(?:is|was|has)\\b`).exec(flat)?.[1] ??
    new RegExp(`\\b(?:help|save|for)\\s+${cap}\\b`).exec(flat)?.[1] ??
    "";
  const name = nm ? nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase() : "";
  const ag = /\b(\d{1,2})\s*(?:-|\s)?(years?|yrs?|year-old|months?)\b/i.exec(flat);
  const months = !!ag && /^month/i.test(ag[2]);
  const age = ag && !months ? Number(ag[1]) : undefined;
  const ageLabel = ag && months ? `${ag[1]} month${ag[1] === "1" ? "" : "s"}` : undefined;
  const lw = ` ${words(flat).join(" ")} `;
  const she = (lw.match(/ (?:she|her|hers|herself|girl|daughter|mother|sister) /g) ?? []).length;
  const he = (lw.match(/ (?:he|his|him|himself|boy|son|father|brother) /g) ?? []).length;
  const gender = she > he ? "f" : "m";
  // Total: an amount next to needed/required/total/left; else the biggest amount that is not a per-person ask.
  const all = amounts(flat);
  const keyed = all.find((a) => /needed|required|need|total|left|remaining|bill|cost|estimate/.test(a.around) && !/donating|per person|each|kind people/.test(a.around));
  const big = [...all].filter((a) => a.n >= 5000).sort((x, y) => y.n - x.n)[0];
  const total = keyed?.n ?? big?.n;
  // Facts: the sentences about the child, without money, pay lines, asks, quotes and the sign-off.
  const facts: string[] = [];
  for (const line of t.split(/\n+/)) {
    for (let s of plain(line).split(/(?<![Rr]s\.|[Dd]r\.|[Nn]o\.)(?<=[.!?])\s+/)) {
      s = s.replace(/^[-•\s]+/, "").trim();
      if (s.length < 8) continue;
      // Money lines: an amount, or a number with "needed / left / collected…" ("he needed a transfusion" stays).
      if (/\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:k|lakh|lac|thousand)\b/i.test(s) || (/\d{3,}/.test(s) && /\b(?:needed|required|collected|remaining|left|raised)\b/i.test(s))) continue;
      if (/\d{10,}|easypaisa|jazzcash|wajdan|givelife|foundation|rs\.?\s*\d|\bpkr\b|donat|kind people|someone else|please|allah|hadith|muslim|bukhari|@all|screenshot|share|jazak|"|“/i.test(s)) continue;
      // "Little Yousuf is only 2 years old & fluid is filling inside his brain." -> keep the part after "&" / ", and".
      const parts = s.split(/\s+(?:&|and)\s+(?=[a-z])/i);
      for (let p of parts) {
        p = p.replace(/[,.!?;:\s]+$/, "").trim();
        if (/^(?:little|helpless|baby)?\s*\w+\s+is\s+(?:only\s+)?\d+\s*(?:years?|months?)\s*old$/i.test(p)) continue;
        if (words(p).length < 3) continue;
        facts.push(p.charAt(0).toUpperCase() + p.slice(1));
      }
    }
  }
  const missing = [...(name ? [] : ["name"]), ...(total ? [] : ["total"]), ...(facts.length ? [] : ["facts"])];
  return { name, age, ageLabel, gender, total, facts: [...new Set(facts)].slice(0, 12), by: "rules", missing };
}

/** An AI fact is kept only if its words (and numbers) are all in the post. */
export function factFromText(fact: string, source: string): boolean {
  const src = new Set(words(plain(source)));
  const w = words(fact).filter((x) => !STOP.has(x));
  if (w.length < 2) return false;
  const missing = w.filter((x) => !src.has(x) && !src.has(x.replace(/s$/, "")) && !src.has(`${x}s`));
  return missing.length === 0;
}

export async function readCase(text: string): Promise<CaseRead> {
  const rules = readByRules(text);
  const r = await llm(
    "Read this WhatsApp donation post for a sick person. Return ONLY JSON: " +
      '{"name":"first name","age":number|null,"ageMonths":number|null,"gender":"m"|"f","total":number|null,"facts":["..."]}. ' +
      "facts: each medical or life fact about the person, one short sentence each, using the SAME words as the post (copy them, do not explain, do not add anything). " +
      "Leave out money, the ask, payment lines, duas, hadith and the sign-off. total: the rupees needed or left. Never guess.",
    text.slice(0, 4000),
    { json: true },
  ).catch(() => ({ text: null }));
  const j = parseJson<{ name?: unknown; age?: unknown; ageMonths?: unknown; gender?: unknown; total?: unknown; facts?: unknown }>(r.text);
  if (!j) return rules;
  const flat = plain(text);
  const inText = (n: number) => amounts(flat).some((a) => a.n === n);
  const aiName = typeof j.name === "string" && new RegExp(`\\b${j.name.replace(/[^A-Za-z]/g, "")}\\b`, "i").test(flat) ? j.name.replace(/[^A-Za-z]/g, "") : "";
  const aiFacts = Array.isArray(j.facts) ? (j.facts as unknown[]).filter((f): f is string => typeof f === "string").map((f) => plain(f).replace(/[.!?\s]+$/, "")).filter((f) => factFromText(f, text)) : [];
  const total = typeof j.total === "number" && inText(Math.round(j.total)) ? Math.round(j.total) : rules.total;
  const age = typeof j.age === "number" && new RegExp(`\\b${j.age}\\b`).test(flat) ? j.age : rules.age;
  const months = typeof j.ageMonths === "number" && new RegExp(`\\b${j.ageMonths}\\s*months?`, "i").test(flat) ? `${j.ageMonths} months` : rules.ageLabel;
  const facts = aiFacts.length >= Math.min(2, rules.facts.length) ? aiFacts.map((f) => f.charAt(0).toUpperCase() + f.slice(1)) : rules.facts;
  const name = rules.name || aiName;
  const out: CaseRead = {
    name,
    age: months ? undefined : age,
    ageLabel: months,
    gender: j.gender === "f" || j.gender === "m" ? (j.gender as "m" | "f") : rules.gender,
    total,
    facts: [...new Set(facts)].slice(0, 12),
    by: aiFacts.length ? "ai" : "rules",
    missing: [],
  };
  out.missing = [...(out.name ? [] : ["name"]), ...(out.total ? [] : ["total"]), ...(out.facts.length ? [] : ["facts"])];
  return out;
}
