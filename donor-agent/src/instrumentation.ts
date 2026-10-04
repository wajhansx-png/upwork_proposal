// Self-hosted: run the agent check every 10 minutes inside the server process.
// On serverless hosts this does not keep running. Call POST /api/agent/run from a scheduler instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runAgent } = await import("./lib/agent");
  setInterval(() => void runAgent().catch((e) => console.error("agent run failed", e)), 10 * 60_000);
}
