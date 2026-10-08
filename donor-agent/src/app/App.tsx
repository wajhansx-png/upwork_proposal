"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, ChatMessage, Role, Settings, Task } from "@/lib/types";

interface State {
  role: Role;
  settings: Settings;
  tasks: Task[];
  messages: ChatMessage[];
  agent?: AgentState;
  system?: { ai: "key" | "shared" | "off"; vision: boolean; push: boolean; persistent: boolean };
  vapidPublicKey: string | null;
  now: string;
}

const AGENT = "Wajdan";

// ---------- helpers ----------

/** Which page this is. Sent with every call, so both pages can be open in one browser. */
const pageRole = (): Role => (location.pathname.startsWith("/manager") ? "manager" : "teammate");

async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "x-as": pageRole(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Something went wrong (${res.status})`), { status: res.status });
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

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function countdown(ms: number) {
  if (ms <= 0) return "time is up";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}h ` : ""}${String(m).padStart(h ? 2 : 1, "0")}m ${String(sec).padStart(2, "0")}s left`;
}

const currentTask = (s: State) => [...s.tasks].reverse().find((t) => t.status === "open" || t.status === "review");

// ---------- page ----------

export default function App({ entry }: { entry: "manager" | "teammate" }) {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setProblem("");
    } catch (e) {
      if ((e as { status?: number }).status === 401) setProblem("not-signed-in");
    }
  }, []);

  useEffect(() => {
    const start = async () => {
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = `/api/manifest?for=${entry === "manager" ? "manager" : "areeba"}`;
      document.head.appendChild(link);
      if (entry === "manager") {
        const code = new URLSearchParams(location.search).get("k");
        if (code) {
          try {
            await api("/api/login", "POST", { code });
          } catch (e) {
            setProblem((e as Error).message);
            return;
          } finally {
            history.replaceState(null, "", "/manager");
          }
        }
        void reclaimAlerts();
      }
      await refresh();
    };
    void start();
    const t = setInterval(() => !document.hidden && void refresh(), 5_000);
    const runner = setInterval(async () => {
      if (document.hidden) return;
      await api("/api/agent/run", "POST").catch(() => undefined);
    }, 60_000);
    const vis = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      clearInterval(runner);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh, entry]);

  if (problem)
    return (
      <main className="login card">
        <h1>Donor Desk</h1>
        <p>{problem === "not-signed-in" ? "Please open your private manager link once on this phone." : problem}</p>
      </main>
    );
  if (!state) return <main><p className="hint">Loading…</p></main>;
  return entry === "manager" ? <Manager s={state} refresh={refresh} /> : <Teammate s={state} refresh={refresh} />;
}

/** If this phone already has alerts, make sure they are saved as the manager's, not Areeba's. */
async function reclaimAlerts() {
  if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) await api("/api/push", "POST", sub.toJSON()).catch(() => undefined);
}

function useAlerts(s: State) {
  const [note, setNote] = useState("");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    const granted = "Notification" in window && Notification.permission === "granted";
    if (!granted || !("serviceWorker" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubscribed(false);
      return;
    }
    void navigator.serviceWorker.getRegistration("/").then(async (reg) => setSubscribed(!!(reg && (await reg.pushManager.getSubscription())))).catch(() => setSubscribed(false));
  }, []);
  const enable = async () => {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator))
        return setNote("This browser cannot show alerts. On iPhone, add the app to your Home Screen first.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setNote("Alerts are blocked. Allow them in your phone settings, then try again.");
      if (!s.vapidPublicKey) return setNote("The server has no push keys yet.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidPublicKey) }));
      await api("/api/push", "POST", sub.toJSON());
      setSubscribed(true);
      setNote("Alerts are on. They work even when Chrome is closed.");
    } catch (e) {
      setSubscribed(false);
      setNote((e as Error).message);
    }
  };
  const test = async (to?: Role) =>
    setNote(
      await api("/api/push/test", "POST", to ? { to } : {}).then(
        () => (to === "teammate" ? `Test alert sent to ${s.settings.teammateName}'s phone.` : "Test alert sent to this phone."),
        (e: Error) => e.message,
      ),
    );
  return { subscribed, note, enable, test };
}

// ---------- manager ----------

function Manager({ s, refresh }: { s: State; refresh: () => void }) {
  const name = s.settings.teammateName;
  const task = currentTask(s) ?? s.tasks.at(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null);
  const lastAgentAtSend = useRef<string | undefined>(undefined);
  const thread = useRef<HTMLDivElement>(null);
  const conversation = s.messages.slice(-40);
  const lastAgentId = conversation.filter((m) => m.from === "agent").at(-1)?.id;
  const displayed = optimistic ? [...conversation, optimistic] : conversation;
  const lastId = displayed.at(-1)?.id;
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, busy, chatOpen]);
  useEffect(() => {
    if (busy && lastAgentId && lastAgentId !== lastAgentAtSend.current) {
      setBusy(false);
      setOptimistic(null);
    }
  }, [busy, lastAgentId]);
  const send = async () => {
    if (busy || !text.trim()) return;
    const outgoing = text.trim();
    lastAgentAtSend.current = lastAgentId;
    setOptimistic({ id: `pending-${Date.now()}`, owner: "manager", from: "user", text: outgoing, at: new Date().toISOString() });
    setText("");
    setBusy(true);
    setError("");
    try {
      await api("/api/messages", "POST", { text: outgoing });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setOptimistic(null);
    }
  };
  const sent = task?.kind === "dms" ? task.reportedDone ?? 0 : task && (task.status === "review" || task.status === "done") ? 1 : 0;
  const target = task?.kind === "dms" ? task.target : task ? 1 : 0;
  return (
    <main className="mgr">
      <header className="mgr-top">
        <button className="small" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </header>
      <section className={`mgr-center ${chatOpen ? "up" : ""}`} aria-live="polite">
        <strong className="mgr-count">{sent}/{target}</strong>
        <div className="bar mgr-bar"><i style={{ width: `${target ? Math.min(100, Math.round((sent / target) * 100)) : 0}%` }} /></div>
        {!task && <p className="hint">No task yet. Open the chat to give {name} one.</p>}
      </section>
      <button className="chat-toggle" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
        Chat {chatOpen ? "▴" : "▾"}
      </button>
      {chatOpen && (
        <section className="desk-conversation">
          <div className="desk-messages" ref={thread}>
            {!conversation.length && <p className="hint">Tell me the task, like: “{name} send 100 DMs by 9pm”.</p>}
            {displayed.map((m) => (
              <div key={m.id} className={`desk-message ${m.from === "user" ? "mine" : "agent"}`}>
                <small>{m.from === "user" ? "You" : AGENT} · {time(m.at)}</small>
                {m.img && (
                  <a href={`/api/img/${m.img}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/img/${m.img}`} alt="Picture from Areeba" className="shot" />
                  </a>
                )}
                {m.text}
              </div>
            ))}
            {busy && <p className="typing-indicator"><i /><i /><i /> typing</p>}
          </div>
          <form className="desk-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input aria-label={`Talk to ${AGENT}`} placeholder="Give a task or ask for an update…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="primary" disabled={busy || !text.trim()}>Send</button>
          </form>
          {error && <p role="alert" className="err">{error}</p>}
        </section>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title"><h2>Settings</h2><button autoFocus className="modal-close" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></div>
            <ManagerSettings s={s} refresh={refresh} />
          </section>
        </div>
      )}
    </main>
  );
}

function ManagerSettings({ s, refresh }: { s: State; refresh: () => void }) {
  const name = s.settings.teammateName;
  const [teammateName, setTeammateName] = useState(name);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const a = useAlerts(s);
  const link = typeof window !== "undefined" ? `${location.origin}/areeba` : "/areeba";
  const aiError = s.system?.ai === "key" && s.agent?.llmStatus?.startsWith("error");
  return (
    <>
      <section className="card">
        <h2>Alerts</h2>
        <div className="row">
          <button className="primary" onClick={a.enable}>{a.subscribed ? "Alerts are on" : "Turn on alerts"}</button>
          <button onClick={() => void a.test()}>Test my phone</button>
          <button onClick={() => void a.test("teammate")}>Test {name}&apos;s phone</button>
        </div>
        {a.note && <p className="hint" style={{ marginTop: 8 }}>{a.note}</p>}
      </section>
      <section className="card">
        <h2>{name}&apos;s link</h2>
        <div className="row">
          <input className="grow" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={`${name}'s link`} />
          <button onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </section>
      <section className="card">
        <label htmlFor="f-name" style={{ marginTop: 0 }}>Teammate name</label>
        <div className="row">
          <input id="f-name" className="grow" value={teammateName} onChange={(e) => setTeammateName(e.target.value)} />
          <button
            onClick={async () => {
              try {
                await api("/api/settings", "PUT", { ...s.settings, teammateName: teammateName.trim() || name });
                setMsg("Saved.");
                refresh();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
          >
            Save
          </button>
        </div>
        {msg && <p className="hint">{msg}</p>}
      </section>
      {aiError && <p className="err">AI problem: {s.agent!.llmStatus}</p>}
    </>
  );
}

// ---------- Areeba ----------

function Teammate({ s, refresh }: { s: State; refresh: () => void }) {
  const name = s.settings.teammateName;
  const task = currentTask(s) ?? (s.tasks.at(-1)?.status === "missed" ? s.tasks.at(-1) : undefined);
  const alerts = useAlerts(s);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [local, setLocal] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = task?.reportedDone ?? 0;
  const target = task?.target ?? 0;
  const value = local ?? done;
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null);
  const messages = s.messages;
  const displayed = optimistic ? [...messages, optimistic] : messages;
  const lastAgentId = messages.filter((m) => m.from !== "user").at(-1)?.id;
  const lastAgentAtSend = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const lastShownId = displayed.at(-1)?.id;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastShownId, busy]);
  useEffect(() => {
    if (busy && lastAgentId && lastAgentId !== lastAgentAtSend.current) {
      setBusy(false);
      setOptimistic(null);
    }
  }, [busy, lastAgentId]);
  useEffect(() => {
    // The server caught up with her taps.
    if (local !== null && local === done && !saveTimer.current) setLocal(null);
  }, [done, local]);
  const send = async (text: string, image?: string) => {
    if ((!text.trim() && !image) || busy) return;
    lastAgentAtSend.current = lastAgentId;
    if (text.trim()) setOptimistic({ id: `p-${Date.now()}`, owner: "teammate", from: "user", text, at: new Date().toISOString() });
    setBusy(true);
    setErr("");
    try {
      await api("/api/messages", "POST", { text, image });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setOptimistic(null);
    }
  };
  const tap = (next: number) => {
    if (!task || task.kind !== "dms") return;
    const v = Math.max(0, Math.min(target, next));
    setLocal(v);
    // Wait until she stops tapping, then save once.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      try {
        await api("/api/progress", "POST", { total: v });
        await refresh();
      } catch (e) {
        setErr((e as Error).message);
        setLocal(null);
      }
    }, 1200);
  };
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const leftMs = task ? new Date(task.deadlineAt).getTime() - nowMs : 0;
  return (
    <main className="simple-shell">
      <header className="simple-top">
        <h1>Hi {name}</h1>
        {alerts.subscribed === false && <button className="small primary" onClick={alerts.enable}>Turn on alerts</button>}
      </header>
      {alerts.note && <p className="hint">{alerts.note}</p>}
      {task ? (
        <section className="simple-progress" aria-label="Your task">
          <b>{task.title}</b>
          <p className="due-red">DUE {new Date(task.deadlineAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: s.settings.timezone || undefined })} · {countdown(leftMs)}</p>
          {task.kind === "dms" ? (
            <>
              <div className="simple-counter">
                <button className="round" aria-label="One less" disabled={value <= 0 || task.status !== "open"} onClick={() => tap(value - 1)}>−</button>
                <div className="simple-numbers"><strong>{value}</strong><span>of {target} sent</span></div>
                <button className="round" aria-label="One more" disabled={value >= target || task.status !== "open"} onClick={() => tap(value + 1)}>+</button>
              </div>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            </>
          ) : (
            <p className="hint">Reply here when it is done.</p>
          )}
        </section>
      ) : (
        <section className="simple-progress"><p style={{ margin: 0 }}>No task right now.</p></section>
      )}
      <section className="simple-chat">
        <div className="simple-messages" ref={list} aria-live="polite">
          {!messages.length && <p className="hint" style={{ textAlign: "center" }}>Say &ldquo;I started&rdquo; when you begin.</p>}
          {displayed.map((m) => (
            <div key={m.id} className={`simple-msg ${m.from === "user" ? "me" : m.from === "manager" ? "boss" : "agent"}`}>
              <small>{m.from === "user" ? "You" : m.from === "manager" ? "Manager" : AGENT} · {time(m.at)}</small>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.img && <a href={`/api/img/${m.img}`} target="_blank" rel="noreferrer"><img src={`/api/img/${m.img}`} alt="" className="shot" /></a>}
              {m.text}
            </div>
          ))}
          {busy && <p className="typing-indicator"><i /><i /><i /></p>}
        </div>
        <SimpleComposer onSend={send} busy={busy} />
        {err && <p className="err">{err}</p>}
      </section>
    </main>
  );
}

function SimpleComposer({ onSend, busy }: { onSend: (text: string, image?: string) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const t = text;
    setText("");
    await onSend(t);
  };
  return (
    <form className="simple-composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
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
            await onSend(text, await shrink(f));
            setText("");
          } catch {
            /* ignore */
          }
        }}
      />
      <button type="button" aria-label="Send a picture" onClick={() => file.current?.click()} disabled={busy}>📎</button>
      <input className="grow" value={text} placeholder={`Write to ${AGENT}…`} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <button className="primary" type="submit" disabled={busy || !text.trim()}>Send</button>
    </form>
  );
}
