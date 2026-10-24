/**
 * The Case Brain starts by itself from the case saved on the Case page: no second paste, no amount to type.
 * His own post: the reader takes the name, age and facts out of it (facts only from its words).
 * The app's post: the facts come from the case form (problem, illness, risk, doctor's words, costs).
 */
import { caseText } from "./case";
import { readCase } from "./brain-read";
import { newBrain } from "./brain";
import type { Brain, CaseFile } from "./types";

const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : "";
};

/** The facts of a case written with the form. */
export function formFacts(c: CaseFile): string[] {
  const f = c.facts;
  const he = f.gender === "f" ? "She" : "He";
  const out = [
    f.problem && (/^(?:child|adult)$/.test(f.type) ? `${f.name} is ${f.problem}` : f.problem),
    f.illness && `${he} has ${f.illness}${f.illnessMeaning ? ` (${f.illnessMeaning})` : ""}`,
    f.worstRisk && `Without treatment, ${f.worstRisk}`,
    f.doctorLine && `Doctors said ${f.doctorLine}`,
    ...(f.items ?? []).map((i) => `${i.item}${i.period ? ` for ${i.period}` : ""} is needed`),
  ];
  return out.filter((x): x is string => !!x).map(sentence).filter(Boolean);
}

/** The post he sends first: his own words, or the app's case text. */
export const casePost = (c: CaseFile) => c.ownText ?? caseText(c);

export async function brainFromCase(c: CaseFile, now = Date.now()): Promise<Brain> {
  const f = c.facts;
  const source = casePost(c);
  const read = c.ownText ? await readCase(c.ownText).catch(() => null) : null;
  const facts = read?.facts.length ? read.facts : formFacts(c);
  const left = f.amountLeft > 0 ? f.amountLeft : read?.total;
  const b = newBrain({
    caseId: c.id,
    name: f.name && f.name !== "this case" ? f.name : read?.name || "this child",
    total: read?.total ?? f.amountLeft ?? 0,
    age: f.age ?? read?.age,
    ageLabel: f.age ? undefined : read?.ageLabel,
    // His own post: he/she is counted from his words (the saved form value may only be a default).
    gender: (c.ownText ? read?.gender : undefined) ?? f.gender ?? "m",
    facts,
    source,
    type: f.type,
    risk: f.riskWord || undefined,
  });
  if (left) {
    b.left = left;
    b.updateLeft = left;
    b.leftAt = new Date(now).toISOString();
  }
  return b;
}
