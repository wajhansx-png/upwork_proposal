"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Donor, DonorStatus } from "@/lib/types";
import { api } from "./App";

type Row = Donor & { canUndo: boolean };
interface Pick { id: string; why: string; label: string; message: string }
interface Stats { total: number; withPhone: number; byStatus: Record<DonorStatus, number>; contacted: number; raised: number }
interface Data {
  role: "manager" | "teammate";
  teammate: string;
  donors: Row[];
  picks: Pick[];
  stats: Stats;
  ideas?: string[];
  task: { title: string; done: number; target: number } | null;
  case: { name: string; amountLeft: number; ask: number; n: number; any: boolean; sent: number } | null;
}

const STATUS_TEXT: Record<DonorStatus, string> = { new: "Not messaged", sent: "Waiting", replied: "Replied", donated: "Gave", no: "Not interested" };
const FILTERS: (DonorStatus | "all")[] = ["all", "new", "sent", "replied", "donated", "no"];
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;
const label = (d: Donor) => d.name || d.phone || "Donor";
const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export default function Donors({ entry }: { entry: "manager" | "teammate" }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"today" | "all">("today");
  const [filter, setFilter] = useState<DonorStatus | "all">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [opened, setOpened] = useState<string[]>([]);
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const [ideas, setIdeas] = useState<{ list: string[]; by: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/donors"));
      setErr("");
    } catch (e) {
      setErr((e as { status?: number }).status === 401 ? "Please open your private link first." : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => !document.hidden && void load(), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const mark = async (d: Donor, action: "sent" | "replied" | "donated" | "no" | "undo") => {
    let amount: number | undefined;
    if (action === "donated") {
      const raw = prompt(`How much did ${label(d)} give? (Rs, leave empty if you don't know)`, "");
      if (raw === null) return;
      amount = Number(raw.replace(/[^\d.]/g, "")) || undefined;
    }
    setBusy(d.id);
    try {
      await api("/api/donors", "POST", { id: d.id, action, amount });
      navigator.vibrate?.(10);
      setToast(action === "undo" ? null : { id: d.id, text: `${label(d)}: ${action === "donated" ? "gave" : action === "no" ? "not interested" : action}` });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const copy = async (d: Donor, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ id: "", text: "Message copied. Paste it to the donor, then tap “Sent”." });
    } catch {
      prompt("Copy this message:", text);
    }
    setOpened((o) => [...o, d.id]);
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.donors.filter((d) => (filter === "all" || d.status === filter) && (!needle || label(d).toLowerCase().includes(needle) || d.group.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  const getIdeas = async () => {
    setBusy("ideas");
    try {
      const r = await api<{ ideas: string[]; by: string }>("/api/donors/ideas", "POST");
      setIdeas({ list: r.ideas, by: r.by });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const back = entry === "manager" ? "/manager" : "/areeba";
  if (!data)
    return (
      <main className="p-shell donors">
        <a className="text-btn back" href={back}>← Back</a>
        <p className="hint">{err || "Loading donors…"}</p>
      </main>
    );
  const s = data.stats;
  const byId = new Map(data.donors.map((d) => [d.id, d]));

  return (
    <main className="p-shell donors">
      <header className="p-top">
        <div>
          <p className="p-eyebrow">Donors</p>
          <h1 className="p-title">{s.total} donors</h1>
        </div>
        <a className="text-btn back" href={back}>← Chat</a>
      </header>

      <section className="d-stats" aria-label="Numbers">
        <div><b>{s.contacted}</b><span>messaged</span></div>
        <div><b>{s.byStatus.replied}</b><span>replied</span></div>
        <div><b>{s.byStatus.donated}</b><span>gave</span></div>
        <div><b>{s.raised ? rs(s.raised) : "Rs 0"}</b><span>raised</span></div>
      </section>

      <div className="d-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}>Message now ({data.picks.length})</button>
        <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All donors</button>
      </div>

      {err && <p className="err" onClick={() => setErr("")}>{err}</p>}

      <div className="d-scroll">
        {tab === "today" ? (
          <>
            {data.role === "manager" && (
              <section className="d-ideas">
                <div className="d-ideas-top">
                  <b>Ideas</b>
                  <button className="text-btn" disabled={busy === "ideas"} onClick={getIdeas}>{busy === "ideas" ? "Thinking…" : "Ask AI"}</button>
                </div>
                <ul>{(ideas?.list ?? data.ideas ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
                {ideas && <p className="hint">{ideas.by === "ai" ? "From the AI, based only on your numbers." : "AI is not available. These come from your numbers."}</p>}
              </section>
            )}
            {data.case && (
              <section className="d-case">
                <b>{data.case.name}&apos;s case · {rs(data.case.amountLeft)} left</b>
                <span>{data.case.any ? "Any amount helps" : `${data.case.n} people × ${data.case.ask.toLocaleString("en-US")}`} · sent to {data.case.sent}</span>
                <span>Send the case poster first, then the text. One DM per person.</span>
                {data.role === "manager" && <a href="/manager/case">Open case writer →</a>}
              </section>
            )}
            {data.task && <p className="hint d-task">Task: {data.task.title} · {data.task.done} of {data.task.target} sent. “Sent” here adds 1.</p>}
            {!data.picks.length && <p className="p-empty">Nobody to message right now. Everyone is done or waiting.</p>}
            {data.picks.map((p) => {
              const d = byId.get(p.id);
              if (!d) return null;
              const hot = opened.includes(d.id);
              return (
                <article key={p.id} className={`d-card ${p.why}`}>
                  <div className="d-head">
                    <b>{label(d)}</b>
                    <span className="d-group">{d.group}</span>
                  </div>
                  <p className="d-why">{p.label}</p>
                  <p className="d-msg">{p.message}</p>
                  <div className="d-actions">
                    {d.phone ? (
                      <a className="d-btn wa" href={waLink(d.phone, p.message)} target="_blank" rel="noreferrer" onClick={() => setOpened((o) => [...o, d.id])}>WhatsApp</a>
                    ) : (
                      <button className="d-btn" onClick={() => copy(d, p.message)}>Copy message</button>
                    )}
                    <button className={`d-btn ${hot ? "hot" : ""}`} disabled={busy === d.id} onClick={() => mark(d, "sent")}>Sent ✓</button>
                  </div>
                  <div className="d-more">
                    <button disabled={busy === d.id} onClick={() => mark(d, "replied")}>Replied</button>
                    <button disabled={busy === d.id} onClick={() => mark(d, "donated")}>Gave</button>
                    <button disabled={busy === d.id} onClick={() => mark(d, "no")}>Not interested</button>
                  </div>
                </article>
              );
            })}
          </>
        ) : (
          <>
            <input className="d-search" placeholder="Search name or group" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="d-filters">
              {FILTERS.map((f) => {
                const n = f === "all" ? s.total : s.byStatus[f];
                return <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : STATUS_TEXT[f]} {n}</button>;
              })}
            </div>
            {rows.map((d) => <DonorRow key={d.id} d={d} manager={data.role === "manager"} busy={busy === d.id} onMark={mark} onSaved={load} onError={setErr} />)}
            {!rows.length && <p className="p-empty">No donors here.</p>}
            {data.role === "manager" && <AddDonor onSaved={load} onError={setErr} />}
          </>
        )}
      </div>

      {toast && (
        <div className="d-toast" role="status">
          <span>{toast.text}</span>
          {toast.id && <button onClick={() => { const d = byId.get(toast.id); if (d) void mark(d, "undo"); }}>Undo</button>}
        </div>
      )}
    </main>
  );
}

function DonorRow({ d, manager, busy, onMark, onSaved, onError }: { d: Row; manager: boolean; busy: boolean; onMark: (d: Donor, a: "sent" | "replied" | "donated" | "no" | "undo") => void; onSaved: () => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(d.phone ?? "");
  const savePhone = async () => {
    try {
      await api("/api/donors", "POST", { id: d.id, phone: phone.trim() });
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <article className={`d-row ${open ? "open" : ""}`}>
      <button className="d-row-top" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="d-name">{label(d)}<small>{d.group}{d.sends > 1 ? ` · messaged ${d.sends}×` : ""}</small></span>
        <span className={`d-pill ${d.status}`}>{STATUS_TEXT[d.status]}{d.amount ? ` · ${rs(d.amount)}` : ""}</span>
      </button>
      {open && (
        <div className="d-row-body">
          <div className="d-more">
            <button disabled={busy} onClick={() => onMark(d, "sent")}>Sent</button>
            <button disabled={busy} onClick={() => onMark(d, "replied")}>Replied</button>
            <button disabled={busy} onClick={() => onMark(d, "donated")}>Gave</button>
            <button disabled={busy} onClick={() => onMark(d, "no")}>No</button>
            {d.canUndo && <button disabled={busy} onClick={() => onMark(d, "undo")}>Undo</button>}
          </div>
          {manager && (
            <form className="d-phone" onSubmit={(e) => { e.preventDefault(); void savePhone(); }}>
              <input inputMode="tel" placeholder="WhatsApp number, like +923001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button type="submit">Save</button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function AddDonor({ onSaved, onError }: { onSaved: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const add = async () => {
    try {
      await api("/api/donors", "POST", { add: { name: name.trim(), phone: phone.trim() || undefined } });
      setName("");
      setPhone("");
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <form className="d-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <b>Add a donor</b>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input inputMode="tel" placeholder="WhatsApp number (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button type="submit" className="primary" disabled={!name.trim() && !phone.trim()}>Add</button>
    </form>
  );
}
