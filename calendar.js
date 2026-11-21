// RTF – RoadToFTP: Kalender-Automatik
// Ein iOS-Kurzbefehl legt die belegten Zeiten (nur Start|Ende, keine Titel) als Notiz "RTF Kalender"
// am 01.01.2000 in intervals.icu ab. RTF liest sie, legt die Einheiten der nächsten 14 Tage in freie
// Zeitfenster und sendet den angepassten Plan automatisch an intervals.icu (→ Zwift, Garmin).
"use strict";

const CAL_NOTE_DATE = "2000-01-01";
const CAL_NOTE_NAME = "RTF Kalender";
const CAL_DEFAULTS = { earliest: "05:30", latest: "21:30", buffer: 15, horizon: 14, autopush: true };
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
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [a, b] = l.split("|");
    const s = a && parseCalDate(a), e = b && parseCalDate(b);
    return s && e ? { s: s.getTime(), e: e.getTime() } : null;
  }).filter(x => x && x.e > x.s && x.e - x.s < 23 * 3600e3); // ganztägige Termine ignorieren
}

async function calFetchBusy() {
  const ev = await icu(`/events?oldest=${CAL_NOTE_DATE}&newest=${CAL_NOTE_DATE}`);
  const notes = (ev || []).filter(e => (e.name || "").startsWith(CAL_NOTE_NAME)).sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!notes.length) return null;
  // nur die neueste Notiz behalten, ältere aufräumen
  for (const n of notes.slice(1)) icu(`/events/${n.id}`, { method: "DELETE" }).catch(() => {});
  const busy = parseBusy(notes[0].description);
  return { id: notes[0].id, received: notes[0].updated || notes[0].created || null, fetched: new Date().toISOString(), busy };
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
    .map(b => [Math.max(ws, Math.floor((b.s - at(0)) / 60000) - c.buffer), Math.min(we, Math.ceil((b.e - at(0)) / 60000) + c.buffer)])
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
  if (!plan || !cal?.busy) return { plan, log };
  const c = { ...CAL_DEFAULTS, ...(st.cal || {}) };
  const today = todayIso(), horizon = isoDate(addDays(new Date(), c.horizon));
  const easy = k => ["endurance", "recovery"].includes(k);
  for (const w of plan.weeks) {
    const order = [...w.days].filter(d => d.date >= today && d.date <= horizon && d.workout.kind !== "event")
      .sort((a, b) => Number(easy(a.workout.kind)) - Number(easy(b.workout.kind)));
    const taken = new Set(w.days.map(d => d.date));
    for (const d of order) {
      const need = d.workout.minutes, pref = toMin(d.time);
      const gaps = freeGaps(d.date, cal.busy, c);
      const slot = bestSlot(gaps, need, pref);
      if (slot) {
        const t = fromMin(slot.st);
        if (t !== d.time) { log.push({ date: d.date, name: d.workout.name, text: `Uhrzeit ${d.time} → ${t}` }); d.note = `Wegen Termin auf ${t} Uhr gelegt`; d.time = t; }
        continue;
      }
      const longest = gaps.reduce((a, g) => (!a || g[1] - g[0] > a[1] - a[0] ? g : a), null);
      const len = longest ? Math.floor((longest[1] - longest[0]) / 5) * 5 : 0;
      if (len >= 30 && d.workout.kind !== "ftp_test") {
        rebuild(d, len, plan.ftp);
        const t = fromMin(longest[0]);
        log.push({ date: d.date, name: d.workout.name, text: `gekürzt auf ${d.workout.minutes} min, ${t} Uhr` });
        d.note = `Wegen Terminen gekürzt (${need} → ${d.workout.minutes} min)`; d.time = t;
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
    w.hours = Math.round(w.days.reduce((a, x) => a + x.workout.minutes, 0) / 6) / 10;
    w.tss = w.days.reduce((a, x) => a + x.workout.tss, 0);
  }
  return { plan, log };
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
  const fmtTs = s => s ? new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
  const now = Date.now(), next = data ? data.busy.filter(b => b.e > now && b.s < now + 14 * 864e5).length : 0;
  let st = !S.icu?.key ? "Zuerst intervals.icu unter „Leistung“ verbinden."
    : !data ? "Noch keine Termine empfangen. Richte den Kurzbefehl ein (Anleitung unten)."
    : `${next} Termine in den nächsten 14 Tagen · empfangen ${fmtTs(data.received || data.fetched)} · geprüft ${fmtTs(cal.lastCheck)}` +
      (cal.lastPush ? ` · gesendet ${fmtTs(cal.lastPush)}` : "");
  if (cal.error) st += ` · Fehler: ${cal.error}`;
  $("calStatus").textContent = st;
  const log = cal.log || [];
  $("calLog").innerHTML = log.length ? `<ul class="facts">${log.map(l =>
    `<li><b>${l.date.slice(8, 10)}.${l.date.slice(5, 7)}.</b> ${esc(l.name)} – ${esc(l.text)}</li>`).join("")}</ul>`
    : (data ? `<p class="muted">Alle Einheiten passen in deine freien Zeiten.</p>` : "");
  $("calHeader").value = S.icu?.key ? "Basic " + btoa("API_KEY:" + S.icu.key) : "";
}

function calBindUi() {
  const saveCfg = () => {
    S.settings.cal = { earliest: $("calEarliest").value || CAL_DEFAULTS.earliest, latest: $("calLatest").value || CAL_DEFAULTS.latest,
      buffer: Math.max(0, +$("calBuffer").value || 0), horizon: 14, autopush: $("calAuto").checked };
    applyCalendar(); save(); renderAll();
  };
  ["calEarliest", "calLatest", "calBuffer", "calAuto"].forEach(id => $(id).addEventListener("change", saveCfg));
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
  $("calPromptCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("calPrompt").value); msg("calMsg", "Beschreibung kopiert – jetzt in Kurzbefehle einfügen."); }
    catch { $("calPrompt").select(); msg("calMsg", "Bitte den markierten Text manuell kopieren.", false); }
  };
  $("calCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("calHeader").value); msg("calMsg", "Header-Wert kopiert."); }
    catch { $("calHeader").select(); msg("calMsg", "Bitte den markierten Wert manuell kopieren.", false); }
  };
}
