import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { normalizeDonor, seedDonors } from "./donors";
import type { Db } from "./types";

// Vercel functions cannot write inside /var/task. Use their writable /tmp
// directory when persistent Redis/KV credentials have not been configured.
// Local development continues to use the project's data directory.
const DATA_DIR = process.env.VERCEL ? "/tmp/donor-desk" : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "db.json");
const KEY = "donor-desk:db";
const LOCK = "donor-desk:lock";
const BLOB_DB = "donor-desk/state.json";
const BLOB_IMG = "donor-desk/proof";
const versions = new WeakMap<Db, string>();

function fresh(): Db {
  return {
    settings: {
      teammateName: "Areeba",
      dailyTarget: 15,
      timezone: "Asia/Karachi",
      workEndHour: 18,
      checkinMinutes: 20,
      quietEnabled: true,
      quietStartHour: 23,
      quietEndHour: 8,
    },
    hashes: {},
    donors: seedDonors(),
    cases: [],
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
    // The first time, load the manager's donor list. Seeded ids are fixed, so every read gives the same donors.
    donors: Array.isArray(raw.donors) && raw.donors.length ? raw.donors.map(normalizeDonor) : seedDonors(),
    cases: Array.isArray(raw.cases) ? raw.cases : [],
  };
}

// ---- storage: Upstash/Vercel KV over REST when configured, else a local file ----

// Vercel's Upstash connect can add a prefix to the names (like "myprefix_KV_REST_API_URL"), so accept any prefix.
const withSuffix = (suffix: string) => {
  const key = Object.keys(process.env).find((k) => k.endsWith(suffix) && process.env[k]);
  return key ? process.env[key] : undefined;
};
const REST_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || withSuffix("_KV_REST_API_URL");
const REST_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || withSuffix("_KV_REST_API_TOKEN");
export const usingRedis = () => !!(REST_URL() && REST_TOKEN());
const usingBlob = () => !!process.env.BLOB_STORE_ID;
export const usingPersistentStore = () => usingRedis() || usingBlob();

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
  if (usingBlob()) {
    // Compressed HTTP responses may expose a weak ETag that cannot be used
    // for a conditional write. Request the original representation.
    const item = await get(BLOB_DB, { access: "private", useCache: false, headers: { "Accept-Encoding": "identity" } });
    if (!item?.stream) return fresh();
    const value = normalize(JSON.parse(await new Response(item.stream).text()));
    versions.set(value, item.blob.etag);
    return value;
  }
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return fresh();
  }
}

async function save(json: string, version?: string) {
  if (usingRedis()) {
    await redis(["SET", KEY, json]);
    return;
  }
  if (usingBlob()) {
    await put(BLOB_DB, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(version ? { ifMatch: version } : {}),
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
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
        // Delete the lock only if it is still ours, in one command.
        await redis(["EVAL", "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, LOCK, id]);
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
      for (let attempt = 0; attempt < 8; attempt++) {
        const db = await load();
        const before = JSON.stringify(db);
        const result = await fn(db);
        const after = JSON.stringify(db);
        try {
          if (after !== before) await save(after, versions.get(db));
          cached = { at: Date.now(), db: structuredClone(db) };
          return result;
        } catch (error) {
          if (!/precondition|etag mismatch/i.test(String(error)) || attempt === 7) throw error;
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1) + Math.random() * 120));
        }
      }
      throw new Error("The task is being updated. Please try again in a moment.");
    } finally {
      await unlock();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

// ---- plain key/value for screenshots (kept out of the main record so it stays small) ----

const IMG_DIR = path.join(DATA_DIR, "img");

export async function kvSetImage(id: string, dataUrl: string) {
  if (usingRedis()) {
    await redis(["SET", `donor-desk:img:${id}`, dataUrl]);
    return;
  }
  if (usingBlob()) {
    await put(`${BLOB_IMG}/${id}.txt`, dataUrl, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "text/plain",
      cacheControlMaxAge: 0,
    });
    return;
  }
  await fs.mkdir(IMG_DIR, { recursive: true });
  await fs.writeFile(path.join(IMG_DIR, `${id}.txt`), dataUrl);
}

export async function kvGetImage(id: string): Promise<string | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  if (usingRedis()) return ((await redis(["GET", `donor-desk:img:${id}`])) as string | null) ?? null;
  if (usingBlob()) {
    const item = await get(`${BLOB_IMG}/${id}.txt`, { access: "private", useCache: false });
    return item?.stream ? new Response(item.stream).text() : null;
  }
  try {
    return await fs.readFile(path.join(IMG_DIR, `${id}.txt`), "utf8");
  } catch {
    return null;
  }
}

// Remote storage is billed per read. Screens poll often, so display reads share one copy for a few seconds.
// Writes (withDb) always read fresh and refresh this copy.
const READ_CACHE_MS = 3_000;
let cached: { at: number; db: Db } | null = null;

/** Read without the lock. May be a moment stale (a few seconds), which is fine for display and planning. */
export async function readDb(): Promise<Db> {
  if (!usingRedis() && !usingBlob()) return load();
  if (cached && Date.now() - cached.at < READ_CACHE_MS) return structuredClone(cached.db);
  const db = await load();
  cached = { at: Date.now(), db: structuredClone(db) };
  return db;
}

export const newId = () => crypto.randomUUID().slice(0, 8);
