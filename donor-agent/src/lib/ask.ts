import type { Task } from "./types";

/** What a "please update me" message may say. Every number here is real, taken from the task at the moment of the click. */
export interface AskContext {
  name: string;
  done: number;
  target: number;
  minsLeft: number;
  /** The same time, as people say it: "2h 30m". */
  timeLeft: string;
  title: string;
}

interface Line {
  text: (c: AskContext) => string;
  /** Only used when this is true (for example, "minutes left" needs time left). */
  when?: (c: AskContext) => boolean;
}

const timeLeft = (c: AskContext) => c.minsLeft > 0;
const left = (c: AskContext) => Math.max(0, c.target - c.done);

/** Different ways to ask a DM task for her count. */
const DM_LINES: Line[] = [
  { text: (c) => `${c.name}, quick check: how many DMs have you sent so far?` },
  { text: (c) => `Hi ${c.name}! What's your count right now? Just send the number.` },
  { text: (c) => `${c.name}, how many DMs are done? Tap + or reply with the number.` },
  { text: (c) => `Update please, ${c.name}: how many have you sent since your last update?` },
  { text: (c) => `Your counter says ${c.done} of ${c.target}. Is that right? How many now?` },
  { text: (c) => `${c.timeLeft} left. ${c.name}, how many DMs have you sent?`, when: timeLeft },
  { text: (c) => `${c.name}, your manager is asking for an update. How many DMs so far?` },
  { text: (c) => `Checking in, ${c.name}. How many DMs did you send? A number is enough 🙂` },
  { text: (c) => `Where are you at, ${c.name}? ${c.done} of ${c.target} on the counter. Send your latest number.` },
  { text: (c) => `${c.name}, how's it going? How many DMs have gone out?` },
  { text: (c) => `Send me your count, ${c.name}. How many DMs are done?` },
  { text: (c) => `Quick one, ${c.name}: how many DMs now? Update the counter if it is behind.` },
  { text: (c) => `${c.name}, I need your number: how many DMs sent so far?` },
  { text: (c) => `Time check, ${c.name}: ${c.timeLeft} left. How many DMs have you sent?`, when: timeLeft },
  { text: (c) => `${c.name}, ${left(c)} still to go. How many have you sent now?`, when: (c) => left(c) > 0 },
];

/** Different ways to ask for an update on a task with no count. */
const GENERAL_LINES: Line[] = [
  { text: (c) => `${c.name}, quick update on "${c.title}": what is done and what is left?` },
  { text: (c) => `How is "${c.title}" going, ${c.name}? Tell me what is finished.` },
  { text: (c) => `${c.name}, your manager is asking for an update on "${c.title}".` },
  { text: (c) => `Checking in, ${c.name}. Where are you with "${c.title}"?` },
  { text: (c) => `${c.name}, what is the latest on "${c.title}"? One line is enough.` },
  { text: (c) => `${c.timeLeft} left on "${c.title}". ${c.name}, what is still open?`, when: timeLeft },
];

/**
 * Pick a message for this click. It never repeats the last one, and does not come back until the rest were used.
 * `used` is the list of lines already sent for this task (indexes, newest last). `rnd` can be replaced in tests.
 */
export function pickAsk(task: Pick<Task, "kind">, ctx: AskContext, used: number[] = [], rnd: () => number = Math.random): { text: string; index: number } {
  const lines = task.kind === "dms" ? DM_LINES : GENERAL_LINES;
  const pool = lines.map((_, i) => i).filter((i) => (lines[i].when ? lines[i].when!(ctx) : true));
  const recent = new Set(used.slice(-(pool.length - 1)));
  let options = pool.filter((i) => !recent.has(i));
  if (!options.length) options = pool.filter((i) => i !== used.at(-1));
  if (!options.length) options = pool;
  const index = options[Math.min(options.length - 1, Math.floor(rnd() * options.length))];
  return { text: lines[index].text(ctx), index };
}
