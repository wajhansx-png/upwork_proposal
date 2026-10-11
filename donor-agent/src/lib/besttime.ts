import { zparts } from "./time";
import { hourLabel } from "./quiet";

export const SEND_LOG_CAP = 3000;
const MIN_SENDS = 20;
const MIN_DAYS = 3;
const WINDOW_DAYS = 30;
/** The best two hours must hold at least this share of her DMs, or there is no clear pattern (a flat day is about 8%). */
const MIN_SHARE = 0.3;

export interface BestTime {
  /** First hour of the best two-hour window, 0-23. */
  from: number;
  to: number;
  /** DMs inside the window, all DMs counted, and the days they cover. */
  sends: number;
  total: number;
  days: number;
  /** "7–9 pm" */
  label: string;
}

/** Add `n` sends at time `at` to the log (oldest first, capped). Mutates and returns the log. */
export function logSends(log: number[] | undefined, at: number, n: number): number[] {
  const out = log ?? [];
  for (let i = 0; i < Math.min(50, Math.max(0, Math.floor(n))); i++) out.push(at);
  if (out.length > SEND_LOG_CAP) out.splice(0, out.length - SEND_LOG_CAP);
  return out;
}

/** Take back the last `n` sends (an undo or a lowered count). Mutates and returns the log. */
export function unlogSends(log: number[] | undefined, n: number): number[] {
  const out = log ?? [];
  out.splice(Math.max(0, out.length - Math.max(0, Math.floor(n))));
  return out;
}

/** The two hours when she sends the most DMs, or null when there is too little data or no clear pattern. */
export function bestTime(log: number[] | undefined, tz: string, now: number): BestTime | null {
  const recent = (log ?? []).filter((t) => Number.isFinite(t) && t <= now && now - t <= WINDOW_DAYS * 86_400_000);
  if (recent.length < MIN_SENDS) return null;
  const perHour = new Array<number>(24).fill(0);
  const days = new Set<string>();
  for (const t of recent) {
    const p = zparts(t, tz);
    perHour[p.h % 24]++;
    days.add(p.day);
  }
  if (days.size < MIN_DAYS) return null;
  let from = 0;
  let best = -1;
  for (let h = 0; h < 24; h++) {
    const n = perHour[h] + perHour[(h + 1) % 24];
    if (n > best) {
      best = n;
      from = h;
    }
  }
  if (best / recent.length < MIN_SHARE) return null;
  const to = (from + 2) % 24;
  const ampm = (h: number) => (h < 12 ? "am" : "pm");
  const num = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const label = ampm(from) === ampm(to) ? `${num(from)}–${num(to)} ${ampm(to)}` : `${hourLabel(from)} – ${hourLabel(to)}`;
  return { from, to, sends: best, total: recent.length, days: days.size, label };
}
