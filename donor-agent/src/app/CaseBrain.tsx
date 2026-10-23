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
  const [form, setForm] = useState({ name: "", age: "", gender: "m", total: "", facts: "", text: "" });
  const [paste, setPaste] = useState("");
  const [byHand, setByHand] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
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

  const started = (nb: Brain) => {
    setB(nb);
    setSetup(false);
    setByHand(false);
    setCmd(String(nb.total));
    setReply("Ready. The amount from your post is in the box: tap LEFT, or change it first.");
  };
  const start = async () => {
    setBusy("setup");
    setErr("");
    try {
      started((await api<{ brain: Brain }>("/api/brain", "POST", { action: "setup", ...form })).brain);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  type Read = { name: string; age?: number; ageLabel?: string; gender: string; total?: number; facts: string[] };
  const toForm = (r: Read, text: string) => ({ name: r.name, age: r.ageLabel ?? (r.age ? String(r.age) : ""), gender: r.gender, total: r.total ? String(r.total) : "", facts: r.facts.join("\n"), text });
  const read = async () => {
    setBusy("paste");
    setErr("");
    try {
      started((await api<{ brain: Brain }>("/api/brain", "POST", { action: "paste", text: paste })).brain);
      setPaste("");
    } catch (e) {
      const data = e as Error & { status?: number; data?: { read?: Read } };
      setErr(data.message);
      if (data.status === 422) {
        // Some things were not found: show the form with what was read, so he fills only the gaps.
        if (data.data?.read) setForm(toForm(data.data.read, paste));
        setByHand(true);
      }
    } finally {
      setBusy("");
    }
  };
  const edit = () => {
    if (!b) return;
    setForm({ name: b.name, age: b.ageLabel ?? (b.age ? String(b.age) : ""), gender: b.gender, total: String(b.total), facts: b.facts.join("\n"), text: b.source ?? "" });
    setByHand(true);
    setSetup(true);
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
          !byHand ? (
          <section className="sv-new cb-setup">
            <b>Paste your case post</b>
            <p className="hint">The whole post, as you wrote it. I read the name, age, amount and facts from it. Only those facts are ever used.</p>
            <textarea rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Little Yousuf is only 2 years old & fluid is filling inside his brain.💔\n\nHis both kidneys are badly swollen…\n\n🚨 Rs. 70,000 needed."} />
            <div className="sv-row">
              <button className="d-btn hot" disabled={busy === "paste" || paste.trim().length < 30} onClick={() => void read()}>{busy === "paste" ? "Reading…" : "Read & start"}</button>
              {b && <button className="d-btn" onClick={() => setSetup(false)}>Cancel</button>}
            </div>
            <button className="text-btn" onClick={() => setByHand(true)}>Fill by hand instead</button>
          </section>
          ) : (
          <section className="sv-new cb-setup">
            <b>Check the case</b>
            <p className="hint">Only these facts are used. Nothing is added.</p>
            <div className="cb-two">
              <input placeholder="Child's name (Yousuf)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Age (2, or 8 months)" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            </div>
            <div className="cb-two">
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="m">Boy</option><option value="f">Girl</option></select>
              <input placeholder="Total (70000)" inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </div>
            <textarea rows={6} value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} placeholder={"Facts, one per line:\nFluid is filling his brain\nHis head is swollen\nBoth his kidneys are badly swollen\nHe has a hernia\nHis blood was so weak he needed a transfusion"} />
            <div className="sv-row">
              <button className="d-btn hot" disabled={busy === "setup"} onClick={() => void start()}>{busy === "setup" ? "Starting…" : "Start this case"}</button>
              <button className="d-btn" onClick={() => (b && !form.text ? setSetup(false) : setByHand(false))}>Back</button>
            </div>
          </section>
          )
        ) : (
          b && (
            <>
              <section className="cb-read">
                <p><b>I read:</b> {b.name} · {b.age ? `${b.age} years` : b.ageLabel ?? "age not given"} · {b.gender === "f" ? "girl" : "boy"} · Rs. {money(b.total)} · {b.facts.length} facts</p>
                <div>
                  <button className="text-btn" onClick={() => setShowFacts(!showFacts)}>{showFacts ? "Hide facts" : "See facts"}</button>
                  <button className="text-btn" onClick={edit}>Edit</button>
                </div>
                {showFacts && <ul>{b.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
              </section>
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
              <button className="text-btn cb-new" onClick={() => { setForm({ name: "", age: "", gender: "m", total: "", facts: "", text: "" }); setByHand(false); setSetup(true); }}>Start a new case</button>
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
