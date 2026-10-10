/**
 * The counter: turns what the browser add-on saw into donor marks and a task count.
 * Pure and testable — no WhatsApp, no network. The add-on only WATCHES (never sends), so the number stays safe.
 */
import { cleanPhone } from "./donors";
import type { Donor } from "./types";

export const SEEN_CAP = 2000;

/** One thing the add-on saw in a donor chat. `id` is the WhatsApp message id, used so nothing is counted twice. */
export interface CounterEvent {
  id: string;
  /** Digits of the chat's number, when the chat shows one. */
  phone?: string;
  /** The chat title, used to match saved contacts that hide the number. */
  name?: string;
  /** "out" = she sent a DM. "in" = the donor replied. */
  dir: "out" | "in";
  at: number;
}

export interface CounterPlan {
  /** Donor ids to mark "sent" (first contact only, so repeats never overcount). */
  sent: string[];
  /** Donor ids to mark "replied" (they were messaged, now wrote back). */
  replied: string[];
  /** Fresh event ids to remember, capped. */
  seen: string[];
  /** Events whose donor we could not match (counted as activity, but no name). */
  unknown: number;
  /** Events skipped because their id was already seen. */
  duplicates: number;
}

const normName = (s?: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Find the donor for one chat: by phone first (most reliable), then by exact saved name. */
export function matchDonor(donors: Donor[], ev: Pick<CounterEvent, "phone" | "name">): Donor | undefined {
  const phone = cleanPhone(ev.phone);
  if (phone) {
    const byPhone = donors.find((d) => d.phone === phone);
    if (byPhone) return byPhone;
  }
  const name = normName(ev.name);
  if (name.length >= 3) {
    const matches = donors.filter((d) => normName(d.name) === name);
    if (matches.length === 1) return matches[0]; // one exact match only, never a guess
  }
  return undefined;
}

/**
 * Decide what the events mean. Does not change anything; the caller applies the plan in one safe step.
 * Rules that keep it accurate:
 *  - An event id seen before is ignored (no double counting on a retry).
 *  - "sent" counts a donor only on first contact (status "new"), so 2 messages in one chat are still 1 DM.
 *  - "replied" counts only a donor she already messaged.
 */
export function planCounter(events: CounterEvent[], donors: Donor[], seenList: string[]): CounterPlan {
  const seen = new Set(seenList);
  const sent = new Set<string>();
  const replied = new Set<string>();
  const fresh: string[] = [];
  let unknown = 0;
  let duplicates = 0;

  // Oldest first, so a "sent" is processed before a "reply" that follows it.
  for (const ev of [...events].sort((a, b) => a.at - b.at)) {
    if (!ev || typeof ev.id !== "string" || !ev.id) continue;
    if (seen.has(ev.id)) {
      duplicates++;
      continue;
    }
    seen.add(ev.id);
    fresh.push(ev.id);
    const donor = matchDonor(donors, ev);
    if (!donor) {
      unknown++;
      continue;
    }
    if (ev.dir === "out") {
      // First contact only. Already-sent/replied/donated donors are not re-counted.
      if (donor.status === "new" && !sent.has(donor.id)) sent.add(donor.id);
    } else if (ev.dir === "in") {
      if ((donor.status === "sent" || sent.has(donor.id)) && donor.status !== "donated") replied.add(donor.id);
    }
  }

  // Keep only the newest ids, so storage never grows without limit.
  const keptSeen = [...seenList, ...fresh].slice(-SEEN_CAP);
  return { sent: [...sent], replied: [...replied], seen: keptSeen, unknown, duplicates };
}
