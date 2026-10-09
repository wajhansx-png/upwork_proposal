"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The base face, from what is really happening. */
export type Mood = "sleep" | "idle" | "worried" | "think" | "happy";
/** A short reaction (1–2 s) to a real event. */
export type BotEvent = "wave" | "jump" | "cheer" | "star" | "party" | "hello" | "tickle";

const EVENT_MS: Record<BotEvent, number> = { wave: 1400, jump: 900, cheer: 1500, star: 1300, party: 2200, hello: 1800, tickle: 700 };
const CONFETTI = ["#55d1ac", "#ff8fb1", "#ffd166", "#7aa2ff", "#ff5c93", "#9be7c4"];

/** Fire reactions and speech bubbles. Each call restarts the animation, even for the same kind. */
export function useBot() {
  const [event, setEvent] = useState<{ kind: BotEvent; id: number } | null>(null);
  const [bubble, setBubble] = useState<{ text: string; id: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const fire = useCallback((kind: BotEvent, say?: string) => {
    const id = Date.now() + Math.random();
    setEvent({ kind, id });
    timers.current.push(setTimeout(() => setEvent((e) => (e?.id === id ? null : e)), EVENT_MS[kind]));
    if (kind === "cheer" || kind === "party" || kind === "star") navigator.vibrate?.([12, 40, 12]);
    if (say) {
      setBubble({ text: say, id });
      timers.current.push(setTimeout(() => setBubble((b) => (b?.id === id ? null : b)), Math.max(2600, say.length * 70)));
    }
  }, []);
  return { event, bubble, fire };
}

/** Pick one line at random, so the cheers stay fresh. */
export const oneOf = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

export function Bot({ mood, bot, size = 46, combo = 0, onTap, side = "right" }: { mood: Mood; bot: ReturnType<typeof useBot>; size?: number; combo?: number; onTap?: () => void; side?: "right" | "left" }) {
  const ev = bot.event?.kind;
  const face: Mood | "joy" | "look" = ev === "jump" || ev === "cheer" || ev === "party" || ev === "star" || ev === "tickle" || ev === "wave" ? "joy" : ev === "hello" ? "look" : mood;
  const closed = face === "sleep";
  const smiley = face === "joy" || face === "happy";
  return (
    <div className={`bot-wrap ${side}`} style={{ width: size, height: size }}>
      <button
        type="button"
        aria-label="Teddy"
        className={`bot mood-${mood} ${ev ? `ev-${ev}` : ""}`}
        key={`e${bot.event?.id ?? "base"}`}
        onClick={onTap}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
          <defs>
            <radialGradient id="bfur" cx="45%" cy="38%" r="65%"><stop offset="0" stopColor="#dca676" /><stop offset="1" stopColor="#a86a3f" /></radialGradient>
            <radialGradient id="bsnout" cx="50%" cy="40%" r="60%"><stop offset="0" stopColor="#fbe6cf" /><stop offset="1" stopColor="#ecc9a4" /></radialGradient>
          </defs>
          <g className="bot-body">
            <circle cx="30" cy="36" r="17" fill="url(#bfur)" /><circle cx="90" cy="36" r="17" fill="url(#bfur)" />
            <circle cx="30" cy="37" r="9" fill="#f3b9a6" /><circle cx="90" cy="37" r="9" fill="#f3b9a6" />
            <ellipse cx="60" cy="66" rx="38" ry="35" fill="url(#bfur)" />
            <ellipse cx="60" cy="80" rx="17" ry="13" fill="url(#bsnout)" />
            {/* eyes */}
            {closed ? (
              <g stroke="#2b1a12" strokeWidth="3.5" fill="none" strokeLinecap="round"><path d="M40 62 q6 5 12 0" /><path d="M68 62 q6 5 12 0" /></g>
            ) : smiley ? (
              <g stroke="#2b1a12" strokeWidth="4" fill="none" strokeLinecap="round"><path d="M40 64 q6 -8 12 0" /><path d="M68 64 q6 -8 12 0" /></g>
            ) : (
              <g className="bot-eyes">
                <g className={face === "look" ? "eyes-look" : face === "think" ? "eyes-up" : ""}>
                  <ellipse cx="46" cy="62" rx="5.2" ry="6.2" fill="#2b1a12" /><ellipse cx="74" cy="62" rx="5.2" ry="6.2" fill="#2b1a12" />
                  <circle cx="47.8" cy="59.6" r="1.9" fill="#fff" /><circle cx="75.8" cy="59.6" r="1.9" fill="#fff" />
                </g>
                {face === "worried" && <g stroke="#2b1a12" strokeWidth="3" strokeLinecap="round"><path d="M39 50 l12 4" /><path d="M81 50 l-12 4" /></g>}
              </g>
            )}
            <ellipse cx="36" cy="75" rx="6.5" ry="4" fill="#ff8fb1" opacity={smiley ? 0.85 : 0.5} /><ellipse cx="84" cy="75" rx="6.5" ry="4" fill="#ff8fb1" opacity={smiley ? 0.85 : 0.5} />
            <ellipse cx="60" cy="75" rx="5.5" ry="4" fill="#3a2418" />
            {/* mouth */}
            {smiley ? (
              <path d="M51 82 q9 11 18 0 z" fill="#7a2e2e" stroke="#3a2418" strokeWidth="2" strokeLinejoin="round" />
            ) : face === "worried" || face === "look" ? (
              <ellipse cx="60" cy="85" rx="3.2" ry="3.6" fill="#3a2418" />
            ) : face === "think" ? (
              <path d="M54 85 h10" stroke="#3a2418" strokeWidth="2.4" strokeLinecap="round" />
            ) : face === "sleep" ? (
              <path d="M56 84 q4 3 8 0" stroke="#3a2418" strokeWidth="2" fill="none" strokeLinecap="round" />
            ) : (
              <path d="M60 79 v3.5 M60 82.5 q-5 4.5 -9 1 M60 82.5 q5 4.5 9 1" stroke="#3a2418" strokeWidth="2" fill="none" strokeLinecap="round" />
            )}
            {/* bow */}
            <g transform="translate(92 26) rotate(18)">
              <path d="M0 0 C-14 -10 -16 8 0 2 Z" fill="#ff5c93" /><path d="M0 0 C14 -10 16 8 0 2 Z" fill="#ff5c93" /><circle cx="0" cy="1" r="3.4" fill="#ff8fb1" />
            </g>
          </g>
          {/* paw: waves hello, taps the glass */}
          {(ev === "wave" || ev === "hello" || ev === "cheer") && <g className="bot-paw"><circle cx="104" cy="88" r="11" fill="url(#bfur)" /><circle cx="104" cy="90" r="5" fill="#f3b9a6" /></g>}
          {mood === "worried" && !ev && <path className="bot-sweat" d="M95 48 q5 8 0 12 q-5 -4 0 -12 z" fill="#8fd3ff" />}
        </svg>
        {mood === "sleep" && !ev && <span className="bot-zzz" aria-hidden>z<i>z</i><b>z</b></span>}
        {mood === "think" && !ev && <span className="bot-dots" aria-hidden><i /><i /><i /></span>}
        {ev === "jump" && <span className="bot-hearts" aria-hidden><i>♥</i><i>♥</i><i>♥</i></span>}
        {ev === "star" && <span className="bot-star" aria-hidden>★</span>}
        {combo >= 2 && <span className="bot-combo" key={combo}>🔥×{combo}</span>}
      </button>
      {bot.bubble && <div className={`bot-bubble ${side}`} key={`b${bot.bubble.id}`} role="status">{bot.bubble.text}</div>}
      {ev === "party" && (
        <div className="bot-confetti" aria-hidden key={`c${bot.event?.id}`}>
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 6) * 0.07}s`, transform: `rotate(${i * 29}deg)` }} />
          ))}
        </div>
      )}
    </div>
  );
}
