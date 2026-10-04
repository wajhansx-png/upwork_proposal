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
  stats: Stats;
  agent?: AgentState;
  system?: { llm: boolean; push: boolean; persistent: boolean };
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

const clock = (iso: string) =>
  new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<State>("/api/state");
      setState(s);
      setLoggedOut(false);
      const last = s.messages.filter((m) => m.from === "agent").at(-1);
      if (last && seen.current && last.id !== seen.current && document.hidden && "Notification" in window && Notification.permission === "granted")
        new Notification("Donor Desk", { body: last.text.slice(0, 140) });
      if (last) seen.current = last.id;
    } catch {
      setLoggedOut(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // Poll only while the page is visible. Push covers the rest.
    const t = setInterval(() => !document.hidden && void refresh(), 12_000);
    const vis = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
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
        <input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Access code" />
        {err && <p className="err">{err}</p>}
        <p><button className="primary" type="submit">Enter</button></p>
      </form>
    </main>
  );
}

function Header({ s, refresh }: { s: State; refresh: () => void }) {
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
      if (!("Notification" in window) || !("serviceWorker" in navigator)) return setNote("This browser cannot show notifications. On iPhone, add the app to your Home Screen first (see the box above).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setNote("Notifications are blocked. Allow them in the browser or phone settings, then try again.");
      if (!s.vapidPublicKey) return setNote("Allowed, but the server has no push keys, so alerts only appear while this page is open.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidPublicKey) }));
      await api("/api/push", "POST", sub.toJSON());
      setEnv((e) => (e ? { ...e, granted: true } : e));
      setNote("Push is on for this device. Press Send test to check it. It works with the app closed.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <>
      <header>
        <h1>Donor Desk · {s.role === "manager" ? "Manager" : s.settings.teammateName}</h1>
        <div className="row">
          <button onClick={enable}>{env?.granted ? "Re-check notifications" : "Turn on notifications"}</button>
          {env?.granted && (
            <button onClick={async () => setNote(await api("/api/push/test", "POST").then(() => "Test sent. Close the app and wait a few seconds.", (e: Error) => e.message))}>
              Send test
            </button>
          )}
          <button onClick={async () => { await api("/api/logout", "POST"); refresh(); }}>Log out</button>
        </div>
        {note && <p className="hint" style={{ width: "100%", margin: 0 }}>{note}</p>}
      </header>
      {env?.ios && !env.installed && (
        <section className="card warn">
          <h2>iPhone: one step first</h2>
          <p style={{ margin: 0 }}>
            Apple only allows notifications for apps on the Home Screen. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>, then open <b>Donor Desk</b> from the Home Screen,
            log in, and press <b>Turn on notifications</b>. Needs iOS 16.4 or newer.
          </p>
        </section>
      )}
    </>
  );
}

function AgentChat({ s, refresh, title, hint, chips }: { s: State; refresh: () => void; title: string; hint: string; chips: string[] }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [s.messages.length, busy]);
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/messages", "POST", { text: t });
      setText("");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="chat" ref={box}>
        {s.messages.length === 0 && <p className="hint">{hint}</p>}
        {s.messages.map((m) => (
          <div key={m.id} className={`msg ${m.from === "user" ? "me" : "agent"}`}>
            <small>{m.from === "user" ? "You" : "Agent"} · {clock(m.at)}</small>
            {m.text}
          </div>
        ))}
        {busy && <div className="msg agent"><small>Agent</small>Thinking…</div>}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        {chips.map((c) => (
          <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <div className="row">
        <input style={{ flex: 1 }} value={text} placeholder="Write a message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
        <button className="primary" onClick={() => send(text)} disabled={busy}>Send</button>
      </div>
      {err && <p className="err">{err}</p>}
    </section>
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
        {done} of {t.target} · due {clock(t.deadlineAt)}
        {flagged > 0 && <span className="err"> · {flagged} unverified</span>}
      </p>
    </>
  );
}

function Teammate({ s, refresh }: { s: State; refresh: () => void }) {
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");
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
  const set = (id: string, status: Donor["status"], replyText?: string) => run(() => api(`/api/donors/${id}`, "PATCH", { status, replyText }));
  return (
    <main>
      <Header s={s} refresh={refresh} />
      <div className="grid two">
        <div>
          <section className="card">
            <h2>Your task</h2>
            {open.length === 0 && <p className="hint">No task right now. Your manager will assign one.</p>}
            {open.map((t) => (
              <div key={t.id} style={{ marginBottom: 10 }}>
                <TaskBar s={s} t={t} />
                {t.kind === "general" && (
                  <p><button className="primary" onClick={() => { const note = prompt("What did you do? Write a short note."); if (note) void run(() => api(`/api/tasks/${t.id}`, "PATCH", { action: "complete", note })); }}>Mark done</button></p>
                )}
              </div>
            ))}
            {err && <p className="err">{err}</p>}
          </section>
          <section className="card">
            <h2>Next donors ({todo.length})</h2>
            <p className="hint">Copy or open the message, send it, then press Mark sent. Your manager sees progress from this.</p>
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
                    <button onClick={async () => { void prepare(d.id); await navigator.clipboard.writeText(text).catch(() => undefined); setCopied(d.id); }}>
                      {copied === d.id ? "Copied" : "Copy message"}
                    </button>
                    {link && <a href={link} target="_blank" rel="noreferrer" onClick={() => void prepare(d.id)}><button>Open {d.channel}</button></a>}
                    <button className="primary" onClick={() => set(d.id, "sent")}>Mark sent</button>
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
                  {d.status === "sent" && (
                    <button onClick={() => { const r = prompt(`Paste what ${d.name} replied. This is your proof.`); if (r) void set(d.id, "replied", r); }}>They replied</button>
                  )}
                  <button onClick={() => set(d.id, "todo")}>Undo</button>
                </div>
              </div>
            ))}
          </section>
        </div>
        <AgentChat
          s={s}
          refresh={refresh}
          title="Chat with the agent"
          hint="The agent will message you here about your task. Reply with updates, questions, or problems."
          chips={["Update: going well", "I have a problem", "What is next?"]}
        />
      </div>
    </main>
  );
}

function Manager({ s, refresh }: { s: State; refresh: () => void }) {
  const [lines, setLines] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<Settings>(s.settings);
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
  const field = (k: keyof Settings, label: string, type = "text") => (
    <>
      <label>{label}</label>
      <input type={type} value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })} />
    </>
  );
  return (
    <main>
      <Header s={s} refresh={refresh} />
      {s.system && (!s.system.push || !s.system.persistent || !s.system.llm || (s.agent?.llmStatus && s.agent.llmStatus.startsWith("error"))) && (
        <section className="card warn">
          <h2>Setup still needed</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {!s.system.push && <li>Push keys are missing. No alerts when the app is closed. Run <code>npm run vapid</code> and set the keys.</li>}
            {!s.system.persistent && <li>No database is set. Data lives in a local file. Fine on your own computer, but it will be lost on Vercel.</li>}
            {!s.system.llm && <li>No free AI key set. The agent understands simple sentences only (&quot;Send 20 DMs by 5pm&quot;). Add a Groq or Gemini key for natural chat.</li>}
            {s.agent?.llmStatus?.startsWith("error") && <li>The AI key failed: {s.agent.llmStatus}. The agent is using simple rules until you fix it.</li>}
          </ul>
        </section>
      )}
      <section className="card">
        <div className="stats">
          <div className="stat"><b>{st.sentToday}</b><span>marked sent today</span></div>
          <div className="stat"><b>{st.todo}</b><span>waiting</span></div>
          <div className="stat"><b>{st.replied}</b><span>replied</span></div>
          <div className="stat"><b className={st.flagged ? "err" : ""}>{st.flagged}</b><span>unverified marks</span></div>
          <div className="stat"><b>{ago(st.lastActivityAt)}</b><span>last real work</span></div>
          <div className="stat"><b>{ago(s.agent?.teammateLastSeenAt)}</b><span>last opened app</span></div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Agent last ran {ago(s.agent?.lastRunAt)}.{" "}
          <button onClick={() => run(async () => { const r = await api<{ actions: string[] }>("/api/agent/run", "POST"); setMsg(r.actions.length ? `Done: ${r.actions.join(", ")}` : "Checked. Nothing needed doing."); })}>Run check now</button>
          {msg && <span> {msg}</span>}
        </p>
      </section>
      <div className="grid two">
        <div>
          <AgentChat
            s={s}
            refresh={refresh}
            title="Your agent"
            hint={`Tell me what ${s.settings.teammateName} should do and by when. Example: "Send 20 DMs by 5pm". I will chase her, check her updates against the app, and report to you.`}
            chips={["How is she doing?", `Send ${s.settings.dailyTarget} DMs by 5pm`, "cancel"]}
          />
          <section className="card">
            <h2>Tasks</h2>
            {active.length === 0 && <p className="hint">No open task. Tell the agent what to assign.</p>}
            {active.map((t) => (
              <div className="donor" key={t.id}>
                <TaskBar s={s} t={t} />
                {t.note && <p>Her note: {t.note}</p>}
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
              <h2>Marks that look unreliable</h2>
              <p className="hint">The app cannot see her DMs. These are marks where her behavior in the app looked off. Ask her about them.</p>
              {flagged.map((d) => (<div className="donor" key={d.id}><b>{d.name}</b><p>{d.flags.join("; ")}</p></div>))}
            </section>
          )}
        </div>
        <div>
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
                  {d.flags.length > 0 && <span className="err">unverified</span>}
                  <button onClick={() => run(() => api(`/api/donors/${d.id}`, "DELETE"))}>Remove</button>
                </div>
                {d.replyText && <p>Reply: &quot;{d.replyText}&quot;</p>}
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Settings</h2>
            {field("teammateName", "Teammate name")}
            {field("dailyTarget", "Default DMs per task (when you give no number)", "number")}
            {field("timezone", "Your timezone (e.g. Africa/Lagos)")}
            {field("workStartHour", "Work starts (hour, 0-23)", "number")}
            {field("workEndHour", "Work ends (hour, 1-24). Daily report is sent then.", "number")}
            {field("checkinMinutes", "Check in with her every (minutes)", "number")}
            <label>Message template. Use {"{name}"} and {"{teammate}"}.</label>
            <textarea value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />
            <p><button className="primary" onClick={() => run(() => api("/api/settings", "PUT", form))}>Save</button></p>
          </section>
        </div>
      </div>
    </main>
  );
}
