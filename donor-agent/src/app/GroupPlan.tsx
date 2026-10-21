"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./App";

interface Item { id: string; n: number; kind: "case" | "line"; text: string; at: string; sentAt?: string; doneAt?: string; preview: string; state: "planned" | "waiting" | "posted" }
interface View { caseName: string | null; amountLeft?: number; payLine?: string; items: Item[] }

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** A time for <input type="datetime-local">, in this phone's own time. */
const toLocal = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (s: string) => new Date(s).toISOString();
const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "Today" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const nextSlot = (items: Item[]) => {
  const last = items.reduce((m, i) => Math.max(m, new Date(i.at).getTime()), 0);
  // 2 hours after the last message, or 10 minutes from now for the first one. Rounded to 5 minutes.
  const t = last ? Math.max(last + 2 * HOUR, Date.now() + 10 * 60_000) : Date.now() + 10 * 60_000;
  return Math.ceil(t / 300_000) * 300_000;
};

/** The manager's group plan: the case first, then emotional texts, each with a time. Areeba gets each one at its time. */
export default function GroupPlan({ name }: { name: string }) {
  const [v, setV] = useState<View | null>(null);
  const [at, setAt] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [linesBy, setLinesBy] = useState("");
  const [own, setOwn] = useState("");
  const [showOwn, setShowOwn] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const apply = useCallback((d: View) => {
    setV(d);
    setAt(toLocal(nextSlot(d.items)));
  }, []);
  const load = useCallback(async () => {
    try {
      const d = await api<View>("/api/groups");
      setV(d);
      setAt((cur) => cur || toLocal(nextSlot(d.items)));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setErr("");
    try {
      apply(await api<View>("/api/groups", "POST", body));
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  const write = async () => {
    setBusy("lines");
    setErr("");
    try {
      const r = await api<{ lines: string[]; by: string }>("/api/groups", "POST", { action: "lines" });
      setLines(r.lines);
      setLinesBy(r.by === "ai" ? "Written by AI. The app removed any text with made-up facts." : "AI did not answer, so these are ready-made texts.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const addLine = async (text: string, i?: number) => {
    if (await run(`add${i ?? "own"}`, { action: "add", kind: "line", text, at: fromLocal(at) })) {
      if (i === undefined) {
        setOwn("");
        setShowOwn(false);
      }
      else setLines((l) => l.filter((_, j) => j !== i));
    }
  };

  if (!v) return <p className="hint">{err || "Loading…"}</p>;
  const hasCase = v.items.some((i) => i.kind === "case" && i.state !== "posted");
  const stateText = (i: Item) => (i.state === "posted" ? `✓ Posted · ${when(i.doneAt!)}` : i.state === "waiting" ? `⏳ With ${name} · not posted yet` : `🕒 ${when(i.at)}`);
  return (
    <section className="gp">
      <p className="gp-how">At each time, {name} gets a notification with the text. She posts it in all groups and taps <b>Done</b>.</p>
      {err && <p className="err" onClick={() => setErr("")}>{err}</p>}

      <h3 className="gp-h">Schedule</h3>
      {v.items.length === 0 ? (
        <p className="gp-empty">Nothing yet. Add messages below.</p>
      ) : (
        <ol className="gp-list">
          {v.items.map((i) => (
            <li key={i.id} className={i.state}>
              <div className="gp-head">
                <b>{i.kind === "case" ? "📄 Case post" : "💬 Short text"}</b>
                <span className={`gp-state ${i.state}`}>{stateText(i)}</span>
              </div>
              <pre className={`gp-text ${i.kind === "case" ? "clip" : ""}`}>{i.preview}</pre>
              {i.state === "planned" && (
                <div className="gp-row">
                  <input type="datetime-local" aria-label="Change time" defaultValue={toLocal(new Date(i.at).getTime())} onBlur={(e) => e.target.value && fromLocal(e.target.value) !== i.at && void run(`at${i.id}`, { action: "edit", id: i.id, at: fromLocal(e.target.value) })} />
                  <button className="d-btn" disabled={!!busy} onClick={() => void run(`now${i.id}`, { action: "now", id: i.id })}>Send now</button>
                  <button className="text-btn" disabled={!!busy} onClick={() => void run(`rm${i.id}`, { action: "remove", id: i.id })}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <h3 className="gp-h">Add a message</h3>
      <div className="gp-add">
        <label className="gp-step"><span>1</span> When should {name} get it?</label>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        <label className="gp-step"><span>2</span> What should she post?</label>
        {!hasCase && (
          <button className="d-btn hot" disabled={!!busy || !at} onClick={() => void run("case", { action: "add", kind: "case", at: fromLocal(at) })}>📄 Add the case post</button>
        )}
        <button className="d-btn" disabled={!!busy} onClick={() => void write()}>{busy === "lines" ? "Writing…" : lines.length ? "✨ Show 5 other texts" : "✨ Get 5 short texts from AI"}</button>
        {lines.length > 0 && (
          <>
            <p className="hint">Pick one, change it if you want, tap Add. The app puts this at the end: <i>{v.payLine}</i></p>
            {lines.map((l, i) => (
              <div key={i} className="gp-line">
                <textarea value={l} rows={4} onChange={(e) => setLines((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
                <button className="d-btn hot" disabled={!!busy || !at || !l.trim()} onClick={() => void addLine(l, i)}>{busy === `add${i}` ? "Adding…" : "Add"}</button>
              </div>
            ))}
            {linesBy && <p className="hint small">{linesBy}</p>}
          </>
        )}
        {showOwn ? (
          <div className="gp-line">
            <textarea value={own} rows={3} autoFocus onChange={(e) => setOwn(e.target.value)} placeholder={"He is still waiting.\nBe the one who helps today."} />
            <button className="d-btn hot" disabled={!!busy || !own.trim() || !at} onClick={() => void addLine(own)}>Add</button>
          </div>
        ) : (
          <button className="d-btn" onClick={() => setShowOwn(true)}>✍️ Write my own text</button>
        )}
      </div>
    </section>
  );
}
