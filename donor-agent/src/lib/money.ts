/**
 * Rupee amounts as people type them: "26000", "26,000", "Rs 26k", "1.5 lakh", "19.5k".
 * Returns undefined for anything that is not a clear amount. Safe for the browser (no server imports).
 */
export function parseAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|lakh|lac|lakhs)?\b/i.exec(String(raw ?? ""));
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase();
  const v = Math.round(n * (/^la/.test(unit) ? 100_000 : unit ? 1000 : 1));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}
