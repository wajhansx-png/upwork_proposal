"use client";

import { usePathname } from "next/navigation";

type Tab = { label: string; href: string };

const MANAGER: Tab[] = [
  { label: "Areeba", href: "/manager" },
  { label: "Cases", href: "/manager/case" },
  { label: "Donors", href: "/manager/donors" },
];
const TEAMMATE: Tab[] = [
  { label: "Home", href: "/areeba" },
  { label: "Messages", href: "/areeba/messages" },
  { label: "Donors", href: "/areeba/donors" },
];

/** The one top bar of the app (in the manager and Areeba layouts): the brand and the pages. The page you are on is marked. */
export default function TopNav({ who }: { who: "manager" | "teammate" }) {
  const path = usePathname() ?? "";
  const tabs = who === "manager" ? MANAGER : TEAMMATE;
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(`${t.href}/`))?.href;
  return (
    <nav className="tn" aria-label="Pages">
      <div className="tn-in">
        <a className="tn-brand" href={tabs[0].href} aria-label="GiveLife home">
          <span className="tn-logo" aria-hidden>G</span>
          <span className="tn-name">GiveLife</span>
        </a>
        <div className="tn-tabs">
          {tabs.map((t) => (
            <a key={t.href} href={t.href} className={t.href === active ? "on" : ""} aria-current={t.href === active ? "page" : undefined}>
              {t.label}
            </a>
          ))}
          {who === "manager" && (
            <a href="/manager?settings=1" className="tn-set" aria-label="Settings" title="Settings">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              <span>Settings</span>
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
