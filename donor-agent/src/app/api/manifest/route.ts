import { NextRequest, NextResponse } from "next/server";

/**
 * The install manifest for the Home Screen app.
 * Teammate: opens /areeba. Manager (?for=manager): opens /manager. Each has its own icon.
 */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const manager = q.get("for") === "manager";
  const start = manager ? "/manager" : "/areeba";
  const who = manager ? "manager" : "areeba";
  return new NextResponse(
    JSON.stringify({
      name: manager ? "Donor Desk Manager" : "Donor Desk",
      short_name: manager ? "Manager" : "Donor Desk",
      start_url: start,
      scope: "/",
      display: "standalone",
      background_color: "#080d0c",
      theme_color: "#080d0c",
      icons: [
        { src: `/icon-${who}-192.png`, sizes: "192x192", type: "image/png" },
        { src: `/icon-${who}-512.png`, sizes: "512x512", type: "image/png" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } },
  );
}
