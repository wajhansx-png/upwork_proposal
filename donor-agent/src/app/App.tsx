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

// ---------- helpers ----------

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

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};
function ago(nowIso: string, iso?: string) {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
function until(nowIso: string, iso: string) {
  const m = Math.round((new Date(iso).getTime() - new Date(nowIso).getTime()) / 60000);
  if (m <= 0) return "time is up";
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${m % 60} min`;
}

const doneFor = (s: State, t: Task) =>
  t.kind === "general" ? (t.status === "review" || t.status === "done" ? 1 : 0) : s.donors.filter((d) => d.sentAt && d.sentAt >= t.createdAt).length;

const VERDICT: Record<string, [string, string]> = {
  match: ["screenshot OK", "ok"],
  mismatch: ["screenshot wrong", "bad"],
  unclear: ["screenshot unclear", "mid"],
  unchecked: ["screenshot not read", ""],
};

/** Remembers the last message the person saw, to show an unread count. */
function useUnread(key: string, list: ChatMessage[], open: boolean, mine: (m: ChatMessage) => boolean) {
  const [seen, setSeen] = useState<string>("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(localStorage.getItem(key) ?? "");
    } catch {}
  }, [key]);
  const last = list.at(-1)?.at ?? "";
  useEffect(() => {
    if (!open || !last) return;
    try {
      localStorage.setItem(key, last);
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(last);
  }, [open, last, key]);
  return open ? 0 : list.filter((m) => !mine(m) && m.at > seen).length;
}

// ---------- page ----------

/** entry: "manager" for /manager (password), "teammate" for / (private link). */
export default function App({ entry }: { entry: "manager" | "teammate" }) {
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
      // Areeba's private link carries her key (?k=...). The manager signs in with a password on /manager.
      const k = entry === "teammate" ? new URLSearchParams(location.search).get("k") : null;
      if (entry === "manager") {
        const link = document.createElement("link");
        link.rel = "manifest";
        link.href = "/api/manifest?for=manager";
        document.head.appendChild(link);
      }
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
    const t = setInterval(() => !document.hidden && void refresh(), 15_000);
    const vis = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh, entry]);

  if (problem === "not-signed-in" && entry === "manager") return <PasswordScreen onDone={refresh} />;
  if (problem)
    return (
      <main className="login card">
        <h1>Donor Desk</h1>
        <p>{problem === "not-signed-in" ? "Please open your private link. The manager has it." : problem}</p>
        <p className="hint">If your link stopped working, ask the manager for a new one.</p>
      </main>
    );
  if (!state) return <main><p className="hint">Loading…</p></main>;
  // Areeba's session never shows the manager page, even on /manager.
  if (entry === "manager" && state.role !== "manager") return <PasswordScreen onDone={refresh} />;
  return state.role === "manager" ? <Manager s={state} refresh={refresh} /> : <Teammate s={state} refresh={refresh} />;
}

function PasswordScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/login", "POST", { password: pw });
      setPw("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login card">
      <h1>Donor Desk</h1>
      <p className="hint">Manager page. Enter your password.</p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        aria-label="Password"
        autoFocus
        style={{ margin: "12px 0" }}
      />
      <button className="primary bigbtn" onClick={go} disabled={busy}>{busy ? "Checking…" : "Open"}</button>
      {err && <p className="err">{err}</p>}
    </main>
  );
}

// ---------- shared pieces ----------

function useAlerts(s: State) {
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
        return setNote("This browser cannot show alerts. On iPhone, add the app to your Home Screen first.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setNote("Alerts are blocked. Allow them in your phone settings, then try again.");
      if (!s.vapidPublicKey) return setNote("Allowed. The server has no push keys yet, so alerts only show while the app is open.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidPublicKey) }));
      await api("/api/push", "POST", sub.toJSON());
      setEnv((e) => (e ? { ...e, granted: true } : e));
      setNote("Alerts are on for this phone. They work even when the app is closed.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const test = async () => setNote(await api("/api/push/test", "POST").then(() => "Test sent. Close the app and wait a few seconds.", (e: Error) => e.message));
  return { env, note, enable, test };
}

/** A small banner, shown only until alerts are on. */
function AlertsBanner({ s, who }: { s: State; who: string }) {
  const a = useAlerts(s);
  if (!a.env || (a.env.granted && !a.note)) return null;
  const iosFirst = a.env.ios && !a.env.installed;
  return (
    <section className="card warn">
      {iosFirst ? (
        <p style={{ margin: 0 }}>
          <b>iPhone:</b> tap <b>Share</b> → <b>Add to Home Screen</b>, then open Donor Desk from your Home Screen. Then you can turn on alerts.
        </p>
      ) : !a.env.granted ? (
        <div className="row">
          <p className="grow" style={{ margin: 0 }}>Turn on alerts so {who}.</p>
          <button className="primary small" onClick={a.enable}>Turn on</button>
        </div>
      ) : null}
      {a.note && <p className="hint" style={{ marginTop: 6 }}>{a.note}</p>}
    </section>
  );
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; icon: string; label: string; badge?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <div>
        {tabs.map((t) => (
          <button key={t.id} className={value === t.id ? "on" : ""} onClick={() => onChange(t.id)} aria-current={value === t.id ? "page" : undefined}>
            <b aria-hidden>{t.icon}</b>
            {t.label}
            {!!t.badge && <span className="dot">{t.badge}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

function ChatView({
  messages,
  label,
  kind,
  placeholder,
  empty,
  chips = [],
  canAttach,
  onSend,
}: {
  messages: ChatMessage[];
  label: (m: ChatMessage) => string;
  kind: (m: ChatMessage) => "me" | "agent" | "boss" | "";
  placeholder: string;
  empty: string;
  chips?: string[];
  canAttach?: boolean;
  onSend: (text: string, image?: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
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
      <div className="chat">
        {messages.length === 0 && <p className="hint">{empty}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${kind(m)}`}>
            <small>{label(m)} · {when(m.at)}</small>
            {m.img && (
              <a href={`/api/img/${m.img}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/img/${m.img}`} alt="Screenshot" className="shot" />
              </a>
            )}
            {m.text}
          </div>
        ))}
        {busy && <div className="msg agent"><small>Agent</small>Typing…</div>}
        <div ref={end} />
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>{c}</button>
          ))}
        </div>
      )}
      <div className="composer">
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
                  setErr("Could not read that picture.");
                }
              }}
            />
            <button onClick={() => file.current?.click()} disabled={busy} aria-label="Send a screenshot">📎</button>
          </>
        )}
        <input className="grow" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} aria-label="Message" />
        <button className="primary" onClick={() => send(text)} disabled={busy}>Send</button>
      </div>
      {err && <p className="err">{err}</p>}
    </>
  );
}

// ---------- manager ----------

type MTab = "home" | "chat" | "donors" | "settings";

function statusOf(s: State) {
  const name = s.settings.teammateName;
  const t = [...s.tasks].reverse().find((x) => x.status === "open" || x.status === "review");
  if (!t) {
    const last = s.tasks.at(-1);
    if (!last) return { t: null, pill: "none", label: "No task yet", line: `Give ${name} a task below.` };
    const d = doneFor(s, last);
    const good = last.status === "done";
    return { t: null, pill: good ? "ok" : "bad", label: good ? "Last task done" : `Last task ${last.status}`, line: `${last.title}: ${d} of ${last.target}.` };
  }
  if (t.status === "review") return { t, pill: "mid", label: "Needs your OK", line: `${name} says it is done. Check her note and confirm.` };
  const late = new Date(t.deadlineAt).getTime() < new Date(s.now).getTime();
  if (t.unanswered >= 2) return { t, pill: "bad", label: "Not answering", line: `${name} ignored ${t.unanswered} check-ins. Maybe call her.` };
  if (late || (t.goalMisses ?? 0) >= 1 || t.paceWarned) return { t, pill: "mid", label: "Behind", line: "The agent is pushing her with small goals." };
  return { t, pill: "ok", label: "On track", line: "Nothing for you to do." };
}

function Manager({ s, refresh }: { s: State; refresh: () => void }) {
  const [tab, setTab] = useState<MTab>("home");
  const name = s.settings.teammateName;
  const herMsgs = s.teammateMessages ?? [];
  const unreadHer = useUnread("dd-m-her", herMsgs, tab === "chat", (m) => m.from === "manager");
  const updates = s.messages.filter((m) => m.from === "agent");
  const unreadUpd = useUnread("dd-m-upd", updates, tab === "home", () => false);
  return (
    <main>
      <div className="top">
        <h1>Donor Desk</h1>
        <span className="hint">{name}&apos;s manager</span>
      </div>
      {tab === "home" && <ManagerHome s={s} refresh={refresh} />}
      {tab === "chat" && (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>Everything {name} and the agent say. If you write here, the agent stays quiet for 30 minutes.</p>
          <ChatView
            messages={herMsgs}
            label={(m) => (m.from === "user" ? name : m.from === "manager" ? "You" : "Agent")}
            kind={(m) => (m.from === "manager" ? "me" : m.from === "agent" ? "agent" : "boss")}
            placeholder={`Write to ${name}`}
            empty={`No messages with ${name} yet.`}
            onSend={async (text) => {
              await api("/api/messages", "POST", { text, to: "teammate" });
              await refresh();
            }}
          />
        </>
      )}
      {tab === "donors" && <ManagerDonors s={s} refresh={refresh} />}
      {tab === "settings" && <ManagerSettings s={s} refresh={refresh} />}
      <Tabs<MTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "home", icon: "🏠", label: "Today", badge: unreadUpd },
          { id: "chat", icon: "💬", label: `${name}`, badge: unreadHer },
          { id: "donors", icon: "👥", label: "Donors" },
          { id: "settings", icon: "⚙️", label: "Settings" },
        ]}
      />
    </main>
  );
}

function ManagerHome({ s, refresh }: { s: State; refresh: () => void }) {
  const name = s.settings.teammateName;
  const st = statusOf(s);
  const t = st.t;
  const done = t ? doneFor(s, t) : 0;
  const lastHer = [s.stats.lastActivityAt, (s.teammateMessages ?? []).filter((m) => m.from === "user").at(-1)?.at].filter(Boolean).sort().at(-1);
  const mine = t ? s.donors.filter((d) => d.sentAt && d.sentAt >= t.createdAt) : [];
  const ok = mine.filter((d) => d.proofCheck?.verdict === "match").length;
  const bad = mine.filter((d) => d.flags.length).length;
  const [all, setAll] = useState(false);
  const updates = s.messages.filter((m) => m.from === "agent").slice().reverse();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tell = async (v: string) => {
    if (!v.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/messages", "POST", { text: v });
      setText("");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <AlertsBanner s={s} who={`you hear about ${name} without opening the app`} />

      <section className="card status" aria-label="Status">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>{name}</b>
          <span className={`pill ${st.pill}`}>{st.label}</span>
        </div>
        {t ? (
          <>
            <div className="big">{done}<small> of {t.target} done</small></div>
            <div className="bar"><i style={{ width: `${Math.min(100, Math.round((done / t.target) * 100))}%` }} /></div>
            <div className="facts">
              <div><span>Task</span>{t.title}</div>
              <div><span>Due</span>{when(t.deadlineAt)} ({until(s.now, t.deadlineAt)})</div>
              <div><span>Last heard</span>{ago(s.now, lastHer)}</div>
              <div><span>Proof</span>{ok} OK{bad ? <b style={{ color: "var(--warn)" }}> · {bad} to check</b> : ""}</div>
              {t.goal && t.status === "open" && <div><span>Her next goal</span>{t.goal.count} by {time(t.goal.by)}</div>}
              {t.checkEvery && <div><span>Check-ins</span>every {t.checkEvery} min</div>}
            </div>
          </>
        ) : null}
        <p className="hint">{st.line}</p>
        {t?.status === "review" && (
          <div className="row">
            {t.note && <p className="grow" style={{ margin: 0 }}>“{t.note}”</p>}
            <button className="primary small" onClick={async () => { await api(`/api/tasks/${t.id}`, "PATCH", { action: "confirm" }); refresh(); }}>Confirm done</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Give {name} a task</h2>
        <div className="row">
          <input className="grow" value={text} placeholder={`${name} send 10 DMs by 5pm, check every 20 min`} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && tell(text)} aria-label="Task for the agent" />
          <button className="primary" disabled={busy} onClick={() => tell(text)}>{busy ? "…" : "Send"}</button>
        </div>
        <div className="chips">
          {[`${name} send ${s.settings.dailyTarget} DMs by 5pm, check every 20 min`, `How is ${name} doing?`, "cancel"].map((c) => (
            <button key={c} className="chip" disabled={busy} onClick={() => tell(c)}>{c}</button>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
      </section>

      <section className="card">
        <h2>Updates</h2>
        {updates.length === 0 && <p className="hint">The agent will post updates here and send them to your phone.</p>}
        <div className="feed">
          {(all ? updates : updates.slice(0, 6)).map((m) => {
            const herWords = /^.{0,40}(answered|replied|has a problem|sent a screenshot)/.test(m.text);
            const alarm = /not answering|not answered|missed|Deadline missed|does not match|Early warning|Screenshot problem|Warning/i.test(m.text);
            return (
              <div key={m.id} className={`upd ${alarm ? "alert" : herWords ? "her" : ""}`}>
                <small>{when(m.at)}</small>
                {m.text}
              </div>
            );
          })}
        </div>
        {updates.length > 6 && (
          <p style={{ marginBottom: 0 }}>
            <button className="small" onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${updates.length}`}</button>
          </p>
        )}
      </section>
    </>
  );
}

function ManagerDonors({ s, refresh }: { s: State; refresh: () => void }) {
  const name = s.settings.teammateName;
  const [lines, setLines] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sure, setSure] = useState(false);
  const link = typeof window !== "undefined" && s.teammateKey ? `${location.origin}/?k=${s.teammateKey}` : "";
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setMsg("");
      await fn();
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const order: Record<string, number> = { sent: 0, replied: 1, todo: 2, skipped: 3 };
  const list = s.donors.slice().sort((a, b) => order[a.status] - order[b.status]);
  return (
    <>
      <section className="card">
        <h2>{name}&apos;s link</h2>
        <p className="hint">Send this to {name}. She taps it and she is in. Keep it private.</p>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="grow" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={`${name}'s link`} />
          <button className="primary" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p style={{ marginBottom: 0 }}>
          {!sure ? (
            <button className="small" onClick={() => setSure(true)}>Make a new link</button>
          ) : (
            <span className="row">
              <span className="hint">The old link will stop working.</span>
              <button className="small primary" onClick={() => { setSure(false); void run(() => api("/api/teammate-link", "POST")); }}>Yes, new link</button>
              <button className="small" onClick={() => setSure(false)}>No</button>
            </span>
          )}
        </p>
      </section>
      <section className="card">
        <h2>Add donors</h2>
        <p className="hint">One per line: name, channel, contact, note</p>
        <textarea value={lines} placeholder={"Amina Bello, whatsapp, +2348012345678, gave in March\nJohn Reed, email, john@example.com"} onChange={(e) => setLines(e.target.value)} aria-label="Donors to add" />
        <p style={{ marginBottom: 0 }}><button className="primary" onClick={() => run(async () => { await api("/api/donors", "POST", { lines }); setLines(""); })}>Add</button></p>
        {msg && <p className="err">{msg}</p>}
      </section>
      <section className="card">
        <h2>Donors ({s.donors.length})</h2>
        {s.donors.length === 0 && <p className="hint">None yet.</p>}
        {list.map((d) => (
          <div className="item" key={d.id}>
            <div className="row">
              <b className="grow">{d.name}</b>
              <span className="tag">{d.status}</span>
              {d.proofCheck && <span className={`tag ${VERDICT[d.proofCheck.verdict][1]}`}>{VERDICT[d.proofCheck.verdict][0]}</span>}
            </div>
            {d.flags.length > 0 && <p className="err" style={{ margin: 0 }}>{d.flags.join("; ")}</p>}
            {d.replyText && <p className="hint">Reply: “{d.replyText}”</p>}
            {d.proofImg && (
              <details>
                <summary>See screenshot</summary>
                <a href={`/api/img/${d.proofImg}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/img/${d.proofImg}`} alt={`Proof for ${d.name}`} className="shot" />
                </a>
                {d.proofCheck && <p className="hint">{d.proofCheck.reason}</p>}
              </details>
            )}
            {d.status === "todo" && (
              <p style={{ margin: 0 }}><button className="small" onClick={() => run(() => api(`/api/donors/${d.id}`, "DELETE"))}>Remove</button></p>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function ManagerSettings({ s, refresh }: { s: State; refresh: () => void }) {
  const [form, setForm] = useState<Settings>(s.settings);
  const [msg, setMsg] = useState("");
  const a = useAlerts(s);
  const sys = s.system;
  const field = (k: keyof Settings, label: string, type = "text") => (
    <>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} type={type} value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })} />
    </>
  );
  return (
    <>
      <section className="card">
        <h2>Your page</h2>
        <p className="hint">Open <b>{typeof window !== "undefined" ? `${location.origin}/manager` : "/manager"}</b> and enter your password. Only you have this. {s.settings.teammateName} uses her own link.</p>
        <p style={{ marginBottom: 0 }}>
          <button className="small" onClick={async () => { await api("/api/logout", "POST"); location.reload(); }}>Log out on this phone</button>
        </p>
      </section>
      <section className="card">
        <h2>Alerts on this phone</h2>
        <div className="row">
          <button className="primary" onClick={a.enable}>{a.env?.granted ? "Check alerts again" : "Turn on alerts"}</button>
          {a.env?.granted && <button onClick={a.test}>Send test</button>}
        </div>
        {a.note && <p className="hint" style={{ marginTop: 8 }}>{a.note}</p>}
      </section>
      {sys?.ai === "key" && s.agent?.llmStatus?.startsWith("error") && (
        <section className="card warn">
          <h2>AI key problem</h2>
          <p className="hint">The AI did not answer: {s.agent.llmStatus}. The agent uses simple rules until this is fixed. Check the key, its credit, or the model name.</p>
        </section>
      )}
      {sys?.ai === "key" && s.agent?.llmStatus === "ok" && (
        <section className="card"><p className="hint" style={{ margin: 0 }}>AI is working ✓</p></section>
      )}
      {sys && (!sys.push || !sys.persistent || sys.ai !== "key") && (
        <section className="card warn">
          <h2>Still to set up</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {!sys.push && <li>Push keys: needed for alerts when the app is closed.</li>}
            {!sys.persistent && <li>Database: needed when the app is online.</li>}
            {sys.ai !== "key" && <li>AI key (GPT or free Gemini): so the agent reads screenshots and understands more.</li>}
          </ul>
        </section>
      )}
      <section className="card">
        <h2>Settings</h2>
        {field("teammateName", "Teammate name")}
        {field("timezone", "Your timezone (example: Asia/Karachi)")}
        {field("checkinMinutes", "Check-in every (minutes), if a task does not say", "number")}
        {field("dailyTarget", "DMs per task, if you give no number", "number")}
        {field("workStartHour", "Work starts (hour, 0-23)", "number")}
        {field("workEndHour", "Work ends (hour, 1-24). Daily report then.", "number")}
        <label className="row" style={{ color: "var(--ink)", fontSize: "1rem" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={form.requireProof} onChange={(e) => setForm({ ...form, requireProof: e.target.checked })} />
          Each DM needs a screenshot
        </label>
        <label htmlFor="f-template">Message she sends. Use {"{name}"} and {"{teammate}"}.</label>
        <textarea id="f-template" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />
        <p style={{ marginBottom: 0 }}>
          <button className="primary" onClick={async () => { try { await api("/api/settings", "PUT", form); setMsg("Saved."); refresh(); } catch (e) { setMsg((e as Error).message); } }}>Save</button>
          {msg && <span className="hint"> {msg}</span>}
        </p>
      </section>
    </>
  );
}

// ---------- Areeba ----------

type TTab = "task" | "chat";

function Teammate({ s, refresh }: { s: State; refresh: () => void }) {
  const [tab, setTab] = useState<TTab>("task");
  const unread = useUnread("dd-t-chat", s.messages, tab === "chat", (m) => m.from === "user");
  return (
    <main>
      <div className="top">
        <h1>Hi {s.settings.teammateName}</h1>
        <span className="hint">Donor Desk</span>
      </div>
      {tab === "task" ? (
        <TeammateTask s={s} refresh={refresh} openChat={() => setTab("chat")} unread={unread} />
      ) : (
        <ChatView
          messages={s.messages}
          label={(m) => (m.from === "user" ? "You" : m.from === "manager" ? "Manager" : "Agent")}
          kind={(m) => (m.from === "user" ? "me" : m.from === "manager" ? "boss" : "agent")}
          placeholder="Write your answer"
          empty="The agent will message you here about your task."
          chips={["Going well", "I can do 3 more", "I have a problem", "What is next?"]}
          canAttach
          onSend={async (text, image) => {
            await api("/api/messages", "POST", { text, image });
            await refresh();
          }}
        />
      )}
      <Tabs<TTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "task", icon: "✅", label: "My task" },
          { id: "chat", icon: "💬", label: "Chat", badge: unread },
        ]}
      />
    </main>
  );
}

function TeammateTask({ s, refresh, openChat, unread }: { s: State; refresh: () => void; openChat: () => void; unread: number }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [replyFor, setReplyFor] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const t = s.tasks.find((x) => x.status === "open");
  const todo = s.donors.filter((d) => d.status === "todo");
  const next = todo[0];
  const sent = s.donors.filter((d) => d.status === "sent" || d.status === "replied").slice().reverse();
  const done = t ? doneFor(s, t) : 0;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setErr("");
      setBusy(true);
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const prepare = (id: string) => api(`/api/donors/${id}/prepare`, "POST").catch(() => undefined);
  const set = (id: string, status: Donor["status"], extra: object = {}) => run(() => api(`/api/donors/${id}`, "PATCH", { status, ...extra }));
  const text = next ? fill(s.settings.template, next, s.settings.teammateName) : "";
  const link = next ? dmLink(next, text) : null;

  return (
    <>
      <AlertsBanner s={s} who="the agent can reach you" />
      {unread > 0 && (
        <section className="card" style={{ borderColor: "var(--brand)" }}>
          <div className="row">
            <p className="grow" style={{ margin: 0 }}>The agent sent you {unread} new message{unread > 1 ? "s" : ""}.</p>
            <button className="primary small" onClick={openChat}>Read and reply</button>
          </div>
        </section>
      )}

      <section className="card status">
        {t ? (
          <>
            <b>{t.title}</b>
            <div className="big">{done}<small> of {t.target} done</small></div>
            <div className="bar"><i style={{ width: `${Math.min(100, Math.round((done / t.target) * 100))}%` }} /></div>
            <div className="facts">
              <div><span>Due</span>{when(t.deadlineAt)} ({until(s.now, t.deadlineAt)})</div>
              {t.goal && <div><span>Your next goal</span>{Math.max(0, t.goal.count - done) || "Done! "} {t.goal.count - done > 0 ? `more by ${time(t.goal.by)}` : ""}</div>}
            </div>
            {t.kind === "general" && (
              <div className="row">
                <input className="grow" value={note} placeholder="What did you do?" onChange={(e) => setNote(e.target.value)} aria-label="What you did" />
                <button className="primary" disabled={busy} onClick={() => run(async () => { await api(`/api/tasks/${t.id}`, "PATCH", { action: "complete", note }); setNote(""); })}>I finished</button>
              </div>
            )}
          </>
        ) : (
          <p style={{ margin: 0 }}>No task right now. You will get an alert when your manager gives you one.</p>
        )}
      </section>

      {(t?.kind === "dms" || (!t && todo.length > 0)) && (
        <section className="card now">
          {next ? (
            <>
              <p className="hint" style={{ marginBottom: 4 }}>Do this now</p>
              <div className="who">{next.name}</div>
              <p className="hint">{next.channel} · {next.contact}{next.note ? ` · ${next.note}` : ""}</p>
              <div className="msgbox" style={{ margin: "10px 0" }}>{text}</div>
              <div className="row" style={{ marginBottom: 8 }}>
                <button className="grow" onClick={async () => { void prepare(next.id); await navigator.clipboard.writeText(text).catch(() => undefined); setCopied(next.id); }}>
                  {copied === next.id ? "Copied ✓" : "1. Copy message"}
                </button>
                {link && (
                  <a className="grow" href={link} target="_blank" rel="noreferrer" onClick={() => void prepare(next.id)} style={{ display: "flex" }}>
                    <button className="grow">2. Open {next.channel}</button>
                  </a>
                )}
              </div>
              <input
                ref={pick}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    const image = await shrink(f);
                    await set(next.id, "sent", { image });
                  } catch {
                    setErr("Could not read that picture.");
                  }
                }}
              />
              <button
                className="primary bigbtn"
                disabled={busy}
                onClick={() => (s.settings.requireProof ? pick.current?.click() : set(next.id, "sent"))}
              >
                {busy ? "Saving…" : s.settings.requireProof ? "3. Sent! Add screenshot" : "3. I sent it"}
              </button>
              <p style={{ margin: "8px 0 0" }}>
                <button className="small" onClick={() => set(next.id, "skipped")}>Skip this donor</button>
              </p>
            </>
          ) : (
            <p style={{ margin: 0 }}>All donors are done. Great work!</p>
          )}
          {err && <p className="err">{err}</p>}
        </section>
      )}

      {sent.length > 0 && (
        <section className="card">
          <details>
            <summary>Sent ({sent.length}). Tap if a donor replied.</summary>
            {sent.map((d) => (
              <div className="item" key={d.id}>
                <div className="row">
                  <b className="grow">{d.name}</b>
                  {d.status === "replied" && <span className="tag ok">replied</span>}
                  {d.proofCheck && d.proofCheck.verdict !== "unchecked" && <span className={`tag ${VERDICT[d.proofCheck.verdict][1]}`}>{VERDICT[d.proofCheck.verdict][0]}</span>}
                </div>
                {d.proofCheck && (d.proofCheck.verdict === "mismatch" || d.proofCheck.verdict === "unclear") && <p className="err" style={{ margin: 0 }}>{d.proofCheck.reason}</p>}
                {d.status === "sent" &&
                  (replyFor === d.id ? (
                    <div className="row">
                      <input className="grow" value={reply} placeholder={`Paste what ${d.name} replied`} onChange={(e) => setReply(e.target.value)} aria-label="Donor reply" />
                      <button className="primary small" onClick={() => { void set(d.id, "replied", { replyText: reply }); setReplyFor(""); setReply(""); }}>Save</button>
                    </div>
                  ) : (
                    <div className="row">
                      <button className="small" onClick={() => setReplyFor(d.id)}>They replied</button>
                      <button className="small" onClick={() => set(d.id, "todo")}>Undo</button>
                    </div>
                  ))}
              </div>
            ))}
          </details>
        </section>
      )}
    </>
  );
}
