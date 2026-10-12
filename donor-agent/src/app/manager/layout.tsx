import type { Metadata } from "next";

// This folder's icon.svg and apple-icon.png are the manager's own icon (Areeba has a different one).
export const metadata: Metadata = {
  title: "Donor Desk Manager",
  appleWebApp: { capable: true, title: "Manager", statusBarStyle: "black" },
};

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
