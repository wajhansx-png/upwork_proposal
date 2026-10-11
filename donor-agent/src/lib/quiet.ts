import { zonedToUtc, zparts } from "./time";
import type { Settings } from "./types";

export const DEFAULT_QUIET = { quietEnabled: true, quietStartHour: 23, quietEndHour: 8 };

const hourOk = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;

/**
 * Quiet hours: no pushes to her at night. Returns when the quiet time ends, or null when pushes should go out.
 *
 * One firm rule keeps the pressure honest: quiet hours never apply to a task whose deadline falls before the
 * quiet time ends. A task due at 11:30 pm, or at 2 am, is pushed all the way to its deadline. Quiet hours only
 * protect her sleep on tasks that run on past the morning.
 */
export function quietUntil(s: Partial<Settings>, now: number, deadlineMs: number): number | null {
  // Only an explicit "on" counts. The saved settings always carry it (default on), so a missing value means "not set up".
  const on = s.quietEnabled === true;
  const a = hourOk(s.quietStartHour) ? s.quietStartHour : DEFAULT_QUIET.quietStartHour;
  const b = hourOk(s.quietEndHour) ? s.quietEndHour : DEFAULT_QUIET.quietEndHour;
  if (!on || a === b) return null;
  const tz = s.timezone ?? "Asia/Karachi";
  const h = zparts(now, tz).h;
  const inside = a < b ? h >= a && h < b : h >= a || h < b;
  if (!inside) return null;
  // The night ends at hour b: later today when it is already after midnight, tomorrow when it is before.
  const t = zparts(now + (a > b && h >= a ? 86_400_000 : 0), tz);
  const end = zonedToUtc(t.y, t.m, t.d, b, 0, tz);
  return deadlineMs <= end ? null : end;
}

/** "11 pm", "8 am", "12 am". */
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
