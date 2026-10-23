"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [fresh, setFresh] = useState("");
  const moneyRef = useRef<HTMLInputElement>(null);
  
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
      if (r.outputs.length) {
        setView(0);
        setFresh(r.outputs[0].at);
        // One click less: the new message is already on the clipboard. Paste it in WhatsApp.
        try {
          await navigator.clipboard.writeText(r.outputs[0].text);
          setToast("Written and copied. Paste it in WhatsApp.");
        } catch {
          setToast("Written. Press Copy.");
        }
      }
      setReply(r.reply ?? (r.outputs.length > 1 ? "2 messages: the main group one is copied. Press → for the freelancer groups one." : ""));
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
      setToast("Saved in Messages for Areeba. She can see it now.");
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // Newest first; one press's messages stay in order. The case post itself is always the last (oldest) card.
  const cards: Card[] = [];
  for (const o of b?.history ?? []) {
    const i = cards.findIndex((x) => x.at !== o.at);
    if (cards[0] && cards[0].at === o.at) cards.splice(i === -1 ? cards.length : i, 0, o);
    else cards.unshift(o);
  }
  if (post) cards.push({ kind: "post", do: "Send this first in GiveLife Foundation with @all.", text: post, at: "" });
  const idx = Math.min(view, Math.max(0, cards.length - 1));
  const shown = cards[idx];

  // Keyboard: 1 / 2 / 3 write the next message, C copies, ← → move between messages, M jumps to the amount box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (editing || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      const k = e.key.toLowerCase();
      const can = isOpen && !busy && b?.left !== undefined;
      if (k === "1" && can) void send("20 MIN");
      else if (k === "2" && can) void send("DRY");
      else if (k === "3" && isOpen && !busy && b && confirm(`Is ${b.name}'s case complete? It will be closed.`)) void send("DONE");
      else if (k === "c" && shown) void copy(shown.text);
      else if (k === "arrowleft") setView((v) => Math.max(0, v - 1));
      else if (k === "arrowright") setView((v) => Math.min(cards.length - 1, v + 1));
      else if (k === "m" && isOpen) {
        e.preventDefault();
        moneyRef.current?.focus();
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!loaded) return <main className="pg"><p className="sub">Loading…</p></main>;
  if (!b) return null;

  const left = b.left;
  const p2 = left ? Math.ceil(left / 2000) : 0;
  const p1 = left ? Math.ceil(left / 1000) : 0;
  const where = shown?.do.replace(/^No donations · level \d+: /, "").replace(/^Send this (first )?in /i, "").replace(/\.$/, "");

  return (
    <main className="pg cbx">
      <div className="cbx-head">
        <button className="link" onClick={onBack}>← All cases</button>
        <h1>{b.name}</h1>
        <span className={`pill ${isOpen ? "live" : ""}`}>{isOpen ? "Open" : "Complete"}</span>
        {left !== undefined && <span className="cbx-amt"><b>Rs {money(left)}</b> still needed · {p2} people × Rs 2,000 or {p1} × Rs 1,000</span>}
        {isOpen && <button className="btn sm" onClick={() => { setForm({ name: b.name, age: b.ageLabel ?? (b.age ? String(b.age) : ""), gender: b.gender, total: String(b.total), facts: b.facts.join("\n") }); setEditing(!editing); }}>{editing ? "Close" : "Edit facts"}</button>}
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
                  <h2>What happened?</h2>
                  <div className="acts">
                    <button className="act" disabled={!!busy || left === undefined} onClick={() => void send("20 MIN")}>
                      <b>{busy === "20 MIN" ? "Writing…" : "20 minutes passed"}</b>
                      <small>Write the next group update</small>
                    </button>
                    <button className="act" disabled={!!busy || left === undefined} onClick={() => void send("DRY")}>
                      <b>{busy === "DRY" ? "Writing…" : "No donations"}</b>
                      <small>{b.dryLevel ? `Write a stronger message (level ${b.dryLevel + 1})` : "Write a stronger message"}</small>
                    </button>
                    <button className="act" disabled={!!busy} onClick={() => confirm(`Is ${b.name}'s case complete? It will be closed.`) && void send("DONE")}>
                      <b>{busy === "DONE" ? "Writing…" : "Case complete"}</b>
                      <small>Write the thank-you message and close the case</small>
                    </button>
                  </div>
                </section>
                <section className="box">
                  <h2>Money came?</h2>
                  <form className="row" onSubmit={(e) => { e.preventDefault(); void send(`LEFT ${amount}`); }}>
                    <input ref={moneyRef} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount still needed now" inputMode="numeric" />
                    <button className="btn" disabled={!!busy || !amount.trim()}>{busy.startsWith("LEFT") ? "…" : "Update"}</button>
                  </form>
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
                    <b>{KIND[shown.kind]}{shown.at && shown.at === fresh && <span className="pill live new">Copied</span>}</b>
                    <small>{shown.at ? hhmm(shown.at) : "Your post"}{cards.length > 1 ? ` · ${idx + 1} of ${cards.length}` : ""}</small>
                  </div>
                  <div className="pager">
                    <button aria-label="Newer message (left arrow key)" title="Newer (←)" disabled={idx <= 0} onClick={() => setView(idx - 1)}>‹</button>
                    <button aria-label="Older message (right arrow key)" title="Older (→)" disabled={idx >= cards.length - 1} onClick={() => setView(idx + 1)}>›</button>
                  </div>
                </div>
                <p className="msg-where">Copy this and send it in <b>{where}</b></p>
                <p className="msg-text">{shown.text}</p>
                <div className="row msg-acts">
                  <button className="btn" onClick={() => void keep(shown)}>Save for Areeba</button>
                  <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(shown.text)}`} target="_blank" rel="noreferrer">Open WhatsApp</a>
                  <button className="btn primary" onClick={() => void copy(shown.text)}>Copy message</button>
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
