"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brain, BrainOut } from "@/lib/types";
import { api } from "./App";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const KIND: Record<BrainOut["kind"], string> = { update: "UPDATE", short: "20 MIN", "dry-main": "DRY · main group", "dry-groups": "DRY · freelancer groups", done: "DONE" };

/** The Case Brain: setup, the 4 commands, and every message it wrote (newest first). */
export default function CaseBrain() {
  const [b, setB] = useState<Brain | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [setup, setSetup] = useState(false);
  const [form, setForm] = useState({ name: "", age: "", gender: "m", total: "", facts: "" });
  const [cmd, setCmd] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ brain: Brain | null }>("/api/brain");
      setB(r.brain);
      if (!r.brain) setSetup(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const start = async () => {
    setBusy("setup");
    setErr("");
    try {
      const r = await api<{ brain: Brain }>("/api/brain", "POST", { action: "setup", ...form });
      setB(r.brain);
      setSetup(false);
      setReply("Ready. Send me LEFT [amount].");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(text);
    setErr("");
    setReply("");
    try {
      const r = await api<{ brain: Brain; reply?: string; outputs: BrainOut[] }>("/api/brain", "POST", { action: "cmd", text });
      setB(r.brain);
      setReply(r.reply ?? (r.outputs.length > 1 ? `${r.outputs.length} messages below.` : ""));
      setCmd("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setToast("Copied.");
    } catch {
      prompt("Copy this text:", t);
    }
  };
  const keep = async (o: BrainOut) => {
    try {
      await api("/api/saved", "POST", { action: "save", title: `${b?.name ?? "Case"} – ${KIND[o.kind]} ${hhmm(o.at)}`, text: o.text });
      setToast("Saved to Messages. Areeba can see it.");
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const left = b?.left;
  const p2 = left !== undefined ? Math.ceil(left / 2000) : 0;
  const p1 = left !== undefined ? Math.ceil(left / 1000) : 0;
  const outs = [...(b?.history ?? [])].reverse();
  return (
    <main className="wa wide">
      <header className="wa-top">
        <a href="/manager/messages" aria-label="Back">←</a>
        <span className="wa-av" aria-hidden>🧠</span>
        <div>
          <b>Case Brain</b>
          <small>{b ? `${b.name} · Rs. ${money(b.total)} total` : "Writes the next message. You send it."}</small>
        </div>
      </header>
      <div className="wa-body">
        {setup ? (
          <section className="sv-new cb-setup">
            <b>New case</b>
            <p className="hint">Only the facts you write here are used. Nothing is added.</p>
            <div className="cb-two">
              <input placeholder="Child's name (Yousuf)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Age (2)" inputMode="numeric" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            </div>
            <div className="cb-two">
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="m">Boy</option><option value="f">Girl</option></select>
              <input placeholder="Total (70000)" inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </div>
            <textarea rows={6} value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} placeholder={"Facts, one per line:\nFluid is filling his brain\nHis head is swollen\nBoth his kidneys are badly swollen\nHe has a hernia\nHis blood was so weak he needed a transfusion"} />
            <div className="sv-row">
              <button className="d-btn hot" disabled={busy === "setup"} onClick={() => void start()}>{busy === "setup" ? "Starting…" : "Start this case"}</button>
              {b && <button className="d-btn" onClick={() => setSetup(false)}>Cancel</button>}
            </div>
          </section>
        ) : (
          b && (
            <>
              <section className="cb-status">
                <div><b>{left !== undefined ? `Rs. ${money(left)}` : "—"}</b><span>left</span></div>
                <div><b>{left !== undefined ? p2 : "—"}</b><span>at Rs. 2,000</span></div>
                <div><b>{left !== undefined ? p1 : "—"}</b><span>at Rs. 1,000</span></div>
                <div><b>{b.angles.length}/10</b><span>angles used</span></div>
              </section>
              <form className="cb-cmd" onSubmit={(e) => { e.preventDefault(); void send(/^\d/.test(cmd.trim()) ? `LEFT ${cmd}` : cmd); }}>
                <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Amount left, like 44000 (or type 20 MIN, DRY, DONE)" inputMode="text" />
                <button className="d-btn hot" disabled={!!busy || !cmd.trim()}>{busy && busy === (/^\d/.test(cmd.trim()) ? `LEFT ${cmd}` : cmd) ? "…" : "LEFT"}</button>
              </form>
              <div className="cb-btns">
                <button className="d-btn" disabled={!!busy} onClick={() => void send("20 MIN")}>{busy === "20 MIN" ? "Writing…" : "⏱ 20 MIN"}</button>
                <button className="d-btn" disabled={!!busy} onClick={() => void send("DRY")}>{busy === "DRY" ? "Writing…" : "🏜 DRY"}</button>
                <button className="d-btn" disabled={!!busy} onClick={() => confirm(`Is ${b.name}'s case complete?`) && void send("DONE")}>{busy === "DONE" ? "Writing…" : "✅ DONE"}</button>
              </div>
              <label className="cb-ai">
                <input type="checkbox" checked={!b.noAi} disabled={!!busy} onChange={async (e) => setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "ai", on: e.target.checked })).brain)} />
                <span>AI wording {b.noAi ? "OFF: only ready lines in your style (100% safe)." : "ON: fresh words each time. It can still add a small detail that is not a fact, so read before you send."}</span>
              </label>
              {reply && <p className="cb-reply">{reply}</p>}
              <div className="sv-grid">
                {outs.map((o, i) => (
                  <div key={`${o.at}-${i}`} className={`wa-msg sv-card ${i === 0 ? "focus" : ""}`}>
                    <span className="sv-now">{KIND[o.kind]} · {hhmm(o.at)}</span>
                    <p className="cb-do"><b>DO:</b> {o.do}</p>
                    <p className="wa-text">{o.text}</p>
                    <div className="wa-actions">
                      <button onClick={() => void copy(o.text)}>Copy</button>
                      <a href={`https://wa.me/?text=${encodeURIComponent(o.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                      <button onClick={() => void keep(o)}>Save to Messages</button>
                    </div>
                  </div>
                ))}
              </div>
              {!outs.length && <p className="wa-sys">Send me LEFT [amount] to start.</p>}
              <button className="text-btn cb-new" onClick={() => { setForm({ name: "", age: "", gender: "m", total: "", facts: "" }); setSetup(true); }}>Start a new case</button>
            </>
          )
        )}
        {!loaded && <p className="wa-sys">Loading…</p>}
        {err && <p className="wa-sys bad" onClick={() => setErr("")}>{err}</p>}
      </div>
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
