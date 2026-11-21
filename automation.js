// RoadToFTP – Tages-Automatik für Scriptable (iPhone)
// Wird vom kleinen Starter-Skript in Scriptable zusammen mit planner.js und calendar.js geladen.
// Ablauf: Plan-Einstellungen aus intervals.icu → Plan nachrechnen → eigene Termine lesen → Plan anpassen
//         → an intervals.icu senden (Zwift, Garmin) → Einheiten in den iPhone-Kalender schreiben.
// Gemeinsame Funktionen (generatePlan, adaptPlan, applyCalendar, icuPushPlan …) kommen aus planner.js/calendar.js.

var ENV = null;
var S = { settings: {}, icu: { key: "", athlete: "0" }, cal: {}, plan: null, planBase: null };
var structuredClone = o => JSON.parse(JSON.stringify(o)); // in Scriptable nicht vorhanden
var MARK = "[RoadToFTP]";                                   // Kennung eigener Kalendereinträge

function todayIso() { return isoDate(new Date()); }

async function icu(path, opts = {}) {
  const req = new ENV.Request(`https://intervals.icu/api/v1/athlete/${S.icu.athlete || "0"}${path}`);
  req.method = opts.method || "GET";
  req.headers = { Authorization: "Basic " + ENV.btoa("API_KEY:" + S.icu.key), "Content-Type": "application/json" };
  if (opts.body) req.body = opts.body;
  const txt = await req.loadString();
  const code = req.response?.statusCode || 0;
  if (code >= 400) throw new Error(`intervals.icu ${code}: ${String(txt).slice(0, 160)}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return null; }
}

async function readNote(date, name) {
  const ev = await icu(`/events?oldest=${date}&newest=${date}`);
  return (ev || []).filter(e => (e.name || "").startsWith(name)).sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
}

/** Zielkalender: ein Kalender namens "RoadToFTP", sonst der Standardkalender */
async function targetCalendar() {
  try { return await ENV.Calendar.forEventsByTitle("RoadToFTP"); }
  catch { return await ENV.Calendar.defaultForEvents(); }
}

/** Belegte Zeiten aus allen Kalendern, ohne ganztägige und ohne eigene RoadToFTP-Einträge */
async function readBusy(days) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = addDays(start, days + 1);
  const cals = await ENV.Calendar.forEvents();
  const evs = await ENV.CalendarEvent.between(start, end, cals);
  return evs.filter(e => !e.isAllDay && !String(e.notes || "").includes(MARK) && e.calendar?.title !== "RoadToFTP")
    .map(e => ({ s: e.startDate.getTime(), e: e.endDate.getTime() }));
}

/** Busy-Notiz für die App aktualisieren, damit sie beim Öffnen dieselbe Anpassung zeigt */
async function writeBusyNote(busy) {
  const ev = await icu(`/events?oldest=${CAL_NOTE_DATE}&newest=${CAL_NOTE_DATE}`);
  for (const n of (ev || []).filter(e => (e.name || "").startsWith(CAL_NOTE_NAME))) await icu(`/events/${n.id}`, { method: "DELETE" }).catch(() => {});
  const lines = busy.map(b => `${new Date(b.s).toISOString()}|${new Date(b.e).toISOString()}`).join("\n");
  await icu("/events", { method: "POST", body: JSON.stringify({
    category: "NOTE", start_date_local: `${CAL_NOTE_DATE}T00:00:00`, name: CAL_NOTE_NAME, description: lines }) });
}

/** Einheiten ab heute in den iPhone-Kalender schreiben; nur Geändertes wird ersetzt */
async function writeCalendar(cal) {
  const days = S.plan.weeks.flatMap(w => w.days.map(d => ({ ...d, phase: w.phase_label, week: w.index }))).filter(d => d.date >= todayIso());
  if (!days.length) return { added: 0, removed: 0 };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = addDays(parseDate(days[days.length - 1].date), 2);
  const existing = (await ENV.CalendarEvent.between(start, end, [cal])).filter(e => String(e.notes || "").includes(MARK));
  const want = days.map(d => {
    const o = d.workout, ev = { title: o.kind === "event" ? o.name : `RoadToFTP · ${o.name}`, allDay: o.kind === "event" };
    if (ev.allDay) { ev.start = parseDate(d.date); ev.end = addDays(ev.start, 1); }
    else {
      const [h, m] = (d.time || "18:00").split(":").map(Number);
      ev.start = new Date(...d.date.split("-").map((v, i) => i === 1 ? +v - 1 : +v), h, m);
      ev.end = new Date(ev.start.getTime() + o.minutes * 60000);
    }
    ev.notes = o.kind === "event" ? MARK
      : `${o.desc}\n\n${(o.structure || []).join("\n")}\n\n${o.minutes} min · TSS ${o.tss} · ${d.phase} (Woche ${d.week})` +
        (d.note ? `\n${d.note}` : "") + `\nZwift: Custom Workouts → intervals.icu\n${MARK}`;
    ev.key = `${ev.title}|${ev.start.getTime()}|${ev.end.getTime()}|${ev.allDay}`;
    return ev;
  });
  const keyOf = e => `${e.title}|${e.startDate.getTime()}|${e.endDate.getTime()}|${!!e.isAllDay}`;
  const wantKeys = new Set(want.map(w => w.key)), haveKeys = new Set(existing.map(keyOf));
  let removed = 0, added = 0;
  for (const e of existing) if (!wantKeys.has(keyOf(e))) { await e.remove(); removed++; }
  for (const w of want) {
    if (haveKeys.has(w.key)) continue;
    const e = new ENV.CalendarEvent();
    e.title = w.title; e.startDate = w.start; e.endDate = w.end; e.isAllDay = w.allDay; e.notes = w.notes; e.calendar = cal;
    await e.save(); added++;
  }
  return { added, removed };
}

/** Einstiegspunkt – env: { key, Request, Calendar, CalendarEvent, Notification, btoa, notify } */
async function runAutomation(env) {
  ENV = env;
  S.icu.key = env.key;
  const cfgNote = await readNote(PLAN_NOTE_DATE, PLAN_NOTE_NAME);
  if (!cfgNote) throw new Error("Kein Plan in intervals.icu gefunden. RoadToFTP einmal öffnen (mit intervals.icu verbunden).");
  const cfg = JSON.parse(cfgNote.description);
  S.settings = cfg.settings;
  S.planBase = generatePlan(cfg.settings, cfg.perf);
  const c = calCfg();
  const busy = await readBusy(c.horizon);
  // Nichts geändert (Termine, Plan-Einstellungen, Datum)? Dann sofort fertig – spart Akku und Daten.
  const sig = JSON.stringify({ busy, cfg: cfgNote.description, day: todayIso() });
  const store = typeof Keychain !== "undefined" ? Keychain : env.store;
  if (store && !env.force && store.contains("roadtoftp-last") && store.get("roadtoftp-last") === sig) return "Keine Änderungen – nichts zu tun.";
  S.cal = { data: { id: null, fetched: new Date().toISOString(), busy } };
  applyCalendar();
  await writeBusyNote(busy);
  const push = await icuPushPlan();
  const cal = await targetCalendar();
  const written = await writeCalendar(cal);
  if (store) store.set("roadtoftp-last", sig);
  const log = S.cal.log || [];
  const summary = log.length
    ? `${log.length} Anpassung${log.length > 1 ? "en" : ""}: ` + log.map(l => `${l.date.slice(8, 10)}.${l.date.slice(5, 7)}. ${l.name} – ${l.text}`).join("; ")
    : "Alle Einheiten passen in deine freien Zeiten.";
  if (env.notify && (written.added || written.removed) && written.removed + written.added < 50) { // nur bei echten Änderungen, nicht beim Ersteinrichten
    const n = new env.Notification();
    n.title = "RoadToFTP";
    n.body = summary;
    await n.schedule();
  }
  return `${summary} · ${busy.length} Termine · ${push.count} an intervals.icu · Kalender: +${written.added} −${written.removed} (${cal.title})`;
}
