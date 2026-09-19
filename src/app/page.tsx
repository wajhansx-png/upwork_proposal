import Script from "next/script";
import { LEGACY_MARKUP } from "./legacy-markup";

export default function Home() {
  return (
    <>
      <div id="app" dangerouslySetInnerHTML={{ __html: LEGACY_MARKUP }} />
      <Script src="/legacy-app.js" strategy="afterInteractive" />
    </>
  );
}
