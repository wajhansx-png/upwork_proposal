import type { Metadata, Viewport } from "next";
import "./legacy.css";

export const metadata: Metadata = {
  title: "Proposal Studio",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: { capable: true, title: "Proposals" },
};

export const viewport: Viewport = {
  themeColor: "#17915A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
