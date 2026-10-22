"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./App";

interface Msg { id: string; title?: string; text: string; imageId?: string; at: string; usedAt?: string; uses?: number }
interface View { items: Msg[]; caseName: string | null; caseText: string | null }

/** Shrink a picture in the browser (max 1600 px, JPEG) so it stays under the server's 450 KB limit. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  let side = 1600;
  for (let q = 0.85; ; q -= 0.1) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 600_000 || q < 0.4) return url;
    if (q < 0.6) side = 1100;
  }
}

/** The saved picture as a PNG blob (the only picture type browsers can put on the clipboard). */
async function pngOf(id: string): Promise<Blob> {
  const img = await createImageBitmap(await (await fetch(`/api/img/${id}`)).blob());
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Could not read the picture."))), "image/png"));
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

/**
 * Saved messages, one page for both. The manager writes or picks texts and saves them;
 * Areeba sees the same list, like a WhatsApp chat, and copies or shares them into the groups.
 */
export default function Saved() {
  const [manager, setManager] = useState(false);
  const [v, setV] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [image, setImage] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const loaded = useRef(false);
  const load = useCallback(async () => {
    try {
      setV(await api<View>("/api/saved"));
      loaded.current = true;
    } catch (e) {
      // A failed background refresh is not shown: the list stays, the next refresh tries again.
      if (!loaded.current) setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => {
      setManager(location.pathname.startsWith("/manager"));
      void load();
    }, 0);
    const id = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const call = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setErr("");
    try {
      setV(await api<View>("/api/saved", "POST", body));
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };
  const save = async (t: string, idea?: number) => {
    if (!(await call(`save${idea ?? ""}`, { action: "save", text: t, title: idea === undefined ? title : "", image: idea === undefined ? image : "" }))) return;
    setToast(`Saved. ${manager ? "Areeba can see it now." : ""}`);
    if (idea === undefined) {
      setText("");
      setTitle("");
      setImage("");
    }
    else setIdeas((all) => all.filter((_, i) => i !== idea));
  };
  const getIdeas = async () => {
    setBusy("ideas");
    setErr("");
    try {
      setIdeas((await api<{ lines: string[] }>("/api/saved", "POST", { action: "lines" })).lines);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const used = (m: Msg) => {
    if (!manager) void api("/api/saved", "POST", { action: "used", id: m.id }).catch(() => {});
  };
  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setToast("Text copied. Paste it in the group.");
    } catch {
      prompt("Copy this text:", m.text);
    }
    used(m);
  };
  const copyImage = async (m: Msg) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(m.imageId!) })]);
      setToast("Picture copied. Paste it in the group.");
      used(m);
    } catch {
      setToast("This phone cannot copy pictures. Use Share or Save picture.");
    }
  };
  const pick = async (file?: File) => {
    if (!file) return;
    try {
      setImage(await shrink(file));
    } catch {
      setErr("Could not read that picture. Try another one.");
    }
  };
  // On phones, Share sends the picture and the text together (WhatsApp, then pick the groups).
  // Without picture sharing (most laptops), the link opens WhatsApp with the text only.
  const share = (m: Msg, e: { preventDefault: () => void }) => {
    used(m);
    if (!m.imageId || typeof navigator.canShare !== "function") return;
    e.preventDefault();
    const wa = `https://wa.me/?text=${encodeURIComponent(m.text)}`;
    void (async () => {
      try {
        const file = new File([await pngOf(m.imageId!)], "givelife.png", { type: "image/png" });
        if (!navigator.canShare({ files: [file] })) return void window.open(wa, "_blank");
        await navigator.share({ files: [file], text: m.text });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") window.open(wa, "_blank");
      }
    })();
  };

  const items = v?.items ?? [];
  return (
    <main className="wa wide">
      <header className="wa-top">
        <a href={manager ? "/manager" : "/areeba"} aria-label="Back">←</a>
        <span className="wa-av" aria-hidden>💬</span>
        <div>
          <b>Saved messages</b>
          <small>{manager ? "Areeba sees this same list" : "From your manager · for the groups"}</small>
        </div>
      </header>

      <div className="wa-body">
        {manager && (
          <section className="sv-new">
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Heading (optional), like: Yousuf – reminder 1" />
            <textarea value={text} rows={4} onChange={(e) => setText(e.target.value)} placeholder="Write or paste a message…" />
            {image ? (
              <div className="sv-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Picture to save" />
                <button className="text-btn" onClick={() => setImage("")}>Remove picture</button>
              </div>
            ) : (
              <label className="d-btn sv-pick">
                🖼️ Add a picture
                <input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
            )}
            <div className="sv-row">
              <button className="d-btn hot" disabled={!!busy || (!text.trim() && !image)} onClick={() => void save(text)}>{busy === "save" ? "Saving…" : "Save"}</button>
              {v?.caseText && <button className="d-btn" disabled={!!busy} onClick={() => setText(v.caseText!)}>Use case post</button>}
              {v?.caseName && <button className="d-btn" disabled={!!busy} onClick={() => void getIdeas()}>{busy === "ideas" ? "Writing…" : "✨ 5 AI texts"}</button>}
            </div>
            {ideas.length > 0 && (
              <div className="sv-ideas">
                <p className="hint">AI texts for {v?.caseName}. Change any, then tap Save.</p>
                {ideas.map((t, i) => (
                  <div key={i} className="sv-idea">
                    <textarea value={t} rows={5} onChange={(e) => setIdeas((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button className="d-btn hot" disabled={!!busy || !t.trim()} onClick={() => void save(t, i)}>{busy === `save${i}` ? "Saving…" : "Save"}</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {v && !items.length && <p className="wa-sys">{manager ? "No saved messages yet. Write one above." : "No messages yet. Your manager will add them here."}</p>}
        {!manager && items.length > 0 && <p className="wa-sys">Copy a message and post it in all groups.</p>}

        <div className="sv-grid">
          {items.map((m) => {
            const isOpen = !!open[m.id];
            const long = m.text.split("\n").length > 2 || m.text.length > 110;
            return (
              <div key={m.id} className="wa-msg sv-card">
                {m.title && <b className="sv-title">{m.title}</b>}
                {m.imageId && (
                  <a href={`/api/img/${m.imageId}`} target="_blank" rel="noreferrer" className="sv-img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/img/${m.imageId}`} alt={m.title || "Saved picture"} loading="lazy" />
                  </a>
                )}
                {m.text && <p className={`wa-text ${isOpen ? "" : "clamp"}`}>{m.text}</p>}
                {long && (
                  <button className="sv-more" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [m.id]: !isOpen }))}>
                    {isOpen ? "− Less" : "+ More"}
                  </button>
                )}
                <span className="wa-time">
                  {when(m.at)}
                  {manager && m.usedAt && <i className="wa-ticks"> · used by Areeba {when(m.usedAt)}</i>}
                </span>
                <div className="wa-actions">
                  {m.text && <button onClick={() => void copy(m)}>{m.imageId ? "Copy text" : "Copy"}</button>}
                  {m.imageId && <button onClick={() => void copyImage(m)}>Copy image</button>}
                  {m.imageId && <a href={`/api/img/${m.imageId}`} download={`givelife-${m.id}.jpg`} onClick={() => used(m)}>Save picture</a>}
                  <a href={`https://wa.me/?text=${encodeURIComponent(m.text)}`} target="_blank" rel="noreferrer" onClick={(e) => share(m, e)}>Share</a>
                  {manager && <button disabled={!!busy} onClick={() => confirm("Delete this message? Areeba will not see it anymore.") && void call(`rm${m.id}`, { action: "remove", id: m.id })}>Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
        {err && <p className="wa-sys bad" onClick={() => setErr("")}>{err}</p>}
      </div>
      {toast && <div className="d-toast" role="status"><span>{toast}</span></div>}
    </main>
  );
}
