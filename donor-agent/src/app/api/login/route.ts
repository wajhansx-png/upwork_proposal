import { NextRequest, NextResponse } from "next/server";
import { COOKIE, COOKIE_MAX_AGE, makeToken, passwordMatches, teammateForKey } from "@/lib/auth";
import { readDb, withDb } from "@/lib/db";
import type { Role } from "@/lib/types";

const MAX_TRIES = 5;
const LOCK_MS = 15 * 60_000;

/** Teammate: sends her link key. Manager: sends the password. Five wrong passwords lock it for 15 minutes. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { key?: string; password?: string };
  let role: Role | null = null;
  let version = 1;
  try {
    const db = await readDb();
    version = db.settings.teammateKeyVersion;
    if (typeof body.password === "string") {
      const lock = db.agent.loginLockUntil ? new Date(db.agent.loginLockUntil).getTime() : 0;
      if (lock > Date.now())
        return NextResponse.json({ error: `Too many wrong tries. Wait ${Math.ceil((lock - Date.now()) / 60_000)} minutes.` }, { status: 429 });
      if (passwordMatches(body.password)) {
        role = "manager";
        if (db.agent.loginFails) await withDb((d) => { d.agent.loginFails = 0; d.agent.loginLockUntil = undefined; });
      } else {
        const fails = await withDb((d) => {
          d.agent.loginFails = (d.agent.loginFails ?? 0) + 1;
          if (d.agent.loginFails >= MAX_TRIES) {
            d.agent.loginLockUntil = new Date(Date.now() + LOCK_MS).toISOString();
            d.agent.loginFails = 0;
            return MAX_TRIES;
          }
          return d.agent.loginFails;
        });
        const left = MAX_TRIES - fails;
        return NextResponse.json(
          { error: left > 0 ? `Wrong password. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong password. Locked for 15 minutes." },
          { status: 401 },
        );
      }
    } else if (teammateForKey(String(body.key ?? "").trim(), version)) {
      role = "teammate";
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!role) return NextResponse.json({ error: "This link is not valid. Ask your manager for a new one." }, { status: 401 });
  const res = NextResponse.json({ role });
  res.cookies.set(COOKIE, makeToken(role, version), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
