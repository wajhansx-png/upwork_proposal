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
export default function CaseBrain({ caseId, onBack }: { caseId?: string; onBack: () => void }) {
  const [b, setB] = useState<Brain | null>(null);
  const [post, setPost] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", age: "", gender: "m", total: "", facts: "" });
  const [amount, setAmount] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [view, setView] = useState(0);
  
  const load = useCallback(async () => {
    try {
      const r = await api<{ brain: Brain | null; post: string | null; open: boolean }>(`/api/brain${caseId ? `?case=${encodeURIComponent(caseId)}` : ""}`);
      setB(r.brain);
      setPost(r.post ?? "");
      setIsOpen(r.open);
      if (!r.brain) onBack();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [caseId, onBack]);
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
      const r = await api<{ brain: Brain; reply?: string; outputs: BrainOut[] }>("/api/brain", "POST", { action: "cmd", text, caseId: b?.caseId });
      setB(r.brain);
      if (r.brain.done) setIsOpen(false);
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
      setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "setup", ...form, caseId: b?.caseId })).brain);
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

  if (!loaded) return <main className="pg"><p className="sub">Loading…</p></main>;
  if (!b) return null;

  // Newest first; one press's messages stay in order. The case post itself is always the last (oldest) card.
  const cards: Card[] = [];
  for (const o of b.history) {
    const i = cards.findIndex((x) => x.at !== o.at);
    if (cards[0] && cards[0].at === o.at) cards.splice(i === -1 ? cards.length : i, 0, o);
    else cards.unshift(o);
  }
  if (post) cards.push({ kind: "post", do: "Send this first in GiveLife Foundation with @all.", text: post, at: "" });
  const idx = Math.min(view, cards.length - 1);
  const shown = cards[idx];
  const left = b.left;
  const p2 = left ? Math.ceil(left / 2000) : 0;
  const p1 = left ? Math.ceil(left / 1000) : 0;
  const raised = left !== undefined && b.total > 0 ? Math.max(0, Math.min(1, (b.total - left) / b.total)) : 0;
  const where = shown?.do.replace(/^No donations · level \d+: /, "").replace(/^Send this (first )?in /i, "").replace(/\.$/, "");

  return (
    <main className="pg cbx">
      <div className="cbx-head">
        <button className="link" onClick={onBack}>← All cases</button>
        <div className="cbx-title">
          <h1>{b.name}</h1>
          <span className={`pill ${isOpen ? "live" : ""}`}>{isOpen ? "Open" : "Complete"}</span>
          {isOpen && <button className="btn sm" onClick={() => { setForm({ name: b.name, age: b.ageLabel ?? (b.age ? String(b.age) : ""), gender: b.gender, total: String(b.total), facts: b.facts.join("\n") }); setEditing(!editing); }}>{editing ? "Close" : "Edit facts"}</button>}
        </div>
        {left !== undefined && (
          <div className="prog">
            <div className="prog-bar"><i style={{ width: `${Math.round(raised * 100)}%` }} /></div>
            <p><b>Rs {money(left)}</b> still needed of Rs {money(b.total)} · {p2} people at Rs 2,000 or {p1} at Rs 1,000</p>
          </div>
        )}
      </div>

      {editing ? (
        <section className="box frm">
          <h2>Facts used in messages</h2>
          <p className="sub">Only these are used. Nothing else is ever added.</p>
          <div className="frm-2">
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Age<input placeholder="2, or 8 months" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></label>
            <label>Boy / girl<select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="m">Boy</option><option value="f">Girl</option></select></label>
            <label>Total (Rs)<input inputMode="numeric" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} /></label>
          </div>
          <label>Facts, one per line<textarea value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} /></label>
          <label className="chk">
            <input type="checkbox" checked={!b.noAi} onChange={async (e) => setB((await api<{ brain: Brain }>("/api/brain", "POST", { action: "ai", on: e.target.checked, caseId: b.caseId })).brain)} />
            Let AI vary the wording (read before you send). Off = only ready lines in your style.
          </label>
          {err && <p className="err-line">{err}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy === "edit"} onClick={() => void saveEdit()}>{busy === "edit" ? "Saving…" : "Save"}</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </section>
      ) : (
        <div className="cbx-main">
          <aside className="cbx-side">
            {isOpen ? (
              <>
                <section className="box">
                  <h2>Write the next message</h2>
                  <div className="acts">
                    <button className="act" disabled={!!busy || left === undefined} onClick={() => void send("20 MIN")}>
                      <b>{busy === "20 MIN" ? "Writing…" : "20 minutes passed"}</b>
                      <small>A short update for the group</small>
                    </button>
                    <button className="act" disabled={!!busy || left === undefined} onClick={() => void send("DRY")}>
                      <b>{busy === "DRY" ? "Writing…" : "No donations"}</b>
                      <small>{b.dryLevel ? `Stronger message · level ${b.dryLevel + 1}` : "A stronger message for 2 groups"}</small>
                    </button>
                    <button className="act" disabled={!!busy} onClick={() => confirm(`Is ${b.name}'s case complete? It will be closed.`) && void send("DONE")}>
                      <b>{busy === "DONE" ? "Writing…" : "Case complete"}</b>
                      <small>Thank-you message, closes the case</small>
                    </button>
                  </div>
                </section>
                <section className="box">
                  <h2>Money received?</h2>
                  <form className="row" onSubmit={(e) => { e.preventDefault(); void send(`LEFT ${amount}`); }}>
                    <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount still needed" inputMode="numeric" />
                    <button className="btn primary" disabled={!!busy || !amount.trim()}>{busy.startsWith("LEFT") ? "…" : "Save"}</button>
                  </form>
                  <p className="sub small">I write an update when enough came in.</p>
                </section>
              </>
            ) : (
              <section className="box"><h2>Case complete</h2><p className="sub">Its messages are kept here. You can still copy them.</p></section>
            )}
            {(reply || err) && <p className={err ? "err-line" : "note-line"} onClick={() => setErr("")}>{err || reply}</p>}
          </aside>

          <section className="box msg">
            {shown && (
              <>
                <div className="msg-top">
                  <div>
                    <b>{KIND[shown.kind]}</b>
                    <small>{shown.at ? hhmm(shown.at) : "Your post"}{cards.length > 1 ? ` · ${idx + 1} of ${cards.length}` : ""}</small>
                  </div>
                  <div className="pager">
                    <button aria-label="Newer" disabled={idx <= 0} onClick={() => setView(idx - 1)}>‹</button>
                    <button aria-label="Older" disabled={idx >= cards.length - 1} onClick={() => setView(idx + 1)}>›</button>
                  </div>
                </div>
                <p className="msg-where"><span>Send to</span> {where}</p>
                <p className="msg-text">{shown.text}</p>
                <div className="row msg-acts">
                  <button className="btn primary" onClick={() => void copy(shown.text)}>Copy</button>
                  <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(shown.text)}`} target="_blank" rel="noreferrer">Open WhatsApp</a>
                  <button className="btn" onClick={() => void keep(shown)}>Save for Areeba</button>
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
