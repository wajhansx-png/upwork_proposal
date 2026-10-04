import { NextRequest, NextResponse } from "next/server";
import { COOKIE, makeToken, roleForCode } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const role = roleForCode(String(code ?? "").trim());
  if (!role) return NextResponse.json({ error: "Wrong code" }, { status: 401 });
  const res = NextResponse.json({ role });
  res.cookies.set(COOKIE, makeToken(role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
