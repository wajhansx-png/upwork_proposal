import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Role } from "./types";

export const COOKIE = "da_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "dev-only-secret";
}

const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");

export function makeToken(role: Role) {
  return `${role}.${sign(role)}`;
}

export function roleFromRequest(req: NextRequest): Role | null {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const [role, sig] = token.split(".");
  if (role !== "manager" && role !== "teammate") return null;
  const good = Buffer.from(sign(role));
  const got = Buffer.from(sig ?? "");
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  return role;
}

/** Returns the role for a login code, or null if the code is wrong or unset. */
export function roleForCode(code: string): Role | null {
  const dev = process.env.NODE_ENV !== "production";
  const manager = process.env.MANAGER_CODE || (dev ? "manager" : "");
  const teammate = process.env.TEAMMATE_CODE || (dev ? "teammate" : "");
  const eq = (a: string, b: string) =>
    !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (eq(code, manager)) return "manager";
  if (eq(code, teammate)) return "teammate";
  return null;
}
