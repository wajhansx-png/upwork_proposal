import type { JobInsights, PortfolioItem } from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "your",
  "our",
  "are",
  "was",
  "will",
  "have",
  "has",
  "need",
  "needs",
  "want",
  "looking",
  "someone",
  "who",
  "can",
  "help",
  "from",
  "into",
  "them",
  "they",
  "not",
  "but",
  "all",
  "any",
  "job",
  "work",
  "project",
  "please",
]);

function tokens(text: string) {
  return (text.toLowerCase().match(/[a-z][a-z+.#]{2,}/g) || []).filter(
    (w) => !STOPWORDS.has(w),
  );
}

export function matchPortfolio(
  jobText: string,
  insights: JobInsights,
  portfolio: PortfolioItem[],
): PortfolioItem | null {
  if (!portfolio.length) return null;

  const jobTokens = new Set([
    ...tokens(jobText),
    ...insights.skills.flatMap((s) => tokens(s)),
  ]);

  let best: { item: PortfolioItem; score: number } | null = null;
  for (const item of portfolio) {
    const itemTokens = [
      ...tokens(item.title || ""),
      ...tokens(item.fileName || ""),
      ...(item.tags || []).flatMap((t) => tokens(t)),
      ...tokens((item.url || "").replace(/[/.\-_]/g, " ")),
    ];
    let score = 0;
    for (const t of new Set(itemTokens)) if (jobTokens.has(t)) score += 3;
    if (item.kind === "link") score += 1;
    if (!best || score > best.score) best = { item, score };
  }
  return best ? best.item : null;
}
