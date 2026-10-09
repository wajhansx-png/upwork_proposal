import { NextRequest, NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { codeMatches, COOKIE_MAX_AGE, MANAGER_COOKIE, managerToken } from "@/lib/auth";
import { readDb, withDb } from "@/lib/db";

const MAX_TRIES = 5;
const LOCK_MS = 15 * 60_000;

/** The manager opens /manager?k=CODE once. Five wrong codes lock it for 15 minutes. */
export async function POST(req: NextRequest) {
  const body = await readBody<{ code: string }>(req);
  try {
    const db = await readDb();
    const lock = db.agent.loginLockUntil ? new Date(db.agent.loginLockUntil).getTime() : 0;
    if (lock > Date.now()) return NextResponse.json({ error: "Too many wrong tries. Wait 15 minutes." }, { status: 429 });
    if (typeof body.code !== "string" || !codeMatches(body.code)) {
      await withDb((d) => {
        d.agent.loginFails = (d.agent.loginFails ?? 0) + 1;
        if (d.agent.loginFails >= MAX_TRIES) {
          d.agent.loginLockUntil = new Date(Date.now() + LOCK_MS).toISOString();
          d.agent.loginFails = 0;
        }
      });
      return NextResponse.json({ error: "This link is not valid." }, { status: 401 });
    }
    if (db.agent.loginFails) await withDb((d) => { d.agent.loginFails = 0; d.agent.loginLockUntil = undefined; });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const res = NextResponse.json({ role: "manager" });
  res.cookies.set(MANAGER_COOKIE, managerToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
