"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./App";

interface Msg { id: string; title?: string; text: string; at: string; usedAt?: string; uses?: number }
interface View { items: Msg[]; caseName: string | null; caseText: string | null }

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

/**
 * Saved messages, one page for both. The manager writes or picks texts and saves them;
 * Areeba sees the same list, like a WhatsApp chat, and copies or shares them into the groups.
 */
export default function Saved() {
  const [manager, setManager] = useState(false);
  const [v, setV] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const loaded = useRef(false);
  const load = useCallback(async () => {
    try {
      setV(await api<View>("/api/saved"));
      loaded.current = true;
    } catch (e) {
      // A failed background refresh is not shown: the list stays, the next refresh tries again.
      if (!loaded.current) setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => {
      setManager(location.pathname.startsWith("/manager"));
      void load();
    }, 0);
    const id = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const call = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setErr("");
    try {
      setV(await api<View>("/api/saved", "POST", body));
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  const save = async (t: string, idea?: number) => {
    if (!(await call(`save${idea ?? ""}`, { action: "save", text: t, title: idea === undefined ? title : "" }))) return;
    setToast(`Saved. ${manager ? "Areeba can see it now." : ""}`);
    if (idea === undefined) {
      setText("");
      setTitle("");
    }
    else setIdeas((all) => all.filter((_, i) => i !== idea));
  };
  const getIdeas = async () => {
    setBusy("ideas");
    setErr("");
    try {
      setIdeas((await api<{ lines: string[] }>("/api/saved", "POST", { action: "lines" })).lines);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setToast("Copied. Paste it in the group.");
    } catch {
      prompt("Copy this text:", m.text);
    }
    if (!manager) void api("/api/saved", "POST", { action: "used", id: m.id }).catch(() => {});
  };
  const share = (m: Msg) => {
    if (!manager) void api("/api/saved", "POST", { action: "used", id: m.id }).catch(() => {});
  };

  const items = v?.items ?? [];
  return (
    <main className="wa wide">
      <header className="wa-top">
        <a href={manager ? "/manager" : "/areeba"} aria-label="Back">←</a>
        <span className="wa-av" aria-hidden>💬</span>
        <div>
          <b>Saved messages</b>
          <small>{manager ? "Areeba sees this same list" : "From your manager · for the groups"}</small>
        </div>
      </header>

      <div className="wa-body">
        {manager && (
          <section className="sv-new">
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Heading (optional), like: Yousuf – reminder 1" />
            <textarea value={text} rows={4} onChange={(e) => setText(e.target.value)} placeholder="Write or paste a message…" />
            <div className="sv-row">
              <button className="d-btn hot" disabled={!!busy || !text.trim()} onClick={() => void save(text)}>{busy === "save" ? "Saving…" : "Save"}</button>
              {v?.caseText && <button className="d-btn" disabled={!!busy} onClick={() => setText(v.caseText!)}>Use case post</button>}
              {v?.caseName && <button className="d-btn" disabled={!!busy} onClick={() => void getIdeas()}>{busy === "ideas" ? "Writing…" : "✨ 5 AI texts"}</button>}
            </div>
            {ideas.length > 0 && (
              <div className="sv-ideas">
                <p className="hint">AI texts for {v?.caseName}. Change any, then tap Save.</p>
                {ideas.map((t, i) => (
                  <div key={i} className="sv-idea">
                    <textarea value={t} rows={5} onChange={(e) => setIdeas((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button className="d-btn hot" disabled={!!busy || !t.trim()} onClick={() => void save(t, i)}>{busy === `save${i}` ? "Saving…" : "Save"}</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {v && !items.length && <p className="wa-sys">{manager ? "No saved messages yet. Write one above." : "No messages yet. Your manager will add them here."}</p>}
        {!manager && items.length > 0 && <p className="wa-sys">Copy a message and post it in all groups.</p>}

        <div className="sv-grid">
          {items.map((m) => {
            const isOpen = !!open[m.id];
            const long = m.text.split("\n").length > 2 || m.text.length > 110;
            return (
              <div key={m.id} className="wa-msg sv-card">
                {m.title && <b className="sv-title">{m.title}</b>}
                <p className={`wa-text ${isOpen ? "" : "clamp"}`}>{m.text}</p>
                {long && (
                  <button className="sv-more" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [m.id]: !isOpen }))}>
                    {isOpen ? "− Less" : "+ More"}
                  </button>
                )}
                <span className="wa-time">
                  {when(m.at)}
                  {manager && m.usedAt && <i className="wa-ticks"> · used by Areeba {when(m.usedAt)}</i>}
                </span>
                <div className="wa-actions">
                  <button onClick={() => void copy(m)}>Copy</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(m.text)}`} target="_blank" rel="noreferrer" onClick={() => share(m)}>Share</a>
                  {manager && <button disabled={!!busy} onClick={() => confirm("Delete this message? Areeba will not see it anymore.") && void call(`rm${m.id}`, { action: "remove", id: m.id })}>Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
        {err && <p className="wa-sys bad" onClick={() => setErr("")}>{err}</p>}
      </div>
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
