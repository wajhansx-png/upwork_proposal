import { NextResponse } from "next/server";
import { MANAGER_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(MANAGER_COOKIE);
  return res;
}
