import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { kvGetImage } from "@/lib/db";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getRole(req))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { id } = await ctx.params;
  const url = await kvGetImage(id);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(url);
  if (!m) return NextResponse.json({ error: "Bad image" }, { status: 500 });
  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: { "content-type": m[1], "cache-control": "private, max-age=31536000, immutable" },
  });
}
