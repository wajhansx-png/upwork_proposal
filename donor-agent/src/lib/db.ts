import { promises as fs } from "node:fs";
import path from "node:path";
import type { Db } from "./types";

const FILE = path.join(process.cwd(), "data", "db.json");

export const DEFAULT_TEMPLATE =
  "Hi {name}, this is {teammate} from our foundation. Thank you for supporting our work. " +
  "I wanted to share a short update and say how much your help means to us. " +
  "Would you be open to a quick chat this week?";

function fresh(): Db {
  return {
    settings: {
      teammateName: "Teammate",
      dailyTarget: 15,
      timezone: "UTC",
      workStartHour: 9,
      workEndHour: 18,
      stallHours: 3,
      template: DEFAULT_TEMPLATE,
    },
    donors: [],
    messages: [],
    subs: [],
    agent: { unansweredNudges: 0 },
  };
}

// One writer at a time, so two requests cannot overwrite each other.
let chain: Promise<unknown> = Promise.resolve();

async function read(): Promise<Db> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<Db>;
    const base = fresh();
    return {
      ...base,
      ...raw,
      settings: { ...base.settings, ...raw.settings },
      agent: { ...base.agent, ...raw.agent },
    };
  } catch {
    return fresh();
  }
}

async function write(db: Db) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, FILE);
}

/** Read-modify-write. The callback may change `db` in place. */
export function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const db = await read();
    const result = await fn(db);
    await write(db);
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function readDb(): Promise<Db> {
  const run = chain.then(read);
  chain = run.catch(() => undefined);
  return run;
}

export const newId = () => crypto.randomUUID().slice(0, 8);
