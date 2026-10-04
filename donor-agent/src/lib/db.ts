import { promises as fs } from "node:fs";
import path from "node:path";
import type { Db } from "./types";

const FILE = path.join(process.cwd(), "data", "db.json");
const KEY = "donor-desk:db";
const LOCK = "donor-desk:lock";

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
      checkinMinutes: 60,
      template: DEFAULT_TEMPLATE,
    },
    donors: [],
    tasks: [],
    messages: [],
    subs: [],
    agent: {},
  };
}

function normalize(raw: Partial<Db> | null): Db {
  const base = fresh();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...raw.settings },
    agent: { ...base.agent, ...raw.agent },
    donors: (raw.donors ?? []).map((d) => ({ ...d, flags: d.flags ?? [] })),
  };
}

// ---- storage: Upstash/Vercel KV over REST when configured, else a local file ----

const REST_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const usingRedis = () => !!(REST_URL() && REST_TOKEN());

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN()}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || data.error) throw new Error(`Redis: ${data.error ?? res.status}`);
  return data.result;
}

async function load(): Promise<Db> {
  if (usingRedis()) {
    const raw = (await redis(["GET", KEY])) as string | null;
    return normalize(raw ? JSON.parse(raw) : null);
  }
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return fresh();
  }
}

async function save(json: string) {
  if (usingRedis()) {
    await redis(["SET", KEY, json]);
    return;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, FILE);
}

/** Cross-instance lock so two serverless calls cannot overwrite each other. */
async function lock(): Promise<() => Promise<void>> {
  if (!usingRedis()) return async () => undefined;
  const id = crypto.randomUUID();
  for (let i = 0; i < 60; i++) {
    if ((await redis(["SET", LOCK, id, "NX", "PX", 10_000])) === "OK")
      return async () => {
        if ((await redis(["GET", LOCK])) === id) await redis(["DEL", LOCK]);
      };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Could not get the database lock");
}

// One writer at a time inside this process.
let chain: Promise<unknown> = Promise.resolve();

/** Read-modify-write. The callback may change `db` in place. Writes only if something changed. */
export function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const unlock = await lock();
    try {
      const db = await load();
      const before = JSON.stringify(db);
      const result = await fn(db);
      const after = JSON.stringify(db);
      if (after !== before) await save(after);
      return result;
    } finally {
      await unlock();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Read without the lock. May be a moment stale, which is fine for display and planning. */
export function readDb(): Promise<Db> {
  return load();
}

export const newId = () => crypto.randomUUID().slice(0, 8);
