import { NextResponse } from "next/server";
import { analyzeJob } from "@/lib/job-analysis";
import { matchPortfolio } from "@/lib/proposal-writer";
import type {
  GenerateResponse,
  PortfolioItem,
  Profile,
  Tone,
} from "@/lib/types";

// Vercel Hobby caps functions at 10s; Pro defaults to 15s but can go higher.
// Setting this raises the ceiling on Pro/Enterprise and is a harmless no-op
// on Hobby (Vercel clamps it back down), so it costs nothing to declare.
export const maxDuration = 30;

const TONES: Tone[] = ["warm", "direct", "expert"];
// A real Upwork post is a few hundred to a couple thousand words. This caps
// abuse (huge pastes inflating AI token cost and regex work) well above that.
const MAX_JOB_LENGTH = 20000;
const MAX_HISTORY_ITEMS = 3;
const MAX_HISTORY_ITEM_LENGTH = 1000;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// Draft, self-check, repair - up to 3 rounds - so a weaker model's mistakes
// get caught and fixed instead of shipped. Bounded to stay well under
// Vercel Hobby's hard 10s function limit even in the worst case.
const MAX_ATTEMPTS = 1;
const PER_CALL_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 9000;

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, MAX_HISTORY_ITEMS)
    .map((v) => v.trim().slice(0, MAX_HISTORY_ITEM_LENGTH));
}

const EMPTY_PROFILE: Profile = {
  firstName: "",
  headline: "",
  years: "",
  skills: "",
  proof: "",
};

function asString(value: unknown, max = 400): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function normalizePortfolio(value: unknown): PortfolioItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const kind =
      item.kind === "pdf" || item.kind === "image" ? item.kind : "link";
    return {
      id: asString(item.id, 64) || `item-${i}`,
      kind,
      title: asString(item.title, 160) || "Untitled piece",
      url: asString(item.url, 400),
      fileName: asString(item.fileName, 200),
      tags: Array.isArray(item.tags)
        ? item.tags.slice(0, 8).map((t) => asString(t, 40))
        : [],
    } satisfies PortfolioItem;
  });
}

function normalizeProfile(value: unknown): Profile {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    firstName: asString(raw.firstName, 40).trim(),
    headline: asString(raw.headline, 120).trim(),
    years: asString(raw.years, 40).trim(),
    skills: asString(raw.skills, 200).trim(),
    proof: asString(raw.proof, 400).trim(),
  };
}

// Five real proposals this freelancer has actually sent and won replies
// with. These are the authoritative source for structure and voice below -
// not a generic style guide, this exact pattern, because it's proven to
// work for this person. Kept verbatim (not paraphrased into rules only) so
// the model can see the real rhythm: paragraph breaks, where "->" chains
// land, how the numbered link list sits right before the closing.
const REAL_EXAMPLES = `--- EXAMPLE 1 ---
Greetings,

99% of proposals you read today were written by AI. This wasn't. You just have to share your design samples + website content documents + access to the HTML editor & the rest I'll build it.

Approach will be to study the draft page first -> match your approved design exactly -> add text, images, and page elements as instructed -> test on mobile and desktop -> hand over clean, ready-to-publish output.

Moreover, I have got 5+ years of experience with HTML, CSS, JavaScript, React, Next.js & other full-stack technologies including technical SEO best practices.

You may take a look at my recent web projects:
1- [link 1]
2- [link 2]

One message. That's the distance between this problem and its solution.

See you inside :)
Thanks

--- EXAMPLE 2 (bug-fix job, no portfolio block, no "My") ---
Greetings,

90% of what you've read today was written by a bot. This wasn't. You just have to share the repo + a clear list of the bugs + areas you want improved.

The approach will be to read the existing codebase first -> identify root causes, not just symptoms -> fix each issue cleanly without touching unrelated parts -> test before delivery.

For 5+ years I have worked with complex web apps and solved multiple errors like these. I have 5+ years of experience in Next.js, Node.js, REST APIs, databases, and other full-stack technologies.

One message. That's the distance between this problem and its solution.
See you inside :)

Thanks

--- EXAMPLE 3 (detailed post, no share-line needed) ---
Greetings,

99% of proposals you read today were written by AI. Here's a real one.

The approach will be to first audit your top competitors' sites -> identify what their design is missing -> build something visually sharper than all of them plus a live booking form that captures leads directly.

Secondly, a "How It Works" section that removes hesitation, a photo gallery that sells the experience visually, real client testimonials for trust, and a clear pricing section so visitors know exactly what to expect.

Moreover, I have got 5+ years of experience with website development using HTML, CSS, React, Next.js & Tailwind.

You may take a look at my recent business website projects:
1- [link 1]
2- [link 2]

One message. That's the distance between this problem and its solution.
See you inside :)

Thanks

--- EXAMPLE 4 (simple job, share-line, approach as one sentence not a chain) ---
Greetings,

99% of proposals you read today were written by AI. This wasn't. You just have to share your website content (images + text) + features you need + any design reference you like & the rest I'll build a site that feels premium.

Approach will be to study your competitors' sites for design direction -> integrate the features you need -> test on mobile and desktop -> deploy and hand over full access.

Moreover, I have got 5+ years of experience with HTML, CSS, React, Next.js, Tailwind CSS, TypeScript & other full-stack technologies.

You may take a look at my recent web projects:
1- [link 1]
2- [link 2]

One message. That's the distance between this problem and its solution.

See you inside :)

Thanks`;

const BANNED_WORDS = [
  "passionate",
  "dedicated",
  "leverage",
  "synergy",
  "seasoned",
  "cutting-edge",
  "robust",
  "innovative",
  "results-driven",
];
const AI_FILLER_PHRASES = [
  "i hope this message finds you well",
  "i would love the opportunity",
  "i am excited to",
];
// A step this vague could be pasted into a proposal for any job in any
// field - the opposite of the deep, field-specific plan the prompt asks
// for, so any hit here forces a rewrite of the approach block.
const GENERIC_APPROACH_PHRASES = [
  "understand your requirements",
  "understand the requirements",
  "gather requirements",
  "plan and execute",
  "ensure quality",
  "deliver high quality",
  "meet your needs",
  "meet your expectations",
  "communicate regularly",
  "keep you updated",
  "complete the task",
  "get the job done",
];

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

// Mechanically checks the fixed rules from the system prompt below, so a
// model's mistakes get caught and sent back for repair instead of shipped
// silently. Returns a plain-English issue per rule broken (empty = clean).
function validateProposal(
  text: string,
  jobText: string,
  portfolioLinks: PortfolioItem[],
): string[] {
  const trimmed = text.trim();
  const issues: string[] = [];

  const words = wordCount(trimmed);
  if (words < 20) {
    issues.push("the response is too short to be a real proposal");
    return issues; // nothing else is worth checking on a near-empty draft
  }

  if (!/^Greetings,/.test(trimmed)) {
    issues.push('must start exactly with "Greetings,"');
  }
  if (
    !trimmed.includes(
      "99% of proposals you read today were written by AI. This wasn't.",
    )
  ) {
    issues.push("missing the fixed opening line word for word");
  }
  if (
    !/One message\. That's the distance between this problem and its solution\./.test(
      trimmed,
    )
  ) {
    issues.push("missing the fixed closing line word for word");
  }
  if (!/Thanks\s*$/.test(trimmed)) {
    issues.push('must end with "Thanks" and nothing after it');
  }
  if (trimmed.includes("—")) {
    issues.push("contains a long dash (—) - use a hyphen (-) instead");
  }
  if (
    /\*\*/.test(trimmed) ||
    /^#{1,6}\s/m.test(trimmed) ||
    /^[-*]\s/m.test(trimmed)
  ) {
    issues.push("contains markdown formatting - plain text only");
  }
  if (/\bmy approach\b/i.test(trimmed)) {
    issues.push(
      'says "My approach" - must say "Approach will be to" or "The approach will be to"',
    );
  }
  const approachMatch = /(?:the\s+)?approach will be to\s+([\s\S]*?)(?:\n\n|$)/i.exec(
    trimmed,
  );
  if (!approachMatch) {
    issues.push('missing the required "Approach will be to" line');
  } else {
    const steps = approachMatch[1]
      .split("->")
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length < 3) {
      issues.push(
        'the approach needs a real 3-5 step chain joined with "->", not one vague sentence',
      );
    } else {
      const shallow = steps.find((s) => wordCount(s) < 4);
      if (shallow) {
        issues.push(
          `the approach step "${shallow}" is too short to be a real action - expand it with the actual specific thing being done`,
        );
      }
    }
  }
  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${w}\\b`, "i").test(trimmed)) {
      issues.push(`uses the banned word "${w}"`);
    }
  }
  const lower = trimmed.toLowerCase();
  for (const p of AI_FILLER_PHRASES) {
    if (lower.includes(p)) {
      issues.push(`uses AI-sounding filler: "${p}"`);
    }
  }
  for (const p of GENERIC_APPROACH_PHRASES) {
    if (lower.includes(p)) {
      issues.push(
        `the approach uses a generic phrase ("${p}") instead of a real, job-specific step`,
      );
    }
  }
  // 180 not 165: real, deep, field-specific approach chains (the kind that
  // actually shock a client) tested at 148-178 words across bookkeeping,
  // video editing, VA, copywriting and dev. Under 180 is a hard cap; the
  // prompt still aims for 150 so genuine bloat doesn't quietly slip past.
  if (words > 180) {
    issues.push(
      `too long at ${words} words - the whole message must stay under 150`,
    );
  }
  const youCount =
    (trimmed.match(/\byou\b/gi) || []).length +
    (trimmed.match(/\byour\b/gi) || []).length;
  const iCount = (trimmed.match(/\bI\b/g) || []).length;
  if (iCount > youCount) {
    issues.push(
      'uses "I" more than "you/your" - this must read as a message about the client, not the freelancer',
    );
  }
  if (/\[[a-z\s]*link[a-z\s]*\d*\]/i.test(trimmed)) {
    issues.push(
      "left an unfilled [link] placeholder instead of a real link or removing the block",
    );
  }
  // Strip URLs first - "www", repeated letters in a slug, etc. are not typos.
  const noUrls = trimmed.replace(/https?:\/\/\S+/gi, "");
  const doubledWord = /\b(\w+)\s+\1\b/i.exec(noUrls);
  if (doubledWord) {
    issues.push(`the word "${doubledWord[1]}" is repeated twice in a row - looks like a typo`);
  }
  const mashedLetters = /\b\w*([a-z])\1{2,}\w*\b/i.exec(noUrls);
  if (mashedLetters) {
    issues.push(`"${mashedLetters[0]}" looks misspelled - no real English word repeats a letter three times in a row`);
  }
  if (portfolioLinks.length) {
    const included = portfolioLinks.some(
      (p) => p.url && trimmed.includes(p.url),
    );
    if (!included) {
      issues.push("the given portfolio link(s) were not included");
    }
  }
  // Verbatim copying: any real 8-word run from the job post showing up
  // unchanged in the draft means it was pasted, not understood.
  const jobWords = jobText.toLowerCase().replace(/\s+/g, " ").split(" ");
  const draftLower = lower.replace(/\s+/g, " ");
  for (let i = 0; i + 8 <= jobWords.length; i++) {
    const gram = jobWords.slice(i, i + 8).join(" ");
    if (gram.length > 30 && draftLower.includes(gram)) {
      issues.push(
        "copies a long phrase verbatim from the job post instead of writing it in your own words",
      );
      break;
    }
  }
  return issues;
}

function repairInstruction(issues: string[]): string {
  return `Your draft above has these problems:\n- ${issues.join("\n- ")}\n\nRewrite the ENTIRE proposal from the start, fixing every problem listed, while keeping everything else that already worked. Follow every rule from the system instructions exactly. Output only the corrected proposal text, nothing else - no notes, no explanation.`;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type AIResult = { text: string } | { error: string };

// Groq and Cerebras both speak the same OpenAI-compatible chat-completions
// shape, just at different URLs with different model names - one function
// covers either provider.
// Never put a provider name, model name, status code, or raw upstream
// response body into a client-facing error - that's internal detail an end
// user has no use for and shouldn't see. The full detail still goes to
// console.error so it's visible in the server's own logs for debugging.
async function callChatCompletion(
  provider: string,
  url: string,
  key: string,
  model: string,
  messages: ChatMessage[],
): Promise<AIResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        // Lower than a creative-writing default - this needs to reliably
        // follow the fixed structure, not vary it.
        temperature: 0.5,
        max_tokens: 500,
        messages,
      }),
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[${provider}] ${res.status}: ${body.slice(0, 500)}`);
      return { error: "The AI service is temporarily unavailable. Try again." };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { text: data.choices?.[0]?.message?.content?.trim() ?? "" };
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { error: "The AI service took too long to respond. Try again." };
    }
    console.error(`[${provider}]`, e);
    return {
      error: "Could not reach the AI service. Check your connection and try again.",
    };
  }
}

// Providers use the same OpenAI-compatible chat-completions shape. Try the
// paid providers first, then retain Groq/Cerebras as a backwards-compatible
// fallback for preview deployments that still have those variables.
async function callAI(messages: ChatMessage[]): Promise<AIResult> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const deepSeekKey = process.env.DEEPSEEK_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;

  const providers: Array<[string, string, string, string]> = [];
  if (openRouterKey) {
    providers.push([
      "openrouter",
      OPENROUTER_URL,
      openRouterKey,
      process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
    ]);
  }
  if (deepSeekKey) {
    providers.push([
      "deepseek",
      DEEPSEEK_URL,
      deepSeekKey,
      process.env.DEEPSEEK_MODEL || "deepseek-chat",
    ]);
  }
  if (groqKey) {
    providers.push([
      "groq",
      GROQ_URL,
      groqKey,
      process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    ]);
  }
  if (cerebrasKey) {
    providers.push([
      "cerebras",
      CEREBRAS_URL,
      cerebrasKey,
      process.env.CEREBRAS_MODEL || "llama-3.3-70b",
    ]);
  }

  if (!providers.length) {
    console.error("callAI: no supported AI provider key configured");
    return { error: "AI is not configured on this server. Nothing was generated." };
  }

  let lastError: AIResult = {
    error: "The AI service is temporarily unavailable. Try again.",
  };
  for (const [provider, url, key, model] of providers) {
    const result = await callChatCompletion(provider, url, key, model, messages);
    if ("text" in result && result.text) return result;
    lastError = result;
  }
  return lastError;
}

async function writeWithAI(args: {
  jobText: string;
  tone: Tone;
  profile: Profile;
  portfolioLinks: PortfolioItem[];
  requiredHints: string[];
  history: string[];
}): Promise<AIResult> {
  if (
    !process.env.OPENROUTER_API_KEY &&
    !process.env.DEEPSEEK_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.CEREBRAS_API_KEY
  ) {
    return {
      error: "AI is not configured on this server. Nothing was generated.",
    };
  }

  const { jobText, profile, portfolioLinks, requiredHints, history } = args;

  // The rules below are pattern-matched from three real proposals this
  // freelancer sent and got replies on (REAL_EXAMPLES above) - not a
  // generic style guide. A regex writer can only pattern-match a job post -
  // it has no way to tell a typo from a real word, or notice that "already
  // built, not a rebuild" means the next line is the real scope, not the
  // paragraph before it. A model reads the whole post the way a person
  // would, then writes from that understanding in its own words.
  const system = [
    "=== ROLE ===",
    "You are a senior freelancer writing a real Upwork proposal for a real client - not an AI assistant describing what it could do, the freelancer, writing it. Use the exact structure and voice shown in REAL_EXAMPLES below. This works for ANY field - development, design, writing, video, marketing, data entry, virtual assistant work, translation, anything. REAL_EXAMPLES happen to be web-development jobs because that's this freelancer's usual field; if the job post below is a different field, adapt every technical detail and step to THAT field instead - never force web-dev language onto an unrelated job.",

    "=== REASONING - do this silently before writing a single word, never show it in the output ===",
    "(1) SITUATION: is this a greenfield build, an existing product with a specific bug or gap, or a one-off task? (2) REAL SCOPE: what has the client explicitly said is already done vs. still needed? If they say 'already built, not a rebuild', the fix or addition they describe next is the real scope, not the background paragraph before it. (3) THE APPROACH - THINK LONGER HERE THAN ANYWHERE ELSE IN THIS PROCESS: whatever field this job is in - code, design, writing, video editing, bookkeeping, translation, virtual assistant work, marketing, anything at all - reason the way the single best specialist in THAT exact field would: what does someone who has done this precise kind of task many times actually do, in what order, and why that order and not another? Ground every step in the specific tools, the specific kind of problem, and the specific deliverable named in the post. Never a generic 'understand requirements -> execute -> deliver' shape that could be pasted onto any job in any field. The bar to clear: a client reading it should think 'this person has clearly done this exact thing before', never 'this sounds like every other proposal'. This becomes Block B and it is what actually wins the job - everything else in the proposal is framing around it. (4) THE ONE DETAIL: what single detail, if mentioned, proves the post was actually read, not just that the industry was recognized?",

    "=== OUTPUT CONTRACT ===",
    "Output ONLY the final proposal message. No headers, no notes, no \"Here is the proposal:\", no explanation of what was done, no markdown formatting (no **bold**, no # headings, no bullet points other than the exact numbered link list in the PROOF block). Plain text paragraphs separated by blank lines, exactly like REAL_EXAMPLES. Never wrap the message in quotes or a code block, never add a signature or name after \"Thanks\".",

    "=== STRUCTURE - in this exact order ===",
    "1. FIXED OPENING - reproduce word for word: \"Greetings,\" on its own line, a blank line, then \"99% of proposals you read today were written by AI. This wasn't.\" as its own sentence. Never change it, never skip it, nothing before it.",
    "2. SHARE-LINE (same paragraph as the opening, only if genuinely needed) - if the post is thin and real information is needed before starting, add: 'You just have to share [thing 1] + [thing 2] + [thing 3] & the rest I'll [build/fix/handle] it.' Three SPECIFIC things tied to this exact job, never generic filler like 'more details'. If the post already gives enough to start, skip this line entirely - adding it to a detailed post reads as not having read it.",
    "3. BLOCK B - THE APPROACH (new paragraph, always present, your deepest thinking goes here). Say 'Approach will be to' or 'The approach will be to' - never 'My approach will be', never just 'Approach:'. Chain 3-5 real steps with '->' arrows. Each step is a bare action with no subject pronoun ('identify root causes', never 'I will identify root causes' or 'I identify root causes'), and each step is a full, real action, not a one or two word label - 'test' or 'fix bugs' is not a step, 'test the checkout flow on both mobile and desktop before shipping' is. Every step must be something only someone who genuinely understood THIS job would write - a step generic enough to paste unchanged into a proposal for a different job must be replaced with something specific to this post. Before writing the chain, silently think of 2-3 things an actual expert in this exact field would know to watch for on a job like this - a mistake beginners make, a step people skip and regret, a detail that changes the whole approach - and fold the single most relevant one into a step (concrete examples of what this looks like: 'shadow your inbox for two days without touching anything, so triage rules match how you actually work' on a VA job; 'match Ragusea's rhythm with quick J-cuts on transitions between prep and cooking' on a YouTube editing job; 'the three usual suspects on intermittent 400s: stale amount, mismatched customer, missing payment method' on a Stripe bug fix; 'refunds, fees and sales tax categorized separately - this is where most e-commerce books go wrong' on a bookkeeping job). That single specific insider detail is what makes a client stop and think 'this one actually gets it', not just 'this sounds professional'. Never skip this - a proposal without one is a proposal that will be skipped. This holds in every field, not just tech: a bookkeeping job gets bookkeeping-specific steps, a video-editing job gets video-editing-specific steps, a copywriting job gets copywriting-specific steps. Write every step in easy, plain English a non-technical client can follow: name the real thing being done ('find where the checkout total stops updating'), never the jargon for it ('debug the state management layer'), even when the underlying work is technical - and never let plain English become vague English; specific and simple at the same time is the target. If the client asked specific numbered questions in the post, answer each one directly and specifically here instead of, or alongside, the approach chain - real answers, never a placeholder.",
    "4. BLOCK D - EXPERIENCE (own short paragraph, always present). Reproduce this shape exactly: 'Moreover, I have got [N]+ years of experience with [skills copied verbatim from the job post's own terminology - if the post says \"Notion, Zapier\", write \"Notion, Zapier\", never \"productivity tools\"] & other related [skills/technologies].' Use the real years given below if provided, otherwise 5+.",
    "5. PROOF (own short block, only if real portfolio links are given below). 'You may take a look at my recent [project type] work:' then each link on its own line as '1- [link]' and '2- [link]'. Never invent a link, never write a placeholder bracket. Skip this entire block if no links are given.",
    "6. FIXED CLOSING - reproduce word for word, nothing added after: \"One message. That's the distance between this problem and its solution.\" blank line, \"See you inside :)\" blank line, \"Thanks\"",

    "=== VOICE ===",
    "Simple, plain English, short sentences. No buzzwords: passionate, dedicated, leverage, synergy, seasoned, cutting-edge, robust, innovative, results-driven. No AI-sounding filler: 'I hope this message finds you well', 'I would love the opportunity', 'I am excited to'. This is a 'you' message, not an 'I' message - you/your must clearly outnumber I across the whole proposal. The only places 'I' belongs are the fixed experience line (Block D) and a direct answer to a question the client asked about the freelancer personally. Confident and direct, never hedging ('I think', 'maybe', 'I believe I could'), never desperate ('I would be so grateful', 'please consider me'). Whole message under 150 words total.",
    "DASHES: never use a long dash (—) anywhere in anything you write. Use a simple hyphen (-) instead. This is the single biggest tell that a proposal was AI-written - an absolute rule, not a style preference.",
    "NEVER start consecutive sentences with 'I' - it's the fastest way for you/your dominance to quietly slip. If a sentence would naturally start with 'I', try rewording it around 'you/your' first, or drop the pronoun and start with the bare action instead (see the approach rule above).",
    "CONFIDENCE TECHNIQUE: when the post raises a real concern - a tight deadline, 'must be available now', a skill they sound worried about - address it with 'obviously', e.g. 'Obviously the first fix ships within 48 hours.' It signals the post was read and the concern isn't a big deal. Only use this when the post actually raises a concern; never force it in.",
    "CRITICAL - NEVER COPY THE CLIENT'S OWN WORDS: never lift a raw phrase, sentence, or typo straight out of the job post into the proposal. If the client wrote broken or typo'd English, write correct English in your own words - proving the problem was understood, not that a sentence could be pasted back. A proposal that just rearranges the client's own sentences, even if grammatically clean, is a failure.",
    "SPELLING AND GRAMMAR: every single word must be spelled correctly and every sentence grammatically correct - no exceptions, no typos, not even a small one. One misspelled word undoes the whole 'this person is careful' impression the rest of the message is built on. Read every sentence back before finishing as if checking someone else's work for mistakes.",

    "=== SELF-CHECK - do this silently before outputting, and silently rewrite anything that fails ===",
    "Opening is word-for-word exact. Closing is word-for-word exact with nothing after \"Thanks\". Every approach step is a full real action (not a one or two word label) that would only make sense for THIS exact job in THIS exact field - if any step could be copy-pasted into a proposal for a different job or a different field, rewrite it to be specific, and at least one step should reflect something only a real expert in this field would know to do. Each step is plain English a client with zero background in the field can still picture, with no subject pronoun. The experience line lists skills that actually appear in the job post's own words. No long dash anywhere. No buzzwords from the banned list, no generic filler like 'understand your requirements' or 'deliver high quality'. No two consecutive sentences start with 'I'. you/your clearly outnumbers I. Whole message is under 150 words. No markdown formatting. Nothing was copied verbatim from the job post. Every word is spelled correctly and every sentence is grammatically correct - reread the whole thing once specifically looking for typos before finishing.",

    `=== REAL_EXAMPLES - this freelancer's own past proposals, the structure and voice reference. Links inside them are placeholders - never reuse them, only the real links given to you below ===\n${REAL_EXAMPLES}`,

    history.length
      ? "=== RECENT VOICE ===\nYou are also shown proposals this freelancer sent recently through this app below. Match their established word choices within all the rules above, but never reuse the same approach sentence twice."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `JOB POST:\n${jobText.slice(0, 6000)}`,
    profile.firstName ? `FREELANCER FIRST NAME: ${profile.firstName}` : "",
    profile.headline ? `WHAT THEY DO: ${profile.headline}` : "",
    profile.years ? `EXPERIENCE: ${profile.years}` : "",
    profile.skills ? `SKILLS: ${profile.skills}` : "",
    profile.proof ? `PROOF THEY CAN CLAIM: ${profile.proof}` : "",
    portfolioLinks.length
      ? `REAL PORTFOLIO LINKS (use verbatim, up to 2, never invent others):\n${portfolioLinks
          .slice(0, 2)
          .map((p) => `${p.title}: ${p.url || p.fileName || ""}`)
          .join("\n")}`
      : "",
    requiredHints.length
      ? `MUST FOLLOW EXACTLY: ${requiredHints.join(" | ")}`
      : "",
    history.length
      ? `PROPOSALS THIS FREELANCER SENT BEFORE (voice reference only, do not repeat verbatim):\n${history
          .map((h, i) => `#${i + 1}:\n${h}`)
          .join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const startedAt = Date.now();
  let best: { text: string; issues: string[] } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0 && Date.now() - startedAt > TOTAL_BUDGET_MS) break;

    const result = await callAI(messages);
    if ("error" in result) {
      lastError = result.error;
      break; // a real technical failure - retrying the same broken call won't help
    }

    const issues = validateProposal(result.text, jobText, portfolioLinks);
    if (!best || issues.length < best.issues.length) {
      best = { text: result.text, issues };
    }
    if (issues.length === 0) break; // clean pass

    const budgetLeft = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (attempt >= MAX_ATTEMPTS - 1 || budgetLeft < PER_CALL_TIMEOUT_MS) break;

    messages.push({ role: "assistant", content: result.text });
    messages.push({ role: "user", content: repairInstruction(issues) });
  }

  if (best) return { text: best.text };
  return { error: lastError || "AI returned an empty response. Try again." };
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "That request did not look like JSON." },
      { status: 400 },
    );
  }

  const jobText =
    typeof payload.jobPost === "string" ? payload.jobPost.trim() : "";
  if (jobText.length < 25) {
    return NextResponse.json(
      {
        error:
          "Paste a bit more of the job post — I need at least a sentence or two to work with.",
      },
      { status: 400 },
    );
  }
  if (jobText.length > MAX_JOB_LENGTH) {
    return NextResponse.json(
      {
        error: `That post is longer than I can read (${jobText.length.toLocaleString()} characters, max ${MAX_JOB_LENGTH.toLocaleString()}). Trim it down and try again.`,
      },
      { status: 413 },
    );
  }

  const tone: Tone = TONES.includes(payload.tone as Tone)
    ? (payload.tone as Tone)
    : "warm";
  const portfolio = normalizePortfolio(payload.portfolio);
  const profile = { ...EMPTY_PROFILE, ...normalizeProfile(payload.profile) };
  const history = normalizeHistory(payload.history);

  const insights = analyzeJob(jobText);
  // Best match first, then one more distinct piece if there is one - the
  // proof block in the real examples lists up to two links.
  const best = matchPortfolio(jobText, insights, portfolio);
  const second = portfolio.find(
    (p) => p.id !== best?.id && (p.url || p.fileName),
  );
  const portfolioLinks = [best, second].filter(
    (p): p is PortfolioItem => p !== null && p !== undefined,
  );

  const result = await writeWithAI({
    jobText,
    tone,
    profile,
    portfolioLinks,
    requiredHints: insights.screeners.map((s) => s.instruction),
    history,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const response: GenerateResponse = {
    text: result.text,
    insights,
    usedPortfolioId: best?.id ?? null,
    coaching: [],
    source: "ai",
  };

  return NextResponse.json(response);
}
