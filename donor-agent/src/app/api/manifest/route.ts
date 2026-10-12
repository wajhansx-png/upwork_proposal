import { NextRequest, NextResponse } from "next/server";

/**
 * The install manifest for the Home Screen app.
 * Teammate: the start page carries her key, so the app opens signed in.
 * Manager (?for=manager): opens /manager, which asks for the password once.
 */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const start = q.get("for") === "manager" ? "/manager" : "/areeba";
  return new NextResponse(
    JSON.stringify({
      name: "Donor Desk",
      short_name: "Donor Desk",
      start_url: start,
      scope: "/",
      display: "standalone",
      background_color: "#080d0c",
      theme_color: "#080d0c",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } },
  );
}
