import webpush from "web-push";
import { withDb } from "./db";
import type { Role } from "./types";

let ready: boolean | null = null;

function setup() {
  if (ready !== null) return ready;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (ready = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.org", pub, priv);
  return (ready = true);
}

export const pushEnabled = () => setup();

/** Sends a browser push to every device a role has subscribed. Never throws. */
export async function notify(role: Role, title: string, body: string) {
  if (!setup()) return;
  const subs = await withDb((db) => db.subs.filter((s) => s.role === role));
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.sub, JSON.stringify({ title, body }));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.sub.endpoint);
      }
    }),
  );
  if (dead.length) {
    await withDb((db) => {
      db.subs = db.subs.filter((s) => !dead.includes(s.sub.endpoint));
    });
  }
}
