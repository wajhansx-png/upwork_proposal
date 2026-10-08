# Donor Desk

You tell the agent a task and a time. The agent follows Areeba, reads her answers and screenshots,
and tells you what is real. You do not chase her.

## Two pages

- **You:** `https://YOUR-APP/manager`. Enter your password once per phone. Five wrong tries lock it for 15 minutes.
- **Areeba:** her own private link (Settings -> "View Areeba's screen", or the link in the manager page). It opens only her task and chat.
  The server refuses all manager data and actions to her.

## What you can say to the agent

- `Areeba send 20 DMs by 5pm, check every 20 min` (a count and a time: answered at once)
- `Message 30 previous donors only before 6pm, 5 minutes between each DM` (the instructions are passed to Areeba)
- `Call the Reed family by 3pm` (a task that is not DMs; she finishes it with a note and you confirm)
- `How is she doing?` / `any progress` / `is she working?` (facts from the app)
- `Tell her to send me the report` / `remind her about the 3pm call`
- `cancel`

If your message has no count or no time, the agent asks one question and sends nothing to Areeba until it is complete.
A statement like "she sent 5 today" is never turned into a task.

## How Areeba's messages are read

Each message is read by GPT (one call) **and checked by code**. GPT can help with meaning, but it cannot change facts:
- A total must be a number she really wrote. Plans ("I will send 10"), questions, denials, and counts of replies
  ("3 replied") are never counted as sent DMs. "15/20 done" means 15.
- GPT can raise "she is blocked", but cannot raise one when she says "no problem".
- GPT writes one friendly sentence. The app rejects it if it contains numbers or claims the work is verified.
  The app writes the facts itself ("Recorded: 8 of 20. Proven by screenshot: 3.") and the next step.
- Anything for the manager (a blocker, a break, more time, a question the agent cannot answer) is forwarded to you,
  and her reply says so.
- She gets exact answers from facts for "when is the deadline?", "what should I do next?", "how am I doing?".
- With no AI key, the same checks run on plain rules (tested on 100+ phrasings).

## How it checks she is telling the truth

| What she does | What the app does |
|---|---|
| Says "I sent 8" | Records it as **claimed**. Only screenshots make a DM **proven**. Your big counter shows proven DMs. |
| Sends a screenshot | GPT reads it in full detail: is it a chat, who is the person, is there a sent message (not a draft)? It also grades the message (1 to 5) against your instructions. |
| Sends the same image twice | Rejected at once. The same person twice is counted once. |
| Sends a poster, a contact list, a draft | Rejected, with the reason. |
| Says she finished | Task goes to review only when the screenshots prove every DM. |
| Goes quiet | Asks again. You are told. After the deadline: 3 final requests, then the task closes as missed. |

When a task ends (review or missed) you get a **review**: score out of 10, what was good, problems, and advice.
The score is calculated from proven DMs, honesty (claims vs proof), message quality, timing, and answers.
GPT may move it by at most 1.5 points, so it cannot invent a good grade.

**Honest limits.** The app cannot open her WhatsApp. A screenshot can be edited, and the AI can make mistakes.
These checks catch careless or lazy faking. They are not proof. For important donors, check one yourself.

## Setup

1. **Vercel**: import this repo, Root Directory `donor-agent`.
2. **Storage**: Vercel -> Storage -> create a **Blob** store (private) and connect it to the project
   (this sets `BLOB_STORE_ID`). Or use a free Upstash Redis (`UPSTASH_REDIS_REST_URL` / `_TOKEN`).
3. **Environment variables**: everything in `.env.example`. Your zip already has a ready `.env.local` to copy from.
4. **Follow-up timer**: the app uses Vercel Workflow to follow each task every minute. As a backup, a free job on
   cron-job.org can call `https://YOUR-APP/api/agent/run?key=YOUR_CRON_SECRET` every minute.
5. Open `/manager`, set your timezone in Settings, copy Areeba's link, and on both phones press **Turn on alerts**, then **Send test**.

### Alerts when the app is closed
- **Android**: press "Turn on alerts" once. Works with Chrome closed. Do not "Force stop" Chrome.
- **iPhone** (iOS 16.4+): Safari -> Share -> **Add to Home Screen**, open it from there, then turn on alerts.
- **Computer**: the browser must still run in the background.

## Run on your computer
```bash
npm install && npm run dev      # http://localhost:43118/manager (password from .env.local)
npm test                        # 5 test suites, no internet or AI key needed
```

## AI use and cost
- No AI call for: a clear DM task (count + time), a status question, cancel, confirm, or "ok/thanks".
- One call for every other message from you or Areeba. Screenshots are read in full detail (accuracy first).
- `AI_DAILY_LIMIT` (default 400) is a safety cap. After it, the app uses rules until tomorrow. Settings shows the AI status.
- `AI_ALWAYS=on` sends every message to GPT, even the clear ones.
- Key: `OPENAI_API_KEY` (model `OPENAI_MODEL`, default gpt-4o-mini). Free alternative: `GEMINI_API_KEY`.

## Privacy
The app saves Areeba's messages, her screenshots, and when she opens the app. Tell her this.
With an AI key, her chat text and screenshots are sent to that AI company to be read.
