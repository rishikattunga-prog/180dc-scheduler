# 180 Degrees Purdue — Retention Feedback Call Scheduler

A booking site for 180DC Purdue retention feedback calls. Interviewees pick a date and a
30-minute slot from the exec team's real availability; calls are auto-assigned to the
available interviewer with the fewest calls; confirmation emails go to both sides via EmailJS.

Everything below is **free** (Supabase free tier + Vercel free tier + EmailJS free tier).

---

## Launch checklist (about 30 minutes)

### Part A — Supabase (the shared database)

1. Go to https://supabase.com → **Start your project** → sign up with GitHub or email.
2. **New project** → name it `180dc-scheduler`, pick any region (US East is closest to
   Purdue), set a database password (save it somewhere), click **Create**.
3. Wait ~1 minute for the project to spin up. Then open **SQL Editor** (left sidebar)
   → **New query** → paste ALL of this and click **Run**:

```sql
create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table app_state enable row level security;

create policy "public read"  on app_state for select using (true);
create policy "public write" on app_state for insert with check (true);
create policy "public update" on app_state for update using (true);

alter publication supabase_realtime add table app_state;
```

4. Go to **Project Settings → API**. Copy two things:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (the long string under "Project API keys")
5. Open `src/storage.js` in this project and paste them into
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top. Save.

That's the whole backend. All bookings, availability, Teams links and blocked days
now live in one shared database that every device sees instantly.

### Part B — Put the code on GitHub

1. Create a free account at https://github.com if you don't have one.
2. Click **+** (top right) → **New repository** → name it `180dc-scheduler` → **Create**.
3. On your computer, install Node.js from https://nodejs.org (LTS version) if you
   don't have it. Then in a terminal, inside this project folder:

```bash
npm install          # installs dependencies (one time)
npm run dev          # optional: test locally at http://localhost:5173
```

4. Push to GitHub:

```bash
git init
git add .
git commit -m "180DC Purdue scheduler"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/180dc-scheduler.git
git push -u origin main
```

### Part C — Deploy on Vercel (the live website)

1. Go to https://vercel.com → sign up **with your GitHub account**.
2. **Add New → Project** → you'll see `180dc-scheduler` in the list → **Import**.
3. Vercel auto-detects Vite. Don't change anything. Click **Deploy**.
4. ~1 minute later you get a live URL like `https://180dc-scheduler.vercel.app`.
   That's the link you share with members being interviewed.
5. (Optional) Custom domain: Vercel project → **Settings → Domains** → add
   `calls.180dcpurdue.org` (or whatever you own) and follow the DNS instructions.

Every time you push a change to GitHub, Vercel redeploys automatically.

### Part D — Prove the emails fire

EmailJS keys are already in the code (`CONFIG.emailJs` at the top of `src/App.jsx`).

1. Open your live URL → **180 Team Login** → Rishi Kattunga / `rishi1234`.
2. **My Availability** → tap tomorrow → set a window (e.g. 10:00 AM – 12:00 PM).
3. **My Calls** → paste your real Microsoft Teams meeting link → Save.
4. Log out → **Schedule Your Call** → pick that day → pick a slot →
   enter your name and `rkattung@purdue.edu` → Confirm.
5. Within a minute you should receive **two emails** (one as interviewee, one as
   the assigned interviewer). Also check https://dashboard.emailjs.com →
   **Email History** — both sends appear there with a status.
6. First-ever sends sometimes land in spam — mark "not spam" once and you're set.

### Part E — Before you announce it

- [ ] All 8 execs log in, set availability, and paste their Teams links in My Calls.
- [ ] Change `bookingWindowDays` in `src/App.jsx` CONFIG if you want more/fewer weeks.
- [ ] Do one real test booking end-to-end with a friend's email.

---

## Team logins

Password = lowercase first name + `1234` (e.g. `liz1234`, `rishi1234`).
Full roster is in `CONFIG.teamMembers` in `src/App.jsx` — edit there to add/remove people.

## Honest security notes (fine for a club tool, know them anyway)

- Team passwords are in the client code. Anyone who reads the source can see them.
  Acceptable for a campus club scheduling tool; not for anything sensitive.
  The worst someone can do is edit availability or cancel bookings.
- The database policies above allow public read/write, which the booking flow needs.
  If abuse ever happens, Supabase dashboard → Table Editor lets you fix data manually,
  and we can tighten rules or add real auth (Supabase Auth) later.
- The EmailJS public key is designed to be client-side; sends are capped at 200/month
  on the free plan, which naturally limits abuse.

## Everyday admin

- **See/cancel bookings:** 180 Team Login → All Bookings.
- **Block a day for everyone:** Block Days tab.
- **Change the roster or passwords:** edit `CONFIG.teamMembers`, push to GitHub,
  Vercel redeploys automatically.
