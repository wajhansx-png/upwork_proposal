export type Tone = "warm" | "direct" | "expert";

export type PortfolioItem = {
  id: string;
  kind: "link" | "image" | "pdf";
  title: string;
  url?: string;
  fileName?: string;
  thumb?: string | null;
  tags?: string[];
};

export type Profile = {
  firstName: string;
  headline: string;
  years: string;
  skills: string;
  proof: string;
};

export type RedFlag = {
  label: string;
  detail: string;
  severity: "high" | "medium";
};

export type Screener = {
  instruction: string;
  hint: string;
};

export type JobInsights = {
  title: string;
  clientName: string | null;
  goal: string | null;
  skills: string[];
  deliverables: string[];
  budget: string | null;
  budgetKind: "hourly" | "fixed" | null;
  timeline: string | null;
  urgency: boolean;
  wordCount: number;
  detailLevel: "thin" | "normal" | "detailed";
  screeners: Screener[];
  redFlags: RedFlag[];
  questions: string[];
  fit: {
    score: number;
    verdict: "strong" | "worth-it" | "risky";
    reasons: string[];
  };
};

export type ScoreCheck = {
  id: string;
  label: string;
  passed: boolean;
  help: string;
  weight: number;
};

export type ProposalScore = {
  total: number;
  band: "sharp" | "solid" | "needs-work";
  checks: ScoreCheck[];
  words: number;
  readSeconds: number;
};

export type GenerateResponse = {
  text: string;
  insights: JobInsights;
  usedPortfolioId: string | null;
  coaching: string[];
  source: "offline" | "ai";
};
