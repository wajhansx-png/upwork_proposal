import { NextRequest, NextResponse } from "next/server";
import { teammateForKey } from "@/lib/auth";
import { readDb } from "@/lib/db";

/**
 * The install manifest for the Home Screen app.
 * Teammate: the start page carries her key, so the app opens signed in.
 * Manager (?for=manager): opens /manager, which asks for the password once.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let start: string;
  if (q.get("for") === "manager") start = "/manager";
  else {
    const key = q.get("k") ?? "";
    if (!teammateForKey(key, (await readDb()).settings.teammateKeyVersion)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    start = `/?k=${encodeURIComponent(key)}`;
  }
  return new NextResponse(
    JSON.stringify({
      name: "Donor Desk",
      short_name: "Donor Desk",
      start_url: start,
      scope: "/",
      display: "standalone",
      background_color: "#f3f5f3",
      theme_color: "#1f6f5c",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } },
  );
}
