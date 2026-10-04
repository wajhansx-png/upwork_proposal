import { NextRequest, NextResponse } from "next/server";
import { COOKIE, COOKIE_MAX_AGE, makeToken, roleForKey } from "@/lib/auth";
import { readDb } from "@/lib/db";

/** Exchanges the private link key for a one-year cookie. Nobody types a password. */
export async function POST(req: NextRequest) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  let role;
  let version = 1;
  try {
    version = (await readDb()).settings.teammateKeyVersion;
    role = roleForKey(String(key ?? "").trim(), version);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!role) return NextResponse.json({ error: "This link is not valid." }, { status: 401 });
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
