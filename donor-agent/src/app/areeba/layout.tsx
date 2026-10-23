import type { Metadata } from "next";
import TopNav from "../TopNav";

// This folder's icon.svg and apple-icon.png are Areeba's own icon (the manager has a different one).
export const metadata: Metadata = {
  title: "Donor Desk",
  appleWebApp: { capable: true, title: "Donor Desk", statusBarStyle: "black" },
};

export default function AreebaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav who="teammate" />
      {children}
    </>
  );
}
