/**
 * Reads plain English the way people really type it in chat.
 * Pure functions, no network. Used first when there is no AI key, and to check what the AI says when there is one.
 */

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export interface Num {
  value: number;
  start: number;
  end: number;
}

/** Digits and number words ("five", "twenty five", "a hundred"). Times like 5pm, 5:30 and percentages are skipped. */
export function extractNumbers(text: string): Num[] {
  const out: Num[] = [];
  const t = text.toLowerCase();
  const digit = /\d[\d,]*(?:\.\d+)?/g;
  for (const m of t.matchAll(digit)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = t[start - 1];
    const after = t.slice(end, end + 4);
    if (before === ":" || /^\s*(?::\d|am\b|pm\b|a\.m|p\.m|%)/.test(after)) continue;
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push({ value: v, start, end });
  }
  const word = new RegExp(`\\b(?:a\\s+hundred|one\\s+hundred|hundred|(?:${Object.keys(WORDS).join("|")})(?:[\\s-]+(?:${Object.keys(WORDS).join("|")}))?)\\b`, "g");
  for (const m of t.matchAll(word)) {
    const start = m.index!;
    if (/hundred/.test(m[0])) {
      out.push({ value: 100, start, end: start + m[0].length });
      continue;
    }
    const parts = m[0].split(/[\s-]+/);
    let v = 0;
    for (const p of parts) v += WORDS[p] ?? 0;
    // "twenty five" is 25, but "ten five" is not a number. Only tens + units combine.
    if (parts.length === 2 && !(WORDS[parts[0]] >= 20 && WORDS[parts[0]] % 10 === 0 && WORDS[parts[1]] < 10 && WORDS[parts[1]] > 0)) {
      out.push({ value: WORDS[parts[0]], start, end: start + parts[0].length });
      const s2 = start + m[0].lastIndexOf(parts[1]);
      out.push({ value: WORDS[parts[1]], start: s2, end: s2 + parts[1].length });
      continue;
    }
    out.push({ value: v, start, end: start + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const numbersIn = (text: string) => extractNumbers(text).map((n) => n.value);

// ---------- clauses ----------

const clauses = (text: string) =>
  text
    .split(/[.;!\n]+|,\s*|\s+(?:and|but|however|although|though|while)\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);

const QUESTION_START = /^(?:what|when|where|why|who|which|how|should|shall|can|could|may|do|does|did|is|are|was|were|will|would|have|has)\b/i;
const FUTURE = /\b(?:will|shall|going to|gonna|plan to|planning to|about to|want to|need to|have to|has to|must|let me|i'?ll|ill|soon|later|tomorrow|tonight|next|after|in \d+ ?(?:min|minutes|hours?)|should|could|would|can|might|may|karungi|karunga|karoongi|karoonga|bhejungi|bhejunga|bhejoongi|baad mein|baad me|kal)\b/i;
const NEGATED = /\b(?:not|never|no|haven'?t|hasn'?t|hadn'?t|didn'?t|don'?t|doesn'?t|wasn'?t|won'?t|cannot|can'?t|couldn'?t|unable|yet to|nothing|none|zero)\b/i;
const SENT_VERB = /\b(?:sent|messaged|contacted|reached|dm'?e?d|dmed|texted|finished|completed|done|did|delivered|bhej\w*|kar diye|kar liye|ho ?gaye|hogaye|hogye|ho gye)\b/i;

export const isQuestion = (text: string) => /\?\s*$/.test(text.trim()) || QUESTION_START.test(text.trim());

// ---------- what Areeba reports ----------

export interface Report {
  /** The total she says she has sent so far. */
  total?: number;
  /** She said "3 more", so add to what is already recorded. */
  more?: number;
  /** "All done" with no number. */
  all?: boolean;
  /** Every number in the message, so a model's number can be checked against it. */
  seen: number[];
  /** Numbers that count replies or times, not sent DMs. A model may not use them as her total. */
  notDms: number[];
}

/**
 * Finds a progress report: "I sent 4", "4 done", "total 15 now", "15/20 done", "sent five", "sent 3 more".
 * Ignores plans ("I will send 10"), questions, denials ("haven't sent 4"), and counts of replies ("3 replied").
 */
export function parseReport(text: string): Report {
  const seen = numbersIn(text);
  const report: Report = { seen, notDms: [] };

  // "15/20", "15 out of 20", "15 of 20 done": the first number is how many she did.
  const frac = /(\d+)\s*(?:\/|out of|of)\s*(\d+)\b/i.exec(text);
  if (frac && !isQuestion(text) && !NEGATED.test(text.slice(0, frac.index)) && !(FUTURE.test(text) && !SENT_VERB.test(text))) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (a <= b) {
      report.total = a;
      return report;
    }
  }

  // A bare number ("40", "40 dms", "40 now") is her total.
  const bare = /^\s*(\d{1,4})\s*(?:dms?|messages?|now|total|so far|done|sent|ho ?gaye|hogaye)?\s*[.!]*\s*$/i.exec(text);
  if (bare) {
    report.total = Number(bare[1]);
    return report;
  }

  for (const raw of clauses(text)) {
    const clause = raw.trim();
    if (!clause) continue;
    if (isQuestion(clause)) continue;
    const nums = extractNumbers(clause);
    const wholeSentenceDone = /\b(?:all|everything|every one|them all)\b/i.test(clause) && /\b(?:done|finished|completed|sent)\b/i.test(clause);
    const hasPast = SENT_VERB.test(clause);
    const hasTotalWord = /\b(?:total|so far|till now|until now|up to now|altogether|in all|by now|as of now)\b/i.test(clause);

    if (NEGATED.test(clause) && !/\bno problems?\b|\bno issues?\b|\bnot a problem\b/i.test(clause)) continue;
    if (FUTURE.test(clause) && !hasTotalWord && !/\b(?:i have|i've|ive|have)\b/i.test(clause)) continue;

    if (wholeSentenceDone || /^(?:i'?m|i am|we are|we're|all)?\s*(?:done|finished|completed)\s*[.!]*$/i.test(clause)) {
      report.all = true;
      continue;
    }
    if (!nums.length) continue;

    // Skip numbers that count replies, not sent DMs: "3 replied", "3 donors replied", "got 3 replies".
    const usable = nums.filter((n) => {
      const after = clause.slice(n.end, n.end + 28);
      const before = clause.slice(Math.max(0, n.start - 24), n.start);
      const reject = () => { report.notDms.push(n.value); return false; };
      if (/^\s*(?:more|extra|additional)?\s*(?:donors?|people|persons?|contacts?|dms?|messages?)?\s*(?:have |has )?(?:repl|respon|answer|seen|read|accept|declin)/i.test(after)) return reject();
      if (/(?:repl(?:y|ies|ied)|respon\w*|answers?)\s*(?:from|by|of)?\s*$/i.test(before)) return reject();
      if (/^\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|pm|am|%)/i.test(after)) return reject();
      return true;
    });
    if (!usable.length) continue;

    // "3 more" adds to the total.
    const more = usable.find((n) => /^\s*(?:more|extra|additional)\b/i.test(clause.slice(n.end, n.end + 12)));
    if (more && (hasPast || hasTotalWord)) {
      report.more = more.value;
      continue;
    }
    // A number right after a past verb or total word, or right before "sent/done".
    const picked = usable.find((n) => {
      const before = clause.slice(Math.max(0, n.start - 30), n.start);
      const after = clause.slice(n.end, n.end + 30);
      if (/\b(?:sent|messaged|contacted|reached|dm'?e?d|dmed|texted|finished|completed|done|did|total|so far|now)\b[^0-9]{0,18}$/i.test(before)) return true;
      if (/^\s*(?:dms?|messages?|donors?|people|contacts?|whatsapps?|emails?)?\s*(?:are |were |is |have been |has been )?(?:sent|done|finished|completed|delivered|total|so far|till now|until now|in total|altogether|bhej\w*|kar diye|kar liye|ho ?gaye|hogaye|hogye|ho gye)\b/i.test(after)) return true;
      if (hasTotalWord && /^\s*(?:dms?|messages?)?\s*(?:now|so far|total|altogether)?\s*$/i.test(after)) return true;
      return false;
    });
    if (picked) report.total = picked.value;
  }
  return report;
}

// ---------- started / blocked ----------

export type StartSignal = "started" | "will-start" | "not-started" | null;

export function startSignal(text: string): StartSignal {
  let result: StartSignal = null;
  for (const c of clauses(text)) {
    if (isQuestion(c)) continue;
    if (/\b(?:not|haven'?t|have not|hasn'?t|didn'?t|yet to|not yet|no)\b[^.]{0,20}\b(?:start|started|begin|begun)\b|^not yet\b|\bnot started\b|\bnot yet\b/i.test(c)) {
      result = "not-started";
      continue;
    }
    if (/\b(?:will|shall|going to|gonna|plan to|about to|i'?ll|ill|soon|later|tomorrow|after|before|at \d|in \d+ ?(?:min|minutes|hours?)|by \d)\b[^.]{0,30}\b(?:start|begin)\b|\bstart(?:ing)?\b[^.]{0,12}\b(?:soon|later|in \d|at \d|after|tomorrow|tonight)/i.test(c)) {
      result = result === "started" ? "started" : "will-start";
      continue;
    }
    if (/\b(?:started|have started|ve started|began|begun|am starting|i'?m starting|starting now|starting right now|just started|already started|on it|working on it|i am working|i'?m working|sending now|sending them|in progress)\b/i.test(c) || /^start(?:ed|ing)?\W*$/i.test(c.trim())) {
      result = "started";
    }
  }
  return result;
}

export interface BlockSignal {
  blocked: boolean;
  resolved: boolean;
  reason?: string;
}

const OBSTACLE =
  /\b(?:can'?t|cannot|can not|couldn'?t|could not|unable|not able|won'?t work|not working|doesn'?t work|isn'?t working|stopped working|stuck|blocked|blocking|problem|issue|trouble|error|failed|failing|banned|suspended|locked out|no (?:internet|network|signal|data|wifi|wi-fi|power|electricity|access|credit|balance|battery|number|list)|(?:internet|wifi|wi-fi|network|phone|laptop|whatsapp|battery|power|electricity|account|number|app)\s+(?:is\s+|was\s+|has\s+|went\s+|got\s+)?(?:down|dead|died|off|gone|out|broken|blocked|banned|crashed|lost|stolen)|phone (?:died|is dead|broke|stolen|lost)|power cut|load ?shedding|sick|unwell|fever|headache|emergency|hospital|funeral|family (?:issue|problem|matter|emergency)|need help|help me|please help|don'?t have|do not have|don'?t know how|do not know how)\b/i;
const NO_OBSTACLE = /\b(?:no|not a|without any|zero|none|nothing)\s+(?:problems?|issues?|trouble|blockers?)\b|\bno blocker|\bnot blocked\b|\ball good\b|\ball fine\b|\beverything (?:is )?(?:fine|ok|okay|good)\b/i;
const RESOLVED = /\b(?:solved|resolved|fixed|working again|works now|sorted|ok now|fine now|back online|unblocked|can continue|back to work|got it working)\b/i;

export function blockSignal(text: string): BlockSignal {
  const resolved = RESOLVED.test(text);
  if (NO_OBSTACLE.test(text)) return { blocked: false, resolved };
  for (const c of clauses(text)) {
    if (isQuestion(c) && !/\b(?:can'?t|cannot|stuck|help)\b/i.test(c)) continue;
    // "wifi is slow but ok" is a complaint, not a blocker. Real blockers stop her from working.
    if (OBSTACLE.test(c) && !(resolved && !/\bstill\b/i.test(c))) return { blocked: true, resolved: false, reason: text.trim().slice(0, 300) };
  }
  return { blocked: false, resolved };
}

// ---------- what Areeba asks ----------

export type Question = "deadline" | "next" | "progress" | "task" | "identity" | "howto" | "break" | "extension" | "other" | null;

const ASKING = (t: string) => isQuestion(t) || /\b(?:kitne|kitna|kitni|kya|kab|kaise|kaun)\b/i.test(t);

export function questionKind(text: string): Question {
  const t = text.trim();
  if (isGreeting(t)) return null;
  if (/\b(?:who are you|what are you|are you (?:a |an )?(?:bot|robot|ai|human|real|person|machine)|your name|ap kaun|aap kaun|tum kaun)\b/i.test(t)) return "identity";
  if (ASKING(t) && /\b(?:how many (?:do|should|must|have to|need to) i|how many (?:dms?|messages?) (?:do|should|must)|what(?:'s| is) (?:my|the) (?:task|target|goal)|what (?:is|was) i (?:supposed|meant) to|my target|kitne bhejne|kitne karne)\b/i.test(t)) return "task";
  if (ASKING(t) && /\b(?:what (?:should|do|shall|can) i (?:write|say|send them|message)|which (?:donors?|people|contacts?|list|numbers?|template)|what (?:message|text|template)|who (?:should|do|shall) i (?:message|send|dm|contact)|where (?:is|are) the (?:list|numbers?|contacts?)|kis ko|kisko|kya likh)\b/i.test(t)) return "howto";
  if (ASKING(t) && /\b(?:my count|my total|my progress|my score|how many (?:have|did|done)|how many so far|how much (?:have|did)|how am i doing|am i on track|am i behind|kitne (?:ho|hue|hu|hogaye|ho gaye|bheje)|kitna hua|count\??$|progress\??$|status\??$)\b/i.test(t) || /^\s*(?:kitne|count|progress|status)\s*\??\s*$/i.test(t)) return "progress";
  if (/\b(?:extension|more time|extra time|need (?:more|extra) time|can i finish (?:later|tomorrow)|move the deadline|longer)\b/i.test(t)) return "extension";
  if (/\b(?:break|lunch|prayer|namaz|rest|pause|go home|leave early|step out|bathroom|call me back|tired)\b/i.test(t) && (isQuestion(t) || /\b(?:need|want|have to|going to|will take|taking)\b/i.test(t))) return "break";
  if (!isQuestion(t)) return null;
  if (/\b(?:deadline|due|when|what time|how long|time left|until when|how much time)\b/i.test(t)) return "deadline";
  if (/\b(?:what (?:should|do|shall) i do|what now|what next|what to do|what else|next step|what'?s next|how (?:do|should|can) i)\b/i.test(t)) return "next";
  return "other";
}

/** Putting the work off: "later", "not now", "kal karungi". */
export const isDelay = (text: string) =>
  !isQuestion(text) &&
  /\b(?:later|not now|not today|tomorrow|kal|baad (?:mein|me)|abhi nahi|in a while|after some time|some other time|next time|i will do it|i'?ll do it|i'?ll start|will start|busy right now|i am busy|i'?m busy|thori der|thodi der)\b/i.test(text) &&
  !/\b(?:sent|done|finished|started)\b/i.test(text);

/** Low mood that is not a blocker: "I am tired", "bored". */
export const isMood = (text: string) =>
  /\b(?:tired|exhausted|bored|sleepy|stressed|demotivated|not in the mood|thak gayi|thak gai|neend|fed up|sick of|frustrat\w*|annoyed|irritat\w*|overwhelm\w*|my mind is|mind is not|can'?t focus|cannot focus|pagal|pareshan|tension|f+u+c+k\w*|shit)\b/i.test(text);

export const isGreeting = (text: string) =>
  /^\s*(?:hi+|hello|hey|salam|salaam|assalam\w*|aoa|asalam\w*|good (?:morning|evening|afternoon))\b[\s\w,!.]{0,20}$/i.test(text) ||
  /^\s*(?:how are you|how r u|how are you doing|kaise ho|kaisi ho|kya haal)\b[\s\w,!.?]{0,15}$/i.test(text);

/** "I can't do all 100 today": a capacity problem, not a broken phone. */
export const isCantFinish = (text: string) =>
  /\b(?:can'?t|cannot|can not|won'?t be able to|not able to|unable to|not possible|impossible|too many|too much)\b[^.]{0,30}\b(?:do|finish|complete|send|make it|all|today|\d+)\b/i.test(text) &&
  !/\b(?:internet|wifi|wi-fi|network|phone|laptop|whatsapp|battery|power|electricity|account|login|app|banned|blocked|sick|hospital)\b/i.test(text);

export const isAck = (text: string) => /^\s*(?:ok+(?:ay)?|k|thanks?|thank you|thx|noted|got it|sure|alright|fine|yes|yep|yeah|no|nope|cool|great|good|will do|understood|ok thanks?|ji|jee|g|theek hai|thik hai|acha|achha|sorry|sry)(?:\s+(?:sir|maam|ma'am|madam|ji|bhai))?\W*$/i.test(text);

// ---------- what the manager says ----------

export type ManagerCommand =
  | { kind: "deadline"; rest: string }
  | { kind: "extend"; minutes: number }
  | { kind: "target"; target: number }
  | { kind: "nudge" }
  | { kind: "identity" }
  | { kind: "herwords" }
  | { kind: "status" }
  | { kind: "yes"; rest: string; minutes: number | null }
  | { kind: "no"; rest: string }
  | { kind: "sendHeld" };

/** "1 hour", "an hour", "half an hour", "30 min", "2 hrs" in minutes. */
export function durationIn(text: string): number | null {
  if (/\bhalf an? hour\b|\badha ghanta\b/i.test(text)) return 30;
  const m = /\b(\d{1,3}|an?|one|two|three|four|five|ten|fifteen|twenty|thirty)\s*(?:more\s+|extra\s+)?(hours?|hrs?|h|minutes?|mins?|m|ghante?)\b/i.exec(text);
  if (!m) return null;
  const w: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : w[m[1].toLowerCase()];
  return /^(?:h|hr|hrs|hour|hours|ghant)/i.test(m[2]) ? n * 60 : n;
}

/** Commands about the task that is already running. They win over new-task drafts. */
export function managerCommand(text: string, teammate: string, hasPendingAsk: boolean): ManagerCommand | null {
  const t = text.trim();
  const who = `(?:her|${teammate.toLowerCase().replace(/[^a-z]/g, "") || "her"})`;
  if (/^\s*send (?:it |this )?to (?:her|areeba)\W*$/i.test(t)) return { kind: "sendHeld" };
  if (/\b(?:who are you|what are you|your name|are you (?:a )?(?:bot|ai|human))\b/i.test(t)) return { kind: "identity" };
  if (new RegExp(`^(?:please\\s+)?(?:remind|ping|nudge|push|chase|poke|follow up with|hurry)\\s+${who}(?:\\s+(?:up|now|again|please|for (?:an? )?update))*\\W*$|^ask ${who} for (?:an? |her )?(?:update|count|status)\\W*$|^(?:get|ask for) (?:an? )?update(?: from ${who})?\\W*$`, "i").test(t)) return { kind: "nudge" };
  if (/\b(?:what did (?:she|areeba) (?:say|write|send)|(?:her|areeba'?s) (?:last )?(?:message|reply|replies|messages)|what is she saying|show (?:me )?her messages)\b/i.test(t)) return { kind: "herwords" };
  if (hasPendingAsk) {
    if (/^(?:yes|yeah|yep|ok(?:ay)?|sure|haan|han|ji|allowed|allow it|fine|go ahead|approved?|she can|let her|of course|theek hai)\b/i.test(t)) return { kind: "yes", rest: t, minutes: durationIn(t) };
    if (/^(?:no|nope|nahi|nahin|not now|no break|don'?t|do not|she can'?t|not allowed|deny|denied|refuse)\b/i.test(t)) return { kind: "no", rest: t };
  }
  const extend = new RegExp(`\\b(?:give ${who}|extend(?: (?:it|the deadline|her deadline))?(?: by)?|add)\\s+(.{0,25}?)\\b(?:more|extra)?\\s*(?:time)?`, "i").exec(t);
  if (extend && /\b(?:give|extend|add)\b/i.test(t) && (/\b(?:more|extra|extend|add)\b/i.test(t) || new RegExp(`^(?:ok,?\\s*|yes,?\\s*)?give ${who}\\s+(?:\\d|an?\\b|half|one|two)`, "i").test(t))) {
    const minutes = durationIn(t);
    if (minutes) return { kind: "extend", minutes };
  }
  const dl = /\b(?:change|move|set|shift|push|update|make)\s+(?:the\s+|her\s+)?(?:deadline|due time|due|finish time|time)\s*(?:to|till|until|at|for)?\s*(.+)$/i.exec(t) || /\b(?:new deadline|deadline is now|deadline now)\s*(?:is|:)?\s*(.+)$/i.exec(t);
  if (dl) return { kind: "deadline", rest: dl[1] };
  const tg = /\b(?:make it|change (?:it|the target|target|the count|count|the number) to|set (?:the )?target(?: to)?|target (?:is )?now|reduce (?:it )?to|increase (?:it )?to|lower (?:it )?to)\s*(\d{1,4})\b/i.exec(t);
  if (tg) return { kind: "target", target: Number(tg[1]) };
  if (
    /\b(?:how many|kitne|kitna|progress|any update|update\?|status|is she (?:working|on it|done|online)|did she start|has she started|when did she|why is she|so slow|too slow|how is she|how'?s she|where is she|on track|behind|deadline|due|time left|kab tak)\b/i.test(t) &&
    (isQuestion(t) || t.split(/\s+/).length <= 5)
  )
    return { kind: "status" };
  return null;
}

const NAME_FILLER = /\b(?:please|pls|kindly|could you|can you|would you|i need|i want|i would like|you should|she should|she must|must|should|have to|has to|make sure|ensure|let|get)\b/gi;

export interface ManagerParse {
  /** A request to do work (not a question, not a report about the past). */
  isRequest: boolean;
  isStatus: boolean;
  isCancel: boolean;
  isConfirm: boolean;
  relay?: string;
}

const pastAboutHer = (teammate: string) =>
  new RegExp(`\\b(?:she|he|they|${teammate.toLowerCase().replace(/[^a-z0-9]/g, "") || "she"})\\s+(?:has\\s+|have\\s+|had\\s+|just\\s+)?(?:sent|did|done|finished|completed|messaged|contacted|replied|reached|started|worked)\\b`, "i");
const NEGATIVE_ABOUT_HER = /\b(?:didn'?t|did not|hasn'?t|has not|haven'?t|have not|not yet|never|no one|nobody|nothing)\b/i;

export function parseManager(text: string, teammate: string): ManagerParse {
  const t = text.trim();
  const low = t.toLowerCase();
  const who = ["her", "him", "them", "the team", "teammate", teammate.toLowerCase().replace(/[^a-z0-9 ]/g, "")].filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const isCancel = /^(?:cancel|undo|discard|never ?mind|forget it|stop)\b(?!\s+(?:her|him|areeba))|\b(?:cancel|stop|drop|discard|abort) (?:the |this |that |her |current |latest )?(?:task|assignment|job|draft|request)\b/i.test(t);
  const isConfirm = /^(?:confirm(?:ed)?|approve(?:d)?|accept(?:ed)?|looks good|that'?s right|all good|ok done|done, thanks|well done)\b/i.test(t) && t.length < 40;
  const relayMatch = new RegExp(`^(?:please\\s+)?(?:(?:can|could) you\\s+)?(tell|message|text|remind|ask|ping|let|inform|notify|say to|send a message to)\\s+(?:${who})\\b[\\s,:]*(.*)$`, "i").exec(t);
  let relay: string | undefined;
  const restText = relayMatch ? relayMatch[2] : "";
  const restIsWork =
    !!relayMatch &&
    relayMatch[1].toLowerCase() !== "remind" &&
    /\b(?:send|dm|dms|message|messages|contact|reach|email|text|call|write|prepare|finish|complete)\b/i.test(restText) &&
    (extractNumbers(restText).length > 0 || /\b(?:by|before|until|till|in \d|within|tonight|today|tomorrow|eod)\b/i.test(restText));
  if (relayMatch && relayMatch[2].trim() && !restIsWork) {
    const verb = relayMatch[1].toLowerCase();
    let rest = relayMatch[2].trim().replace(/^(?:to\s+|that\s+|about\s+)/i, (m) => (verb === "remind" ? m : ""));
    if (verb === "remind") rest = `Reminder: ${rest.replace(/^(?:about|to|that)\s+/i, (m) => (m.trim() === "about" ? "" : "to "))}`.replace(/^Reminder:\s*$/, "Reminder");
    else if (verb === "ask") rest = rest.replace(/^(?:if|whether)\s+/i, "") + (rest.endsWith("?") ? "" : /^(?:if|whether)\s+/i.test(relayMatch[2]) ? "?" : "");
    relay = rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  const statusWords =
    /\b(?:how(?:'?s| is| are| was)\b|how many|how much|how far|what(?:'?s| is) the (?:update|status|progress|news)|any (?:update|progress|news)|status|progress|update me|updates?\b|report|is (?:she|he|they|areeba)\b[^.?]{0,30}\b(?:working|done|started|online|active|there|ready|busy|stuck|late|behind)|did (?:she|he|they|areeba)|has (?:she|he|they|areeba)|have (?:they)|where is (?:she|areeba)|done yet|finished yet)\b/i;
  const looksLikeAsk = /\?\s*$/.test(t) || /^(?:how|what|where|when|why|who|is|are|did|has|have|any|status|update|progress)\b/i.test(low);
  // "Areeba did not send anything yet, why?" is a question about her progress.
  const complaint = NEGATIVE_ABOUT_HER.test(t) && /\?\s*$/.test(t) && new RegExp(`\\b(?:she|he|they|${teammate.toLowerCase().replace(/[^a-z0-9]/g, "")})\\b`, "i").test(t);
  const isStatus = !isCancel && !relay && (complaint || statusWords.test(t)) && (complaint || looksLikeAsk || /\b(?:update|status|progress|report)\b/i.test(t)) && !/\b(?:send|message|contact|dm)\b[^?]*\bby\b/i.test(t);
  const statementAboutPast = pastAboutHer(teammate).test(t) && !/\b(?:please|must|should|need|make|ask|tell|get)\b/i.test(t);
  const request =
    !isCancel &&
    !isConfirm &&
    !relay &&
    !isStatus &&
    !statementAboutPast &&
    !(NEGATIVE_ABOUT_HER.test(t) && /\?\s*$/.test(t)) &&
    !/\?\s*$/.test(t) &&
    (/\b(?:send|dm|dms|message|messages|contact|reach(?: out)?|call|ring|phone|email|write|prepare|finish|complete|follow ?up|collect|update|list|draft|share|post|submit|arrange|schedule|book|organi[sz]e|compile|check|review|do|make|find|prepare|deliver|upload|invite|thank)\b/i.test(t) ||
      /\b(?:need|want)(?:s)? .{1,40}\b(?:sent|done|messaged|contacted|called|ready|finished|completed)\b/i.test(t)) &&
    (extractNumbers(t).length > 0 || /\b(?:by|before|until|till|in \d|within|tonight|today|tomorrow|eod|end of (?:the )?day|every|asap|now)\b/i.test(t) || /^(?:please\s+)?(?:send|dm|message|contact|call|prepare|finish|complete|write)\b/i.test(t) || new RegExp(`\\b(?:${who})\\b`, "i").test(t));
  return { isRequest: request, isStatus, isCancel, isConfirm, relay };
}

/** The core request phrase: "send 20 DMs", "message 30 donors", "contact 25 people". */
const CORE = /\b(?:please\s+)?(?:send|dm|message|messaging|contact|reach(?: out to)?|text|email|whatsapp)\s+(?:to\s+)?(?:(?:the\s+)?(?:next\s+)?)?(?:\d[\d,]*|[a-z-]+)?\s*(?:more\s+)?(?:dms?|messages?|donors?|people|persons?|contacts?|emails?|texts?|whatsapps?)\b(?:\s+to)?/i;
const TIME_PHRASE = /\b(?:by|before|until|till|at|within|in)\s+(?:an? (?:hour|minute)|half an hour|\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?)\b|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midnight|the evening|the morning|tonight|end of (?:the )?(?:work ?)?day|eod|cob)(?:\s+(?:today|tomorrow|tonight))?\b|\b(?:today|tomorrow|tonight|eod|end of (?:the )?(?:work ?)?day|asap|right now|now)\b/gi;
const EVERY = /[,;]?\s*(?:and\s+)?(?:(?:check(?:\s*-?in)?|ask(?:\s+her)?|follow\s*-?up|remind(?:\s+her)?|ping(?:\s+her)?|update(?:s)?)\s+(?:with\s+her\s+|on\s+her\s+|me\s+)?)?(?:every|each|after)\s+(?:\d{1,3}|an?|half an)?\s*(?:minutes?|mins?|m|hours?|hrs?|h)\b/gi;
const GAP = /[,;]?\s*(?:with\s+|and\s+)?(?:a\s+)?(?:\d{1,3}\s*(?:minutes?|mins?|min|m)\s*(?:gap|between|apart|per\s+dm)|(?:gap|wait|break)\s*(?:of\s*)?\d{1,3}\s*(?:minutes?|mins?|min|m))(?:\s+between(?:\s+(?:each|every)(?:\s+(?:dm|dms|message|messages|one))?)?)?/gi;

const STOP = new Set(["areeba", "please", "pls", "kindly", "to", "the", "a", "an", "of", "for", "and", "her", "him", "them", "she", "he", "must", "should", "need", "needs", "want", "make", "get", "ask", "tell", "have", "has", "do", "send", "dm", "dms", "message", "messages", "donor", "donors", "people", "contact", "contacts", "i", "you", "can", "could", "would", "will", "that", "this", "so", "it", "is", "are", "be", "me", "my", "all", "just", "then", "also", "ok", "okay", "sent", "messaged", "contacted", "called", "emailed", "texted", "done", "finished", "completed", "ready", "every", "each", "hour", "hours", "minute", "minutes", "min", "mins", "dm'd", "emails", "email", "texts", "text", "whatsapp", "whatsapps", "gap", "between"]);

/** Special instructions left over after the count, time and check-in time are removed: "previous donors only". */
export function extractInstructions(text: string, teammate: string): string | undefined {
  let rest = text;
  rest = rest.replace(EVERY, " ").replace(GAP, " ").replace(CORE, " ").replace(TIME_PHRASE, " ");
  rest = rest.replace(new RegExp(`\\b${teammate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ").replace(NAME_FILLER, " ");
  rest = rest.replace(/\b\d[\d,]*\b/g, " ").replace(/[,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const words = rest.split(" ").filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w.toLowerCase().replace(/[^a-z]/g, "")));
  if (meaningful.length < 1) return undefined;
  const cleaned = rest.replace(/^(?:to|that|and|only to)\s+/i, "").replace(/\s+(?:and|to)$/i, "").trim();
  if (cleaned.length < 4) return undefined;
  // Time words are part of the deadline, not an instruction.
  if (/^(?:yesterday|today|tomorrow|tonight|now|asap|later|soon|this (?:morning|evening|afternoon))$/i.test(cleaned)) return undefined;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** A clean task name for a non-DM task: "Call the Reed family". */
export function cleanTitle(text: string, teammate: string): string {
  let t = text.replace(EVERY, " ").replace(GAP, " ").replace(TIME_PHRASE, " ");
  t = t.replace(new RegExp(`\\b${teammate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ").replace(NAME_FILLER, " ");
  t = t.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").replace(/\s+/g, " ").replace(/^(?:to|and)\s+/i, "");
  if (!t) return text.trim().slice(0, 80);
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 90);
}

/** "5 minutes between each DM", "10 min gap", "wait 3 minutes". Minutes, or null. */
export function extractGap(text: string): number | null {
  const m = /\b(\d{1,3})\s*(?:minutes?|mins?|min|m)\s*(?:gap|between|apart|per\s+dm)\b|\b(?:gap|wait|break)\s*(?:of\s*)?(\d{1,3})\s*(?:minutes?|mins?|min|m)\b/i.exec(text);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n >= 1 && n <= 240 ? n : null;
}

const WORD_SET = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** Share (0 to 1) of the words in `claimed` that really appear in `source`. Catches text a model made up. */
export function overlap(claimed: string, source: string) {
  const src = new Set(WORD_SET(source));
  const w = WORD_SET(claimed).filter((x) => x.length > 2);
  if (!w.length) return 1;
  return w.filter((x) => src.has(x)).length / w.length;
}
