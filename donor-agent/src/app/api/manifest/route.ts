import { NextRequest, NextResponse } from "next/server";
import { roleForKey } from "@/lib/auth";
import { readDb } from "@/lib/db";

/** The install manifest for the Home Screen app. Its start page contains the private key, so the app opens already signed in. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("k") ?? "";
  const role = roleForKey(key, (await readDb()).settings.teammateKeyVersion);
  if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(
    JSON.stringify({
      name: "Donor Desk",
      short_name: "Donor Desk",
      start_url: `/?k=${encodeURIComponent(key)}`,
      scope: "/",
      display: "standalone",
      background_color: "#f6f5f1",
      theme_color: "#1f6f5c",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } },
  );
}
