"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brain, BrainOut } from "@/lib/types";
import { api } from "./App";

type Card = Omit<BrainOut, "kind"> & { kind: BrainOut["kind"] | "post" };

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const KIND: Record<Card["kind"], string> = { post: "Case post", update: "Update", short: "20 minutes passed", "dry-main": "No donations · main group", "dry-groups": "No donations · freelancer groups", done: "Case complete" };

/**
 * The live case, on one screen. It starts by itself from the case saved on the Case page.
 * Three buttons write the next message; the amount box is only for when money comes in.
 */
export default function CaseBrain({ onNewCase }: { onNewCase: () => void }) {
  const [b, setB] = useState<Brain | null>(null);
  const [post, setPost] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", age: "", gender: "m", total: "", facts: "" });
  const [amount, setAmount] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [view, setView] = useState(0);
  const [doOpen, setDoOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ brain: Brain | null; post: string | null }>("/api/brain");
      setB(r.brain);
      setPost(r.post ?? "");
      if (!r.brain) onNewCase();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [onNewCase]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(text);
    setErr("");
    setReply("");
    try {
      const r = await api<{ brain: Brain; reply?: string; outputs: BrainOut[] }>("/api/brain", "POST", { action: "cmd", text });
      setB(r.brain);
      if (r.outputs.length) setView(0);
      setReply(r.reply ?? (r.outputs.length > 1 ? "2 messages: main group first, then › for the freelancer groups." : ""));
      setAmount("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const saveEdit = async () => {
    setBusy("edit");
    setErr("");
    try {
      setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "setup", ...form })).brain);
      setEditing(false);
      setToast("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setToast("Copied. Paste it in WhatsApp.");
    } catch {
      prompt("Copy this text:", t);
    }
  };
  const keep = async (o: Card) => {
    try {
      await api("/api/saved", "POST", { action: "save", title: `${b?.name ?? "Case"} – ${KIND[o.kind]}`, text: o.text });
      setToast("Saved to Messages. Areeba can see it.");
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  if (!loaded) return <main className="cb"><p className="cb-empty">Loading…</p></main>;
  if (!b) return null;

  // Newest first; one press's messages stay in order. The case post itself is always the last (oldest) card.
  const cards: Card[] = [];
  for (const o of b.history) {
    const i = cards.findIndex((x) => x.at !== o.at);
    if (cards[0] && cards[0].at === o.at) cards.splice(i === -1 ? cards.length : i, 0, o);
    else cards.unshift(o);
  }
  if (post) cards.push({ kind: "post", do: "Send this first in GiveLife Foundation with @all.", text: post, at: "" });
  const shown = cards[Math.min(view, cards.length - 1)];
  const left = b.left;
  const p2 = left ? Math.ceil(left / 2000) : 0;
  const p1 = left ? Math.ceil(left / 1000) : 0;

  return (
    <main className="cb">
      <header className="wa-top cb-top">
        <a href="/manager" aria-label="Back">←</a>
        <div className="cb-title">
          <b>{b.name}&apos;s case</b>
          <small>{left !== undefined ? `Rs. ${money(left)} left · ${p2} × Rs. 2,000 · ${p1} × Rs. 1,000` : "Type the amount left to start"}</small>
        </div>
        <div className="cb-tools">
          <button className="cb-chip" onClick={() => { setForm({ name: b.name, age: b.ageLabel ?? (b.age ? String(b.age) : ""), gender: b.gender, total: String(b.total), facts: b.facts.join("\n") }); setEditing(!editing); }}>{editing ? "Close" : "Edit"}</button>
          <button className="cb-chip" onClick={onNewCase}>New case</button>
        </div>
      </header>

      {editing ? (
        <div className="cb-setupwrap">
          <section className="cb-card cb-setup">
            <b>The facts I use</b>
            <p className="hint">Only these are ever used in messages. Nothing is added.</p>
            <div className="cb-two">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Age (2, or 8 months)" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="m">Boy</option><option value="f">Girl</option></select>
              <input placeholder="Total (70000)" inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </div>
            <textarea value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} placeholder="One fact per line" />
            <label className="cb-ai">
              <input type="checkbox" checked={!b.noAi} onChange={async (e) => setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "ai", on: e.target.checked })).brain)} />
              <span>{b.noAi ? "AI wording off: only ready lines in your style (safe)." : "AI wording on: fresh words each time. Read before you send."}</span>
            </label>
            <div className="cb-row">
              <button className="d-btn hot" disabled={busy === "edit"} onClick={() => void saveEdit()}>{busy === "edit" ? "Saving…" : "Save"}</button>
              <button className="d-btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </section>
          {err && <p className="cb-err" onClick={() => setErr("")}>{err}</p>}
        </div>
      ) : (
        <div className="cb-main">
          <aside className="cb-side">
            <div className="cb-btns">
              <button className="d-btn" disabled={!!busy || left === undefined} onClick={() => void send("20 MIN")}>{busy === "20 MIN" ? "Writing…" : <>⏱ 20 minutes passed<span className="cb-long"> / Update group</span></>}</button>
              <button className="d-btn" disabled={!!busy || left === undefined} onClick={() => void send("DRY")}>{busy === "DRY" ? "Writing…" : `😔 No donations${b.dryLevel ? ` · level ${b.dryLevel + 1}` : ""}`}</button>
              <button className="d-btn" disabled={!!busy} onClick={() => confirm(`Is ${b.name}'s case complete? It will be closed.`) && void send("DONE")}>{busy === "DONE" ? "Writing…" : "✅ Case complete"}</button>
            </div>
            <form className="cb-cmd" onSubmit={(e) => { e.preventDefault(); void send(`LEFT ${amount}`); }}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={left !== undefined ? "Money came? New amount left" : "Amount left now"} inputMode="numeric" />
              <button className="d-btn hot" disabled={!!busy || !amount.trim()}>{busy.startsWith("LEFT") ? "…" : "Update"}</button>
            </form>
            {(reply || err) && <p className={err ? "cb-err" : "cb-reply"} onClick={() => setErr("")}>{err || reply}</p>}
          </aside>

          <section className="cb-out">
            {shown && (
              <>
                <div className="cb-nav">
                  <button aria-label="Newer" disabled={view <= 0} onClick={() => setView(view - 1)}>‹</button>
                  <span>{KIND[shown.kind]}{shown.at ? ` · ${hhmm(shown.at)}` : ""}{cards.length > 1 ? ` · ${Math.min(view, cards.length - 1) + 1} of ${cards.length}` : ""}</span>
                  <button aria-label="Older" disabled={view >= cards.length - 1} onClick={() => setView(view + 1)}>›</button>
                </div>
                <p className={`cb-do ${doOpen ? "open" : ""}`} onClick={() => setDoOpen(!doOpen)}><b>DO:</b> {shown.do}</p>
                <p className="cb-text">{shown.text}</p>
                <div className="cb-acts">
                  <button className="d-btn hot" onClick={() => void copy(shown.text)}>Copy</button>
                  <a className="d-btn" href={`https://wa.me/?text=${encodeURIComponent(shown.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                  <button className="d-btn" onClick={() => void keep(shown)}>Save for Areeba</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
