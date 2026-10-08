import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { newId, withDb } from "@/lib/db";
import { notify } from "@/lib/push";
import type { Db, Role } from "@/lib/types";

const say = (d: Db, owner: Role, text: string) =>
  d.messages.push({ id: newId(), owner, from: "agent", text, at: new Date().toISOString() });

/** Buttons that do the same as chat commands. actions: complete (teammate), confirm / cancel (manager). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const role = (await getRole(req));
  if (!role) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { id } = await ctx.params;
  const { action, note, enabled } = (await req.json().catch(() => ({}))) as { action?: string; note?: string; enabled?: boolean };
  let push: { to: Role; title: string; body: string } | null = null;

  const result = await withDb((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return "Task not found";
    const name = d.settings.teammateName;
    const now = new Date().toISOString();
    if (action === "complete" && role === "teammate" && t.kind === "general" && t.status === "open") {
      const proof = String(note ?? "").trim().slice(0, 500);
      if (proof.length < 3) return "Write a short note about what you did.";
      t.status = "review";
      t.note = proof;
      say(d, "manager", `${name} says this is done: "${t.title}". Her note: "${proof}". Reply "confirm" if it is right.`);
      push = { to: "manager", title: "Task needs your confirmation", body: `${t.title}: ${proof}` };
      return null;
    }
    if (action === "confirm" && role === "manager" && t.status === "review") {
      t.status = "done";
      t.closedAt = now;
      say(d, "teammate", `Your manager confirmed: ${t.title}. Thank you.`);
      push = { to: "teammate", title: "Confirmed", body: t.title };
      return null;
    }
    if (action === "cancel" && role === "manager" && (t.status === "open" || t.status === "review")) {
      t.status = "cancelled";
      t.closedAt = now;
      say(d, "teammate", `Your manager cancelled the task: ${t.title}.`);
      push = { to: "teammate", title: "Task cancelled", body: t.title };
      return null;
    }
    if (action === "alerts" && role === "teammate" && t.status === "open") {
      if (typeof enabled !== "boolean") return "Choose on or off.";
      if (note === "timer") t.timerEnabled = enabled;
      else if (note === "reminders") t.remindersEnabled = enabled;
      else return "Unknown alert setting.";
      if (!enabled) {
        const line = `${name} turned off ${note === "timer" ? "DM timer" : "report reminder"} alerts.`;
        say(d, "manager", line);
        push = { to: "manager", title: "Areeba changed alerts", body: line };
      }
      return null;
    }
    return "That action is not allowed now.";
  });
  if (result) return NextResponse.json({ error: result }, { status: 400 });
  const p = push as { to: Role; title: string; body: string } | null;
  if (p) await notify(p.to, p.title, p.body);
  return NextResponse.json({ ok: true });
}
