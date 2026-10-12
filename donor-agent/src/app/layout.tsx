import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Donor Desk",
  description: "Donor outreach tracker with an agent that checks in for you.",
  appleWebApp: { capable: true, title: "Donor Desk", statusBarStyle: "black" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#080d0c", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
