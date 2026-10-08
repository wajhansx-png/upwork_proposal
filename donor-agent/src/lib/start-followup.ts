import { start } from "workflow/api";
import { followTask } from "../workflows/follow-task";
import { withDb } from "./db";

export async function ensureFollowup() {
  const id = await withDb(d => {
    const t = [...d.tasks].reverse().find(t => ["open", "review"].includes(t.status));
    if (!t || (t.workflowRunId && t.workflowRunId !== "starting")) return null;
    if (t.workflowRunId === "starting") return null;
    t.workflowRunId = "starting";
    return t.id;
  });
  if (!id) return;
  try {
    const run = await start(followTask, [id]);
    await withDb(d => {
      const t = d.tasks.find(t => t.id === id);
      if (t) { t.workflowRunId = run.runId; t.workflowError = undefined; }
    });
  } catch (error) {
    await withDb(d => {
      const t = d.tasks.find(t => t.id === id);
      if (t) { t.workflowRunId = undefined; t.workflowError = "Background follow-up could not start. Please retry from Settings."; }
    });
    throw error;
  }
}
