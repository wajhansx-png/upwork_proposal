import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readDb } from "./db";
import type { Db, Role } from "./types";

export const COOKIE = "dd_session";
const YEAR = 60 * 60 * 24 * 365;
export const COOKIE_MAX_AGE = YEAR;

/** The manager's private link key. In production it must be set and long. */
function managerKey(): string {
  const k = process.env.MANAGER_KEY;
  if (k) {
    if (process.env.NODE_ENV === "production" && k.length < 20) throw new Error("MANAGER_KEY must be at least 20 characters");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("MANAGER_KEY is not set");
  return "manager-dev-key";
}

const hmac = (v: string) => createHmac("sha256", managerKey()).update(v).digest("hex");

/** The teammate's link key is derived from the manager key. Changing the version makes a new link. */
export const teammateKey = (version: number) => hmac(`teammate-link:${version}`).slice(0, 40);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function roleForKey(key: string, version: number): Role | null {
  if (!key) return null;
  if (same(key, managerKey())) return "manager";
  if (same(key, teammateKey(version))) return "teammate";
  return null;
}

export function makeToken(role: Role, version: number) {
  const v = role === "teammate" ? version : 0;
  return `${role}.${v}.${hmac(`session:${role}:${v}`)}`;
}

export interface Auth {
  role: Role;
  /** Loaded only for the teammate (to check the link version). */
  db?: Db;
}

/** Who is calling. The teammate's session ends when the manager makes a new link. */
export async function authenticate(req: NextRequest): Promise<Auth | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const [role, v, sig] = token.split(".");
  if ((role !== "manager" && role !== "teammate") || !sig) return null;
  if (!same(sig, hmac(`session:${role}:${v}`))) return null;
  if (role === "manager") return { role };
  const db = await readDb();
  if (Number(v) !== db.settings.teammateKeyVersion) return null;
  return { role, db };
}

export async function getRole(req: NextRequest): Promise<Role | null> {
  return (await authenticate(req))?.role ?? null;
}
