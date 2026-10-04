const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmtFor(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validTimezone(tz: string) {
  try {
    fmtFor(tz);
    return true;
  } catch {
    return false;
  }
}

export function zparts(ts: number, tz: string) {
  const f = validTimezone(tz) ? fmtFor(tz) : fmtFor("UTC");
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), h = Number(p.hour), mi = Number(p.minute);
  return { y, m, d, h, mi, day: `${p.year}-${p.month}-${p.day}` };
}

function offset(ts: number, tz: string) {
  const p = zparts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ts / 60000) * 60000;
}

/** Wall-clock time in a timezone to a UTC timestamp. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let g = wall - offset(wall, tz);
  g = wall - offset(g, tz);
  return g;
}

/** Parses "2026-10-05 17:30" (local to tz). */
export function parseLocalStamp(s: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

export function fmtDuration(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

export function fmtWhen(ts: number, now: number, tz: string) {
  const t = zparts(ts, tz);
  const n = zparts(now, tz);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: validTimezone(tz) ? tz : "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(ts));
  if (t.day === n.day) return `${time} today`;
  const tomorrow = zparts(now + 86_400_000, tz).day;
  if (t.day === tomorrow) return `${time} tomorrow`;
  return `${time} on ${t.day}`;
}

/**
 * Reads a deadline from plain text: "in 2 hours", "by 5pm", "by 17:30 tomorrow", "end of day".
 * Returns a UTC timestamp, or null if no time is found.
 */
export function parseDeadline(text: string, now: number, tz: string, endHour: number): number | null {
  const s = text.toLowerCase();

  const rel = /\b(?:in|within|after)\s+(\d+(?:\.\d+)?|an|a|half an)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/.exec(s);
  if (rel) {
    const raw = rel[1];
    const n = raw === "an" || raw === "a" ? 1 : raw === "half an" ? 0.5 : Number(raw);
    const mult = rel[2].startsWith("h") ? 60 : 1;
    return now + n * mult * 60_000;
  }

  const today = zparts(now, tz);
  const wantsTomorrow = /\btomorrow\b/.test(s);
  const base = wantsTomorrow ? zparts(now + 86_400_000, tz) : today;

  let h: number | null = null;
  let mi = 0;
  const clock = /\b(?:by|before|at|until|till)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(s);
  if (clock) {
    h = Number(clock[1]);
    mi = clock[2] ? Number(clock[2]) : 0;
    const ap = clock[3]?.[0];
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (!ap && h <= 12 && !clock[2]) {
      // "by 5" with no am/pm: take the earliest option that is still ahead.
      const options = [h % 12, (h % 12) + 12];
      const ahead = options.find((x) => zonedToUtc(base.y, base.m, base.d, x, mi, tz) > now);
      h = ahead ?? options[0];
    }
  } else if (/\bnoon\b/.test(s)) h = 12;
  else if (/\b(eod|end of (the )?(work ?)?day|tonight|close of business|cob)\b/.test(s)) h = Math.min(23, endHour);

  if (h === null || h > 23 || mi > 59) return null;
  let ts = zonedToUtc(base.y, base.m, base.d, h, mi, tz);
  if (ts <= now && !wantsTomorrow) {
    const t = zparts(now + 86_400_000, tz);
    ts = zonedToUtc(t.y, t.m, t.d, h, mi, tz);
  }
  return ts;
}

export function parseTarget(text: string): number | null {
  const m = /(\d{1,4})\s*(?:more\s+)?(?:dms?|messages?|donors?|people|contacts?|emails?|texts?|whatsapps?)\b/i.exec(text);
  return m ? Number(m[1]) : null;
}
