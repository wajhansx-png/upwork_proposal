"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, ChatMessage, Donor, Role, Settings } from "@/lib/types";
import type { Stats } from "@/lib/agent";

interface State {
  role: Role;
  settings: Settings;
  donors: Donor[];
  messages: ChatMessage[];
  stats: Stats;
  agent?: AgentState;
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
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

function fill(template: string, donor: Donor, teammate: string) {
  return template.replaceAll("{name}", donor.name.split(" ")[0]).replaceAll("{teammate}", teammate);
}

function dmLink(d: Donor, text: string): string | null {
  const c = d.contact.trim();
  switch (d.channel) {
    case "whatsapp":
      return `https://wa.me/${c.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
    case "email":
      return `mailto:${c}?subject=${encodeURIComponent("A thank you from our foundation")}&body=${encodeURIComponent(text)}`;
    case "instagram":
      return `https://ig.me/m/${c.replace(/^@/, "")}`;
    case "linkedin":
      return /^https?:\/\//.test(c) ? c : null;
    default:
      return /^https?:\/\//.test(c) ? c : null;
  }
}

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<State>("/api/state");
      setState(s);
      setLoggedOut(false);
      // Tab-open notification when a new message arrives and the tab is hidden.
      const inbound = s.messages.filter((m) => m.from !== s.role);
      const last = inbound.at(-1);
      if (last && seen.current && last.id !== seen.current && document.hidden && "Notification" in window && Notification.permission === "granted")
        new Notification(last.from === "agent" ? "Agent" : "New message", { body: last.text.slice(0, 140) });
      if (last) seen.current = last.id;
    } catch {
      setLoggedOut(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (loggedOut) return <Login onDone={refresh} />;
  if (!state) return <main><p className="hint">Loading…</p></main>;
  return state.role === "manager" ? <Manager s={state} refresh={refresh} /> : <Teammate s={state} refresh={refresh} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  return (
    <main className="login card">
      <h1>Donor Desk</h1>
      <p className="hint">Enter the code you were given.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/login", "POST", { code });
            onDone();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Access code" />
        {err && <p className="err">{err}</p>}
        <p><button className="primary" type="submit">Enter</button></p>
      </form>
    </main>
  );
}

function Header({ s, refresh }: { s: State; refresh: () => void }) {
  const [note, setNote] = useState("");
  const enable = async () => {
    try {
      if (!("Notification" in window)) return setNote("This browser does not support notifications.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setNote("Notifications are blocked. Allow them in the browser settings.");
      if (!s.vapidPublicKey || !("serviceWorker" in navigator)) return setNote("On. You will be alerted while this page is open. Phone push needs the server VAPID keys.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidPublicKey) }));
      await api("/api/push", "POST", sub.toJSON());
      setNote("Push notifications are on for this device.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <header>
      <h1>Donor Desk · {s.role === "manager" ? "Manager" : s.settings.teammateName}</h1>
      <div className="row">
        <button onClick={enable}>Turn on notifications</button>
        <button
          onClick={async () => {
            await api("/api/logout", "POST");
            refresh();
          }}
        >
          Log out
        </button>
      </div>
      {note && <p className="hint" style={{ width: "100%", margin: 0 }}>{note}</p>}
    </header>
  );
}

function Chat({ s, refresh, title }: { s: State; refresh: () => void; title: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [s.messages.length]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/messages", "POST", { text });
      setText("");
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="chat" ref={box}>
        {s.messages.length === 0 && <p className="hint">No messages yet.</p>}
        {s.messages.map((m) => (
          <div key={m.id} className={`msg ${m.from === s.role ? "me" : ""} ${m.from === "agent" ? "agent" : ""}`}>
            <small>
              {m.from === "agent" ? "Agent" : m.from === s.role ? "You" : m.from === "manager" ? "Manager" : s.settings.teammateName} ·{" "}
              {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
            </small>
            {m.text}
          </div>
        ))}
      </div>
      <div className="row">
        <input
          style={{ flex: 1 }}
          value={text}
          placeholder="Write a message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="primary" onClick={send} disabled={busy}>Send</button>
      </div>
    </section>
  );
}

function Teammate({ s, refresh }: { s: State; refresh: () => void }) {
  const [copied, setCopied] = useState("");
  const todo = s.donors.filter((d) => d.status === "todo");
  const done = s.donors.filter((d) => d.status === "sent" || d.status === "replied").slice().reverse();
  const set = async (id: string, status: Donor["status"]) => {
    await api(`/api/donors/${id}`, "PATCH", { status });
    refresh();
  };
  const pct = Math.min(100, Math.round((s.stats.sentToday / s.stats.target) * 100));
  return (
    <main>
      <Header s={s} refresh={refresh} />
      <div className="grid two">
        <div>
          <section className="card">
            <h2>Today: {s.stats.sentToday} of {s.stats.target} sent</h2>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <p className="hint">{s.stats.todo} donors waiting. After you send a DM, press &quot;Mark sent&quot;. That is how your manager sees your progress.</p>
          </section>
          <section className="card">
            <h2>Next donors</h2>
            {todo.length === 0 && <p className="hint">Everyone is done. Well done.</p>}
            {todo.slice(0, 10).map((d) => {
              const text = fill(s.settings.template, d, s.settings.teammateName);
              const link = dmLink(d, text);
              return (
                <div className="donor" key={d.id}>
                  <div className="row"><b>{d.name}</b><span className="tag">{d.channel}</span><span className="hint">{d.contact}</span></div>
                  {d.note && <p>Note: {d.note}</p>}
                  <p>{text}</p>
                  <div className="row">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(text).catch(() => undefined);
                        setCopied(d.id);
                      }}
                    >
                      {copied === d.id ? "Copied" : "Copy message"}
                    </button>
                    {link && <a href={link} target="_blank" rel="noreferrer"><button>Open {d.channel}</button></a>}
                    <button className="primary" onClick={() => set(d.id, "sent")}>Mark sent</button>
                    <button onClick={() => set(d.id, "skipped")}>Skip</button>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="card">
            <h2>Sent</h2>
            {done.length === 0 && <p className="hint">Nothing sent yet.</p>}
            {done.map((d) => (
              <div className="donor" key={d.id}>
                <div className="row">
                  <b>{d.name}</b>
                  <span className={`tag ${d.status}`}>{d.status}</span>
                  {d.status === "sent" && <button onClick={() => set(d.id, "replied")}>They replied</button>}
                  <button onClick={() => set(d.id, "todo")}>Undo</button>
                </div>
              </div>
            ))}
          </section>
        </div>
        <Chat s={s} refresh={refresh} title="Chat with your manager" />
      </div>
    </main>
  );
}

function Manager({ s, refresh }: { s: State; refresh: () => void }) {
  const [lines, setLines] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [form, setForm] = useState<Settings>(s.settings);
  const [asking, setAsking] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setMsg("");
      await fn();
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const st = s.stats;
  const mins = (t?: string) => (t ? `${Math.max(0, Math.round((new Date(s.now).getTime() - new Date(t).getTime()) / 60000))} min ago` : "never");
  const field = (k: keyof Settings, label: string, type = "text") => (
    <>
      <label>{label}</label>
      <input
        type={type}
        value={String(form[k])}
        onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })}
      />
    </>
  );
  return (
    <main>
      <Header s={s} refresh={refresh} />
      <section className="card">
        <div className="stats">
          <div className="stat"><b>{st.sentToday}/{st.target}</b><span>sent today</span></div>
          <div className="stat"><b>{st.todo}</b><span>waiting</span></div>
          <div className="stat"><b>{st.sent}</b><span>sent overall</span></div>
          <div className="stat"><b>{st.replied}</b><span>replied</span></div>
          <div className="stat"><b>{mins(st.lastActivityAt)}</b><span>last work</span></div>
          <div className="stat"><b>{mins(s.agent?.teammateLastSeenAt)}</b><span>last opened app</span></div>
        </div>
      </section>
      <div className="grid two">
        <div>
          <section className="card">
            <h2>Ask the agent</h2>
            <div className="row">
              <input style={{ flex: 1 }} value={q} placeholder="How is she doing today?" onChange={(e) => setQ(e.target.value)} />
              <button
                className="primary"
                disabled={asking}
                onClick={async () => {
                  setAsking(true);
                  try {
                    setAnswer((await api<{ answer: string }>("/api/agent/ask", "POST", { question: q || "How is she doing today?" })).answer);
                  } catch (e) {
                    setAnswer((e as Error).message);
                  } finally {
                    setAsking(false);
                  }
                }}
              >
                Ask
              </button>
            </div>
            {answer && <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>}
            <p className="hint">
              The agent checks every 10 minutes. Last check: {mins(s.agent?.lastRunAt)}. Last nudge: {mins(s.agent?.lastNudgeAt)}.{" "}
              <button onClick={() => run(async () => { const r = await api<{ action: string; reason: string }>("/api/agent/run", "POST"); setMsg(`${r.action}: ${r.reason}`); })}>Check now</button>
            </p>
            {msg && <p className="hint">{msg}</p>}
          </section>
          <section className="card">
            <h2>Add donors</h2>
            <p className="hint">One per line: name, channel, contact, note. Channels: whatsapp, email, instagram, linkedin, other.</p>
            <textarea value={lines} placeholder={"Amina Bello, whatsapp, +2348012345678, gave in March\nJohn Reed, email, john@example.com"} onChange={(e) => setLines(e.target.value)} />
            <p><button className="primary" onClick={() => run(async () => { await api("/api/donors", "POST", { lines }); setLines(""); })}>Add to queue</button></p>
          </section>
          <section className="card">
            <h2>Donors ({s.donors.length})</h2>
            {s.donors.length === 0 && <p className="hint">None yet.</p>}
            {s.donors.map((d) => (
              <div className="donor" key={d.id}>
                <div className="row">
                  <b>{d.name}</b><span className="tag">{d.channel}</span><span className={`tag ${d.status}`}>{d.status}</span>
                  <button onClick={() => run(() => api(`/api/donors/${d.id}`, "DELETE"))}>Remove</button>
                </div>
              </div>
            ))}
          </section>
        </div>
        <div>
          <Chat s={s} refresh={refresh} title={`Chat with ${s.settings.teammateName}`} />
          <section className="card">
            <h2>Settings</h2>
            {field("teammateName", "Teammate name")}
            {field("dailyTarget", "DMs per day", "number")}
            {field("timezone", "Timezone (e.g. Africa/Lagos)")}
            {field("workStartHour", "Work starts (hour, 0-23)", "number")}
            {field("workEndHour", "Work ends (hour, 1-24)", "number")}
            {field("stallHours", "Nudge after this many quiet hours", "number")}
            <label>Message template. Use {"{name}"} and {"{teammate}"}.</label>
            <textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />
            <p><button className="primary" onClick={() => run(() => api("/api/settings", "PUT", form))}>Save</button></p>
          </section>
        </div>
      </div>
    </main>
  );
}
