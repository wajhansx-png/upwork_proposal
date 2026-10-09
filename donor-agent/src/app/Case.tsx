"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaseFacts, CaseFile, CasePost, CaseType } from "@/lib/types";
import { api } from "./App";

interface Check { ok: boolean; label: string }
interface Out { text: string; checks: Check[] }
interface View {
  case: CaseFile;
  ask: { ask: number; n: number; raised: boolean; any: boolean };
  main: Out;
  dm: Out;
  reminder: (Out & { kind: CasePost["kind"] }) | null;
  closing: { text: string } | null;
}
interface Data { current: View | null; dropped?: string[]; closing?: string }

const TYPES: { v: CaseType; label: string }[] = [
  { v: "child", label: "Sick child" },
  { v: "adult", label: "Sick adult / elder" },
  { v: "death", label: "Death / janazah" },
  { v: "orphans", label: "Orphans / lost earner" },
  { v: "needs", label: "Basic needs" },
];
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const medical = (t?: CaseType) => !t || t === "child" || t === "adult";
type Form = Record<string, string | boolean>;

const toForm = (f: Partial<CaseFacts>): Form => ({
  type: f.type ?? "child",
  name: f.name ?? "",
  gender: f.gender ?? "m",
  age: f.age ? String(f.age) : "",
  city: f.city ?? "",
  problem: f.problem ?? "",
  illness: f.illness ?? "",
  illnessMeaning: f.illnessMeaning ?? "",
  worstRisk: f.worstRisk ?? "",
  riskWord: f.riskWord ?? "",
  doctorLine: f.doctorLine ?? "",
  proof: f.proof ?? "",
  amountLeft: f.amountLeft ? String(f.amountLeft) : "",
  askAmount: f.askAmount ? String(f.askAmount) : "2000",
  deadline: f.deadline ?? "",
  items: (f.items ?? []).map((i) => [i.item, i.period, i.amount].filter(Boolean).join(" — ")).join("\n"),
  familySaidPain: !!f.familySaidPain,
});

/** "Ration — 1 month — 12000" per line. */
const parseItems = (s: string) =>
  s.split("\n").map((l) => l.split(/\s+[—-]\s+/).map((x) => x.trim())).filter((p) => p.length >= 2).map((p) => ({ item: p[0], period: p.length > 2 ? p[1] : undefined, amount: Number(p[p.length - 1].replace(/[^\d]/g, "")) }));

export default function CasePage() {
  const [data, setData] = useState<Data | null>(null);
  const [mode, setMode] = useState<"view" | "details" | "form">("view");
  const [details, setDetails] = useState("");
  const [form, setForm] = useState<Form>(toForm({}));
  const [notes, setNotes] = useState<string[]>([]);
  const [tab, setTab] = useState<"main" | "dm" | "reminder" | "close">("main");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/case");
      setData(d);
      if (!d.current || d.current.case.status !== "open") setMode((m) => (m === "view" ? "details" : m));
    } catch (e) {
      setErr((e as { status?: number }).status === 403 ? "Please open your private manager link first." : (e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const read = () => run("read", async () => {
    const r = await api<{ facts: Partial<CaseFacts>; missing: string[]; notes: string[] }>("/api/case", "POST", { action: "read", details });
    setForm(toForm(r.facts));
    setNotes([...r.notes, ...(r.missing.length ? [`Please fill in: ${r.missing.join(", ")}.`] : [])]);
    setMode("form");
  });

  const write = (replace = false): Promise<void> => run("write", async (): Promise<void> => {
    const facts = { ...form, items: parseItems(String(form.items)), familySaidPain: !!form.familySaidPain };
    try {
      const d = await api<Data>("/api/case", "POST", { action: "write", facts, replace });
      setData(d);
      setNotes(d.dropped ?? []);
      setMode("view");
      setTab("main");
    } catch (e) {
      const open = data?.current?.case;
      if ((e as { status?: number }).status === 409 && open && confirm(`${open.facts.name}'s case is still open. Close it and start this new case?`)) return write(true);
      throw e;
    }
  });

  const posted = async (kind: CasePost["kind"], text: string, how: "copy" | "wa") => {
    if (how === "copy") {
      try {
        await navigator.clipboard.writeText(text);
        setToast("Copied. Paste it in WhatsApp.");
      } catch {
        prompt("Copy this text:", text);
      }
    } else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    await run("posted", async () => setData(await api<Data>("/api/case", "POST", { action: "posted", kind, text })));
  };

  const setLeft = () => run("amount", async () => {
    setData(await api<Data>("/api/case", "POST", { action: "amount", amountLeft: Number(amount.replace(/[^\d]/g, "")) }));
    setAmount("");
    setTab("reminder");
  });

  const close = () => {
    const c = data?.current?.case;
    if (!c || !confirm(`Is ${c.facts.name}'s case complete? Reminders will stop.`)) return;
    void run("close", async () => {
      const d = await api<Data>("/api/case", "POST", { action: "close" });
      setData(d);
      setTab("close");
    });
  };

  const v = data?.current;
  const c = v?.case;
  const isOpen = c?.status === "open";
  const f = (k: string) => String(form[k] ?? "");
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const out = (o: Out | null, kind: CasePost["kind"]) =>
    o && (
      <>
        <pre className="c-text">{o.text}</pre>
        <ul className="c-checks">{o.checks.map((x, i) => <li key={i} className={x.ok ? "ok" : "bad"}>{x.ok ? "✓" : "✗"} {x.label}</li>)}</ul>
        <div className="d-actions">
          <button className="d-btn hot" disabled={!!busy || o.checks.some((x) => !x.ok)} onClick={() => posted(kind, o.text, "copy")}>Copy</button>
          <button className="d-btn wa" disabled={!!busy || o.checks.some((x) => !x.ok)} onClick={() => posted(kind, o.text, "wa")}>WhatsApp</button>
        </div>
      </>
    );

  return (
    <main className="p-shell donors case-page">
      <header className="p-top">
        <div>
          <p className="p-eyebrow">Case writer</p>
          <h1 className="p-title">{mode === "view" && c ? `${c.facts.name}${isOpen ? "" : " · closed"}` : "New case"}</h1>
        </div>
        <div className="top-btns">
          <a className="text-btn" href="/manager/donors">Donors</a>
          <a className="text-btn" href="/manager">← Chat</a>
        </div>
      </header>
      {err && <p className="err" onClick={() => setErr("")}>{err}</p>}

      <div className="d-scroll">
        {mode === "details" && (
          <section className="d-ideas c-form">
            <b>Paste the case details</b>
            <p className="hint">Any language. Name, problem, what doctors said, proof, amount left. I will not guess anything.</p>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Affan, 7, Peshawar. Hemophilia. Bleeding inside, knee and hand. Doctor said delay can put them at risk of removal. Aga Khan lab report. 26k left." />
            <div className="d-actions">
              <button className="d-btn hot" disabled={busy === "read" || details.trim().length < 10} onClick={read}>{busy === "read" ? "Reading…" : "Read details"}</button>
              <button className="d-btn" onClick={() => { setForm(toForm({})); setNotes([]); setMode("form"); }}>Fill in myself</button>
            </div>
            {c && <button className="text-btn" onClick={() => setMode("view")}>Back to {c.facts.name}</button>}
          </section>
        )}

        {mode === "form" && (
          <section className="d-ideas c-form">
            {notes.length > 0 && <ul className="c-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            <label>Case type</label>
            <select value={f("type")} onChange={set("type")}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
            <div className="c-two">
              <div><label>Name *</label><input value={f("name")} onChange={set("name")} /></div>
              <div><label>He / She</label><select value={f("gender")} onChange={set("gender")}><option value="m">He</option><option value="f">She</option></select></div>
            </div>
            <div className="c-two">
              <div><label>Age</label><input inputMode="numeric" value={f("age")} onChange={set("age")} /></div>
              <div><label>City</label><input value={f("city")} onChange={set("city")} /></div>
            </div>
            <label>What is happening, easy words *{medical(form.type as CaseType) ? " (Helpless NAME is …)" : ""}</label>
            <textarea value={f("problem")} onChange={set("problem")} />
            {medical(form.type as CaseType) && (
              <>
                <div className="c-two">
                  <div><label>Illness name</label><input value={f("illness")} onChange={set("illness")} /></div>
                  <div><label>Its meaning (easy)</label><input value={f("illnessMeaning")} onChange={set("illnessMeaning")} /></div>
                </div>
                <label>What will be lost * (doctor&apos;s words)</label>
                <input value={f("worstRisk")} onChange={set("worstRisk")} />
                <label>What the doctor said * (real words, never stronger)</label>
                <input value={f("doctorLine")} onChange={set("doctorLine")} />
              </>
            )}
            <label>One word at risk, for the hook (LEG, KIDNEY, HOME)</label>
            <input value={f("riskWord")} onChange={set("riskWord")} />
            <label>Proof you have *</label>
            <input value={f("proof")} onChange={set("proof")} placeholder="Aga Khan lab report + doctor's diagnosis" />
            <div className="c-two">
              <div><label>Amount left (Rs) *</label><input inputMode="numeric" value={f("amountLeft")} onChange={set("amountLeft")} /></div>
              <div><label>Ask per person *</label><select value={f("askAmount")} onChange={set("askAmount")}>{["1000", "1500", "2000", "3000", "5000"].map((a) => <option key={a} value={a}>{rs(Number(a))}</option>)}</select></div>
            </div>
            <label>Real deadline (only if the hospital or family gave one)</label>
            <input value={f("deadline")} onChange={set("deadline")} />
            <label>Costs, one per line (Ration — 1 month — 12000)</label>
            <textarea value={f("items")} onChange={set("items")} />
            <label className="c-check"><input type="checkbox" checked={!!form.familySaidPain} onChange={(e) => setForm({ ...form, familySaidPain: e.target.checked })} /> The family said the pain is getting worse</label>
            <div className="d-actions">
              <button className="d-btn hot" disabled={busy === "write"} onClick={() => write()}>{busy === "write" ? "Writing…" : "Write case text"}</button>
              <button className="d-btn" onClick={() => setMode(c ? "view" : "details")}>Cancel</button>
            </div>
          </section>
        )}

        {mode === "view" && v && c && (
          <>
            <section className="d-stats c-stats">
              <div><b>{rs(c.facts.amountLeft)}</b><span>left</span></div>
              <div><b>{v.ask.any ? "Any" : v.ask.n}</b><span>{v.ask.any ? "amount" : `people × ${v.ask.ask.toLocaleString("en-US")}`}</span></div>
              <div><b>{c.posts.length}</b><span>posted</span></div>
            </section>
            {v.ask.raised && <p className="hint">The ask is {rs(v.ask.ask)} so no more than 25 people are needed.</p>}
            {notes.length > 0 && <ul className="c-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {isOpen && (
              <form className="d-phone" onSubmit={(e) => { e.preventDefault(); void setLeft(); }}>
                <input inputMode="numeric" placeholder="Amount left now (Rs)" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <button type="submit" disabled={!amount.trim() || !!busy}>Update</button>
              </form>
            )}
            <div className="d-tabs c-tabs" role="tablist">
              {(["main", "dm", "reminder", "close"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "main" ? "Group post" : t === "dm" ? "DM" : t === "reminder" ? "Reminder" : "Close"}</button>
              ))}
            </div>
            {tab === "main" && (isOpen ? out(v.main, "main") : <p className="p-empty">This case is closed.</p>)}
            {tab === "dm" && isOpen && (
              <>
                <p className="hint">Areeba sends this to each donor from the Donors page, with their own name. Send the poster first, then this text. One DM per person.</p>
                <pre className="c-text">{v.dm.text}</pre>
                <ul className="c-checks">{v.dm.checks.map((x, i) => <li key={i} className={x.ok ? "ok" : "bad"}>{x.ok ? "✓" : "✗"} {x.label}</li>)}</ul>
              </>
            )}
            {tab === "reminder" && isOpen && (
              <>
                <p className="hint">Group only. Best time 8 pm – 11:30 pm, 20–60 minutes apart. Update the amount left first.</p>
                {v.reminder ? out(v.reminder, v.reminder.kind) : <p className="p-empty">{c.facts.amountLeft <= 0 ? "Fully funded. Go to Close." : "Nothing new to post. Update the amount left when gifts come in."}</p>}
              </>
            )}
            {tab === "close" && (
              isOpen ? (
                <div className="d-actions"><button className="d-btn hot" disabled={!!busy} onClick={close}>Case complete</button></div>
              ) : (
                <>
                  <p className="hint">Send proof (receipt, hospital photo, video) within 24 hours. It makes the next case work.</p>
                  {v.closing && (
                    <>
                      <pre className="c-text">{v.closing.text}</pre>
                      <div className="d-actions">
                        <button className="d-btn hot" onClick={() => posted("closing", v.closing!.text, "copy")}>Copy</button>
                        <button className="d-btn wa" onClick={() => posted("closing", v.closing!.text, "wa")}>WhatsApp</button>
                      </div>
                    </>
                  )}
                </>
              )
            )}
            <div className="d-more c-more">
              {isOpen && <button onClick={() => { setForm(toForm(c.facts)); setNotes([]); setMode("form"); }}>Edit facts</button>}
              <button onClick={() => { setDetails(""); setMode("details"); }}>New case</button>
              <span className="hint">{c.by === "ai" ? "Lines written by AI, checked by the app." : "Lines from the guide's formula."}</span>
            </div>
          </>
        )}
        {!data && !err && <p className="hint">Loading…</p>}
      </div>
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
