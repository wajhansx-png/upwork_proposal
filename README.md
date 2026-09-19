# Proposal Studio

Paste an Upwork job post, get a proposal that sounds like a person wrote it — plus an honest read on
whether the job deserves your connects.

It is built around how applying actually feels: you are on proposal number nine, you have no idea if
the client will ever open it, and the temptation is to paste the same template again. So the app does
three things instead of one:

1. **Writes a first draft** in your voice, using your saved work and your own one-line proof.
2. **Reads the job post back to you** — budget, timeline, the hidden "start your proposal with…"
   screening test, and the terms worth settling before you start working.
3. **Checks your draft before the client does** — clichés, length, whether it opens about them
   instead of you, whether it ends with a question.

Everything you save (your work samples, your details, your drafts) stays in your browser's
localStorage. There is no account, no upload, and no proposal is ever sent for you.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:43117.

## Optional: better drafts via an LLM

The app works with no keys at all — the writer and the job analysis run locally on the server with
no external calls. If you want an LLM to write the prose instead, set an OpenAI key and restart:

```bash
# .env.local
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini   # optional
```

When an API key is present, `/api/generate` uses OpenRouter with a DeepSeek model first, then tries the direct DeepSeek API and any legacy Groq/Cerebras variables that remain. It silently falls back to the local
writer if the call fails, so the page never dead-ends.

## How it fits together

| Path                           | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/lib/job-analysis.ts`      | Pulls budget, timeline, deliverables, skills, screening instructions and red flags from the post |
| `src/lib/proposal-writer.ts`   | Local proposal writer: hook, proof, three-step plan, one question, sign-off                     |
| `src/lib/proposal-score.ts`    | Scores a draft the way a skimming client reads it                                               |
| `src/lib/local.ts`             | localStorage as an external store, so nothing needs a server or an account                      |
| `src/app/api/generate/route.ts`| Analyses the post, writes the draft, optionally upgrades the prose with OpenAI                   |
| `src/components/`              | The two-step UI (paste → draft) plus the coach column                                           |

## What the coach column is checking

- **Fit score** — detail level, stated budget, clear deliverables, hidden screeners, red flags.
- **Screening tests** — "start your proposal with…", "include the word…", "answer these questions".
  The local writer puts the required phrase on line one automatically.
- **Red flags** — free test tasks, off-platform contact, equity instead of pay, unfunded milestones.
  Each one is explained in plain language with what to ask for instead.
- **Draft checks** — template clichés, opening about the client, using their words, a concrete plan,
  one piece of proof, a closing question, and staying under ~200 words.

## Scripts

| Command         | Purpose                            |
| --------------- | ---------------------------------- |
| `npm run dev`   | Dev server on port 43117           |
| `npm run build` | Production build                   |
| `npm start`     | Serve the production build         |
| `npm run lint`  | ESLint (Next.js + React Compiler)  |

## Stack

Next.js 16 (App Router), React 19, TypeScript. The UI itself is hand-written vanilla JS/CSS (`public/legacy-app.js`, `src/app/legacy.css`).
