import { useState, useEffect, useMemo } from "react";
import { storageGet, storageSet, storageSubscribe, usingSharedStorage } from "./storage.js";

/* ================================================================
   180 DEGREES PURDUE SCHEDULING WEBSITE
   ----------------------------------------------------------------
   ADMIN CUSTOMIZATION — edit everything in CONFIG below.
   `primaryGreen` recolors the entire site from this one line.

   EMAIL SENDING (optional, free):
   1. Create a free account at https://www.emailjs.com
   2. Add an email service + a template with variables:
      {{to_email}} {{to_name}} {{date}} {{time}} {{interviewer}} {{teams_link}} {{booking_id}}
   3. Paste your serviceId, templateId and publicKey into CONFIG.emailJs.
   Until keys are added, the site shows a prefilled email draft button instead.

   TEAMS LINKS: paste each interviewer's standing Teams meeting link
   below — it is shown on the confirmation page and included in emails.
   ================================================================ */

const LOGO_URL =
  "https://cdn.prod.website-files.com/63b610d81215b25001c51b2b/6473fc49131edc263274c582_180DEGREES-FULL-CONSULTING-LANDSCAPE%20(1).avif";
const LOGO_FALLBACK = "data:image/png;base64,__LIGHT_B64__";

const CONFIG = {
  siteName: "180 Degrees Purdue Scheduling Website",
  primaryGreen: "#76A935",
  primaryGreenDark: "#618E2A",
  primaryGreenTint: "#F2F8E9",
  clubEmail: "purdue@180dc.org",
  instagram: "https://instagram.com/180dcpurdue",
  linkedin: "https://linkedin.com/company/180-degrees-consulting-purdue",
  homeHeading: "Schedule Your 180 Degrees Purdue Retention Feedback Call",
  homeDescription:
    "Select an available time for your 180 Degrees Purdue retention feedback call. Once your booking is confirmed, an available interviewer will automatically be assigned to you.",
  footerTagline: "Retention Feedback Call Scheduling Portal",

  /* ============================================================
     180 TEAM LOGINS — 6 members. Each person has their own
     password and their own permanent Microsoft Teams link.

     >>> PASTE EACH PERSON'S TEAMS LINK in the teamsLink field <<<
     (In Teams: Calendar → New meeting → save → open it → copy the
     "Join" link. That link is permanent and can be reused for
     every call. Replace the PASTE_TEAMS_LINK_HERE text below.)
     ============================================================ */
  teamMembers: [
    { name: "Liz Liban", role: "Managing Director", email: "eliban@purdue.edu", password: "liz1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Rishi Kattunga", role: "Senior Director", email: "rkattung@purdue.edu", password: "rishi1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Liya Abil", role: "Director of Internal Operations", email: "labil@purdue.edu", password: "liya1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Dev Makhecha", role: "Director of Recruitment", email: "dmakhech@purdue.edu", password: "dev1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Anushka Wayse", role: "Director of Professional Development", email: "wayse@purdue.edu", password: "anushka1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Fabian Lugo", role: "Director of Client Acquisition", email: "lugof@purdue.edu", password: "fabian1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Harish Venkatasubramanian", role: "Director of Client Success", email: "venka178@purdue.edu", password: "harish1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
    { name: "Alex Okano", role: "Director of Marketing", email: "aokano@purdue.edu", password: "alex1234", teamsLink: "PASTE_TEAMS_LINK_HERE" },
  ],
  defaultTimes: ["10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
  bookingWindowDays: 21,
  emailJs: {
    serviceId: "service_ifxa7sj",
    templateId: "template_we57qxl",   // email the INTERVIEWEE receives
    templateIdInterviewer: "template_10fsu3n",         // email the INTERVIEWER receives — paste 2nd template ID here
    publicKey: "k_yovKbdn3CGIEVL9",
  },
};

/* ---------------- helpers ---------------- */
const iso = (d) => d.toISOString().slice(0, 10);
const prettyDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
const shortDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function bookableDates() {
  const out = [], today = new Date();
  for (let i = 1; i <= CONFIG.bookingWindowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(iso(d));
  }
  return out;
}

const STORAGE_KEY = "180dc_scheduler_data";
const emptyData = { bookings: [], closedSlots: [], memberAvail: {}, memberLinks: {} };

/* Effective Teams link for a member: link saved in the Team Area wins,
   otherwise the one pasted in CONFIG. */
const linkFor = (name, data) => {
  const saved = (data.memberLinks || {})[name];
  if (saved) return saved;
  const m = CONFIG.teamMembers.find((p) => p.name === name);
  return m && m.teamsLink && !m.teamsLink.includes("PASTE_TEAMS_LINK") ? m.teamsLink : "";
};

/* Members available to take a given slot. If nobody on the team has set
   any availability yet, everyone is considered available (so the site
   works out of the box). */
/* Each member's availability is a map of { "YYYY-MM-DD": "their times that day (EST)" }.
   Older saved data may be an array of dates — normalize it. */
const availMapFor = (name, data) => {
  const raw = (data.memberAvail || {})[name];
  if (!raw) return {};
  const norm = {};
  if (Array.isArray(raw)) { raw.forEach((d) => { norm[d] = []; }); return norm; } // legacy: list of dates
  Object.entries(raw).forEach(([d, v]) => {
    if (Array.isArray(v)) norm[d] = v;            // current: list of windows
    else if (v) norm[d] = [v];                    // legacy: single window string
    else norm[d] = [];
  });
  return norm;
};

const candidatesFor = (d, data) => {
  const anyoneSet = CONFIG.teamMembers.some((m) => Object.keys(availMapFor(m.name, data)).length > 0);
  if (!anyoneSet) return CONFIG.teamMembers.map((m) => m.name);
  return CONFIG.teamMembers.filter((m) => d in availMapFor(m.name, data)).map((m) => m.name);
};

/* ----- 30-minute slot machinery (all times EST) ----- */
const minsToLabel = (m) => {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
};
/* dropdown choices for interviewers: 8:00 AM → 10:00 PM in 30-min steps */
const TIME_CHOICES = Array.from({ length: (22 - 8) * 2 + 1 }, (_, i) => 8 * 60 + i * 30);

/* A stored window is "start|end" (minutes). Legacy free text like "10:00 AM - 12:30 PM" is parsed too. */
const parseWindow = (raw) => {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d+\|\d+$/.test(str)) {
    const [a, b] = str.split("|").map(Number);
    return b > a ? [a, b] : null;
  }
  const times = [...str.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)].map((m) => {
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  });
  return times.length >= 2 && times[1] > times[0] ? [times[0], times[1]] : null;
};

/* 30-min start times inside a window: 10:00–12:30 → 10:00, 10:30, 11:00, 11:30, 12:00 */
const slotsInWindow = (win) => {
  const p = parseWindow(win);
  if (!p) return [];
  const out = [];
  for (let t = p[0]; t + 30 <= p[1]; t += 30) out.push(minsToLabel(t));
  return out;
};

/* All bookable slots on a day → { "10:00 AM": [memberNames offering it] }.
   If nobody on the team has set any availability yet, fall back to the default
   hourly times with the whole team, so the site works out of the box. */
const slotMapFor = (d, data) => {
  const anyoneSet = CONFIG.teamMembers.some((m) => Object.keys(availMapFor(m.name, data)).length > 0);
  const map = {};
  if (!anyoneSet) {
    CONFIG.defaultTimes.forEach((t) => { map[t] = CONFIG.teamMembers.map((m) => m.name); });
    return map;
  }
  CONFIG.teamMembers.forEach((m) => {
    const wins = availMapFor(m.name, data)[d];
    if (wins === undefined) return;
    wins.forEach((win) =>
      slotsInWindow(win).forEach((t) => {
        if (!(map[t] = map[t] || []).includes(m.name)) map[t].push(m.name);
      })
    );
  });
  return map;
};

const slotSort = (a, b) => {
  const toMin = (l) => {
    const m = l.match(/(\d{1,2}):(\d{2}) (AM|PM)/);
    let h = parseInt(m[1], 10) % 12;
    if (m[3] === "PM") h += 12;
    return h * 60 + parseInt(m[2], 10);
  };
  return toMin(a) - toMin(b);
};
const emailConfigured = () => CONFIG.emailJs.serviceId && CONFIG.emailJs.templateId && CONFIG.emailJs.publicKey;

/* Send confirmation emails via EmailJS (interviewee + interviewer). */
async function sendEmails(booking) {
  if (!emailConfigured()) return { sent: false };
  const iv = CONFIG.teamMembers.find((p) => p.name === booking.interviewer) || {};
  const link = booking.teamsLink || "";
  const base = {
    date: prettyDate(booking.date), time: `${booking.time} (EST)`,
    meeting_link: link, teams_link: link, booking_id: booking.id,
  };
  const send = (template_id, params) =>
    fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: CONFIG.emailJs.serviceId,
        template_id,
        user_id: CONFIG.emailJs.publicKey,
        template_params: params,
      }),
    });
  try {
    await Promise.all([
      /* interviewee: who's interviewing them + when + link */
      send(CONFIG.emailJs.templateId, {
        ...base, to_email: booking.email, to_name: booking.name,
        interviewer: booking.interviewer,
      }),
      /* interviewer: who they're interviewing + when + link */
      iv.email
        ? send(CONFIG.emailJs.templateIdInterviewer || CONFIG.emailJs.templateId, {
            ...base, to_email: iv.email, to_name: booking.interviewer,
            interviewer: booking.interviewer,
            interviewee_name: booking.name, interviewee_email: booking.email,
          })
        : Promise.resolve(),
    ]);
    return { sent: true };
  } catch (e) {
    console.error("Email send failed", e);
    return { sent: false };
  }
}

function mailtoDraft(booking) {
  const iv = CONFIG.teamMembers.find((p) => p.name === booking.interviewer) || {};
  const link = booking.teamsLink || "";
  const subject = encodeURIComponent(`180 Degrees Purdue — Retention Feedback Call Confirmed (${booking.id})`);
  const body = encodeURIComponent(
    `Hi ${booking.name},\n\nYour 180 Degrees Purdue retention feedback call is confirmed.\n\n` +
    `Date: ${prettyDate(booking.date)}\nTime: ${booking.time}\nInterviewer: ${booking.interviewer}\n` +
    `Meeting link: ${link || "(to be shared)"}\n\nConfirmation ID: ${booking.id}\n\n— 180 Degrees Consulting Purdue`
  );
  return `mailto:${booking.email}?cc=${iv.email || ""}&subject=${subject}&body=${body}`;
}

/* ---------------- shared atoms ---------------- */
const Logo = ({ h = 48 }) => {
  const [broken, setBroken] = useState(false);
  return (
    <img src={broken ? LOGO_FALLBACK : LOGO_URL} alt="180 Degrees Consulting"
      style={{ height: h, width: "auto" }} onError={() => setBroken(true)} />
  );
};

const Btn = ({ children, onClick, kind = "primary", disabled, small, style }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className={`btn btn-${kind}${small ? " btn-sm" : ""}`} style={style}>
    {children}
  </button>
);

const Field = ({ label, ...props }) => (
  <label className="field">
    <span>{label}</span>
    <input {...props} />
  </label>
);

/* ================================================================ */
export default function App() {
  const [page, setPage] = useState("home");
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [lastBooking, setLastBooking] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [teamUser, setTeamUser] = useState(null); // logged-in team member object

  useEffect(() => { document.title = CONFIG.siteName; }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await storageGet(STORAGE_KEY);
        if (r && r.value) setData({ ...emptyData, ...JSON.parse(r.value) });
      } catch { /* first run */ }
      setLoaded(true);
    })();
    /* live sync: when anyone else books or edits availability, update this screen */
    const unsub = storageSubscribe(STORAGE_KEY, (val) => setData({ ...emptyData, ...val }));
    return unsub;
  }, []);

  const save = async (next) => {
    setData(next);
    try { await storageSet(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
  };

  const go = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const closedKeys = useMemo(() => new Set(data.closedSlots), [data.closedSlots]);
  /* an interviewer can only take one call per slot */
  const bookedPairs = useMemo(
    () => new Set(data.bookings.filter((b) => !b.cancelled).map((b) => `${b.date}|${b.time}|${b.interviewer}`)),
    [data.bookings]
  );
  const freeMembersFor = (d, t) =>
    (slotMapFor(d, data)[t] || []).filter((n) => !bookedPairs.has(`${d}|${t}|${n}`));
  /* slots the interviewee can pick on a day: offered by the team AND not fully booked */
  const openSlotsFor = (d) => Object.keys(slotMapFor(d, data)).sort(slotSort)
    .map((t) => ({ t, free: freeMembersFor(d, t).length > 0 }));
  const dateOpen = (d) => !closedKeys.has(d) && openSlotsFor(d).some((s) => s.free);

  const confirmBooking = async ({ name, email, date, time }) => {
    /* assign, among interviewers offering this exact slot, the one with the fewest upcoming calls */
    const candidates = freeMembersFor(date, time);
    const load = (n) => data.bookings.filter((b) => !b.cancelled && b.interviewer === n).length;
    const interviewer = [...candidates].sort((a, b) => load(a) - load(b))[0];
    const booking = {
      id: `RF-${Date.now().toString(36).toUpperCase()}`,
      name, email, date, time, interviewer,
      teamsLink: linkFor(interviewer, data),
      createdAt: new Date().toISOString(), cancelled: false,
    };
    await save({ ...data, bookings: [...data.bookings, booking] });
    setLastBooking(booking);
    go("confirm");
    setEmailStatus("pending");
    const r = await sendEmails(booking);
    setEmailStatus(r.sent ? "sent" : "manual");
  };

  return (
    <div className="site" style={{ "--green": CONFIG.primaryGreen, "--greenDark": CONFIG.primaryGreenDark, "--tint": CONFIG.primaryGreenTint }}>
      <GlobalStyles />
      <Header page={page} go={go} />
      <main className="wrap">
        {!loaded ? (
          <p className="loading">Loading…</p>
        ) : page === "book" ? (
          <Book key="book" dateOpen={dateOpen} openSlotsFor={openSlotsFor} onConfirm={confirmBooking} goHome={() => go("home")} />
        ) : page === "confirm" ? (
          <Confirmation key="confirm" booking={lastBooking} go={go} emailStatus={emailStatus} />
        ) : page === "team" && !teamUser ? (
          <TeamLogin key="tl" onSuccess={(u) => setTeamUser(u)} />
        ) : page === "team" && teamUser ? (
          <Admin key="admin" data={data} save={save} closedKeys={closedKeys}
            user={teamUser} logout={() => { setTeamUser(null); go("home"); }} />
        ) : (
          <Home key="home" go={go} />
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header({ page, go }) {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <button className="brand" onClick={() => go("home")} aria-label="180 Degrees Consulting — home">
          <Logo h={48} />
        </button>
        <nav>
          {page !== "home" && (
            <button className="nav-lnk back" onClick={() => go("home")}>← Back to Home</button>
          )}
          <button className={`nav-lnk sub${page === "team" ? " on" : ""}`} onClick={() => go("team")}>180 Team Login</button>
        </nav>
      </div>
    </header>
  );
}

/* ---------------- Homepage ---------------- */
function Home({ go }) {
  return (
    <section className="page hero">
      <p className="eyebrow rise d1">{CONFIG.siteName}</p>
      <h1 className="rise d2">{CONFIG.homeHeading}</h1>
      <p className="lede rise d3">{CONFIG.homeDescription}</p>
      <div className="rise d4">
        <Btn onClick={() => go("book")}>Schedule Your Call</Btn>
      </div>
      <p className="steps-line rise d5">
        <span>1&nbsp;·&nbsp;Pick a date</span><i>→</i>
        <span>2&nbsp;·&nbsp;Pick a time</span><i>→</i>
        <span>3&nbsp;·&nbsp;Get your interviewer</span>
      </p>
    </section>
  );
}

/* ---------------- Booking wizard (Back / Next) ---------------- */
function Book({ dateOpen, openSlotsFor, onConfirm, goHome }) {
  const dates = useMemo(bookableDates, []);
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1); // 1 = forward, -1 = backward
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const next = () => { setError(""); setDir(1); setStep((s) => Math.min(3, s + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const back = () => { setError(""); setDir(-1); if (step === 1) { goHome(); } else { setStep((s) => s - 1); } window.scrollTo({ top: 0, behavior: "smooth" }); };
  const slideCls = dir === 1 ? "slide-fwd" : "slide-back";

  const submit = () => {
    if (!name.trim() || !email.trim()) return setError("Please enter your name and email to confirm.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Please enter a valid email address.");
    if (!openSlotsFor(date).some((s) => s.t === time && s.free)) {
      setStep(2); setTime(null);
      return setError("That time was just booked — please pick another slot.");
    }
    onConfirm({ name: name.trim(), email: email.trim(), date, time });
  };

  return (
    <section className="page">
      <h2 className="rise d1">Book Your Retention Feedback Call</h2>
      <div className="progress rise d2">
        {["Date", "Time", "Details"].map((l, i) => (
          <div key={l} className={`p-seg${step > i ? " done" : ""}`}>
            <div className="p-bar" /><span>{i + 1}. {l}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className={slideCls} key="s1">
          <h3 className="step-h">Choose a date</h3>
          <div className="date-grid">
            {dates.map((d, i) => {
              const open = dateOpen(d);
              return (
                <button key={d} disabled={!open}
                  className={`date-card stagger${date === d ? " is-selected" : ""}`}
                  style={{ animationDelay: `${Math.min(i * 25, 400)}ms` }}
                  onClick={() => { setDate(d); if (time && !openSlotsFor(d).some((s) => s.t === time && s.free)) setTime(null); }}>
                  <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={slideCls} key="s2">
          <h3 className="step-h">Pick a time <span className="muted">· {prettyDate(date)} · all times EST</span></h3>
          <p className="muted" style={{ marginTop: -6 }}>These are the times our team is available that day.</p>
          <div className="pill-grid">
            {openSlotsFor(date).map(({ t, free }, i) => (
              <button key={t} disabled={!free}
                className={`pill stagger${time === t ? " is-selected" : ""}`}
                style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
                onClick={() => setTime(t)}>
                {t}{!free && " · booked"}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={slideCls} key="s3">
          <div className="card form-card">
            <h3 className="step-h" style={{ marginTop: 0 }}>Your details</h3>
            <div className="summary-chip">{prettyDate(date)} · <b>{time}</b></div>
            <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Boiler Maker" autoComplete="name" />
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@purdue.edu" autoComplete="email" />
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      )}

      {error && step !== 3 && <p className="err">{error}</p>}

      <div className="wizard-nav rise d3">
        <Btn kind="outline" onClick={back}>← Back</Btn>
        {step < 3 ? (
          <Btn onClick={next} disabled={step === 1 ? !date : !time}>Next →</Btn>
        ) : (
          <Btn onClick={submit}>Confirm Booking</Btn>
        )}
      </div>
    </section>
  );
}

/* ---------------- Confirmation ---------------- */
function Confirmation({ booking, go, emailStatus }) {
  if (!booking) return <Home go={go} />;
  const teamsLink = booking.teamsLink || "";
  return (
    <section className="page confirm">
      <div className="check"><svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg></div>
      <h2 className="rise d2">Your call is booked!</h2>
      <p className="muted rise d2" style={{ marginTop: -8 }}>{CONFIG.siteName}</p>
      <div className="card detail-card rise d3">
        {[["Date", prettyDate(booking.date)], ["Time", booking.time], ["Interviewer", booking.interviewer], ["Confirmation ID", booking.id]].map(([k, v]) => (
          <div key={k} className="d-row"><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      {teamsLink && (
        <a className="teams-btn rise d4" href={teamsLink} target="_blank" rel="noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 3.5V7l-4 3.5z"/></svg>
          Join Meeting
        </a>
      )}

      <p className="fine rise d4">
        {emailStatus === "sent" ? (
          <>A confirmation email with your meeting link has been sent to <b>{booking.email}</b> and your interviewer.</>
        ) : emailStatus === "pending" ? (
          <>Sending your confirmation email…</>
        ) : (
          <>Save your meeting link above. You can also send yourself the confirmation by email:</>
        )}
      </p>
      {emailStatus === "manual" && (
        <a className="rise d4" href={mailtoDraft(booking)} style={{ display: "inline-block", marginBottom: 18 }}>
          Open email draft →
        </a>
      )}

      <p className="fine rise d5" style={{ marginTop: 6 }}>
        Questions? Contact <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>
      </p>
      <div className="rise d5"><Btn kind="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
    </section>
  );
}

/* ---------------- 180 Team Login (6 individual accounts) ---------------- */
function TeamLogin({ onSuccess }) {
  const [who, setWho] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const tryLogin = () => {
    const member = CONFIG.teamMembers.find((m) => m.name === who);
    if (!member) return setErr("Select your name first.");
    if (pw !== member.password) return setErr("Incorrect password.");
    onSuccess(member);
  };
  return (
    <section className="page" style={{ maxWidth: 380 }}>
      <h2 className="rise d1">180 Team Login</h2>
      <p className="muted rise d2">For 180 Degrees Purdue team members only.</p>
      <div className="rise d3" style={{ marginTop: 22 }}>
        <label className="field">
          <span>Your name</span>
          <select className="dropdown" style={{ width: "100%", marginBottom: 0 }} value={who}
            onChange={(e) => { setWho(e.target.value); setErr(""); }}>
            <option value="">Select your name…</option>
            {CONFIG.teamMembers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </label>
        <Field label="Password" type="password" value={pw} placeholder="••••••••"
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && tryLogin()} />
        {err && <p className="err">{err}</p>}
        <Btn onClick={tryLogin}>Log in</Btn>
      </div>
    </section>
  );
}

/* ---------------- My Calls (logged-in member's own calls + link editor) ---------------- */
function MyCallsPanel({ data, save, user }) {
  const myLink = linkFor(user.name, data);
  const [draft, setDraft] = useState(myLink);
  const [savedMsg, setSavedMsg] = useState(false);
  const mine = data.bookings
    .filter((b) => !b.cancelled && b.interviewer === user.name)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const saveLink = async () => {
    await save({ ...data, memberLinks: { ...(data.memberLinks || {}), [user.name]: draft.trim() } });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  return (
    <div className="fadein" key="mycalls">
      <div className="card link-card">
        <p className="link-title">My meeting link</p>
        <p className="muted" style={{ margin: "0 0 10px" }}>
          Paste your permanent meeting link here (Teams, Zoom, or Google Meet all work). It's automatically shared with every interviewee assigned to you.
        </p>
        <div className="link-row">
          <input className="link-input" value={draft} placeholder="https://… (Teams / Zoom / Meet link)"
            onChange={(e) => setDraft(e.target.value)} />
          <Btn small onClick={saveLink} disabled={!draft.trim() || draft.trim() === myLink}>Save</Btn>
        </div>
        {savedMsg && <p className="saved-msg">✓ Link saved — it will be used for all your calls.</p>}
        {!myLink && !savedMsg && <p className="err" style={{ margin: "8px 0 0" }}>No link set yet — interviewees won't get a meeting link until you save one.</p>}
      </div>

      <h3 className="step-h" style={{ marginTop: 26 }}>Calls assigned to you</h3>
      {mine.length === 0 ? (
        <p className="muted fadein">No upcoming calls assigned to you yet.</p>
      ) : (
        <div className="fadein">
          {mine.map((b, i) => (
            <div key={b.id} className="card call-card stagger" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="call-when">
                <b>{prettyDate(b.date)}</b>
                <span className="call-time">{b.time}</span>
              </div>
              <div className="call-who">
                <b>{b.name}</b>
                <a href={`mailto:${b.email}`}>{b.email}</a>
              </div>
              {myLink && (
                <a className="teams-btn small" href={myLink} target="_blank" rel="noreferrer">Join Meeting</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- My Availability (days + multiple From/To windows per day, EST) ---------------- */
function MyAvailabilityPanel({ data, save, user }) {
  const dates = useMemo(bookableDates, []);
  const myAvail = availMapFor(user.name, data);
  const myDays = Object.keys(myAvail).filter((d) => dates.includes(d)).sort();
  const DEFAULT_WIN = `${10 * 60}|${16 * 60}`;

  const saveAvail = (next) =>
    save({ ...data, memberAvail: { ...(data.memberAvail || {}), [user.name]: next } });

  const toggle = async (d) => {
    const next = { ...myAvail };
    if (d in next) { delete next[d]; } else { next[d] = [DEFAULT_WIN]; }
    await saveAvail(next);
  };
  const setAll = async (on) => {
    if (!on) return saveAvail({});
    const next = { ...myAvail };
    dates.forEach((d) => { if (!(d in next)) next[d] = [DEFAULT_WIN]; });
    await saveAvail(next);
  };
  const setWin = (d, i, startMin, endMin) => {
    const wins = [...(myAvail[d] || [])];
    wins[i] = `${startMin}|${endMin}`;
    return saveAvail({ ...myAvail, [d]: wins });
  };
  const addWin = (d) => saveAvail({ ...myAvail, [d]: [...(myAvail[d] || []), DEFAULT_WIN] });
  const removeWin = (d, i) => {
    const wins = (myAvail[d] || []).filter((_, j) => j !== i);
    return saveAvail({ ...myAvail, [d]: wins });
  };

  return (
    <div className="fadein" key="myavail">
      <p className="muted" style={{ marginTop: 0 }}>
        Tap the days you're free, then set your time ranges for each day (EST) — add as many
        ranges per day as you need (e.g. 10 AM–12 PM and 3–5 PM). Interviewees can only pick
        30-minute slots inside these ranges; each booking is auto-assigned to an available
        interviewer with the fewest calls.
      </p>
      <div className="avail-row" style={{ marginBottom: 16 }}>
        <Btn kind="outline" small onClick={() => setAll(true)}>Mark all free</Btn>
        <Btn kind="outline" small onClick={() => setAll(false)}>Clear all</Btn>
      </div>
      <div className="date-grid">
        {dates.map((d, i) => {
          const on = d in myAvail;
          return (
            <button key={d} onClick={() => toggle(d)}
              className={`date-card stagger${on ? " is-selected" : ""}`}
              style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}>
              <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
            </button>
          );
        })}
      </div>

      {myDays.length > 0 && (
        <>
          <h3 className="step-h" style={{ marginTop: 26 }}>Your time ranges for each day <span className="muted">· EST</span></h3>
          <div className="times-table">
            {myDays.map((d) => {
              const wins = myAvail[d] || [];
              const totalSlots = wins.reduce((n, w) => n + slotsInWindow(w).length, 0);
              return (
                <div key={d} className="times-row" style={{ alignItems: "flex-start" }}>
                  <div className="times-day" style={{ paddingTop: 8 }}>
                    <b>{shortDay(d)}</b>
                    <span>{shortDate(d)}</span>
                  </div>
                  <div className="win-stack">
                    {wins.map((w, i) => {
                      const p = parseWindow(w) || [10 * 60, 16 * 60];
                      return (
                        <div key={i} className="win-line">
                          <label className="win-label">From
                            <select className="win-select" value={p[0]}
                              onChange={(e) => setWin(d, i, Number(e.target.value), Math.max(Number(e.target.value) + 30, p[1]))}>
                              {TIME_CHOICES.slice(0, -1).map((m) => <option key={m} value={m}>{minsToLabel(m)}</option>)}
                            </select>
                          </label>
                          <label className="win-label">To
                            <select className="win-select" value={p[1]}
                              onChange={(e) => setWin(d, i, p[0], Number(e.target.value))}>
                              {TIME_CHOICES.filter((m) => m > p[0]).map((m) => <option key={m} value={m}>{minsToLabel(m)}</option>)}
                            </select>
                          </label>
                          {wins.length > 1 && (
                            <button className="win-remove" title="Remove this range" onClick={() => removeWin(d, i)}>×</button>
                          )}
                        </div>
                      );
                    })}
                    <button className="win-add" onClick={() => addWin(d)}>+ Add another range</button>
                  </div>
                  <span className="times-status set" style={{ paddingTop: 10 }}>{totalSlots} slot{totalSlots === 1 ? "" : "s"}</span>
                </div>
              );
            })}
          </div>
          <p className="muted">Interviewees will only be offered 30-minute slots inside these ranges.</p>
        </>
      )}
      <p className="muted">You're available on <b style={{ color: "var(--green)" }}>{myDays.length}</b> day{myDays.length === 1 ? "" : "s"}.</p>
    </div>
  );
}

/* ---------------- Admin ---------------- */
function Admin({ data, save, closedKeys, user, logout }) {
  const [tab, setTab] = useState("mycalls");
  const dates = useMemo(bookableDates, []);
  const [manageDate, setManageDate] = useState(dates[0]);
  const active = data.bookings.filter((b) => !b.cancelled);

  const cancelBooking = (id) => save({ ...data, bookings: data.bookings.map((b) => (b.id === id ? { ...b, cancelled: true } : b)) });
  const toggleDay = (d) =>
    save({ ...data, closedSlots: closedKeys.has(d) ? data.closedSlots.filter((k) => k !== d) : [...data.closedSlots, d] });

  return (
    <section className="page">
      <div className="admin-top rise d1">
        <div><h2 style={{ margin: 0 }}>180 Team Area</h2><p className="muted" style={{ margin: "2px 0 0" }}>Logged in as <b style={{ color: "var(--green)" }}>{user.name}</b>{user.role ? ` \u00b7 ${user.role}` : ""}</p></div>
        <Btn kind="outline" small onClick={logout}>Log out</Btn>
      </div>

      {!emailConfigured() && (
        <p className="notice rise d2">
          Automatic emails are off. Add your free EmailJS keys in the CONFIG at the top of the site code to
          email confirmations and meeting links to interviewees and interviewers automatically.
        </p>
      )}

      <div className="stats">
        {[["Upcoming calls", active.length], ["Cancelled", data.bookings.length - active.length], ["Blocked days", data.closedSlots.length]].map(([k, v], i) => (
          <div key={k} className="card stat stagger" style={{ animationDelay: `${i * 80}ms` }}><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      <div className="tabs rise d3">
        <button className={`tab${tab === "mycalls" ? " on" : ""}`} onClick={() => setTab("mycalls")}>My Calls</button>
        <button className={`tab${tab === "myavail" ? " on" : ""}`} onClick={() => setTab("myavail")}>My Availability</button>
        <button className={`tab${tab === "bookings" ? " on" : ""}`} onClick={() => setTab("bookings")}>All Bookings</button>
        <button className={`tab${tab === "availability" ? " on" : ""}`} onClick={() => setTab("availability")}>Block Days</button>
      </div>

      {tab === "mycalls" ? (
        <MyCallsPanel data={data} save={save} user={user} />
      ) : tab === "myavail" ? (
        <MyAvailabilityPanel data={data} save={save} user={user} />
      ) : tab === "bookings" ? (
        active.length === 0 ? (
          <p className="muted fadein" key="empty">No upcoming calls yet — bookings will appear here.</p>
        ) : (
          <div className="tbl-wrap fadein" key="tbl">
            <table>
              <thead><tr>{["Name", "Email", "Date", "Time", "Interviewer", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {[...active].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((b, i) => (
                  <tr key={b.id} className="stagger" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                    <td><b>{b.name}</b></td><td>{b.email}</td><td>{prettyDate(b.date)}</td><td>{b.time}</td><td>{b.interviewer}</td>
                    <td><Btn kind="danger" small onClick={() => cancelBooking(b.id)}>Cancel</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="fadein" key="avail">
          <p className="muted" style={{ marginTop: 0 }}>Tap a day to block or reopen it for interviewees. Blocked days can't be booked by anyone.</p>
          <div className="date-grid">
            {dates.map((d, i) => {
              const closed = closedKeys.has(d);
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className={`date-card stagger${closed ? " blockedday" : ""}`}
                  style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}>
                  <span>{shortDay(d)}</span><b>{shortDate(d)}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Footer ---------------- */
function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-in">
        <Logo h={36} />
        <div className="ftr-txt">
          <b>180 Degrees Consulting Purdue</b>
          <span>{CONFIG.footerTagline}</span>
        </div>
        <div className="ftr-links">
          <a href={`mailto:${CONFIG.clubEmail}`}>{CONFIG.clubEmail}</a>
          <a href={CONFIG.instagram} target="_blank" rel="noreferrer">Instagram</a>
          <a href={CONFIG.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>
        </div>
      </div>
    </footer>
  );
}

/* ---------------- styles ---------------- */
function GlobalStyles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

* , *::before, *::after { box-sizing: border-box; }
.site { min-height: 100vh; display: flex; flex-direction: column; background: #fff; color: #111;
  font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
.wrap { flex: 1; width: 100%; max-width: 920px; margin: 0 auto; padding: 0 20px; box-sizing: border-box; }
h1, h2, h3 { font-family: 'Space Grotesk', sans-serif; color: #111; }
a { color: var(--green); font-weight: 600; text-decoration: none; transition: color .2s; }
a:hover { text-decoration: underline; color: var(--greenDark); }
.muted { color: #777; font-weight: 400; font-size: 14.5px; }
.loading { padding: 60px; text-align: center; color: #888; }

/* ---- motion ---- */
.page { animation: pageIn .5s cubic-bezier(.22,1,.36,1) both; padding: 40px 0 80px; }
@keyframes pageIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.rise { animation: rise .6s cubic-bezier(.22,1,.36,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.d1 { animation-delay: .05s; } .d2 { animation-delay: .12s; } .d3 { animation-delay: .2s; }
.d4 { animation-delay: .28s; } .d5 { animation-delay: .38s; }
.stagger { animation: rise .45s cubic-bezier(.22,1,.36,1) both; }
.fadein { animation: fadein .35s ease both; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

/* wizard step transitions — forward slides in from the right, back from the left */
.slide-fwd { animation: slideFwd .45s cubic-bezier(.22,1,.36,1) both; }
.slide-back { animation: slideBack .45s cubic-bezier(.22,1,.36,1) both; }
@keyframes slideFwd { from { opacity: 0; transform: translateX(36px); } to { opacity: 1; transform: none; } }
@keyframes slideBack { from { opacity: 0; transform: translateX(-36px); } to { opacity: 1; transform: none; } }
.slide-fwd .stagger, .slide-back .stagger { animation: fadein .4s ease both; }

/* header */
.hdr { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,.92); backdrop-filter: blur(10px);
  border-bottom: 1px solid #E9E9E4; animation: fadein .5s ease both; }
.hdr-in { max-width: 920px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand { background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center;
  transition: opacity .2s, transform .2s; }
.brand:hover { opacity: .85; }
nav { margin-left: auto; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.nav-lnk { position: relative; background: none; border: none; cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  font-weight: 600; font-size: 14.5px; color: #111; padding: 9px 14px; border-radius: 8px;
  transition: background .25s, color .25s; }
.nav-lnk:hover { color: var(--greenDark); background: var(--tint); }
.nav-lnk.on { color: var(--green); }
.nav-lnk.sub { color: #888; font-size: 13.5px; }
.nav-lnk.back { color: #fff; background: var(--green); }
.nav-lnk.back:hover { background: var(--greenDark); color: #fff; }

/* hero */
.hero { padding-top: 80px; max-width: 680px; }
.eyebrow { font-family: 'Space Grotesk', sans-serif; color: var(--green); font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; font-size: 12.5px; margin: 0 0 16px; }
.hero h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.12; margin: 0 0 18px; }
.lede { font-size: 17.5px; line-height: 1.65; color: #444; margin: 0 0 32px; }
.steps-line { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 46px;
  font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; color: #555; }
.steps-line i { color: var(--green); font-style: normal; }

/* buttons */
.btn { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; border-radius: 10px;
  padding: 14px 28px; cursor: pointer; border: 2px solid transparent;
  transition: background .25s, transform .18s cubic-bezier(.22,1,.36,1), box-shadow .25s, border-color .25s, color .25s; }
.btn:active { transform: scale(.97); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-sm { padding: 8px 16px; font-size: 14px; border-radius: 8px; }
.btn-primary { background: var(--green); color: #fff; box-shadow: 0 2px 10px rgba(118,169,53,.28); }
.btn-primary:hover:not(:disabled) { background: var(--greenDark); box-shadow: 0 4px 14px rgba(118,169,53,.35); }
.btn-outline { background: #fff; color: #111; border-color: #111; }
.btn-outline:hover { background: #111; color: #fff; }
.btn-danger { background: #fff; color: #C0392B; border-color: #E4B6B0; }
.btn-danger:hover { border-color: #C0392B; background: #FDF3F2; }

/* wizard nav */
.wizard-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px;
  padding-top: 22px; border-top: 1.5px solid #EFEFEA; }

/* progress */
.progress { display: flex; gap: 8px; margin: 20px 0 32px; }
.p-seg { flex: 1; }
.p-bar { height: 5px; border-radius: 3px; background: #E9E9E4; overflow: hidden; position: relative; }
.p-bar::before { content: ""; position: absolute; inset: 0; background: var(--green); border-radius: 3px;
  transform: scaleX(0); transform-origin: left; transition: transform .5s cubic-bezier(.22,1,.36,1); }
.p-seg.done .p-bar::before { transform: scaleX(1); }
.p-seg span { font-size: 12.5px; font-weight: 600; color: #999; transition: color .4s; display: inline-block; margin-top: 6px; }
.p-seg.done span { color: var(--green); }

.step-h { font-size: 18px; margin: 0 0 14px; }

/* date grid */
.date-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; margin-bottom: 30px; }
.date-card { display: flex; flex-direction: column; gap: 2px; align-items: center; padding: 12px 6px;
  box-sizing: border-box; width: 100%; border-radius: 12px; border: 2px solid #DEDEDA; background: #fff;
  cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  transition: border-color .25s, background .25s, color .25s; }
.date-card span { font-size: 12px; font-weight: 600; color: #888; transition: color .25s; }
.date-card b { font-size: 15px; color: #111; transition: color .25s; }
.date-card:hover:not(:disabled):not(.is-selected) { border-color: var(--green); }
.date-card.is-selected { background: var(--green); border-color: var(--green); }
.date-card.blockedday { border-color: #C0392B; background: #FDF3F2; }
.date-card.blockedday span, .date-card.blockedday b { color: #C0392B; text-decoration: line-through; }
.date-card.is-selected span, .date-card.is-selected b { color: #fff; }
.date-card:disabled { background: #F5F5F2; cursor: not-allowed; }
.date-card:disabled b { color: #BBB; }

/* time pills */
.pills { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 30px; }
.pill { padding: 11px 22px; border-radius: 999px; font-family: 'Space Grotesk', sans-serif; font-weight: 600;
  font-size: 15px; border: 2px solid #DEDEDA; background: #fff; color: #111; cursor: pointer;
  transition: border-color .25s, background .25s, color .25s; }
.pill:hover:not(:disabled):not(.is-selected) { border-color: var(--green); }
.pill.is-selected { background: var(--green); border-color: var(--green); color: #fff; }
.pill.off { background: #F5F5F2; color: #BBB; text-decoration: line-through; cursor: not-allowed; }
.pill.avail { background: var(--tint); border: 2px solid var(--green); }
.pill.blocked { color: #C0392B; border-color: #C0392B; text-decoration: line-through; }
.pill.booked { background: #EEE; color: #999; cursor: not-allowed; }

/* per-day times table */
.times-table { border: 1.5px solid #E7E7E2; border-radius: 12px; overflow: hidden; }
.times-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
.times-row + .times-row { border-top: 1px solid #EDEDEA; }
.times-row:nth-child(even) { background: #FAFAF8; }
.times-day { display: flex; flex-direction: column; min-width: 64px; line-height: 1.2; }
.times-day b { font-family: 'Space Grotesk', sans-serif; font-size: 14px; }
.times-day span { font-size: 12.5px; color: #777; }
.times-input { flex: 1; min-width: 200px; padding: 9px 12px; font-size: 14.5px;
  border: 1.5px solid #D8D8D3; border-radius: 8px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .2s, box-shadow .2s; background: #fff; }
.times-input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.14); }
.times-status { font-size: 12.5px; font-weight: 700; color: #AAA; min-width: 64px; text-align: right; }
.times-status.set { color: var(--green); }
.win-label { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: #666;
  font-family: 'Space Grotesk', sans-serif; }
.win-select { padding: 8px 10px; font-size: 14px; border: 1.5px solid #D8D8D3; border-radius: 8px;
  font-family: Inter, sans-serif; background: #fff; outline: none; transition: border-color .2s; }
.win-select:focus { border-color: var(--green); }
.win-stack { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.win-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.win-remove { width: 30px; height: 30px; border-radius: 8px; border: 1.5px solid #E3B7B2; background: #fff;
  color: #C0392B; font-size: 16px; font-weight: 700; cursor: pointer; line-height: 1;
  transition: background .2s, border-color .2s; }
.win-remove:hover { background: #FDF3F2; border-color: #C0392B; }
.win-add { align-self: flex-start; padding: 7px 14px; border-radius: 999px; border: 1.5px dashed var(--green);
  background: #fff; color: var(--greenDark); font-family: 'Space Grotesk', sans-serif; font-weight: 700;
  font-size: 13px; cursor: pointer; transition: background .2s; }
.win-add:hover { background: var(--tint); }

/* team windows hint on the booking time step */
.windows-hint { background: var(--tint); border: 1px solid var(--green); border-radius: 10px;
  padding: 10px 14px; font-size: 13.5px; margin: 0 0 14px; }
.windows-hint b { font-family: 'Space Grotesk', sans-serif; font-size: 13px; }
.windows-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.window-chip { background: #fff; border: 1px solid var(--green); border-radius: 999px;
  padding: 3px 12px; font-weight: 600; font-size: 13px; color: var(--greenDark); }

/* quick time chips */
.quick-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 8px 16px; border-radius: 999px; font-family: 'Space Grotesk', sans-serif; font-weight: 600;
  font-size: 13.5px; border: 1.5px solid #DEDEDA; background: #fff; color: #333; cursor: pointer;
  transition: border-color .2s, background .2s, color .2s; }
.chip:hover { border-color: var(--green); background: var(--tint); color: var(--greenDark); }

/* cards + form */
.card { border: 1.5px solid #E7E7E2; border-radius: 14px; background: #fff; transition: box-shadow .3s, transform .3s; }
.form-card { max-width: 430px; padding: 26px; box-shadow: 0 8px 28px rgba(0,0,0,.06); }
.summary-chip { background: var(--tint); border: 1px solid var(--green); border-radius: 9px;
  padding: 10px 14px; font-size: 14.5px; margin-bottom: 20px; }
.field { display: block; margin-bottom: 18px; }
.field span { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; margin-bottom: 6px; }
.field input { width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 16px;
  border: 1.5px solid #D8D8D3; border-radius: 9px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .25s, box-shadow .25s; }
.field input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.16); }
.err { color: #C0392B; font-weight: 600; font-size: 14px; margin: 0 0 14px; animation: shake .35s ease; }
@keyframes shake { 0%,100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

/* confirmation */
.confirm { max-width: 520px; }
.check { width: 58px; height: 58px; border-radius: 50%; background: var(--green); display: flex;
  align-items: center; justify-content: center; margin-bottom: 20px;
  animation: pop .55s cubic-bezier(.22,1.5,.36,1) both; box-shadow: 0 6px 20px rgba(118,169,53,.35); }
@keyframes pop { from { transform: scale(0) rotate(-30deg); } to { transform: scale(1) rotate(0); } }
.detail-card { margin: 24px 0 18px; overflow: hidden; }
.d-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 18px; font-size: 15px; }
.d-row:nth-child(even) { background: #FAFAF8; }
.fine { font-size: 14.5px; color: #666; line-height: 1.6; margin: 14px 0 20px; }

.teams-btn { display: inline-flex; align-items: center; gap: 9px; background: var(--green); color: #fff !important;
  font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15.5px; padding: 13px 24px;
  border-radius: 10px; text-decoration: none !important; box-shadow: 0 2px 10px rgba(118,169,53,.28);
  transition: background .25s, transform .18s, box-shadow .25s; }
.teams-btn:hover { background: var(--greenDark); box-shadow: 0 4px 14px rgba(118,169,53,.35); }
.teams-btn.small { padding: 9px 16px; font-size: 14px; }

/* my calls */
.call-card { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 16px 20px; margin-top: 12px; }
.call-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.05); }
.call-when { display: flex; flex-direction: column; min-width: 180px; }
.call-when b { font-family: 'Space Grotesk', sans-serif; font-size: 15.5px; }
.call-time { color: var(--green); font-weight: 700; font-size: 14.5px; }
.call-who { display: flex; flex-direction: column; flex: 1; min-width: 160px; }
.call-who b { font-size: 15px; }
.call-who a { font-size: 13.5px; font-weight: 500; }

/* link editor + availability */
.link-card { padding: 18px 20px; }
.link-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15.5px; margin: 0 0 4px; }
.link-row { display: flex; gap: 10px; flex-wrap: wrap; }
.link-input { flex: 1; min-width: 220px; box-sizing: border-box; padding: 11px 14px; font-size: 14.5px;
  border: 1.5px solid #D8D8D3; border-radius: 9px; font-family: Inter, sans-serif; outline: none;
  transition: border-color .25s, box-shadow .25s; }
.link-input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(118,169,53,.16); }
.saved-msg { color: var(--green); font-weight: 700; font-size: 14px; margin: 8px 0 0; animation: fadein .3s ease; }
.avail-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

/* admin */
.admin-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.notice { background: var(--tint); border: 1px solid var(--green); border-radius: 10px;
  padding: 12px 16px; font-size: 14px; color: #333; line-height: 1.55; margin: 18px 0 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 24px 0 8px; }
.stat { padding: 15px 18px; }
.stat:hover { box-shadow: 0 4px 12px rgba(0,0,0,.05); }
.stat span { font-size: 13px; color: #777; font-weight: 600; }
.stat b { display: block; font-family: 'Space Grotesk', sans-serif; font-size: 28px; color: var(--green); margin-top: 2px; }
.tabs { border-bottom: 1.5px solid #E7E7E2; margin: 16px 0 22px; }
.tab { background: none; border: none; cursor: pointer; font-family: 'Space Grotesk', sans-serif;
  font-weight: 700; font-size: 15px; padding: 10px 2px; margin-right: 24px; color: #777;
  border-bottom: 3px solid transparent; transition: color .25s, border-color .25s; }
.tab:hover { color: #111; }
.tab.on { color: var(--green); border-color: var(--green); }
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #111;
  font-family: 'Space Grotesk', sans-serif; font-size: 12.5px; letter-spacing: .04em; text-transform: uppercase; }
td { padding: 11px 12px; border-bottom: 1px solid #EDEDEA; transition: background .2s; }
tr:hover td { background: #FAFBF7; }
.dropdown { padding: 10px 14px; font-size: 15px; border-radius: 9px; border: 1.5px solid #D8D8D3;
  margin-bottom: 18px; font-family: Inter, sans-serif; background: #fff; transition: border-color .25s;
  min-width: 220px; }
.dropdown:focus { border-color: var(--green); outline: none; }

/* footer — light */
.ftr { background: #FAFAF8; border-top: 1px solid #E9E9E4; margin-top: auto; }
.ftr-in { max-width: 920px; margin: 0 auto; padding: 26px 20px; display: flex; flex-wrap: wrap;
  gap: 20px; align-items: center; }
.ftr-txt { display: flex; flex-direction: column; gap: 3px; }
.ftr-txt b { font-family: 'Space Grotesk', sans-serif; font-size: 15px; color: #111; }
.ftr-txt span { font-size: 13px; color: #888; }
.ftr-links { margin-left: auto; display: flex; gap: 18px; font-size: 14px; flex-wrap: wrap; }

@media (max-width: 560px) {
  .hero { padding-top: 48px; }
  .ftr-links { margin-left: 0; }
  .brand img { height: 40px !important; }
}
@media (prefers-reduced-motion: reduce) {
  *, .page, .rise, .stagger, .check, .fadein, .slide-fwd, .slide-back { animation: none !important; transition: none !important; }
}
    `}</style>
  );
}
