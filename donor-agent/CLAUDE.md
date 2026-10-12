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

- `src/lib/agent.ts` — all agent behaviour: replies to Areeba (buildReply, statusLine, goals), manager commands (runManagerCommand, summarize), the clock (runAgent: 4-min nudges, pace alert that can repeat, goal checks — seeded the moment a task is assigned, missed-goal has priority over the generic nag — the 10-min stale-count floor that only kicks in when no goal is already governing the pace, deadline), +/− (setProgress).
- `src/lib/nlp.ts` — rules that read messages (counts, questions, delay, mood, managerCommand). `understand.ts` merges rules + GPT. `prompts.ts` — GPT prompts. `llm.ts` — GPT call with self-healing retries.
- `src/lib/task-state.ts` phases/check-in times · `evaluate.ts` task score · `auth.ts` `x-as` roles (public links, no sign-in) · `push.ts` web push · `http.ts` safe request body · `types.ts` data shapes.
- `src/app/App.tsx` — both screens (Manager, Teammate, chips, Bubble, settings, useHerBot, GiftTeddy). `Bot.tsx` — teddy bot (moods, reactions, speech bubble). `globals.css` — styles (newest blocks at the end override older ones).
- `src/lib/donors.ts` — donor list logic (who to message now, messages, marks/undo, stats, ideas); `donor-list.ts` the 138 seeded donors. `src/app/Donors.tsx` — Donors page (/manager/donors, /areeba/donors).
- `src/lib/case.ts` — case texts by the GiveLife writing guide (facts, N maths, main/DM/reminders/closing, Part 10 checks; AI writes only hook + story and is checked); `case-guide.ts` fixed lines, verses, reference lines. `src/app/Case.tsx` — /manager/case.
- `src/lib/counter.ts` — WhatsApp counter add-on logic (planCounter: phone match, dedupe, first-contact count, replies; on an "old donors" task (`task.oldDonors`, set by words like "previous donors" or the switch on the manager screen → `/api/task-switch`, `setOldDonors`) any donor except "no" counts once per task via `task.countedDonors`, shared with her "Sent" tap); `extension-files.ts` the add-on source (read-only, never sends; treats chat opening/scroll/load as history, keeps unsent DMs in storage, retries on 5xx, honest badge); `zip.ts` zip writer. `src/app/api/counter/*` routes; CounterPanel in App.tsx.
- `src/lib/quiet.ts` — quiet hours (no pushes at night; never for a task that ends before the night ends); `besttime.ts` — send log + her best two hours; `makeNudgeOpeners` in `understand.ts` — fresh, checked push openers (pool on the task). `/api/settings` saves quiet hours. `/api/reset` + `clearChatsAndTasks` (Clear button at the bottom of manager Settings) deletes all chats and tasks only.
- `src/app/api/*` — thin routes; logic lives in `src/lib`.

# Tests (scripts/, plain node)

- `scenario-regression.cjs` real-life simulation with a fake clock + 600 random inputs, rules checked after every step (`SEED=n` for other runs) · `logic-regression.cjs` her/manager conversation logic · `regression.cjs` clock, nudges, +/− · `nlp-regression.cjs` rule parsing · `understand-regression.cjs` GPT checks · `evaluate-regression.cjs` scoring · `llm-regression.cjs` GPT retries · `storage-regression.cjs` storage · `donors-regression.cjs` donor list, picks, marks, task count, case DMs · `case-regression.cjs` case texts, maths, checks, reminders · `work-regression.cjs` quiet hours, fresh push words, best time, stale-count nag, repeatable pace alert, first goal at assignment · `counter-regression.cjs` add-on counting, dedupe, replies, zip, 3,000-batch stress, old-donors switch (rules, taps + add-on never double count, words that turn it on, stress) · `extension-check.cjs` runs the real add-on code against a fake WhatsApp page (history rules, badge, retry, popup, worker restart, 5xx; ~1 min; `ONLY=<step>` runs one part) · `extension-e2e.cjs` loads the real unpacked add-on in Chromium and drives the whole chain (add-on → app → her screen) against a running local server. Both need Chromium (`NODE_PATH=$(npm root -g) node scripts/<name>.cjs`); not in `npm test`.
- `api-check.cjs` (needs a running server): roles, broken input. Not part of `npm test`.

# Deploy

Vercel is not linked to GitHub: after pushing, deploy with the Vercel MCP `create_deployment` (team `team_LYTISSX5C5lPHt2ESl8edHMi`, project `donor-agent`, rootDirectory `donor-agent`, gitSource = this branch + commit SHA, target production).
