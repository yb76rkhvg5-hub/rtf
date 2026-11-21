// RTF – RoadToFTP: App-Logik (Speicher, intervals.icu, Strava, Oberfläche)
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WD = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const KEY = "rtf-state-v1";
const DATA_DAYS = 180; // Zeitraum für Leistungsdaten und Analyse

const DEFAULTS = {
  settings: {
    goal_type: "ftp", goal_name: "", event_date: "", target_ftp: "", start_date: "", plan_weeks: 12,
    style: "pyramidal", focus: [], ftp: 200, weight: 75, weekly_hours: 6, ramp: "gradual", long_day: 5,
    days: {
      0: { active: false, minutes: 60, time: "18:00" }, 1: { active: true, minutes: 75, time: "18:00" },
      2: { active: true, minutes: 60, time: "18:00" }, 3: { active: true, minutes: 75, time: "18:00" },
      4: { active: false, minutes: 60, time: "18:00" }, 5: { active: true, minutes: 150, time: "09:00" },
      6: { active: true, minutes: 90, time: "09:00" },
    },
  },
  icu: { key: "", athlete: "0" },
  strava: {},
  performance: null,
  wellness: [],
  plan: null,       // angezeigter Plan (an Termine angepasst)
  planBase: null,   // erzeugter Plan ohne Kalenderanpassung
  cal: {},
  ui: { theme: "auto", planView: "week", weekOffset: 0, monthOffset: 0 },
  lastSync: null,
};

let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      const st = { ...structuredClone(DEFAULTS), ...s, settings: { ...DEFAULTS.settings, ...s.settings }, ui: { ...DEFAULTS.ui, ...(s.ui || {}) } };
      if (st.plan && !st.planBase) st.planBase = st.plan; // ältere Versionen
      return st;
    }
  } catch (e) { /* defekte Daten -> Standard */ }
  return structuredClone(DEFAULTS);
}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

function msg(el, text, ok = true) { $(el).innerHTML = `<div class="msg ${ok ? "ok" : "err"}">${text}</div>`; }
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || "…"; btn.disabled = true; }
  else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; }
}
const todayIso = () => isoDate(new Date());

// ================================================================ Navigation & Darstellung
const TITLES = { plan: "Plan", analyse: "Analyse", ziel: "Ziel & Profil", daten: "Leistung & Daten", kalender: "Kalender-Automatik", export: "Export" };
function show(id) {
  if (!TITLES[id]) id = "plan";
  document.querySelectorAll("nav button, .menu button[data-s]").forEach(b => b.classList.toggle("active", b.dataset.s === id));
  document.querySelectorAll("main > section").forEach(s => s.classList.toggle("active", s.id === id));
  const sub = id === "plan" || id === "analyse" ? "" : TITLES[id];
  $("pageTitle").textContent = sub; $("brand").hidden = !!sub; // Unterseiten zeigen ihren Titel statt des Namens
  history.replaceState(null, "", "#" + id);
  window.scrollTo(0, 0);
  closeMenu();
  if (id === "analyse") renderAnalysis(); // Diagramme brauchen die sichtbare Breite
}
document.querySelectorAll("nav button, .menu button[data-s]").forEach(b => b.onclick = () => show(b.dataset.s));

function openMenu() { $("menu").hidden = false; $("menuBtn").setAttribute("aria-expanded", "true"); }
function closeMenu() { if ($("menu")) { $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); } }
$("menuBtn").onclick = e => { e.stopPropagation(); $("menu").hidden ? openMenu() : closeMenu(); };
document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

function applyTheme() {
  const t = S.ui.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#0d0d0d" : "#f6f6f4");
  document.querySelectorAll("#themeSeg button").forEach(b => b.classList.toggle("active", b.dataset.t === (t || "auto")));
}
document.querySelectorAll("#themeSeg button").forEach(b => b.onclick = e => {
  e.stopPropagation();
  S.ui.theme = b.dataset.t; save(); applyTheme();
  if ($("analyse").classList.contains("active")) renderAnalysis(); // Diagrammfarben neu
});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
applyTheme();

// ================================================================ Formular
function renderForm() {
  const st = S.settings;
  $("goal_type").innerHTML = Object.entries(GOALS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  for (const k of ["goal_type", "goal_name", "event_date", "target_ftp", "start_date", "plan_weeks", "style", "ftp", "weight", "weekly_hours", "ramp"])
    $(k).value = st[k] ?? "";
  if (!st.start_date) $("start_date").value = todayIso();
  $("focus").innerHTML = Object.entries(HARD_TYPES).map(([k, v]) =>
    `<label class="chip"><input type="checkbox" value="${k}" ${st.focus.includes(k) ? "checked" : ""}> ${v}</label>`).join("");
  $("daysList").innerHTML = WD.map((n, i) => {
    const d = st.days[i] || { active: false, minutes: 60, time: "18:00" };
    return `<div class="dayrow">
      <label class="sw"><input type="checkbox" id="d_a${i}" ${d.active ? "checked" : ""}> <b>${n}</b></label>
      <input type="number" id="d_m${i}" value="${d.minutes}" min="30" step="15" inputmode="numeric" aria-label="Minuten"><span class="muted">min</span>
      <input type="time" id="d_t${i}" value="${d.time}" aria-label="Uhrzeit">
      <label class="muted"><input type="radio" name="long" value="${i}" ${+st.long_day === i ? "checked" : ""}> lang</label></div>`;
  }).join("");
  updWkg();
  updTarget();
}
function updWkg() { const f = +$("ftp").value, w = +$("weight").value; $("wkg").value = f && w ? (f / w).toFixed(2) + " W/kg" : ""; }
function updTarget() {
  const t = +$("target_ftp").value, f = +$("ftp").value;
  $("targetInfo").textContent = t && f ? `Ziel: +${t - f} W (${((t / f - 1) * 100).toFixed(1)} %). Realistisch sind etwa 0,5–1 % pro Trainingswoche.` : "";
}
$("ftp").oninput = $("weight").oninput = () => { updWkg(); updTarget(); };
$("target_ftp").oninput = updTarget;

function collect() {
  const days = {};
  WD.forEach((_, i) => days[i] = { active: $("d_a" + i).checked, minutes: +$("d_m" + i).value || 60, time: $("d_t" + i).value || "18:00" });
  return {
    goal_type: $("goal_type").value, goal_name: $("goal_name").value.trim(), event_date: $("event_date").value,
    target_ftp: $("target_ftp").value, start_date: $("start_date").value, plan_weeks: +$("plan_weeks").value || 12,
    style: $("style").value, focus: [...document.querySelectorAll("#focus input:checked")].map(x => x.value),
    ftp: +$("ftp").value || 200, weight: +$("weight").value || 75, weekly_hours: +$("weekly_hours").value || 6, ramp: $("ramp").value, days,
    long_day: +(document.querySelector("input[name=long]:checked")?.value ?? 5),
  };
}

function generate(fromEl) {
  try {
    S.settings = { ...collect(), cal: S.settings.cal };
    S.planBase = generatePlan(S.settings, S.performance);
    // Eingaben merken, damit die Hintergrund-Automatik den Plan identisch nachrechnen kann
    S.planSettings = structuredClone(S.settings);
    S.planPerf = { weekly_hours_avg: S.performance?.weekly_hours_avg ?? null, tsb: S.performance?.tsb ?? null };
    applyCalendar();
    S.ui.weekOffset = 0; S.ui.monthOffset = 0;
    save(); renderAll(); show("plan");
    autoCalendarSync(); // Termine prüfen und automatisch an intervals.icu senden
  } catch (e) { msg(fromEl || "zielMsg", esc(e.message), false); }
}

// ================================================================ intervals.icu
async function icu(path, opts = {}) {
  if (!S.icu.key) throw new Error("Bitte zuerst den intervals.icu API-Key eintragen.");
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${S.icu.athlete || "0"}${path}`, {
    ...opts,
    headers: { Authorization: "Basic " + btoa("API_KEY:" + S.icu.key), "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`intervals.icu ${r.status}: ${t.slice(0, 200) || r.statusText}`);
  }
  return r.status === 204 ? null : r.json();
}

async function icuLoadPerformance() {
  const today = todayIso(), oldest = isoDate(addDays(new Date(), -DATA_DAYS));
  const [ath, wellness, acts] = await Promise.all([
    icu(""), icu(`/wellness?oldest=${oldest}&newest=${today}`), icu(`/activities?oldest=${oldest}&newest=${today}`),
  ]);
  const ride = (ath.sportSettings || []).find(s => (s.types || []).some(t => /Ride/.test(t)));
  const list = (acts || []).filter(a => a.start_date_local).map(a => ({
    date: a.start_date_local.slice(0, 10), name: a.name || a.type, type: a.type,
    minutes: Math.round((a.moving_time || a.elapsed_time || 0) / 60),
    km: a.distance ? Math.round(a.distance / 100) / 10 : 0, elev: Math.round(a.total_elevation_gain || 0),
    np: a.icu_weighted_avg_watts || null, power: !!a.device_watts || !!a.icu_weighted_avg_watts,
    hr: a.average_heartrate || null, tss: a.icu_training_load ?? null,
  }));
  const perf = analyzeActivities(list, ride?.ftp || S.settings.ftp, DATA_DAYS);
  // Fitness/Ermüdung von intervals.icu übernehmen, wo vorhanden
  const wmap = Object.fromEntries((wellness || []).filter(x => x.ctl != null).map(x => [x.id, x]));
  for (const p of perf.series) if (wmap[p.date]) { p.ctl = +wmap[p.date].ctl.toFixed(1); p.atl = +wmap[p.date].atl.toFixed(1); }
  const w = perf.series.at(-1);
  perf.ctl = w.ctl; perf.atl = w.atl; perf.tsb = +(w.ctl - w.atl).toFixed(1);
  perf.source = "intervals.icu";
  perf.icu_ftp = ride?.ftp || null;
  perf.icu_weight = ath.icu_weight || ath.weight || null;
  perf.athlete = ath.name || null;
  // Gesundheitsdaten (z. B. von Garmin) separat speichern – bleiben auch bei späterem Strava-Abruf erhalten
  const num = v => (v == null || v === "" || isNaN(+v) || +v === 0) ? null : +v;
  S.wellness = (wellness || []).map(x => ({
    date: x.id, hrv: num(x.hrv), rhr: num(x.restingHR), sleepH: num(x.sleepSecs) ? +(x.sleepSecs / 3600).toFixed(2) : null,
    sleepScore: num(x.sleepScore), weight: num(x.weight), vo2max: num(x.vo2max), steps: num(x.steps),
    bodyFat: num(x.bodyFat), spo2: num(x.spO2), sleepHR: num(x.avgSleepingHR),
  })).filter(x => Object.entries(x).some(([k, v]) => k !== "date" && v != null));
  return perf;
}

// icuPushPlan() liegt in calendar.js (gemeinsam mit der Hintergrund-Automatik)

// ================================================================ Strava (OAuth direkt aus dem Browser)
const REDIRECT = location.origin + location.pathname;
function stravaConnect() {
  const q = new URLSearchParams({ client_id: S.strava.client_id, redirect_uri: REDIRECT, response_type: "code",
    approval_prompt: "auto", scope: "read,activity:read_all,profile:read_all", state: "rtf" });
  location.href = "https://www.strava.com/oauth/authorize?" + q;
}
async function stravaToken(params) {
  const r = await fetch("https://www.strava.com/oauth/token", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: S.strava.client_id, client_secret: S.strava.client_secret, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = (j.errors || [])[0] || {};
    const hints = {
      Application: "Client-ID oder Client-Secret stimmt nicht. Secret auf strava.com/settings/api über „Anzeigen“ neu kopieren (nicht den Zugriffs- oder Aktualisierungs-Token), in RTF speichern und neu verbinden.",
      AuthorizationCode: "Der Strava-Code ist abgelaufen oder wurde schon benutzt. Bitte erneut auf „Mit Strava verbinden“ tippen.",
      RefreshToken: "Die Strava-Verbindung ist abgelaufen. Bitte erneut auf „Mit Strava verbinden“ tippen.",
    };
    const detail = e.resource ? ` (${e.resource} ${e.field || ""} ${e.code || ""})`.replace(/\s+\)/, ")") : "";
    throw new Error(`Strava: ${j.message || r.status}${detail}. ${hints[e.resource] || ""}`);
  }
  Object.assign(S.strava, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at });
  if (j.athlete) S.strava.athlete = `${j.athlete.firstname || ""} ${j.athlete.lastname || ""}`.trim();
  save();
}
async function stravaGet(path) {
  if (!S.strava.expires_at || S.strava.expires_at < Date.now() / 1000 + 60)
    await stravaToken({ grant_type: "refresh_token", refresh_token: S.strava.refresh_token });
  const r = await fetch("https://www.strava.com/api/v3" + path, { headers: { Authorization: "Bearer " + S.strava.access_token } });
  if (!r.ok) throw new Error(`Strava ${r.status}`);
  return r.json();
}
async function stravaLoadPerformance() {
  const after = Math.floor(Date.now() / 1000 - DATA_DAYS * 86400);
  let acts = [], page = 1;
  for (;;) {
    const b = await stravaGet(`/athlete/activities?after=${after}&per_page=100&page=${page}`);
    acts = acts.concat(b);
    if (b.length < 100) break;
    page++;
  }
  const ath = await stravaGet("/athlete");
  const list = acts.map(a => ({ date: a.start_date_local.slice(0, 10), name: a.name, type: a.sport_type || a.type,
    minutes: Math.round(a.moving_time / 60), km: Math.round((a.distance || 0) / 100) / 10,
    elev: Math.round(a.total_elevation_gain || 0), power: !!a.device_watts,
    np: a.device_watts ? a.weighted_average_watts : null, hr: a.average_heartrate || null }));
  const perf = analyzeActivities(list, S.settings.ftp, DATA_DAYS);
  perf.source = "Strava";
  perf.strava_ftp = ath.ftp || null;
  perf.strava_weight = ath.weight || null;
  return perf;
}
async function handleOAuthReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.get("code") || q.get("state") !== "rtf") return;
  history.replaceState(null, "", REDIRECT + "#daten");
  if (!S.strava.client_id || !S.strava.client_secret) {
    // iOS: Home-Bildschirm-App und Safari haben getrennte Speicher -> Code zum Kopieren anzeigen
    show("daten");
    msg("stravaMsg", `Strava-Code: <code>${esc(q.get("code"))}</code><br>Kopiere ihn und füge ihn in RTF unter „Code einfügen“ ein.`);
    return;
  }
  try { await stravaToken({ grant_type: "authorization_code", code: q.get("code") }); renderAll(); show("daten"); msg("stravaMsg", "Mit Strava verbunden."); }
  catch (e) { show("daten"); msg("stravaMsg", esc(e.message), false); }
}

// ================================================================ Daten-Tab
function renderData() {
  const i = S.icu, s = S.strava;
  $("icuKey").value = i.key || "";
  $("icuAth").value = i.athlete || "0";
  $("icuState").textContent = i.key ? "API-Key gespeichert." : "Noch nicht verbunden.";
  $("stravaId").value = s.client_id || "";
  $("stravaSecret").value = s.client_secret || "";
  $("stravaState").innerHTML = s.refresh_token ? `Verbunden${s.athlete ? " als <b>" + esc(s.athlete) + "</b>" : ""}.` : "Nicht verbunden.";
  $("stravaRedirect").textContent = location.hostname || "(Domain der App)";
  renderPerf();
}
$("icuSave").onclick = () => { S.icu = { key: $("icuKey").value.trim(), athlete: $("icuAth").value.trim() || "0" }; save(); renderData(); msg("icuMsg", "Gespeichert."); };
$("icuLoad").onclick = async e => {
  busy(e.target, true, "Lade …");
  try {
    const perf = await icuLoadPerformance();
    save(); // Gesundheitsdaten immer übernehmen
    const wN = (S.wellness || []).length, wTxt = wN ? ` Gesundheitsdaten von ${wN} Tagen.` : "";
    if (!perf.activities) {
      msg("icuMsg", "Verbindung klappt, aber intervals.icu hat noch keine Aktivitäten. Nach dem ersten Verbinden lädt intervals.icu ältere Daten erst nach („Alte Daten herunterladen“ unter Einstellungen → Verbindungen). In ein paar Minuten erneut versuchen. Deine bisherigen Daten bleiben erhalten.", false);
    } else {
      S.performance = perf; S.lastSync = new Date().toISOString(); save(); renderData(); renderAnalysis();
      msg("icuMsg", `${perf.activities} Aktivitäten der letzten ${DATA_DAYS} Tage geladen.${wTxt}`);
    }
  }
  catch (err) { msg("icuMsg", esc(err.message), false); }
  busy(e.target, false);
};
$("stravaSave").onclick = () => {
  const id = $("stravaId").value.replace(/\s/g, ""), secret = $("stravaSecret").value.replace(/\s/g, "");
  if (!/^\d+$/.test(id)) return msg("stravaMsg", "Die Client-ID besteht nur aus Ziffern (z. B. 299517).", false);
  if (!/^[0-9a-f]{40}$/i.test(secret)) return msg("stravaMsg", `Das Client-Secret sollte 40 Zeichen lang sein (0–9, a–f); eingegeben: ${secret.length} Zeichen. Bitte auf strava.com/settings/api bei „Geheimer Clientschlüssel“ über „Anzeigen“ kopieren.`, false);
  Object.assign(S.strava, { client_id: id, client_secret: secret }); save(); renderData(); msg("stravaMsg", "Gespeichert. Jetzt „Mit Strava verbinden“ antippen.");
};
$("stravaConnect").onclick = () => { if (!S.strava.client_id) return msg("stravaMsg", "Erst Client-ID und Secret speichern.", false); stravaConnect(); };
$("stravaCode").onclick = async () => {
  const c = prompt("Strava-Code einfügen:");
  if (!c) return;
  try { await stravaToken({ grant_type: "authorization_code", code: c.trim() }); renderData(); msg("stravaMsg", "Mit Strava verbunden."); }
  catch (e) { msg("stravaMsg", esc(e.message), false); }
};
$("stravaLoad").onclick = async e => {
  busy(e.target, true, "Lade …");
  try { S.performance = await stravaLoadPerformance(); S.lastSync = new Date().toISOString(); save(); renderData(); renderAnalysis(); msg("stravaMsg", `${S.performance.activities} Aktivitäten der letzten ${DATA_DAYS} Tage analysiert.`); }
  catch (err) { msg("stravaMsg", esc(err.message), false); }
  busy(e.target, false);
};
$("stravaReset").onclick = () => { if (confirm("Strava-Verbindung entfernen?")) { S.strava = {}; save(); renderData(); } };
$("manSave").onclick = () => {
  S.performance = { ...(S.performance || {}), weekly_hours_avg: +$("manHours").value || null, updated: new Date().toISOString().slice(0, 19), source: "manuell" };
  save(); renderData(); msg("manMsg", "Übernommen. Plan neu berechnen, um ihn anzupassen.");
};

function renderPerf() {
  const p = S.performance;
  if (!p) { $("perfCard").innerHTML = `<h2>Leistungsstand</h2><p class="muted">Noch keine Daten. Lade sie über intervals.icu oder Strava oder gib deinen Umfang von Hand ein.</p>`; return; }
  const tsbTxt = p.tsb == null ? "" : p.tsb < -25 ? "stark ermüdet" : p.tsb < -10 ? "belastet" : p.tsb > 15 ? "erholt" : "ausgeglichen";
  const kpi = (v, l) => v == null ? "" : `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  let h = `<h2>Leistungsstand</h2><div class="kpis">
    ${kpi(p.ctl, "Fitness (CTL)")}${kpi(p.atl, "Ermüdung (ATL)")}${kpi(p.tsb, "Form (TSB) " + tsbTxt)}
    ${kpi(p.weekly_hours_avg != null ? p.weekly_hours_avg + " h" : null, "Ø Std./Woche (4 Wo.)")}
    ${kpi(p.icu_ftp ? p.icu_ftp + " W" : null, "FTP intervals.icu")}${kpi(p.strava_ftp ? p.strava_ftp + " W" : null, "FTP Strava")}
    ${kpi(p.ftp_estimate ? p.ftp_estimate + " W" : null, "FTP-Schätzung")}</div>`;
  const ftps = [["intervals.icu", p.icu_ftp], ["Strava", p.strava_ftp], ["Schätzung", p.ftp_estimate]].filter(x => x[1]);
  if (ftps.length) h += `<p class="muted">Eingestellt: ${S.settings.ftp} W. ` +
    ftps.map(([n, v]) => `<button class="btn sec sm" onclick="takeFtp(${v})">${n} übernehmen (${v} W)</button>`).join(" ") + `</p>`;
  if (p.ftp_estimate_source) h += `<p class="muted">Schätzung (berechnet, nicht gemessen) aus: ${esc(p.ftp_estimate_source)}</p>`;
  if (p.weeks?.length) {
    const mx = Math.max(...p.weeks.map(w => w.tss), 1);
    h += `<h3>Wochenbelastung (TSS)</h3><div class="bars">` + p.weeks.map(w =>
      `<div title="${w.week}: ${w.tss} TSS, ${w.hours} h"><div style="height:${Math.round(w.tss / mx * 80)}px"></div>${w.week.slice(8, 10)}.${w.week.slice(5, 7)}</div>`).join("") + `</div>`;
  }
  if (p.recent?.length) h += `<h3>Letzte Aktivitäten</h3><div class="tbl"><table><tr><th>Datum</th><th>Name</th><th>Min</th><th>TSS</th></tr>` +
    p.recent.map(a => `<tr><td>${a.date.slice(8, 10)}.${a.date.slice(5, 7)}.</td><td>${esc(a.name)}</td><td>${a.minutes}</td><td>${a.tss}</td></tr>`).join("") + `</table></div>`;
  h += `<p class="muted">Quelle: ${esc(p.source || "–")} · Stand ${esc((p.updated || "").replace("T", " "))}. TSS ohne Leistungsmesser ist geschätzt.
        Der Plan startet mit deinem Ø-Umfang und entschärft die erste Woche bei starker Ermüdung.</p>`;
  $("perfCard").innerHTML = h;
}
window.takeFtp = v => {
  S.settings.ftp = v; save(); renderForm(); renderPerf();
  msg("manMsg", `FTP auf ${v} W gesetzt. Tippe auf „Plan neu berechnen“, damit die Wattangaben stimmen.`);
};

// ================================================================ Plan
// Zwift-Zonen: Z1 < 60 % grau · Z2 60–75 % blau · Z3 76–89 % grün · Z4 90–104 % gelb · Z5 105–118 % orange · Z6 ≥ 119 % rot
function zoneColor(p) { return p < 0.60 ? "var(--z1)" : p < 0.76 ? "var(--z2)" : p < 0.90 ? "var(--z3)" : p < 1.05 ? "var(--z4)" : p < 1.19 ? "var(--z5)" : "var(--z6)"; }
function profile(segs, h = 38) {
  const flat = [];
  for (const s of segs) {
    if (s.t === "intervals") for (let i = 0; i < s.n; i++) flat.push([s.on, s.onp, s.onp], [s.off, s.offp, s.offp]);
    else if (s.t === "warmup" || s.t === "cooldown") flat.push([s.d, s.from, s.to]);
    else if (s.t === "free") flat.push([s.d, 1, 1]);
    else flat.push([s.d, s.p, s.p]);
  }
  if (!flat.length) return `<div class="trophy" style="height:${h}px">Event</div>`;
  const tot = flat.reduce((a, b) => a + b[0], 0), mx = 1.6;
  let x = 0, out = "";
  for (const [d, a, b] of flat) {
    const w = d / tot * 300, ya = h - Math.min(a, mx) / mx * h, yb = h - Math.min(b, mx) / mx * h;
    out += `<polygon points="${x},${h} ${x},${ya} ${x + w},${yb} ${x + w},${h}" fill="${zoneColor((a + b) / 2)}"/>`;
    x += w;
  }
  return `<svg class="prof" style="height:${h}px" viewBox="0 0 300 ${h}" preserveAspectRatio="none">${out}</svg>`;
}
const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const dm = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
function weekOfToday(P) {
  const t = todayIso();
  const i = P.weeks.findIndex(w => w.start <= t && t < isoDate(addDays(parseDate(w.start), 7)));
  return i >= 0 ? i : t < P.weeks[0].start ? 0 : P.weeks.length - 1;
}
function kw(iso) { // ISO-Kalenderwoche
  const d = parseDate(iso); d.setDate(d.getDate() + 3 - weekdayMon0(d));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + weekdayMon0(w1)) / 7);
}

function renderPlan() {
  const P = S.plan, view = S.ui.planView || "week";
  document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("active", b.dataset.v === view));
  if (!P) {
    $("planTitle").textContent = "Noch kein Plan";
    $("planSub").textContent = "";
    $("planNav").hidden = true;
    $("weeks").innerHTML = `<div class="card muted">Lege im Menü unter „Ziel & Profil“ dein Ziel und deine Trainingstage fest und erstelle den Plan.</div>`;
    return;
  }
  $("planTitle").textContent = P.goal_label;
  $("planSub").textContent = `${P.weeks.length} Wochen · FTP ${P.ftp} W` + (P.event_date ? ` · Event ${dm(P.event_date)}` : "");
  const today = todayIso();
  $("planNav").hidden = view === "all";
  const dayById = new Map(P.weeks.flatMap(w => w.days.map(d => [d.date, d])));

  if (view === "week") {
    const i = Math.max(0, Math.min(P.weeks.length - 1, weekOfToday(P) + (S.ui.weekOffset || 0)));
    const w = P.weeks[i];
    const end = isoDate(addDays(parseDate(w.start), 6));
    $("navLabel").innerHTML = `<b>KW ${kw(w.start)}</b> <span class="muted">${dm(w.start)}–${dm(end)}</span>`;
    let rows = "";
    for (let k = 0; k < 7; k++) {
      const iso = isoDate(addDays(parseDate(w.start), k)), d = dayById.get(iso);
      const cls = `wrow ${iso < today ? "past" : ""} ${iso === today ? "today" : ""}`;
      const head = `<div class="wd"><b>${WEEKDAYS[k]}</b><span>${dm(iso)}</span></div>`;
      if (!d) { rows += `<div class="${cls} rest">${head}<div class="wc"><span class="muted">Ruhetag</span></div></div>`; continue; }
      const o = d.workout;
      rows += `<div class="${cls}" data-id="${o.id}">${head}<div class="wc">
        <div class="wn">${esc(o.name)}</div>
        <div class="wm">${d.time ? d.time + " Uhr" : ""}${o.minutes ? ` · ${o.minutes} min · TSS ${o.tss}` : ""}</div>
        ${profile(o.segments, 30)}${d.note ? `<div class="wnote">${esc(d.note)}</div>` : ""}</div></div>`;
    }
    $("weeks").innerHTML = `<div class="card"><div class="week-head"><span class="phase ph-${w.phase}">${w.phase_label}</span>
      <span class="muted">Woche ${w.index} von ${P.weeks.length} · ${w.hours} h · ~${w.tss} TSS</span></div>${rows}</div>`;
  } else if (view === "month") {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + (S.ui.monthOffset || 0));
    const y = base.getFullYear(), m = base.getMonth();
    $("navLabel").innerHTML = `<b>${MONTH_NAMES[m]} ${y}</b>`;
    const first = new Date(y, m, 1), lead = weekdayMon0(first), days = new Date(y, m + 1, 0).getDate();
    let cells = WEEKDAYS.map(n => `<div class="mh">${n}</div>`).join("");
    for (let k = 0; k < lead; k++) cells += `<div class="mc empty"></div>`;
    let sumMin = 0, n = 0;
    for (let dd = 1; dd <= days; dd++) {
      const iso = isoDate(new Date(y, m, dd)), d = dayById.get(iso);
      if (d) { sumMin += d.workout.minutes; n++; }
      cells += `<div class="mc ${iso < today ? "past" : ""} ${iso === today ? "today" : ""} ${d ? "has" : ""}" ${d ? `data-id="${d.workout.id}"` : ""}>
        <span class="mn">${dd}</span>${d ? `${profile(d.workout.segments, 18)}<span class="mt">${d.workout.minutes ? d.workout.minutes + "′" : "Event"}</span>` : ""}</div>`;
    }
    $("weeks").innerHTML = `<div class="card"><div class="month">${cells}</div>
      <p class="muted" style="margin:12px 0 0">${n} Einheiten · ${Math.round(sumMin / 6) / 10} h geplant</p></div>`;
  } else {
    $("weeks").innerHTML = P.weeks.map(w => {
      const current = w.start <= today && today < isoDate(addDays(parseDate(w.start), 7));
      return `<div class="card week ${current ? "current" : ""}"><div class="week-head">
        <b>KW ${kw(w.start)}</b><span class="phase ph-${w.phase}">${w.phase_label}</span>
        <span class="muted">${dm(w.start)} · ${w.hours} h · ~${w.tss} TSS</span></div>
        <div class="days">${w.days.map(d => `<div class="day ${d.date < today ? "past" : ""} ${d.date === today ? "today" : ""}" data-id="${d.workout.id}">
          <div class="d">${d.weekday} ${dm(d.date)}${d.time ? " · " + d.time : ""}</div>
          <div class="n">${esc(d.workout.name)}</div>${profile(d.workout.segments)}
          <div class="d">${d.workout.minutes ? d.workout.minutes + " min · TSS " + d.workout.tss : ""}</div></div>`).join("")}</div></div>`;
    }).join("");
  }
  document.querySelectorAll("#weeks [data-id]").forEach(el => el.onclick = () => detail(el.dataset.id));
}
document.querySelectorAll("#viewSeg button").forEach(b => b.onclick = () => { S.ui.planView = b.dataset.v; save(); renderPlan(); });
$("navPrev").onclick = () => { S.ui[S.ui.planView === "month" ? "monthOffset" : "weekOffset"] = (S.ui[S.ui.planView === "month" ? "monthOffset" : "weekOffset"] || 0) - 1; save(); renderPlan(); };
$("navNext").onclick = () => { S.ui[S.ui.planView === "month" ? "monthOffset" : "weekOffset"] = (S.ui[S.ui.planView === "month" ? "monthOffset" : "weekOffset"] || 0) + 1; save(); renderPlan(); };
$("navToday").onclick = () => { S.ui.weekOffset = 0; S.ui.monthOffset = 0; save(); renderPlan(); };
function findDay(id) {
  for (const w of S.plan.weeks) for (const d of w.days) if (d.workout.id === id) return d;
}
function detail(id) {
  const d = findDay(id), o = d.workout;
  $("dlgBody").innerHTML = `<h2>${esc(o.name)}</h2>
    <div class="muted">${d.weekday}, ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.${d.date.slice(0, 4)}${d.time ? " · " + d.time + " Uhr" : ""}${o.minutes ? ` · ${o.minutes} min · TSS ${o.tss} · IF ${o.if}` : ""}</div>
    ${d.note ? `<p class="wnote">${esc(d.note)}</p>` : ""}
    <p>${esc(o.desc)}</p>${o.segments.length ? profile(o.segments, 80) : ""}
    <ol>${o.structure.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
    ${o.kind === "event" ? "" : `<button class="btn sec" id="zwoBtn">.zwo-Datei für Zwift</button>`}`;
  if (o.kind !== "event") $("zwoBtn").onclick = () => saveFile(`${d.date}_${o.kind}.zwo`, workoutToZwo(d, S.plan.ftp), "application/xml");
  $("dlg").showModal();
}

// ================================================================ Export
async function saveFile(name, text, mime) {
  const file = new File([text], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$("pushIcu").onclick = async e => {
  busy(e.target, true, "Übertrage …");
  try { const r = await icuPushPlan(); msg("exportMsg", `${r.count} Termine an intervals.icu übertragen${r.removed ? `, ${r.removed} veraltete entfernt` : ""}. Zwift bekommt jeweils die nächsten 7 Tage automatisch.`); }
  catch (err) { msg("exportMsg", esc(err.message), false); }
  busy(e.target, false);
};
$("icsBtn").onclick = () => S.plan ? saveFile("RTF-Trainingsplan.ics", planToIcs(S.plan), "text/calendar") : msg("exportMsg", "Bitte zuerst einen Plan erstellen.", false);

// Backup
$("backupBtn").onclick = () => {
  const copy = structuredClone(S);
  if (!$("backupSecrets").checked) { copy.icu.key = ""; copy.strava = {}; }
  saveFile(`RTF-Backup-${todayIso()}.json`, JSON.stringify(copy, null, 1), "application/json");
};
$("restoreFile").onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.settings) throw new Error("Keine RTF-Sicherung.");
    const keepIcu = S.icu, keepStrava = S.strava;
    S = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...data.settings } };
    if (!S.icu?.key) S.icu = keepIcu;
    if (!S.strava?.refresh_token) S.strava = keepStrava;
    save(); renderAll(); msg("backupMsg", "Sicherung wiederhergestellt.");
  } catch (err) { msg("backupMsg", esc(err.message), false); }
};
$("resetBtn").onclick = () => { if (confirm("Alle RTF-Daten auf diesem Gerät löschen?")) { localStorage.removeItem(KEY); S = load(); renderAll(); show("ziel"); } };

// ================================================================ Start
function renderAll() { renderForm(); renderData(); renderPlan(); renderCalendar(); if ($("analyse").classList.contains("active")) renderAnalysis(); }
document.querySelectorAll("[data-generate]").forEach(b => b.onclick = () => generate(b.dataset.generate));
calBindUi();

if (S.planBase) applyCalendar(); // Anpassung an heutiges Datum / gespeicherte Termine
renderAll();
const h = location.hash.slice(1);
show(h && TITLES[h] ? h : (S.plan ? "plan" : "ziel"));
handleOAuthReturn();
autoCalendarSync(); // Termine holen, Plan anpassen, automatisch senden
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoCalendarSync(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
