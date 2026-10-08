import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Role } from "./types";

/** Separate cookies, so the manager's page and Areeba's page can both be open in one browser. */
export const MANAGER_COOKIE = "dd_m";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Server secret. Signs the manager's session. */
function secret(): string {
  const k = process.env.MANAGER_KEY;
  if (k) {
    if (process.env.NODE_ENV === "production" && k.length < 20) throw new Error("MANAGER_KEY must be at least 20 characters");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("MANAGER_KEY is not set");
  return "manager-dev-key";
}

/** The code inside the manager's private link (/manager?k=CODE). */
function managerCode(): string {
  const c = process.env.MANAGER_LINK_CODE || process.env.MANAGER_PASSWORD;
  if (c) return c;
  if (process.env.NODE_ENV === "production") throw new Error("MANAGER_LINK_CODE is not set");
  return "manager";
}

const hmac = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");
const sha = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const codeMatches = (code: string) => timingSafeEqual(sha(code), sha(managerCode()));

/** Changes when the code changes, so old manager sessions end. */
const stamp = () => hmac(`code:${managerCode()}`).slice(0, 16);

export const managerToken = () => `manager.${stamp()}.${hmac(`session:manager:${stamp()}`)}`;

function isManager(req: NextRequest): boolean {
  const token = req.cookies.get(MANAGER_COOKIE)?.value;
  if (!token) return false;
  const [role, v, sig] = token.split(".");
  return role === "manager" && !!sig && v === stamp() && same(sig, hmac(`session:manager:${v}`));
}

/**
 * Who is calling. Each page says who it is (x-as header).
 * Areeba's page is open: no key needed. The manager needs his cookie from the private link.
 */
export async function getRole(req: NextRequest): Promise<Role | null> {
  const as = req.headers.get("x-as");
  if (as === "teammate") return "teammate";
  if (as === "manager") return isManager(req) ? "manager" : null;
  return isManager(req) ? "manager" : "teammate";
}
