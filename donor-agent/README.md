# Donor Desk

A small app for a foundation manager and a teammate who sends DMs to donors.
An agent watches progress so the manager does not have to ask for updates.

## How it works

- **Manager** adds donors, sets a daily target, and sees live progress.
- **Teammate** gets a queue. For each donor she presses "Copy message" or "Open", sends the DM
  on WhatsApp/email/etc., then presses **Mark sent**. This is how progress is measured.
- **Agent** runs every 10 minutes during work hours:
  - No teammate activity for N hours -> sends her a check-in (chat + push).
  - She ignores 2 check-ins -> alerts the manager.
  - At end of work day -> sends the manager a report.
  - The manager can ask it questions ("How is she doing?").
- **Chat** between manager and teammate, with push notifications.

## Limits (read this)

- The app **cannot see DMs** sent on WhatsApp, Instagram, etc. Those platforms do not let an app read
  another person's messages. Progress is only what she marks as sent. Tell her this is how it works.
- It tracks work only (sent/replied/skipped, last activity). It does not track her screen or location.
  Tell your teammate what it records.
- The agent does not send DMs to donors. A person does.

## Run

```bash
cd donor-agent
npm install
cp .env.example .env.local   # fill in codes and secrets
npm run dev                  # http://localhost:43118
```

In dev, login codes are `manager` and `teammate` if you set none. In production they are required.

Optional:
- `npm run vapid` makes keys for phone push notifications (put them in `.env.local`).
- `ANTHROPIC_API_KEY` makes the agent's messages and answers sound natural. Without it, it uses fixed text.

## Deploy

Data is saved in `data/db.json`. This needs a server with a disk that persists (VPS, Railway/Fly volume).
**It will lose data on Vercel/serverless.** To use serverless, replace `src/lib/db.ts` with a real database
and call `POST /api/agent/run` (header `Authorization: Bearer $CRON_SECRET`) from a scheduler.
