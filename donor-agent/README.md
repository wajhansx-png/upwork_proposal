# Donor Desk

A manager tells an agent what her teammate must do and by when. The agent chases the teammate,
checks her updates against the app, and reports to the manager. No need to keep asking for updates.

## How it works

**Manager** (one chat with the agent):
- "Amina send 20 DMs by 5pm" -> creates a task with a deadline and tells her.
- "How is she doing?" -> real numbers from the app, not her words.
- "Tell her to call the Reed family today" -> passes it on.
- "cancel" -> cancels the latest task.
- Gets push alerts: task finished, deadline missed, halfway/behind, she ignores 2 check-ins,
  her update does not match the app, she reports a problem, nothing assigned today, end-of-day report.

**Teammate**: sees her task, a queue of donors, copy/open the message, "Mark sent". Chats with the agent.
The agent checks in on a schedule (default every 60 min), 30 minutes before the deadline, and at the deadline.

**Checking updates are real.** The app cannot read WhatsApp/Instagram/email, so it checks what it can:
- If she says "I sent 8" and the app shows 5, the agent tells her and alerts the manager.
- A "sent" mark is flagged if she never copied/opened the message, or marked it within 20 seconds of another.
- "They replied" needs the donor's reply pasted in as proof. The manager sees it.
- The manager sees "unverified marks" and why.
These are signals, not proof. A determined person can still fake it. For high-stakes cases, spot-check a donor yourself.

## Free setup (about 30 minutes)

All of these have free plans. Check their current limits and terms (Vercel's free plan is for non-commercial use).

1. **Code**: push this repo to GitHub (done). Import the `donor-agent` folder as a project on **Vercel**
   (Root Directory = `donor-agent`).
2. **Database**: create a free Redis on **upstash.com**. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **AI (optional, recommended)**: free key from **console.groq.com** (`GROQ_API_KEY`) or **aistudio.google.com** (`GEMINI_API_KEY`).
4. **Push keys**: run `npm install && npm run vapid` once on any computer. Copy both keys.
5. **Vercel environment variables**: everything in `.env.example`. Use long random values for the codes and secrets.
6. **Scheduler**: create a free job on **cron-job.org**, every 1 minute, URL
   `https://YOUR-APP.vercel.app/api/agent/run?key=YOUR_CRON_SECRET`. Vercel's own free cron is once a day, so it is not enough.
7. Open the app, log in as manager, set your timezone in Settings, add donors, press **Turn on notifications**, then **Send test**.

### Notifications with the app closed
- **Android / computer**: press "Turn on notifications" once in Chrome. Works with Chrome closed.
- **iPhone**: Apple only allows this for apps on the Home Screen, iOS 16.4 or newer.
  Open the site in **Safari -> Share -> Add to Home Screen**, open **Donor Desk** from the Home Screen,
  log in, press "Turn on notifications". The site must be HTTPS (Vercel is).
  Both people must do this on their own phone.

## Run on your computer

```bash
cd donor-agent && npm install
cp .env.example .env.local
npm run dev        # http://localhost:43118
```
Dev login codes are `manager` and `teammate` if unset. Data is saved to `data/db.json`.
Locally the agent runs by itself every minute. Push needs HTTPS, so test it on the deployed site.

## Limits
- Free AI tiers have rate limits and models get retired. If the AI fails, the app shows the error and keeps
  working with simple rules (it then needs sentences like "send 20 DMs by 5pm").
- The agent never messages donors. A person sends every DM.
- Tell your teammate what is recorded: task progress, her marks, her chat, and when she opens the app.
