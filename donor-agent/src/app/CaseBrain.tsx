"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brain, BrainOut } from "@/lib/types";
import { api } from "./App";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const KIND: Record<BrainOut["kind"], string> = { update: "UPDATE", short: "20 minutes passed", "dry-main": "No donations · main group", "dry-groups": "No donations · freelancer groups", done: "DONE" };

/** The Case Brain: setup, the 4 commands, and every message it wrote (newest first). */
export default function CaseBrain() {
  const [b, setB] = useState<Brain | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [setup, setSetup] = useState(false);
  const [form, setForm] = useState({ name: "", age: "", gender: "m", total: "", facts: "", text: "" });
  const [paste, setPaste] = useState("");
  const [byHand, setByHand] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [view, setView] = useState(0);
  const [doOpen, setDoOpen] = useState(false);
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
      if (r.outputs.length) setView(0);
      setReply(r.reply ?? (r.outputs.length > 1 ? `${r.outputs.length} messages: main group first, then › for the freelancer groups.` : ""));
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
  // Newest press first, but the messages of one press stay in order (main group, then freelancer groups).
  const outs: BrainOut[] = [];
  for (const o of b?.history ?? []) {
    const last = outs[0];
    if (last && last.at === o.at) outs.splice(outs.findIndex((x) => x.at !== o.at) === -1 ? outs.length : outs.findIndex((x) => x.at !== o.at), 0, o);
    else outs.unshift(o);
  }
  const shown = outs[Math.min(view, Math.max(0, outs.length - 1))];
  const ageText = b ? (b.age ? `${b.age} yrs` : b.ageLabel ?? "") : "";
  return (
    <main className="cb">
      <header className="wa-top cb-top">
        <a href="/manager/messages" aria-label="Back">←</a>
        <span className="wa-av" aria-hidden>🧠</span>
        <div className="cb-title">
          <b>Case Brain</b>
          <small>{b && !setup ? `${b.name} · ${ageText}${ageText ? " · " : ""}${b.gender === "f" ? "girl" : "boy"} · Rs. ${money(b.total)} total` : "Writes the next message. You send it."}</small>
        </div>
        {b && !setup && (
          <div className="cb-tools">
            <button className={`cb-chip ${b.noAi ? "" : "on"}`} title={b.noAi ? "AI wording is off: only ready lines in your style (safe)." : "AI wording is on: fresh words each time. Read before you send."} disabled={!!busy} onClick={async () => setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "ai", on: !!b.noAi })).brain)}>{b.noAi ? "AI off" : "AI on"}</button>
            <button className="cb-chip" onClick={() => setShowFacts(!showFacts)}>{showFacts ? "Hide facts" : `${b.facts.length} facts`}</button>
            <button className="cb-chip" onClick={edit}>Edit</button>
            <button className="cb-chip" onClick={() => { setForm({ name: "", age: "", gender: "m", total: "", facts: "", text: "" }); setByHand(false); setSetup(true); }}>New case</button>
          </div>
        )}
      </header>

      {setup ? (
        <div className="cb-setupwrap">
          {!byHand ? (
            <section className="cb-card cb-setup">
              <b>Paste your case post</b>
              <p className="hint">The whole post, as you wrote it. I read the name, age, amount and facts. Only those facts are ever used.</p>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Little Yousuf is only 2 years old & fluid is filling inside his brain.💔\n\nHis both kidneys are badly swollen…\n\n🚨 Rs. 70,000 needed."} />
              <div className="cb-row">
                <button className="d-btn hot" disabled={busy === "paste" || paste.trim().length < 30} onClick={() => void read()}>{busy === "paste" ? "Reading…" : "Read & start"}</button>
                {b && <button className="d-btn" onClick={() => setSetup(false)}>Cancel</button>}
                <button className="text-btn" onClick={() => setByHand(true)}>Fill by hand</button>
              </div>
            </section>
          ) : (
            <section className="cb-card cb-setup">
              <b>Check the case</b>
              <p className="hint">Only these facts are used. Nothing is added.</p>
              <div className="cb-two">
                <input placeholder="Child's name (Yousuf)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input placeholder="Age (2, or 8 months)" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="m">Boy</option><option value="f">Girl</option></select>
                <input placeholder="Total (70000)" inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
              </div>
              <textarea value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} placeholder={"Facts, one per line:\nFluid is filling his brain\nHis head is swollen"} />
              <div className="cb-row">
                <button className="d-btn hot" disabled={busy === "setup"} onClick={() => void start()}>{busy === "setup" ? "Starting…" : "Start this case"}</button>
                <button className="d-btn" onClick={() => (b && !form.text ? setSetup(false) : setByHand(false))}>Back</button>
              </div>
            </section>
          )}
          {err && <p className="cb-err" onClick={() => setErr("")}>{err}</p>}
        </div>
      ) : (
        b && (
          <div className="cb-main">
            <aside className="cb-side">
              {showFacts && <ul className="cb-facts">{b.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
              <section className="cb-status">
                <div><b>{left !== undefined ? `Rs. ${money(left)}` : "—"}</b><span>left</span></div>
                <div><b>{left !== undefined ? p2 : "—"}</b><span>× Rs. 2,000</span></div>
                <div><b>{left !== undefined ? p1 : "—"}</b><span>× Rs. 1,000</span></div>
                <div><b>{b.angles.length}/10</b><span>angles</span></div>
              </section>
              <form className="cb-cmd" onSubmit={(e) => { e.preventDefault(); void send(/^\d/.test(cmd.trim()) ? `LEFT ${cmd}` : cmd); }}>
                <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Amount left now" inputMode="numeric" />
                <button className="d-btn hot" disabled={!!busy || !cmd.trim()}>{busy.startsWith("LEFT") ? "…" : "LEFT"}</button>
              </form>
              <div className="cb-btns">
                <button className="d-btn" disabled={!!busy} onClick={() => void send("20 MIN")}>{busy === "20 MIN" ? "Writing…" : <>⏱ 20 minutes passed<span className="cb-long"> / Update group</span></>}</button>
                <button className="d-btn" disabled={!!busy} onClick={() => void send("DRY")}>{busy === "DRY" ? "Writing…" : `😔 No donations${b.dryLevel ? ` · level ${b.dryLevel + 1}` : ""}`}</button>
                <button className="d-btn" disabled={!!busy} onClick={() => confirm(`Is ${b.name}'s case complete?`) && void send("DONE")}>{busy === "DONE" ? "Writing…" : "✅ Done"}</button>
              </div>
              <p className="cb-ainote">{b.noAi ? "AI off: only ready lines in your style." : "AI on: fresh words each time. Read before you send."}</p>
              {(reply || err) && <p className={err ? "cb-err" : "cb-reply"} onClick={() => setErr("")}>{err || reply}</p>}
            </aside>

            <section className="cb-out">
              {shown ? (
                <>
                  <div className="cb-nav">
                    <button aria-label="Newer" disabled={view <= 0} onClick={() => setView(view - 1)}>‹</button>
                    <span>{KIND[shown.kind]} · {hhmm(shown.at)}{outs.length > 1 ? ` · ${Math.min(view, outs.length - 1) + 1} of ${outs.length}` : ""}</span>
                    <button aria-label="Older" disabled={view >= outs.length - 1} onClick={() => setView(view + 1)}>›</button>
                  </div>
                  <p className={`cb-do ${doOpen ? "open" : ""}`} onClick={() => setDoOpen(!doOpen)}><b>DO:</b> {shown.do}</p>
                  <p className="cb-text">{shown.text}</p>
                  <div className="cb-acts">
                    <button className="d-btn hot" onClick={() => void copy(shown.text)}>Copy</button>
                    <a className="d-btn" href={`https://wa.me/?text=${encodeURIComponent(shown.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                    <button className="d-btn" onClick={() => void keep(shown)}>Save to Messages</button>
                  </div>
                </>
              ) : (
                <p className="cb-empty">Tap <b>LEFT</b> with the amount left now. Your first message comes here.</p>
              )}
            </section>
          </div>
        )
      )}
      {!loaded && <p className="cb-empty">Loading…</p>}
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
