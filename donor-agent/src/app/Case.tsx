"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaseFacts, CaseFile, CaseType } from "@/lib/types";
import { api } from "./App";
import CaseBrain from "./CaseBrain";

interface CaseRow { id: string; name: string; status: "open" | "closed"; amountLeft: number; createdAt: string; closedAt?: string; messages: number }
interface Data { current: { case: CaseFile } | null; dropped?: string[] }

const TYPES: { v: CaseType; label: string }[] = [
  { v: "child", label: "Sick child" },
  { v: "adult", label: "Sick adult / elder" },
  { v: "death", label: "Death / janazah" },
  { v: "orphans", label: "Orphans / lost earner" },
  { v: "needs", label: "Basic needs" },
];
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const medical = (t?: CaseType) => !t || t === "child" || t === "adult";
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
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

/**
 * Cases. The list of all cases (each keeps its own messages) with "New case" on top.
 * /manager/case?id=<id> opens one case on the live case screen.
 */
export default function CasePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [mode, setMode] = useState<"home" | "form">("home");
  const [details, setDetails] = useState("");
  const [form, setForm] = useState<Form>(toForm({}));
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const loadList = useCallback(async () => {
    try {
      setCases((await api<{ cases: CaseRow[] }>("/api/brain?list=1")).cases);
    } catch (e) {
      setErr((e as { status?: number }).status === 403 ? "Please open your private manager link first." : (e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setSelected(new URLSearchParams(location.search).get("id"));
      void loadList();
    }, 0);
    const back = () => setSelected(new URLSearchParams(location.search).get("id"));
    addEventListener("popstate", back);
    return () => {
      clearTimeout(t);
      removeEventListener("popstate", back);
    };
  }, [loadList]);

  const open = (id: string) => {
    history.pushState(null, "", `/manager/case?id=${id}`);
    setSelected(id);
  };
  const backToList = useCallback(() => {
    history.pushState(null, "", "/manager/case");
    setSelected(null);
    setMode("home");
    void loadList();
  }, [loadList]);

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
  const openCase = cases?.find((c) => c.status === "open");
  const replaceOk = () => !openCase || confirm(`${openCase.name}'s case is still open. Close it and start this new case?`);

  const saveOwn = () => run("own", async () => {
    if (!replaceOk()) return;
    const d = await api<Data>("/api/case", "POST", { action: "own", details, replace: true });
    setDetails("");
    if (d.current) open(d.current.case.id);
  });
  const read = () => run("read", async () => {
    const r = await api<{ facts: Partial<CaseFacts>; missing: string[]; notes: string[] }>("/api/case", "POST", { action: "read", details });
    setForm(toForm(r.facts));
    setNotes([...r.notes, ...(r.missing.length ? [`Please fill in: ${r.missing.join(", ")}.`] : [])]);
    setMode("form");
  });
  const write = () => run("write", async () => {
    if (!replaceOk()) return;
    const facts = { ...form, items: parseItems(String(form.items)), familySaidPain: !!form.familySaidPain };
    const d = await api<Data>("/api/case", "POST", { action: "write", facts, replace: true });
    setDetails("");
    setMode("home");
    if (d.current) open(d.current.case.id);
  });

  if (selected) return <CaseBrain key={selected} caseId={selected} onBack={backToList} />;

  const f = (k: string) => String(form[k] ?? "");
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  if (mode === "form")
    return (
      <main className="pg">
        <header className="pg-head">
          <div>
            <h1>New case</h1>
            <p>Check the details. The app writes the post from them.</p>
          </div>
          <button className="btn" onClick={() => setMode("home")}>Cancel</button>
        </header>
        {notes.length > 0 && <ul className="note">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <section className="box frm">
          <label>Case type<select value={f("type")} onChange={set("type")}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></label>
          <div className="frm-2">
            <label>Name *<input value={f("name")} onChange={set("name")} /></label>
            <label>He / She<select value={f("gender")} onChange={set("gender")}><option value="m">He</option><option value="f">She</option></select></label>
            <label>Age<input inputMode="numeric" value={f("age")} onChange={set("age")} /></label>
            <label>City<input value={f("city")} onChange={set("city")} /></label>
          </div>
          <label>What is happening, in easy words *<textarea value={f("problem")} onChange={set("problem")} /></label>
          {medical(form.type as CaseType) && (
            <>
              <div className="frm-2">
                <label>Illness name<input value={f("illness")} onChange={set("illness")} /></label>
                <label>Its meaning (easy words)<input value={f("illnessMeaning")} onChange={set("illnessMeaning")} /></label>
              </div>
              <label>What will be lost * (the doctor&apos;s words)<input value={f("worstRisk")} onChange={set("worstRisk")} /></label>
              <label>What the doctor said * (real words, never stronger)<input value={f("doctorLine")} onChange={set("doctorLine")} /></label>
            </>
          )}
          <label>Proof you have *<input value={f("proof")} onChange={set("proof")} placeholder="Aga Khan lab report + doctor's diagnosis" /></label>
          <div className="frm-2">
            <label>Amount still needed (Rs) *<input inputMode="numeric" value={f("amountLeft")} onChange={set("amountLeft")} /></label>
            <label>Ask per person<select value={f("askAmount")} onChange={set("askAmount")}>{["1000", "1500", "2000", "3000", "5000"].map((a) => <option key={a} value={a}>{rs(Number(a))}</option>)}</select></label>
          </div>
          <details className="frm-more">
            <summary>More (optional)</summary>
            <label>One word at risk (LEG, KIDNEY, HOME)<input value={f("riskWord")} onChange={set("riskWord")} /></label>
            <label>Real deadline (only if the hospital or family gave one)<input value={f("deadline")} onChange={set("deadline")} /></label>
            <label>Costs, one per line (Ration — 1 month — 12000)<textarea value={f("items")} onChange={set("items")} /></label>
            <label className="chk"><input type="checkbox" checked={!!form.familySaidPain} onChange={(e) => setForm({ ...form, familySaidPain: e.target.checked })} /> The family said the pain is getting worse</label>
          </details>
          {err && <p className="err-line">{err}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy === "write"} onClick={() => void write()}>{busy === "write" ? "Writing…" : "Write the post"}</button>
          </div>
        </section>
      </main>
    );

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>Cases</h1>
          <p>Add a case once. Open it any time to write the next message.</p>
        </div>
      </header>

      <div className="cs-grid">
        <section className="box cs-new">
          <h2>New case</h2>
          <p className="sub">Paste your full post, or just the details.</p>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder={"Little Yousuf is only 2 years old…\n\nRs. 70,000 needed."} />
          {err && <p className="err-line">{err}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy === "own" || details.trim().length < 20} onClick={() => void saveOwn()}>{busy === "own" ? "Saving…" : "Save my post"}</button>
            <button className="btn" disabled={busy === "read" || details.trim().length < 10} onClick={() => void read()}>{busy === "read" ? "Reading…" : "Write it for me"}</button>
          </div>
          <p className="sub small">“Save my post” keeps every word. “Write it for me” turns details into a post.</p>
        </section>

        <section className="cs-list">
          <h2>Your cases</h2>
          {cases === null && <p className="sub">Loading…</p>}
          {cases?.length === 0 && <p className="sub">No cases yet. Add your first one.</p>}
          {cases?.map((c) => (
            <button key={c.id} className={`cs-row ${c.status}`} onClick={() => open(c.id)}>
              <span className="cs-main">
                <b>{c.name}</b>
                <small>{c.status === "open" ? `Rs ${Math.round(c.amountLeft).toLocaleString("en-US")} still needed` : `Complete${c.closedAt ? ` · ${day(c.closedAt)}` : ""}`} · {c.messages} {c.messages === 1 ? "message" : "messages"}</small>
              </span>
              <span className={`pill ${c.status === "open" ? "live" : ""}`}>{c.status === "open" ? "Open" : "Done"}</span>
              <span className="chev" aria-hidden>›</span>
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}
