"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { linesOf, waFormat, type WaNode } from "@/lib/wa-format";

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

/** The lines he selected on the preview, and where (to place the small edit box). */
export type Picked = { from: number; to: number; rect: DOMRect };

/**
 * The message as it will look in WhatsApp: a green bubble on the chat background, bold / italic / strike / mono shown,
 * line breaks kept. It always fits the box without scrolling: the text shrinks (15 → 11 px); a very long message
 * then flows into two columns and shrinks again (down to 10 px). Selecting words picks their whole lines (onPick).
 */
export default function WaPreview({ text, onPick }: { text: string; onPick?: (p: Picked) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = bubble.current;
    if (!outer || !inner) return;
    const over = () => outer.scrollHeight > outer.clientHeight + 1;
    const shrink = (from: number, to: number) => {
      let size = from;
      inner.style.fontSize = `${size}px`;
      while (size > to && over()) {
        size -= 0.5;
        inner.style.fontSize = `${size}px`;
      }
    };
    const fit = () => {
      inner.classList.remove("cols");
      shrink(window.innerWidth < 760 ? 13 : 15, 11);
      // Phones scroll the page instead (the box grows), so this only happens on a computer screen.
      if (over()) {
        inner.classList.add("cols");
        shrink(14, 10);
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(outer);
    return () => watch.disconnect();
  }, [text]);
  const pick = () => {
    const sel = window.getSelection();
    if (!onPick || !sel || sel.isCollapsed || !bubble.current?.contains(sel.anchorNode)) return;
    const r = linesOf(text, sel.toString());
    if (r) onPick({ ...r, rect: sel.getRangeAt(0).getBoundingClientRect() });
  };
  return (
    <div className="wa-chat" ref={box} aria-label="How it looks in WhatsApp">
      <div className="wa-bubble" ref={bubble} onMouseUp={pick} onTouchEnd={() => setTimeout(pick, 50)}>{nodes(waFormat(text))}</div>
    </div>
  );
}

/** A small piece of WhatsApp text with its formatting (for the 5 versions list). */
export function WaPreviewLine({ text }: { text: string }) {
  return <span className="wa-line">{nodes(waFormat(text))}</span>;
}
