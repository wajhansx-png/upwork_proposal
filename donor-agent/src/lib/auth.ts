import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readDb } from "./db";
import type { Db, Role } from "./types";

export const COOKIE = "dd_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Server secret. Signs sessions and makes the teammate's link. In production it must be set and long. */
function secret(): string {
  const k = process.env.MANAGER_KEY;
  if (k) {
    if (process.env.NODE_ENV === "production" && k.length < 20) throw new Error("MANAGER_KEY must be at least 20 characters");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("MANAGER_KEY is not set");
  return "manager-dev-key";
}

/** The manager's password. Set MANAGER_PASSWORD. Never stored in the code. */
function password(): string {
  const p = process.env.MANAGER_PASSWORD;
  if (p) return p;
  if (process.env.NODE_ENV === "production") throw new Error("MANAGER_PASSWORD is not set");
  return "manager";
}

const hmac = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");
const sha = (v: string) => createHash("sha256").update(v).digest();

/** The teammate's link key. Changing the version makes a new link. */
export const teammateKey = (version: number) => hmac(`teammate-link:${version}`).slice(0, 40);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Only the teammate signs in with a link. The manager uses the password. */
export function teammateForKey(key: string, version: number): boolean {
  return !!key && same(key, teammateKey(version));
}

export function passwordMatches(pw: string): boolean {
  return timingSafeEqual(sha(pw), sha(password()));
}

/** Changes when the password changes, so old manager sessions end. */
const passwordStamp = () => hmac(`pw:${password()}`).slice(0, 16);

export function makeToken(role: Role, version: number) {
  const v = role === "teammate" ? String(version) : passwordStamp();
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
  if ((role !== "manager" && role !== "teammate") || !sig || !v) return null;
  if (!same(sig, hmac(`session:${role}:${v}`))) return null;
  if (role === "manager") return v === passwordStamp() ? { role } : null;
  const db = await readDb();
  if (Number(v) !== db.settings.teammateKeyVersion) return null;
  return { role, db };
}

export async function getRole(req: NextRequest): Promise<Role | null> {
  return (await authenticate(req))?.role ?? null;
}
