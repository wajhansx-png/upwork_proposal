"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, ChatMessage, Donor, Role, Settings, Task } from "@/lib/types";
import type { Stats } from "@/lib/agent";

interface State {
  role: Role;
  settings: Settings;
  donors: Donor[];
  tasks: Task[];
  messages: ChatMessage[];
  teammateMessages?: ChatMessage[];
  stats: Stats;
  agent?: AgentState;
  system?: { ai: "key" | "shared" | "off"; vision: boolean; push: boolean; persistent: boolean };
  teammateKey?: string;
  vapidPublicKey: string | null;
  now: string;
}

async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Something went wrong (${res.status})`);
  return data as T;
}

/** Makes a phone photo small enough to store: max 1000px, JPEG. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const fill = (tpl: string, d: Donor, teammate: string) =>
  tpl.replaceAll("{name}", d.name.split(" ")[0]).replaceAll("{teammate}", teammate);

function dmLink(d: Donor, text: string): string | null {
  const c = d.contact.trim();
  switch (d.channel) {
    case "whatsapp":
      return `https://wa.me/${c.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
    case "email":
      return `mailto:${c}?subject=${encodeURIComponent("A thank you from our foundation")}&body=${encodeURIComponent(text)}`;
    case "instagram":
      return `https://ig.me/m/${c.replace(/^@/, "")}`;
    default:
      return /^https?:\/\//.test(c) ? c : null;
  }
}

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

const clock = (iso: string) => new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState("");
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<State>("/api/state");
      setState(s);
      setProblem("");
      const last = s.messages.filter((m) => m.from !== "user").at(-1);
      if (last && seen.current && last.id !== seen.current && document.hidden && "Notification" in window && Notification.permission === "granted")
        new Notification("Donor Desk", { body: last.text.slice(0, 140) });
      if (last) seen.current = last.id;
    } catch {
      setProblem("not-signed-in");
    }
  }, []);

  useEffect(() => {
    const start = async () => {
      // The private link carries the key (?k=...). No password is ever typed.
      const k = new URLSearchParams(location.search).get("k");
      if (k) {
        try {
          await api("/api/login", "POST", { key: k });
          // Makes "Add to Home Screen" open the app already signed in.
          const link = document.createElement("link");
          link.rel = "manifest";
          link.href = `/api/manifest?k=${encodeURIComponent(k)}`;
          document.head.appendChild(link);
        } catch (e) {
          setProblem((e as Error).message);
          return;
        }
      }
      await refresh();
    };
    void start();
    // Look for news only while the page is open. Push alerts cover the rest.
    const t = setInterval(() => !document.hidden && void refresh(), 20_000);
    const vis = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh]);

  if (problem)
    return (
      <main className="login card">
        <h1>Donor Desk</h1>
        <p>{problem === "not-signed-in" ? "Please open your private link. The manager has it." : problem}</p>
        <p className="hint">If your link stopped working, ask the manager to make a new one.</p>
      </main>
    );
  if (!state) return <main><p className="hint">Loading…</p></main>;
  return state.role === "manager" ? <Manager s={state} refresh={refresh} /> : <Teammate s={state} refresh={refresh} />;
}

function Header({ s }: { s: State }) {
  const [note, setNote] = useState("");
  const [env, setEnv] = useState<{ ios: boolean; installed: boolean; granted: boolean } | null>(null);
  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnv({ ios, installed, granted: "Notification" in window && Notification.permission === "granted" });
  }, []);

  const enable = async () => {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator))
        return setNote("This browser cannot show alerts. On iPhone, add the app to your Home Screen first (see the box below).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setNote("Alerts are blocked. Allow them in your browser or phone settings, then try again.");
      if (!s.vapidPublicKey) return setNote("Allowed. But the server has no push keys, so alerts only show while this page is open.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidPublicKey) }));
      await api("/api/push", "POST", sub.toJSON());
      setEnv((e) => (e ? { ...e, granted: true } : e));
      setNote("Alerts are on for this phone. Press Send test to check. They work even when the app is closed.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <>
      <header>
        <h1>Donor Desk · {s.role === "manager" ? "Manager" : s.settings.teammateName}</h1>
        <div className="row">
          <button onClick={enable}>{env?.granted ? "Check alerts again" : "Turn on alerts"}</button>
          {env?.granted && (
            <button onClick={async () => setNote(await api("/api/push/test", "POST").then(() => "Test sent. Close the app and wait a few seconds.", (e: Error) => e.message))}>
              Send test
            </button>
          )}
        </div>
        {note && <p className="hint" style={{ width: "100%", margin: 0 }}>{note}</p>}
      </header>
      {env?.ios && !env.installed && (
        <section className="card warn">
          <h2>iPhone: do this first</h2>
          <p style={{ margin: 0 }}>
            Apple only allows alerts for apps on the Home Screen. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>. Open <b>Donor Desk</b> from the Home Screen.
            Then press <b>Turn on alerts</b>. You need iOS 16.4 or newer.
          </p>
        </section>
      )}
    </>
  );
}

function Thread({
  messages,
  label,
  mine,
  placeholder,
  hint,
  chips,
  onSend,
  canAttach,
}: {
  messages: ChatMessage[];
  label: (m: ChatMessage) => string;
  mine: (m: ChatMessage) => boolean;
  placeholder: string;
  hint: string;
  chips: string[];
  onSend: (text: string, image?: string) => Promise<void>;
  canAttach?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages.length, busy]);
  const send = async (t: string, image?: string) => {
    if ((!t.trim() && !image) || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSend(t, image);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="chat" ref={box}>
        {messages.length === 0 && <p className="hint">{hint}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${mine(m) ? "me" : m.from === "agent" ? "agent" : ""}`}>
            <small>{label(m)} · {clock(m.at)}</small>
            {m.img && (
              <a href={`/api/img/${m.img}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/img/${m.img}`} alt="Screenshot" className="shot" />
              </a>
            )}
            {m.text}
          </div>
        ))}
        {busy && <div className="msg agent"><small>Agent</small>Thinking…</div>}
      </div>
      {chips.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          {chips.map((c) => (
            <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>{c}</button>
          ))}
        </div>
      )}
      <div className="row">
        {canAttach && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  await send(text, await shrink(f));
                } catch {
                  setErr("Could not read that image.");
                }
              }}
            />
            <button onClick={() => file.current?.click()} disabled={busy} aria-label="Add screenshot">📎</button>
          </>
        )}
        <input style={{ flex: 1 }} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
        <button className="primary" onClick={() => send(text)} disabled={busy}>Send</button>
      </div>
      {err && <p className="err">{err}</p>}
    </>
  );
}

function TaskBar({ s, t }: { s: State; t: Task }) {
  const mine = s.donors.filter((d) => d.sentAt && d.sentAt >= t.createdAt);
  const done = t.kind === "general" ? (t.status === "review" || t.status === "done" ? 1 : 0) : mine.length;
  const pct = Math.min(100, Math.round((done / t.target) * 100));
  const flagged = mine.filter((d) => d.flags.length).length;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{t.title}</b>
        <span className={`tag ${t.status}`}>{t.status}</span>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <p className="hint" style={{ margin: 0 }}>
        {done} of {t.target} done · due {clock(t.deadlineAt)}
        {flagged > 0 && <span className="err"> · {flagged} not verified</span>}
      </p>
    </>
  );
}

const VERDICT: Record<string, string> = { match: "screenshot OK", mismatch: "screenshot wrong", unclear: "screenshot unclear", unchecked: "screenshot not read" };

function Teammate({ s, refresh }: { s: State; refresh: () => void }) {
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const pickFor = useRef("");
  const open = s.tasks.filter((t) => t.status === "open");
  const todo = s.donors.filter((d) => d.status === "todo");
  const done = s.donors.filter((d) => d.status === "sent" || d.status === "replied").slice().reverse();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setErr("");
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const prepare = (id: string) => api(`/api/donors/${id}/prepare`, "POST").catch(() => undefined);
  const set = (id: string, status: Donor["status"], extra: object = {}) => run(() => api(`/api/donors/${id}`, "PATCH", { status, ...extra }));
  const markSent = (id: string) => {
    if (!s.settings.requireProof) return set(id, "sent");
    pickFor.current = id;
    pick.current?.click();
  };
  return (
    <main>
      <Header s={s} />
      <input
        ref={pick}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          const id = pickFor.current;
          if (!f || !id) return;
          setBusyId(id);
          try {
            await set(id, "sent", { image: await shrink(f) });
          } finally {
            setBusyId("");
          }
        }}
      />
      <div className="grid two">
        <div>
          <section className="card">
            <h2>Your task</h2>
            {open.length === 0 && <p className="hint">No task now. Your manager will give you one.</p>}
            {open.map((t) => (
              <div key={t.id} style={{ marginBottom: 10 }}>
                <TaskBar s={s} t={t} />
                {t.kind === "general" && (
                  <p>
                    <button
                      className="primary"
                      onClick={() => {
                        const note = prompt("What did you do? Write a short note.");
                        if (note) void run(() => api(`/api/tasks/${t.id}`, "PATCH", { action: "complete", note }));
                      }}
                    >
                      I finished this
                    </button>
                  </p>
                )}
              </div>
            ))}
            {err && <p className="err">{err}</p>}
          </section>
          <section className="card">
            <h2>Next donors ({todo.length})</h2>
            <p className="hint">Copy the message, send it, then press Mark sent{s.settings.requireProof ? " and add a screenshot of what you sent" : ""}.</p>
            {todo.length === 0 && <p className="hint">All done. Well done.</p>}
            {todo.slice(0, 10).map((d) => {
              const text = fill(s.settings.template, d, s.settings.teammateName);
              const link = dmLink(d, text);
              return (
                <div className="donor" key={d.id}>
                  <div className="row"><b>{d.name}</b><span className="tag">{d.channel}</span><span className="hint">{d.contact}</span></div>
                  {d.note && <p>Note: {d.note}</p>}
                  <p>{text}</p>
                  <div className="row">
                    <button onClick={async () => { void prepare(d.id); await navigator.clipboard.writeText(text).catch(() => undefined); setCopied(d.id); }}>
                      {copied === d.id ? "Copied" : "Copy message"}
                    </button>
                    {link && <a href={link} target="_blank" rel="noreferrer" onClick={() => void prepare(d.id)}><button>Open {d.channel}</button></a>}
                    <button className="primary" disabled={busyId === d.id} onClick={() => markSent(d.id)}>{busyId === d.id ? "Sending…" : "Mark sent"}</button>
                    <button onClick={() => set(d.id, "skipped")}>Skip</button>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="card">
            <h2>Sent ({done.length})</h2>
            {done.length === 0 && <p className="hint">Nothing sent yet.</p>}
            {done.map((d) => (
              <div className="donor" key={d.id}>
                <div className="row">
                  <b>{d.name}</b>
                  <span className={`tag ${d.status}`}>{d.status}</span>
                  {d.proofCheck && <span className={`tag v-${d.proofCheck.verdict}`}>{VERDICT[d.proofCheck.verdict]}</span>}
                  {d.status === "sent" && (
                    <button onClick={() => { const r = prompt(`Paste what ${d.name} replied. This is your proof.`); if (r) void set(d.id, "replied", { replyText: r }); }}>They replied</button>
                  )}
                  <button onClick={() => set(d.id, "todo")}>Undo</button>
                </div>
                {d.proofCheck && d.proofCheck.verdict !== "match" && d.proofCheck.verdict !== "unchecked" && <p className="err">{d.proofCheck.reason}</p>}
              </div>
            ))}
          </section>
        </div>
        <section className="card">
          <h2>Chat</h2>
          <Thread
            messages={s.messages}
            label={(m) => (m.from === "user" ? "You" : m.from === "manager" ? "Manager" : "Agent")}
            mine={(m) => m.from === "user"}
            placeholder="Write your answer"
            hint="Your answers show here. You can add a screenshot with the 📎 button."
            chips={["Going well", "I have a problem", "What is next?"]}
            canAttach
            onSend={async (text, image) => {
              await api("/api/messages", "POST", { text, image });
              await refresh();
            }}
          />
        </section>
      </div>
    </main>
  );
}

function Manager({ s, refresh }: { s: State; refresh: () => void }) {
  const [tab, setTab] = useState<"agent" | "her">("agent");
  const [lines, setLines] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<Settings>(s.settings);
  const name = s.settings.teammateName;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setMsg("");
      await fn();
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const st = s.stats;
  const ago = (t?: string) => {
    if (!t) return "never";
    const m = Math.max(0, Math.round((new Date(s.now).getTime() - new Date(t).getTime()) / 60000));
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  const active = s.tasks.filter((t) => t.status === "open" || t.status === "review");
  const past = s.tasks.filter((t) => !(t.status === "open" || t.status === "review")).slice(-5).reverse();
  const flagged = s.donors.filter((d) => d.sentAt && d.flags.length);
  const link = typeof window !== "undefined" && s.teammateKey ? `${location.origin}/?k=${s.teammateKey}` : "";
  const sys = s.system;
  const aiBad = s.agent?.llmStatus?.startsWith("error") && sys?.ai === "key";
  const field = (k: keyof Settings, label: string, type = "text") => (
    <>
      <label>{label}</label>
      <input type={type} value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })} />
    </>
  );
  return (
    <main>
      <Header s={s} />
      {sys && (!sys.push || !sys.persistent || sys.ai !== "key" || aiBad) && (
        <section className="card warn">
          <h2>Still to set up</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {!sys.push && <li>Alerts for a closed app need push keys. See the setup steps.</li>}
            {!sys.persistent && <li>No database yet. Your data is saved on this computer only. On the internet it would be lost.</li>}
            {sys.ai !== "key" && <li>No AI key. The agent understands short clear sentences only, and does <b>not</b> read screenshots. Add one free Gemini key to fix both.</li>}
            {aiBad && <li>The AI key has an error: {s.agent?.llmStatus}</li>}
          </ul>
        </section>
      )}
      <section className="card">
        <div className="stats">
          <div className="stat"><b>{st.sentToday}</b><span>sent today</span></div>
          <div className="stat"><b>{st.todo}</b><span>waiting</span></div>
          <div className="stat"><b>{st.replied}</b><span>replied</span></div>
          <div className="stat"><b className={st.flagged ? "err" : ""}>{st.flagged}</b><span>not verified</span></div>
          <div className="stat"><b>{ago(st.lastActivityAt)}</b><span>last real work</span></div>
          <div className="stat"><b>{ago(s.agent?.teammateLastSeenAt)}</b><span>last opened app</span></div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Agent checked {ago(s.agent?.lastRunAt)}.{" "}
          <button onClick={() => run(async () => { const r = await api<{ actions: string[] }>("/api/agent/run", "POST"); setMsg(r.actions.length ? `Done: ${r.actions.join(", ")}` : "Checked. Nothing to do."); })}>Check now</button>
          {msg && <span> {msg}</span>}
        </p>
      </section>
      <div className="grid two">
        <div>
          <section className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={tab === "agent" ? "primary" : ""} onClick={() => setTab("agent")}>Tell the agent</button>
              <button className={tab === "her" ? "primary" : ""} onClick={() => setTab("her")}>{name}&apos;s chat</button>
            </div>
            {tab === "agent" ? (
              <Thread
                messages={s.messages}
                label={(m) => (m.from === "user" ? "You" : "Agent")}
                mine={(m) => m.from === "user"}
                placeholder={`Example: ${name} send 20 DMs by 5pm, check every 20 min`}
                hint={`Tell me the task, the time, and how often to check. Example: "${name} send 20 DMs by 5pm, check every 20 min". I talk to ${name}, wait for her answers, check them, and tell you.`}
                chips={[`${name} send ${s.settings.dailyTarget} DMs by 5pm, check every 20 min`, `How is ${name} doing?`, "cancel"]}
                onSend={async (text) => {
                  await api("/api/messages", "POST", { text });
                  await refresh();
                }}
              />
            ) : (
              <>
                <p className="hint" style={{ marginTop: 0 }}>You see everything the agent and {name} write. If you write here, the agent stays quiet for 30 minutes.</p>
                <Thread
                  messages={s.teammateMessages ?? []}
                  label={(m) => (m.from === "user" ? name : m.from === "manager" ? "You" : "Agent")}
                  mine={(m) => m.from === "manager"}
                  placeholder={`Write to ${name}`}
                  hint={`No messages with ${name} yet.`}
                  chips={[]}
                  onSend={async (text) => {
                    await api("/api/messages", "POST", { text, to: "teammate" });
                    await refresh();
                  }}
                />
              </>
            )}
          </section>
          <section className="card">
            <h2>Tasks</h2>
            {active.length === 0 && <p className="hint">No open task. Tell the agent what to assign.</p>}
            {active.map((t) => (
              <div className="donor" key={t.id}>
                <TaskBar s={s} t={t} />
                {t.note && <p>{name}&apos;s note: {t.note}</p>}
                <div className="row" style={{ marginTop: 6 }}>
                  {t.status === "review" && <button className="primary" onClick={() => run(() => api(`/api/tasks/${t.id}`, "PATCH", { action: "confirm" }))}>Confirm done</button>}
                  <button onClick={() => run(() => api(`/api/tasks/${t.id}`, "PATCH", { action: "cancel" }))}>Cancel</button>
                </div>
              </div>
            ))}
            {past.length > 0 && <h2 style={{ marginTop: 14 }}>Recent</h2>}
            {past.map((t) => (<div className="donor" key={t.id}><TaskBar s={s} t={t} /></div>))}
          </section>
          {flagged.length > 0 && (
            <section className="card">
              <h2>Marks to check</h2>
              <p className="hint">The app cannot see the DMs. These marks looked wrong. Ask {name} about them.</p>
              {flagged.map((d) => (<div className="donor" key={d.id}><b>{d.name}</b><p>{d.flags.join("; ")}</p></div>))}
            </section>
          )}
        </div>
        <div>
          <section className="card">
            <h2>{name}&apos;s link</h2>
            <p className="hint">Send this link to {name}. She opens it and she is in. No password. Keep it private.</p>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
              <button onClick={() => { if (confirm(`Make a new link? The old link stops working for ${name}.`)) void run(() => api("/api/teammate-link", "POST")); }}>Make new link</button>
            </div>
          </section>
          <section className="card">
            <h2>Add donors</h2>
            <p className="hint">One per line: name, channel, contact, note. Channels: whatsapp, email, instagram, linkedin, other.</p>
            <textarea value={lines} placeholder={"Amina Bello, whatsapp, +2348012345678, gave in March\nJohn Reed, email, john@example.com"} onChange={(e) => setLines(e.target.value)} />
            <p><button className="primary" onClick={() => run(async () => { await api("/api/donors", "POST", { lines }); setLines(""); })}>Add to list</button></p>
          </section>
          <section className="card">
            <h2>Donors ({s.donors.length})</h2>
            {s.donors.length === 0 && <p className="hint">None yet.</p>}
            {s.donors.map((d) => (
              <div className="donor" key={d.id}>
                <div className="row">
                  <b>{d.name}</b><span className="tag">{d.channel}</span><span className={`tag ${d.status}`}>{d.status}</span>
                  {d.proofCheck && <span className={`tag v-${d.proofCheck.verdict}`}>{VERDICT[d.proofCheck.verdict]}</span>}
                  <button onClick={() => run(() => api(`/api/donors/${d.id}`, "DELETE"))}>Remove</button>
                </div>
                {d.proofImg && (
                  <p>
                    <a href={`/api/img/${d.proofImg}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/img/${d.proofImg}`} alt={`Proof for ${d.name}`} className="shot" />
                    </a>
                    {d.proofCheck && <span className="hint">{d.proofCheck.reason}</span>}
                  </p>
                )}
                {d.flags.length > 0 && <p className="err">{d.flags.join("; ")}</p>}
                {d.replyText && <p>Reply: &quot;{d.replyText}&quot;</p>}
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Settings</h2>
            {field("teammateName", "Teammate name")}
            {field("dailyTarget", "DMs per task when you give no number", "number")}
            {field("timezone", "Your timezone (example: Africa/Lagos)")}
            {field("workStartHour", "Work starts (hour, 0-23)", "number")}
            {field("workEndHour", "Work ends (hour, 1-24). Daily report is sent then.", "number")}
            {field("checkinMinutes", "Ask for an update every (minutes)", "number")}
            <label><input type="checkbox" style={{ width: "auto" }} checked={form.requireProof} onChange={(e) => setForm({ ...form, requireProof: e.target.checked })} /> Every &quot;Mark sent&quot; needs a screenshot</label>
            <label>Message template. Use {"{name}"} and {"{teammate}"}.</label>
            <textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />
            <p><button className="primary" onClick={() => run(() => api("/api/settings", "PUT", form))}>Save</button></p>
          </section>
        </div>
      </div>
    </main>
  );
}
