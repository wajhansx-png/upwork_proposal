"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { waFormat, type WaNode } from "@/lib/wa-format";

function nodes(list: WaNode[]): ReactNode[] {
  return list.map((n, i) => {
    switch (n.t) {
      case "text": return n.v;
      case "br": return <br key={i} />;
      case "b": return <b key={i}>{nodes(n.c)}</b>;
      case "i": return <i key={i}>{nodes(n.c)}</i>;
      case "s": return <s key={i}>{nodes(n.c)}</s>;
      case "m": return <code key={i}>{nodes(n.c)}</code>;
      case "block": return <pre key={i}>{n.v}</pre>;
      case "bullet": return <span key={i} className="wa-li">{nodes(n.c)}</span>;
    }
  });
}

/**
 * The message as it will look in WhatsApp: a green bubble on the chat background, bold / italic / strike / mono shown,
 * line breaks kept. The text shrinks by itself (never below 11 px) until the whole message fits the box, so it is read without scrolling.
 */
export default function WaPreview({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = bubble.current;
    if (!outer || !inner) return;
    const fit = () => {
      let size = window.innerWidth < 760 ? 13 : 15;
      inner.style.fontSize = `${size}px`;
      while (size > 11 && outer.scrollHeight > outer.clientHeight) {
        size -= 0.5;
        inner.style.fontSize = `${size}px`;
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(outer);
    return () => watch.disconnect();
  }, [text]);
  return (
    <div className="wa-chat" ref={box} aria-label="How it looks in WhatsApp">
      <div className="wa-bubble" ref={bubble}>{nodes(waFormat(text))}</div>
    </div>
  );
}
