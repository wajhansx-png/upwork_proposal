import type { JobInsights, RedFlag, Screener } from "./types";

const SKILL_DICTIONARY: Record<string, string[]> = {
  React: ["react", "reactjs", "react.js"],
  "Next.js": ["next.js", "nextjs"],
  TypeScript: ["typescript", "ts "],
  JavaScript: ["javascript", "js "],
  "Node.js": ["node.js", "nodejs", "express"],
  Python: ["python", "django", "flask", "fastapi"],
  WordPress: ["wordpress", "wp ", "elementor", "woocommerce"],
  Shopify: ["shopify", "liquid"],
  Webflow: ["webflow"],
  Figma: ["figma"],
  "UI/UX design": ["ui/ux", "ux design", "ui design", "wireframe", "user flow"],
  "Logo & brand": ["logo", "brand identity", "branding", "style guide"],
  "Landing page": ["landing page", "sales page", "squeeze page"],
  Copywriting: ["copywriting", "copywriter", "sales copy", "landing page copy"],
  SEO: ["seo", "search engine optimization", "backlink", "keyword research"],
  "Content writing": [
    "blog post",
    "article writing",
    "content writer",
    "ghostwriting",
  ],
  "Video editing": [
    "video editing",
    "premiere",
    "after effects",
    "davinci",
    "reels",
    "capcut",
  ],
  "Motion graphics": ["motion graphics", "animation", "explainer video"],
  "Data entry": ["data entry", "data scraping", "web scraping"],
  "Data analysis": ["data analysis", "power bi", "tableau", "pandas", "sql"],
  "AI / LLM": [
    "openai",
    "gpt",
    "llm",
    "langchain",
    "chatbot",
    "prompt engineering",
    "rag ",
  ],
  Automation: ["zapier", "make.com", "n8n", "automation", "workflow"],
  "Paid ads": ["facebook ads", "google ads", "meta ads", "ppc", "tiktok ads"],
  "Email marketing": ["klaviyo", "mailchimp", "email sequence", "newsletter"],
  "Social media": ["social media", "instagram", "tiktok", "content calendar"],
  "Virtual assistant": [
    "virtual assistant",
    "admin support",
    "inbox management",
  ],
  Bookkeeping: ["bookkeeping", "quickbooks", "xero", "accounting"],
  "Mobile app": [
    "react native",
    "flutter",
    "ios app",
    "android app",
    "swift",
    "kotlin",
  ],
  "API integration": [
    "api integration",
    "rest api",
    "webhook",
    "stripe integration",
  ],
  Database: ["postgres", "mysql", "mongodb", "supabase", "firebase"],
  Translation: ["translation", "translate", "localization", "subtitles"],
  "3D / CAD": ["blender", "3d model", "autocad", "solidworks", "rendering"],
};

const RED_FLAG_RULES: Array<{
  test: RegExp;
  flag: RedFlag;
}> = [
  {
    test: /\b(unpaid|free)\s+(test|trial|sample|task|work)\b/i,
    flag: {
      label: "Free test task",
      detail:
        "They want work before payment. Offer a small paid trial instead.",
      severity: "high",
    },
  },
  {
    test: /\b(whatsapp|telegram|skype|signal)\b/i,
    flag: {
      label: "Wants to move off Upwork",
      detail:
        "Off-platform contact breaks Upwork's terms and drops your payment protection.",
      severity: "high",
    },
  },
  {
    test: /\b(revenue share|equity|profit split|commission only)\b/i,
    flag: {
      label: "Pay is a promise, not money",
      detail:
        "Equity or commission-only means the risk is all yours. Ask for a base rate.",
      severity: "high",
    },
  },
  {
    test: /\b(pay(ment)? (after|upon) (delivery|completion|approval))\b/i,
    flag: {
      label: "No milestone up front",
      detail:
        "Ask for a funded milestone before you start. That is what escrow is for.",
      severity: "medium",
    },
  },
  {
    test: /\b(rockstar|ninja|wizard|guru)\b/i,
    flag: {
      label: "Hype language",
      detail:
        "Often signals big expectations on a small budget. Confirm scope in writing.",
      severity: "medium",
    },
  },
  {
    test: /\b(long[- ]term)\b[\s\S]{0,120}\b(\$?\s?[1-9]\d?\s?(\/|per )?(hr|hour)|low budget|small budget|tight budget)\b/i,
    flag: {
      label: "Long-term promise, low rate",
      detail:
        '"Long-term" is not a rate. Price the first deliverable on its own merit.',
      severity: "medium",
    },
  },
  {
    test: /\b(everything|end[- ]to[- ]end|full package)\b[\s\S]{0,80}\b(design|develop|market|manage)\b[\s\S]{0,80}\b(and|\+)\b/i,
    flag: {
      label: "Scope looks like three jobs",
      detail:
        "Pick the slice you are best at and name it. Vague scope grows for free.",
      severity: "medium",
    },
  },
  {
    test: /\b(asap|urgent|immediately)\b[\s\S]{0,60}\b(cheap|low cost|budget friendly|affordable)\b/i,
    flag: {
      label: "Urgent and cheap",
      detail:
        "Rush plus cheap usually means pressure later. Quote a rush rate.",
      severity: "medium",
    },
  },
];

const SCREENER_RULES: Array<{ test: RegExp; hint: string }> = [
  {
    // The "your proposal/reply/etc" is made optional so plain forms like
    // "Start with the word X" or "Begin with X" also fire.
    test: /\b(start|begin)(\s+your)?(\s+(proposal|cover letter|application|reply|message|response))?\s+with[^.\n]*/i,
    hint: "Put this in your very first line, exactly as written. Most applicants miss it.",
  },
  {
    test: /\b(include|use|type|mention|add)\s+the\s+(word|phrase|code)[^.\n]*/i,
    hint: "This is a filter. Copy the word exactly, including capitalisation.",
  },
  {
    test: /\b(do not|don't)\s+(use|send)\s+(a\s+)?(template|ai|chatgpt|generic)[^.\n]*/i,
    hint: "They are AI-allergic. Keep the language plain and specific to their post.",
  },
  {
    test: /\b(answer|reply to)\s+(the\s+)?(following|these)\s+questions?[^.\n]*/i,
    hint: "Answer each one in order, short lines. Skipping one reads as careless.",
  },
  {
    test: /\b(tell me|share|send)\s+(an?\s+)?(example|sample|link|portfolio)[^.\n]*/i,
    hint: "Give one link with a one-line reason it is relevant. Not a wall of links.",
  },
];

function clean(text: string) {
  return text.replace(/\r/g, "").trim();
}

// Plain substring matching lets short needles like "ts " (TypeScript) or
// "js " (JavaScript) match inside unrelated words - "formats AI EPS PNG PDF"
// contains "ts " from "formats ". Requiring a non-alphanumeric character on
// both sides of the needle keeps the match anchored to a real word/token.
function hasNeedle(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    const before = haystack[i - 1];
    const after = haystack[i + needle.length];
    const beforeOk = !before || !/[a-z0-9]/.test(before);
    const afterOk = !after || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return true;
    from = i + 1;
  }
}

export function detectSkills(text: string): string[] {
  const haystack = ` ${text.toLowerCase()} `;
  const found: string[] = [];
  for (const [skill, needles] of Object.entries(SKILL_DICTIONARY)) {
    if (needles.some((n) => hasNeedle(haystack, n))) found.push(skill);
  }
  return found.slice(0, 8);
}

function detectClientName(text: string): string | null {
  const patterns = [
    /\b[Hh](?:i|ello|ey)[,!]?\s*(?:there,?\s*)?(?:[Ii]'?m|[Ii] am|[Mm]y name is)\s+([A-Z][a-z]{1,14})\b/,
    /\b(?:[Ii]'?m|[Ii] am|[Mm]y name is)\s+([A-Z][a-z]{1,14})\b/,
    /\b[Tt]his is\s+([A-Z][a-z]{1,14})\b/,
    /\b(?:thanks|regards|cheers|best)[,!]?\s*\n+\s*([A-Z][a-z]{1,14})\s*$/m,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const name = m[1];
      const noise = [
        "Looking",
        "Hiring",
        "Seeking",
        "Building",
        "Working",
        "Based",
        "Currently",
      ];
      if (!noise.includes(name)) return name;
    }
  }
  return null;
}

function detectTitle(text: string): string {
  const firstLine = clean(text).split("\n")[0]?.trim() ?? "";
  if (firstLine && firstLine.length <= 90 && !/[.!?]$/.test(firstLine))
    return firstLine;

  const looking = text.match(
    /\b(?:looking for|need|seeking|hiring|want to hire)\s+(?:an?\s+)?([^.\n]{6,70})/i,
  );
  if (looking) return looking[1].trim().replace(/\s+who$/i, "");
  return firstLine.slice(0, 80) || "This job";
}

function detectGoal(text: string): string | null {
  const patterns = [
    /\b(?:so that|so we can|in order to|goal is to|the goal:|objective is to)\s+([^.\n]{10,120})/i,
    /\b(?:we|i)\s+(?:want|need)\s+to\s+([^.\n]{10,120})/i,
    /\b(?:help(?:ing)? (?:us|me))\s+([^.\n]{10,120})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim().replace(/[,;:]$/, "");
  }
  return null;
}

// A job post pasted from Upwork sometimes drags along page chrome - a
// "...more" truncation toggle, "Read more / Show less" expander text, a
// stray ellipsis where the client's browser cut the post off mid-sentence.
// Those look exactly like a short bullet to the extraction regexes above,
// and writing one straight into a proposal is how you get "My approach
// will be to review... moreMore/Less about." A junk line is worse than no
// line - drop it instead of treating it as real content.
const JUNK_LINE =
  /\b(read\s*more|show\s*more|see\s*more|view\s*more|more\s*\/\s*less|expand|collapse)\b|\.{3,}|\bmore(?=[A-Z])/i;

function detectDeliverables(text: string): string[] {
  const lines = clean(text).split("\n");
  const bullets = lines
    .map((l) => l.trim())
    .filter((l) => /^([-*•·–—]|\d+[.)])\s+/.test(l))
    .map((l) =>
      l
        .replace(/^([-*•·–—]|\d+[.)])\s+/, "")
        .replace(/[.;]$/, "")
        .trim(),
    )
    .filter((l) => l.length > 3 && l.length < 140 && !JUNK_LINE.test(l));

  if (bullets.length) return bullets.slice(0, 8);

  return lines
    .filter((l) =>
      /\b(need|must|should|deliver|include|responsible for|tasks?)\b/i.test(l),
    )
    .map((l) => l.trim())
    .filter((l) => l.length > 12 && l.length < 140 && !JUNK_LINE.test(l))
    .slice(0, 4);
}

function detectBudget(text: string): {
  budget: string | null;
  kind: "hourly" | "fixed" | null;
} {
  const hourlyRange = text.match(
    /\$\s?([\d,]+(?:\.\d+)?)\s?(?:-|–|to)\s?\$?\s?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)?(?:hr|hour)/i,
  );
  if (hourlyRange)
    return {
      budget: `$${hourlyRange[1]}–$${hourlyRange[2]}/hr`,
      kind: "hourly",
    };

  const hourly = text.match(
    /\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)?(?:hr|hour)/i,
  );
  if (hourly) return { budget: `$${hourly[1]}/hr`, kind: "hourly" };

  const fixedRange = text.match(/\$\s?([\d,]+)\s?(?:-|–|to)\s?\$?\s?([\d,]+)/);
  if (fixedRange)
    return { budget: `$${fixedRange[1]}–$${fixedRange[2]}`, kind: "fixed" };

  const fixed = text.match(
    /(?:budget|pay|paying|offer)[^$\n]{0,24}\$\s?([\d,]+)/i,
  );
  if (fixed) return { budget: `$${fixed[1]}`, kind: "fixed" };

  const anyAmount = text.match(/\$\s?([\d,]{2,})/);
  if (anyAmount)
    return {
      budget: `$${anyAmount[1]}`,
      kind: /hourly/i.test(text) ? "hourly" : "fixed",
    };

  if (/\bhourly\b/i.test(text)) return { budget: null, kind: "hourly" };
  if (/\bfixed[- ]price\b/i.test(text)) return { budget: null, kind: "fixed" };
  return { budget: null, kind: null };
}

function detectTimeline(text: string): string | null {
  const patterns = [
    /\b(?:less than|under|within)\s+\d+\s+(?:hrs?|hours?|days?|weeks?|months?)\b/i,
    /\b\d+\s*(?:-|–|to)\s*\d+\s+(?:days?|weeks?|months?)\b/i,
    /\b(?:by|before)\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|friday)\b/i,
    /\b\d+\s+(?:days?|weeks?|months?)\s+(?:project|engagement|timeline|deadline)\b/i,
    /\b(?:ongoing|long[- ]term|one[- ]time|short[- ]term)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

function detectScreeners(text: string): Screener[] {
  const out: Screener[] = [];
  for (const rule of SCREENER_RULES) {
    const m = text.match(rule.test);
    if (m) {
      out.push({
        instruction: m[0].trim().replace(/\s+/g, " ").slice(0, 160),
        hint: rule.hint,
      });
    }
  }
  return out.slice(0, 3);
}

function detectRedFlags(text: string): RedFlag[] {
  const out: RedFlag[] = [];
  for (const rule of RED_FLAG_RULES) {
    if (rule.test.test(text)) out.push(rule.flag);
  }
  return out;
}

function detectQuestions(text: string): string[] {
  return clean(text)
    .split(/\n|(?<=\?)\s+/)
    .map((l) => l.trim())
    .filter((l) => l.endsWith("?") && l.length > 12 && l.length < 180)
    .slice(0, 4);
}

function scoreFit(input: {
  words: number;
  skills: string[];
  deliverables: string[];
  budget: string | null;
  redFlags: RedFlag[];
  screeners: Screener[];
  clientName: string | null;
}) {
  const reasons: string[] = [];
  let score = 52;

  if (input.words > 120) {
    score += 12;
    reasons.push(
      "The post is detailed, so this client has thought it through.",
    );
  } else if (input.words < 45) {
    score -= 10;
    reasons.push("Very short post. Expect to define the scope for them.");
  }

  if (input.deliverables.length >= 3) {
    score += 10;
    reasons.push("Clear list of deliverables you can mirror back to them.");
  }

  if (input.budget) {
    score += 8;
    reasons.push(
      `Budget is on the table (${input.budget}), so you can price with facts.`,
    );
  } else {
    score -= 4;
    reasons.push("No budget stated. Anchor your own number first.");
  }

  if (input.skills.length >= 2) {
    score += 8;
    reasons.push(
      `Named skills to match: ${input.skills.slice(0, 3).join(", ")}.`,
    );
  }

  if (input.screeners.length) {
    score += 6;
    reasons.push(
      "The post hides an instruction. Following it puts you ahead of most applicants.",
    );
  }

  if (input.clientName) {
    score += 4;
    reasons.push(
      `You can open with their name (${input.clientName}) instead of "Hi there".`,
    );
  }

  for (const flag of input.redFlags) {
    score -= flag.severity === "high" ? 20 : 9;
    reasons.push(`${flag.label}: ${flag.detail}`);
  }

  score = Math.max(6, Math.min(97, Math.round(score)));
  const verdict: "strong" | "worth-it" | "risky" =
    score >= 74 ? "strong" : score >= 52 ? "worth-it" : "risky";

  return { score, verdict, reasons: reasons.slice(0, 5) };
}

export function analyzeJob(rawText: string): JobInsights {
  const text = clean(rawText);
  const words = (text.match(/\S+/g) || []).length;
  const skills = detectSkills(text);
  const deliverables = detectDeliverables(text);
  const { budget, kind } = detectBudget(text);
  const redFlags = detectRedFlags(text);
  const screeners = detectScreeners(text);
  const clientName = detectClientName(text);

  return {
    title: detectTitle(text),
    clientName,
    goal: detectGoal(text),
    skills,
    deliverables,
    budget,
    budgetKind: kind,
    timeline: detectTimeline(text),
    urgency:
      /\b(asap|urgent|immediately|right away|start today|this week)\b/i.test(
        text,
      ),
    wordCount: words,
    detailLevel: words > 160 ? "detailed" : words > 55 ? "normal" : "thin",
    screeners,
    redFlags,
    questions: detectQuestions(text),
    fit: scoreFit({
      words,
      skills,
      deliverables,
      budget,
      redFlags,
      screeners,
      clientName,
    }),
  };
}
