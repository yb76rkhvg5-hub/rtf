// RTF – RoadToFTP: Kalender-Automatik
// Ein iOS-Kurzbefehl legt die belegten Zeiten (nur Start|Ende, keine Titel) als Notiz "RTF Kalender"
// am 01.01.2000 in intervals.icu ab. RTF liest sie, legt die Einheiten der nächsten 14 Tage in freie
// Zeitfenster und sendet den angepassten Plan automatisch an intervals.icu (→ Zwift, Garmin).
"use strict";

const CAL_NOTE_DATE = "2000-01-01";
const CAL_NOTE_NAME = "RTF Kalender";
const CAL_DEFAULTS = { earliest: "05:30", latest: "21:30", buffer: 15, horizon: 14, autopush: true, exclude: [],
  work: { active: true, from: "06:40", to: "19:00", doneBy: "06:10", days: [0, 1, 2, 3, 4] } }; // feste Arbeitszeit (Mo–Fr), morgens fertig bis

/** Feste Arbeitszeit als belegte Blöcke für jeden Tag im Zeitraum */
function workBlocks(c, fromIso, toIso) {
  const w = c.work;
  if (!w?.active || !w.days?.length) return [];
  const out = [];
  for (let d = parseDate(fromIso); isoDate(d) <= toIso; d = addDays(d, 1)) {
    if (!w.days.includes(weekdayMon0(d))) continue;
    const at = hm => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, toMin(hm)).getTime();
    out.push({ s: at(w.from), e: at(w.to), work: true });
    // Morgens vor der Arbeit: Training muss bis "doneBy" beendet sein (feste Grenze, ohne Puffer)
    if (w.doneBy && toMin(w.doneBy) < toMin(w.from)) out.push({ s: at(w.doneBy), e: at(w.from), work: true, nb: true });
  }
  return out;
}
const calCfg = () => ({ ...CAL_DEFAULTS, ...(S.settings.cal || {}) });

// ---------------------------------------------------------------- Einlesen
function parseCalDate(s) {
  s = s.trim();
  let d = new Date(s);
  if (!isNaN(d)) return d;
  // Fallback für deutsches Format, z. B. "23.11.2026, 09:00" oder "23.11.26 09:00"
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(\d{1,2}):(\d{2})/);
  if (m) return new Date(+(m[3].length === 2 ? "20" + m[3] : m[3]), +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}
function parseBusy(text) {
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const [a, b, cal] = l.split("|");
    const s = a && parseCalDate(a), e = b && parseCalDate(b);
    return s && e ? { s: s.getTime(), e: e.getTime(), cal: (cal || "").trim() } : null;
  }).filter(x => x && x.e > x.s && x.e - x.s < 23 * 3600e3); // ganztägige Termine ignorieren
}
/** Kalendernamen aus der Kopfzeile "#kalender: [...]" (liefert das Scriptable-Skript) */
function parseCalendars(text) {
  const m = String(text || "").match(/^#kalender:\s*(\[.*\])\s*$/m);
  try { return m ? JSON.parse(m[1]) : []; } catch { return []; }
}

async function calFetchBusy() {
  const ev = await icu(`/events?oldest=${CAL_NOTE_DATE}&newest=${CAL_NOTE_DATE}`);
  const notes = (ev || []).filter(e => (e.name || "").startsWith(CAL_NOTE_NAME)).sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!notes.length) return null;
  // nur die neueste Notiz behalten, ältere aufräumen
  for (const n of notes.slice(1)) icu(`/events/${n.id}`, { method: "DELETE" }).catch(() => {});
  const busy = parseBusy(notes[0].description), calendars = parseCalendars(notes[0].description);
  return { id: notes[0].id, received: notes[0].updated || notes[0].created || null, fetched: new Date().toISOString(), busy, calendars };
}

// ---------------------------------------------------------------- Planen
const toMin = hhmm => { const [h, m] = String(hhmm || "18:00").split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const round5 = m => Math.ceil(m / 5) * 5;

/** Freie Zeitfenster eines Tages in Minuten ab Mitternacht */
function freeGaps(dateIso, busy, c) {
  const day = parseDate(dateIso);
  const at = min => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min).getTime();
  let ws = toMin(c.earliest);
  const we = toMin(c.latest);
  if (dateIso === todayIso()) { const n = new Date(); ws = Math.max(ws, round5(n.getHours() * 60 + n.getMinutes() + 15)); }
  const blocks = busy.filter(b => b.e > at(ws) && b.s < at(we))
    .map(b => { const buf = b.nb ? 0 : c.buffer; // feste Grenzen (z. B. "morgens fertig bis") ohne Puffer
      return [Math.max(ws, Math.floor((b.s - at(0)) / 60000) - buf), Math.min(we, Math.ceil((b.e - at(0)) / 60000) + buf)]; })
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = ws;
  for (const [s, e] of blocks) { if (s > cur) gaps.push([cur, s]); cur = Math.max(cur, e); }
  if (we > cur) gaps.push([cur, we]);
  return gaps.filter(g => g[1] - g[0] >= 20);
}
/** Beste Startzeit: passendes Fenster möglichst nah an der Wunschzeit */
function bestSlot(gaps, need, pref) {
  let best = null;
  for (const g of gaps) {
    if (g[1] - g[0] < need) continue;
    const st = Math.min(Math.max(pref, g[0]), g[1] - need);
    const dist = Math.abs(st - pref);
    if (!best || dist < best.dist) best = { st: round5(st) > g[1] - need ? st : round5(st), dist };
  }
  return best;
}
function rebuild(d, minutes, ftp) {
  const o = d.workout;
  const wo = buildWorkout(o.kind, minutes, o.level || 0, ftp);
  wo.structure = describeSegments(wo.segments, ftp);
  wo.id = o.id;
  d.workout = wo;
}

/**
 * Passt den Basisplan an die belegten Zeiten an. Gibt { plan, log } zurück.
 * Reihenfolge je Einheit: Uhrzeit verschieben → kürzen (mind. 30 min) → auf freien Tag derselben Woche → entfällt.
 * Intensive Einheiten werden zuerst eingeplant und bekommen so die besten Fenster.
 */
function adaptPlan(base, cal, st) {
  const plan = structuredClone(base);
  const log = [];
  if (!plan) return { plan, log };
  const c = { ...CAL_DEFAULTS, ...(st.cal || {}), work: { ...CAL_DEFAULTS.work, ...(st.cal?.work || {}) } };
  const today = todayIso();
  const planEnd = plan.weeks.at(-1) ? isoDate(addDays(parseDate(plan.weeks.at(-1).start), 6)) : today;
  // Kalendertermine kennen wir für ~14 Tage, die Arbeitszeit für den ganzen Plan
  const horizon = c.work.active ? planEnd : isoDate(addDays(new Date(), c.horizon));
  const exclude = new Set(c.exclude || []); // abgewählte Kalender (z. B. geteilter Kalender der Partnerin)
  const busyAll = [...(cal?.busy || []).filter(b => !exclude.has(b.cal)), ...workBlocks(c, today, horizon)];
  if (!busyAll.length) return { plan, log };
  cal = { ...(cal || {}), busy: busyAll };
  const easy = k => ["endurance", "recovery"].includes(k);
  const why = d => cal.busy.some(b => !b.work && b.s < parseDate(d.date).getTime() + 864e5 && b.e > parseDate(d.date).getTime()) ? "Termin" : "Arbeitszeit";
  for (const [wi, w] of plan.weeks.entries()) {
    const order = [...w.days].filter(d => d.date >= today && d.date <= horizon && d.workout.kind !== "event")
      .sort((a, b) => Number(easy(a.workout.kind)) - Number(easy(b.workout.kind)));
    const taken = new Set(w.days.map(d => d.date));
    for (const d of order) {
      const need = d.workout.minutes, pref = toMin(d.time);
      const gaps = freeGaps(d.date, cal.busy, c);
      const slot = bestSlot(gaps, need, pref);
      if (slot) {
        const t = fromMin(slot.st);
        if (t !== d.time) {
          if (why(d) === "Termin") { log.push({ date: d.date, name: d.workout.name, text: `Uhrzeit ${d.time} → ${t}` }); d.note = `Wegen Termin auf ${t} Uhr gelegt`; }
          d.time = t; // Verschiebung nur wegen Arbeitszeit ist der Normalfall – kein Hinweis nötig
        }
        continue;
      }
      const longest = gaps.reduce((a, g) => (!a || g[1] - g[0] > a[1] - a[0] ? g : a), null);
      const len = longest ? Math.floor((longest[1] - longest[0]) / 5) * 5 : 0;
      // Kürzen nur, wenn die gekürzte Einheit wirklich ins Fenster passt (Intervall-Einheiten haben eine Mindestlänge)
      const orig = d.workout;
      if (len >= 30 && d.workout.kind !== "ftp_test") rebuild(d, len, plan.ftp);
      if (d.workout !== orig && d.workout.minutes > len) d.workout = orig;
      if (d.workout !== orig) {
        const t = fromMin(longest[0]);
        log.push({ date: d.date, name: d.workout.name, text: `gekürzt auf ${d.workout.minutes} min, ${t} Uhr` });
        d.note = `Wegen ${why(d) === "Termin" ? "Terminen" : "Arbeitszeit"} gekürzt (${need} → ${d.workout.minutes} min)`; d.time = t;
        continue;
      }
      // freien Tag derselben Woche suchen (nicht direkt neben einer harten Einheit, wenn möglich)
      const cands = [];
      for (let i = 0; i < 7; i++) {
        const di = isoDate(addDays(parseDate(w.start), i));
        if (di < today || di > horizon || taken.has(di)) continue;
        const s2 = bestSlot(freeGaps(di, cal.busy, c), need, pref);
        if (!s2) continue;
        const nearHard = w.days.some(x => !easy(x.workout.kind) && x !== d && Math.abs(parseDate(x.date) - parseDate(di)) === 864e5);
        cands.push({ di, s2, score: (nearHard && !easy(d.workout.kind) ? 10 : 0) + Math.abs(parseDate(di) - parseDate(d.date)) / 864e5 });
      }
      cands.sort((a, b) => a.score - b.score);
      if (cands.length) {
        const { di, s2 } = cands[0], from = d.weekday;
        taken.delete(d.date); taken.add(di);
        d.date = di; d.weekday = WEEKDAYS[weekdayMon0(parseDate(di))]; d.time = fromMin(s2.st);
        log.push({ date: di, name: d.workout.name, text: `von ${from} auf ${d.weekday} ${d.time} verschoben` });
        d.note = `Wegen Terminen von ${from} hierher verschoben`;
        continue;
      }
      log.push({ date: d.date, name: d.workout.name, text: "entfällt – kein freies Zeitfenster" });
      d.drop = true;
    }
    w.days = w.days.filter(d => !d.drop).sort((a, b) => a.date.localeCompare(b.date));

    // Ausgleich: was durch Kürzen/Entfallen fehlt, auf andere Einheiten derselben Woche verteilen,
    // damit die geplante Wochenzeit erreicht wird – innerhalb freier Fenster und der Maximaldauer je Tag.
    const fut = d => d.date >= today && d.date <= horizon;
    const sum = days => days.filter(fut).reduce((a, d) => a + d.workout.minutes, 0);
    let deficit = sum(base.weeks[wi].days) - sum(w.days);
    if (deficit >= 10) {
      const grow = ["endurance", "endurance_tempo", "tempo", "sweetspot", "sweetspot_long", "threshold", "overunder"];
      const cands = w.days.filter(d => fut(d) && grow.includes(d.workout.kind))
        .sort((a, b) => Number(!easy(a.workout.kind)) - Number(!easy(b.workout.kind)) || b.workout.minutes - a.workout.minutes);
      for (const d of cands) {
        if (deficit < 10) break;
        const day = st.days?.[weekdayMon0(parseDate(d.date))];
        const cap = Math.max(d.workout.minutes, Math.round((day?.active ? +day.minutes : d.workout.minutes) * 1.15 / 5) * 5);
        const before = d.workout.minutes;
        let want = Math.min(cap, before + deficit);
        if (want - before < 10) continue;
        const gaps = freeGaps(d.date, cal.busy, c);
        let slot = bestSlot(gaps, want, toMin(d.time));
        while (!slot && want - before >= 10) { want -= 5; slot = bestSlot(gaps, want, toMin(d.time)); }
        if (!slot || want - before < 10) continue;
        const prev = d.workout;
        rebuild(d, want, plan.ftp);
        const fit = bestSlot(gaps, d.workout.minutes, toMin(d.time));
        if (!fit) { d.workout = prev; continue; } // Ergebnis länger als gedacht -> nicht verlängern
        d.time = fromMin(fit.st);
        deficit -= d.workout.minutes - before;
        log.push({ date: d.date, name: d.workout.name, text: `verlängert ${before} → ${d.workout.minutes} min (Wochenzeit halten)` });
        d.note = (d.note ? d.note + " · " : "") + `Verlängert auf ${d.workout.minutes} min, um die Wochenzeit zu halten`;
      }
    }
    w.hours = Math.round(w.days.reduce((a, x) => a + x.workout.minutes, 0) / 6) / 10;
    w.tss = w.days.reduce((a, x) => a + x.workout.tss, 0);
  }
  return { plan, log };
}

// ---------------------------------------------------------------- Senden an intervals.icu (→ Zwift, Garmin)
async function icuPushPlan() {
  if (!S.plan) throw new Error("Bitte zuerst einen Plan erstellen.");
  const today = todayIso();
  const events = [];
  for (const w of S.plan.weeks) for (const d of w.days) {
    if (d.date < today) continue;
    const wo = d.workout;
    if (wo.kind === "event") {
      events.push({ category: "RACE_A", start_date_local: `${d.date}T00:00:00`, type: "Ride", name: wo.name,
                    external_id: `rtf-${d.date}-event` });
      continue;
    }
    events.push({
      category: "WORKOUT", type: "VirtualRide", name: `RTF ${wo.name}`,
      start_date_local: `${d.date}T${d.time || "18:00"}:00`,
      description: workoutToIcuText(wo), moving_time: wo.minutes * 60, icu_training_load: wo.tss,
      external_id: `rtf-${d.date}`,
    });
  }
  if (!events.length) throw new Error("Keine zukünftigen Einheiten im Plan.");
  await icu("/events/bulk?upsert=true", { method: "POST", body: JSON.stringify(events) });
  // Alte RTF-Einheiten entfernen, die nicht mehr im Plan sind (nur ab heute)
  const last = events[events.length - 1].start_date_local.slice(0, 10);
  const keep = new Set(events.map(e => e.external_id));
  const existing = await icu(`/events?oldest=${today}&newest=${isoDate(addDays(parseDate(last), 60))}`);
  let removed = 0;
  for (const e of existing || []) {
    if (e.external_id && e.external_id.startsWith("rtf-") && !keep.has(e.external_id)) {
      await icu(`/events/${e.id}`, { method: "DELETE" }); removed++;
    }
  }
  return { count: events.length, removed };
}

// ---------------------------------------------------------------- Plan-Einstellungen für die Hintergrund-Automatik
// Die Automatik (Scriptable) rechnet den Plan aus denselben Eingaben exakt nach. Dafür liegen Einstellungen
// und Leistungsstand zum Zeitpunkt der Planerstellung als Notiz "RTF Plan" am 02.01.2000 in intervals.icu.
const PLAN_NOTE_DATE = "2000-01-02", PLAN_NOTE_NAME = "RTF Plan";
function planConfig() {
  if (!S.planBase) return null;
  const st = S.planSettings || S.settings;
  return JSON.stringify({ v: 1,
    settings: { ...st, start_date: S.planBase.weeks[0].start, cal: S.settings.cal || {} },
    perf: S.planPerf || { weekly_hours_avg: S.performance?.weekly_hours_avg ?? null, tsb: S.performance?.tsb ?? null } });
}
async function publishPlanConfig() {
  const txt = planConfig();
  if (!txt || S.cal?.cfgPublished === txt) return;
  const ev = await icu(`/events?oldest=${PLAN_NOTE_DATE}&newest=${PLAN_NOTE_DATE}`);
  for (const n of (ev || []).filter(e => (e.name || "").startsWith(PLAN_NOTE_NAME)))
    await icu(`/events/${n.id}`, { method: "DELETE" }).catch(() => {});
  await icu("/events", { method: "POST", body: JSON.stringify({
    category: "NOTE", start_date_local: `${PLAN_NOTE_DATE}T00:00:00`, name: PLAN_NOTE_NAME, description: txt }) });
  S.cal = { ...(S.cal || {}), cfgPublished: txt };
}

// ---------------------------------------------------------------- Ablauf
function applyCalendar() {
  if (!S.planBase) return;
  const { plan, log } = adaptPlan(S.planBase, S.cal?.data, S.settings);
  S.plan = plan;
  S.cal = { ...(S.cal || {}), log };
}
const upcomingHash = () => JSON.stringify((S.plan?.weeks || []).flatMap(w => w.days)
  .filter(d => d.date >= todayIso()).map(d => [d.date, d.time, d.workout.kind, d.workout.minutes]));

/** Beim Öffnen: Termine holen, Plan anpassen, bei Änderungen automatisch senden */
async function autoCalendarSync({ silent = true } = {}) {
  if (!S.icu?.key || !S.planBase) return;
  S.cal = S.cal || {};
  try {
    await publishPlanConfig();
    const data = await calFetchBusy();
    if (data) S.cal.data = data;
    S.cal.lastCheck = new Date().toISOString();
    S.cal.error = null;
    applyCalendar();
    const h = upcomingHash();
    if (calCfg().autopush && h !== S.cal.pushedHash) {
      const r = await icuPushPlan();
      S.cal.pushedHash = h; S.cal.lastPush = new Date().toISOString(); S.cal.pushInfo = r;
    }
  } catch (e) {
    S.cal.error = e.message;
    if (!silent) throw e;
  } finally {
    save(); renderAll();
  }
}

/** Selbsttest: sendet eine Beispielnotiz wie der Kurzbefehl, liest sie zurück und löscht sie wieder */
async function calSelfTest() {
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
  const e = new Date(t.getTime() + 3600e3);
  const iso = d => { const o = -d.getTimezoneOffset(), s = o >= 0 ? "+" : "-", p = n => String(Math.abs(n)).padStart(2, "0");
    return `${isoDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}:00${s}${p(o / 60 | 0)}:${p(o % 60)}`; };
  const created = await icu("/events", { method: "POST", body: JSON.stringify({
    category: "NOTE", start_date_local: `${CAL_NOTE_DATE}T00:00:00`, name: `${CAL_NOTE_NAME} Test`, description: `${iso(t)}|${iso(e)}` }) });
  try {
    const ev = await icu(`/events?oldest=${CAL_NOTE_DATE}&newest=${CAL_NOTE_DATE}`);
    const mine = (ev || []).find(x => x.id === created.id);
    const busy = parseBusy(mine?.description);
    if (busy.length !== 1) throw new Error("Notiz wurde gespeichert, aber nicht korrekt gelesen.");
  } finally {
    await icu(`/events/${created.id}`, { method: "DELETE" }).catch(() => {});
  }
  return true;
}

// ---------------------------------------------------------------- Oberfläche
function renderCalendar() {
  const host = $("calCard");
  if (!host) return;
  const c = calCfg(), cal = S.cal || {}, data = cal.data;
  $("calEarliest").value = c.earliest; $("calLatest").value = c.latest; $("calBuffer").value = c.buffer; $("calAuto").checked = !!c.autopush;
  const wk = { ...CAL_DEFAULTS.work, ...(c.work || {}) };
  $("workActive").checked = !!wk.active; $("workFrom").value = wk.from; $("workTo").value = wk.to; $("workDoneBy").value = wk.doneBy || "";
  const titles = [...new Set([...(data?.calendars || []), ...(data?.busy || []).map(b => b.cal).filter(Boolean)])].sort();
  const ex = new Set(c.exclude || []);
  $("calListHint").textContent = titles.length ? "Abgewählte Kalender zählen nicht als belegt (z. B. ein geteilter Kalender)." : "Die Liste erscheint nach dem nächsten Lauf der Tages-Automatik in Scriptable.";
  $("calList").innerHTML = titles.map(t => `<label class="chip"><input type="checkbox" value="${esc(t)}" ${ex.has(t) ? "" : "checked"}> ${esc(t)}</label>`).join("");
  $("workDays").innerHTML = WEEKDAYS.map((n, i) => `<label class="chip"><input type="checkbox" value="${i}" ${wk.days.includes(i) ? "checked" : ""}> ${n}</label>`).join("");
  const fmtTs = s => s ? new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
  const now = Date.now(), exS = new Set(c.exclude || []), next = data ? data.busy.filter(b => !exS.has(b.cal) && b.e > now && b.s < now + 14 * 864e5).length : 0;
  let st = !S.icu?.key ? "Zuerst intervals.icu unter „Leistung“ verbinden."
    : !data ? "Noch keine Termine empfangen. Richte die Tages-Automatik ein (Anleitung unten)."
    : `${next} Termine in den nächsten 14 Tagen · empfangen ${fmtTs(data.received || data.fetched)} · geprüft ${fmtTs(cal.lastCheck)}` +
      (cal.lastPush ? ` · gesendet ${fmtTs(cal.lastPush)}` : "");
  if (cal.error) st += ` · Fehler: ${cal.error}`;
  $("calStatus").textContent = st;
  const log = cal.log || [];
  $("calLog").innerHTML = log.length ? `<ul class="facts">${log.map(l =>
    `<li><b>${l.date.slice(8, 10)}.${l.date.slice(5, 7)}.</b> ${esc(l.name)} – ${esc(l.text)}</li>`).join("")}</ul>`
    : (data ? `<p class="muted">Alle Einheiten passen in deine freien Zeiten.</p>` : "");
}

function calBindUi() {
  const saveCfg = () => {
    S.settings.cal = { earliest: $("calEarliest").value || CAL_DEFAULTS.earliest, latest: $("calLatest").value || CAL_DEFAULTS.latest,
      buffer: Math.max(0, +$("calBuffer").value || 0), horizon: 14, autopush: $("calAuto").checked,
      work: { active: $("workActive").checked, from: $("workFrom").value || CAL_DEFAULTS.work.from, to: $("workTo").value || CAL_DEFAULTS.work.to, doneBy: $("workDoneBy").value || "",
              days: [...document.querySelectorAll("#workDays input:checked")].map(x => +x.value) },
      exclude: document.querySelectorAll("#calList input").length ? [...document.querySelectorAll("#calList input:not(:checked)")].map(x => x.value) : (calCfg().exclude || []) };
    applyCalendar(); save(); renderAll();
    autoCalendarSync(); // geänderte Einstellungen an die Automatik weitergeben und Plan senden
  };
  ["calEarliest", "calLatest", "calBuffer", "calAuto", "workActive", "workFrom", "workTo", "workDoneBy"].forEach(id => $(id).addEventListener("change", saveCfg));
  $("workDays").addEventListener("change", saveCfg);
  $("calList").addEventListener("change", saveCfg);
  $("calSync").onclick = async e => {
    busy(e.target, true, "Prüfe …");
    try { await autoCalendarSync({ silent: false }); msg("calMsg", "Kalender geprüft und Plan angepasst."); }
    catch (err) { msg("calMsg", esc(err.message), false); }
    busy(e.target, false);
  };
  $("calTest").onclick = async e => {
    busy(e.target, true, "Teste …");
    try { await calSelfTest(); msg("calMsg", "Übertragung funktioniert: Notiz gespeichert, gelesen und wieder gelöscht."); }
    catch (err) { msg("calMsg", "Test fehlgeschlagen: " + esc(err.message), false); }
    busy(e.target, false);
  };
  // Starter-Skript für Scriptable anzeigen und kopieren
  fetch("scriptable-starter.js", { cache: "no-cache" }).then(r => r.text()).then(t => { $("calScript").value = t; }).catch(() => {});
  $("calScriptCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("calScript").value); msg("calMsg", "Skript kopiert – jetzt in Scriptable einfügen."); }
    catch { $("calScript").select(); msg("calMsg", "Bitte den markierten Text manuell kopieren.", false); }
  };
}
