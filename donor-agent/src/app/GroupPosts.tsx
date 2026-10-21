"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./App";

interface Item { id: string; n: number; kind: "case" | "line"; text: string; sentAt: string; doneAt?: string }
interface View { caseName: string | null; items: Item[]; next: string | null }

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Areeba's group messages, shown like a WhatsApp chat. She sees a text only when its time comes. */
export default function GroupPosts() {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const count = v?.items.length ?? 0;

  const load = useCallback(async () => {
    try {
      setV(await api<View>("/api/groups"));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 20_000);
    const back = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
    };
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied. Paste it in each group.");
    } catch {
      prompt("Copy this text:", text);
    }
  };
  const posted = async (id: string) => {
    setBusy(id);
    try {
      setV(await api<View>("/api/groups", "POST", { action: "posted", id }));
      setToast("Great. Marked as posted ✓");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="wa">
      <header className="wa-top">
        <a href="/areeba" aria-label="Back">←</a>
        <span className="wa-av" aria-hidden>📢</span>
        <div>
          <b>Group posts</b>
          <small>{v?.caseName ? `GiveLife · ${v.caseName}'s case` : "GiveLife Foundation"}</small>
        </div>
      </header>
      <div className="wa-body">
        <p className="wa-sys">Post each message in ALL groups, then tap “I posted it”.</p>
        {v && !v.items.length && <p className="wa-sys">No group message yet. You will get a notification when it is time.</p>}
        {v?.items.map((m) => (
          <div key={m.id} className={`wa-msg ${m.doneAt ? "done" : ""}`}>
            <span className="wa-tag">{m.kind === "case" ? "📢 Full case · post in all groups" : `💬 Message ${m.n} · post in all groups`}</span>
            <p className="wa-text">{m.text}</p>
            <span className="wa-time">{hhmm(m.sentAt)}{m.doneAt && <i className="wa-ticks"> ✓✓</i>}</span>
            {m.doneAt ? (
              <p className="wa-ok">Posted at {hhmm(m.doneAt)} ✓</p>
            ) : (
              <div className="wa-actions">
                <button onClick={() => void copy(m.text)}>Copy</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(m.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                <button className="wa-done" disabled={busy === m.id} onClick={() => void posted(m.id)}>{busy === m.id ? "…" : "I posted it ✓"}</button>
              </div>
            )}
          </div>
        ))}
        {v?.next && <p className="wa-sys">Next message at {hhmm(v.next)}</p>}
        {err && <p className="wa-sys bad" onClick={() => setErr("")}>{err}</p>}
        <div ref={end} />
      </div>
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
