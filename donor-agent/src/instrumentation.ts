// Self-hosted: run the agent every minute inside the server process.
// On Vercel this does not keep running. Use a free scheduler (cron-job.org) to call /api/agent/run instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  const { runAgent } = await import("./lib/agent");
  setInterval(() => void runAgent().catch((e) => console.error("agent run failed", e)), 60_000);
}
