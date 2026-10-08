@AGENTS.md

# Workflow (keep token use low, quality high)

- Read only the files the task touches. Use the map below instead of searching; grep once for a symbol, then read just that range.
- Reuse existing helpers (statusLine, makeGoal, say, sendPushes, summarize, toHer, DueLine, Bubble, ChipRow). No new dependencies.
- Edit in place; no rewrites of whole files unless the change needs it.
- Test only what changed: run the matching script below, then `npm test` once before commit. Run `npx tsc --noEmit -p . && npx eslint src` before commit.
- Build/screenshot only for UI changes. Never commit secrets (check `git diff --cached` for keys/codes).
- Keep replies short and in simple English.
- Do not change how often or how firmly Areeba is pushed unless asked.

# Map

- `src/lib/agent.ts` — all agent behaviour: replies to Areeba (buildReply, statusLine, goals), manager commands (runManagerCommand, summarize), the clock (runAgent: 4-min nudges, goal checks, deadline), +/− (setProgress).
- `src/lib/nlp.ts` — rules that read messages (counts, questions, delay, mood, managerCommand). `understand.ts` merges rules + GPT. `prompts.ts` — GPT prompts. `llm.ts` — GPT call with self-healing retries.
- `src/lib/task-state.ts` phases/check-in times · `evaluate.ts` task score · `auth.ts` manager link code, `x-as` roles · `push.ts` web push · `types.ts` data shapes.
- `src/app/App.tsx` — both screens (Manager, Teammate, chips, Bubble, settings). `globals.css` — styles (newest blocks at the end override older ones).
- `src/app/api/*` — thin routes; logic lives in `src/lib`.

# Tests (scripts/, plain node)

- `logic-regression.cjs` her/manager conversation logic · `regression.cjs` clock, nudges, +/− · `nlp-regression.cjs` rule parsing · `understand-regression.cjs` GPT checks · `evaluate-regression.cjs` scoring · `llm-regression.cjs` GPT retries · `storage-regression.cjs` storage.

# Deploy

Vercel is not linked to GitHub: after pushing, deploy with the Vercel MCP `create_deployment` (team `team_LYTISSX5C5lPHt2ESl8edHMi`, project `donor-agent`, rootDirectory `donor-agent`, gitSource = this branch + commit SHA, target production).
