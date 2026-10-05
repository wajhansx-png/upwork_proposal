# Donor Desk

You tell the agent a task and a time. The agent asks Areeba everything, checks her answers
and screenshots, and tells you what is real. You do not chase her.

## How you use it

**Two different pages:**
- **You:** `https://YOUR-APP/manager`. Enter your password once per phone. Five wrong tries lock it for 15 minutes.
- **Areeba:** her own private link (copy it from the Donors tab). It opens only her task and her chat.
  She cannot open your page without your password, and the server refuses all your data to her.

**You** open your page. In "Give Areeba a task" write:
- `Areeba send 20 DMs by 5pm, check every 20 min`  -> the agent gives her the task, asks her questions,
  and checks in every 20 minutes. When she answers, it waits another 20 minutes before asking again.
  You get her answers as alerts.
- `How is Areeba doing?`        -> real numbers from the app.
- `Tell her to call the Reed family today`
- `cancel`

Open **Areeba's chat** to read everything she and the agent write, and to write to her yourself.
While you write there, the agent stays quiet for 30 minutes.

**Areeba** opens her link (you copy it from the app). She sees her task and her donors.
For each donor: copy the message, send it, press **Mark sent**, add a **screenshot** of what she sent.

**The agent asks her** (on every task, and every hour by default):
1. How many DMs did you send? 2. Did anyone reply? 3. Any problem? + send a screenshot.
If her answer has no number, it asks again.

## How it gets the work done

- **Small goals.** Every check-in ends with a goal: "2 more by 2:40. Can you do that?" The next check-in
  says if she hit it. Missed twice -> you are told.
- **Her own promise.** If she says "I can do 3 more", that becomes her goal, and the agent holds her to it.
- **Next step ready.** Every message names the next donors, so she never has to decide what to do.
- **Praise after each DM.** "Nice work! 4 of 10. Next: Sam Lee."
- **Early warning.** If her speed means she will miss the deadline, you are told early.

No app can force a person to work. This makes the work easy to start, measured in small steps, and visible to you.

## How it checks she is telling the truth

| What she does | What the app does |
|---|---|
| Says "I sent 8" | Compares to what the app shows. If different, tells her and alerts you. |
| Presses Mark sent | Needs a screenshot. Refuses without one. |
| Sends a screenshot | The AI reads it: is it a chat, with the right donor, with a sent message? Wrong -> flagged, you and she are told. |
| Uses the same screenshot twice | Caught and flagged (no AI needed). |
| Says a donor replied | Must paste the reply. You can read it. |
| Does nothing | Asks again. After 2 ignored check-ins, alerts you. |

**Honest limits.** The app cannot open her WhatsApp or Instagram. A screenshot can be edited or faked,
and the AI can make mistakes. These checks catch lazy or careless faking. They are not proof.
For important donors, check one yourself. Without an AI key, screenshots are saved and compared for
duplicates only. They are **not read**.

## Setup (free, about 30 minutes)

Free plans change. Check the limits and terms. Vercel's free plan is for non-commercial use.

1. **Vercel**: import this repo, set Root Directory to `donor-agent`.
2. **Upstash** (upstash.com): make a free Redis database. Copy the REST URL and token.
3. **Gemini key** (aistudio.google.com): free. Copy the key.
4. **Alert keys**: on any computer run `cd donor-agent && npm install && npm run vapid`. Copy both keys.
5. **Vercel -> Settings -> Environment Variables**: add everything from `.env.example`.
6. **cron-job.org**: make a free job, every 1 minute, URL
   `https://YOUR-APP.vercel.app/api/agent/run?key=YOUR_CRON_SECRET`
   (Vercel's own free cron is once a day. That is too slow.)
7. Open `https://YOUR-APP.vercel.app/manager` and enter your password (MANAGER_PASSWORD).
   Set your timezone in Settings. Add donors. Copy **Areeba's link** (Donors tab) and send it to her.
8. On both phones press **Turn on alerts**, then **Send test**.

Never share your password. If Areeba's link leaks, press **Make a new link**.

### Alerts when the app is closed
- **Android phone**: press "Turn on alerts" once. Alerts arrive even when Chrome is closed and the phone is locked.
  Do not "Force stop" Chrome in phone settings, and turn off battery saving for Chrome if alerts come late.
- **Computer**: Chrome must still be running in the background (on Windows: Chrome settings -> System ->
  "Continue running background apps"). If Chrome is fully quit, alerts wait until it opens.
- **iPhone** (iOS 16.4 or newer): Safari -> Share -> **Add to Home Screen**. Open it from the Home Screen,
  then press "Turn on alerts". Do this on Areeba's phone too. The link is saved in the Home Screen app,
  so it opens already signed in.

## Run on your own computer
```bash
cd donor-agent && npm install && npm run dev
```
Open http://localhost:43118/manager and enter the password from `.env.local`. Data is saved in `data/`. The agent runs every minute by itself.
Alerts to a phone need the internet (HTTPS), so test those after you deploy.

## Privacy
The app saves donor names and contacts, Areeba's marks, her chat, her screenshots, and when she opens the app.
Tell her this. With a Gemini or Groq key, chat text and screenshots are sent to that company to be read.
With no key, only chat text (no donor names, no images) may go to a free shared AI service. Set
`FREE_SHARED_AI=off` to stop that.
