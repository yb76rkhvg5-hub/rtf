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
    style: "pyramidal", focus: [], ftp: 200, weight: 75, weekly_hours: 6, long_day: 5,
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
  plan: null,
  lastSync: null,
};

let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return { ...structuredClone(DEFAULTS), ...s, settings: { ...DEFAULTS.settings, ...s.settings } };
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

// ================================================================ Navigation
function show(id) {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.s === id));
  document.querySelectorAll("main > section").forEach(s => s.classList.toggle("active", s.id === id));
  history.replaceState(null, "", "#" + id);
  window.scrollTo(0, 0);
  if (id === "analyse") renderAnalysis(); // Diagramme brauchen die sichtbare Breite
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => show(b.dataset.s));

// ================================================================ Formular
function renderForm() {
  const st = S.settings;
  $("goal_type").innerHTML = Object.entries(GOALS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  for (const k of ["goal_type", "goal_name", "event_date", "target_ftp", "start_date", "plan_weeks", "style", "ftp", "weight", "weekly_hours"])
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
    ftp: +$("ftp").value || 200, weight: +$("weight").value || 75, weekly_hours: +$("weekly_hours").value || 6, days,
    long_day: +(document.querySelector("input[name=long]:checked")?.value ?? 5),
  };
}

function generate(fromEl) {
  try {
    S.settings = collect();
    S.plan = generatePlan(S.settings, S.performance);
    save(); renderAll(); show("plan");
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
  return perf;
}

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
  try { S.performance = await icuLoadPerformance(); S.lastSync = new Date().toISOString(); save(); renderData(); renderAnalysis(); msg("icuMsg", `${S.performance.activities} Aktivitäten der letzten ${DATA_DAYS} Tage geladen.`); }
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
function zoneColor(p) { return p < 0.56 ? "var(--z1)" : p < 0.76 ? "var(--z2)" : p < 0.88 ? "var(--z3)" : p < 1.0 ? "var(--z4)" : p < 1.2 ? "var(--z5)" : "var(--z6)"; }
function profile(segs, h = 38) {
  const flat = [];
  for (const s of segs) {
    if (s.t === "intervals") for (let i = 0; i < s.n; i++) flat.push([s.on, s.onp, s.onp], [s.off, s.offp, s.offp]);
    else if (s.t === "warmup" || s.t === "cooldown") flat.push([s.d, s.from, s.to]);
    else if (s.t === "free") flat.push([s.d, 1, 1]);
    else flat.push([s.d, s.p, s.p]);
  }
  if (!flat.length) return `<div class="trophy" style="height:${h}px">🏆</div>`;
  const tot = flat.reduce((a, b) => a + b[0], 0), mx = 1.6;
  let x = 0, out = "";
  for (const [d, a, b] of flat) {
    const w = d / tot * 300, ya = h - Math.min(a, mx) / mx * h, yb = h - Math.min(b, mx) / mx * h;
    out += `<polygon points="${x},${h} ${x},${ya} ${x + w},${yb} ${x + w},${h}" fill="${zoneColor((a + b) / 2)}"/>`;
    x += w;
  }
  return `<svg class="prof" style="height:${h}px" viewBox="0 0 300 ${h}" preserveAspectRatio="none">${out}</svg>`;
}
function renderPlan() {
  const P = S.plan;
  if (!P) {
    $("planTitle").textContent = "Noch kein Plan";
    $("planSub").textContent = "";
    $("weeks").innerHTML = `<div class="card muted">Lege Ziel und Trainingstage fest und tippe auf „Plan erstellen“.</div>`;
    return;
  }
  $("planTitle").textContent = `${P.goal_label} · ${P.weeks.length} Wochen`;
  $("planSub").textContent = `FTP ${P.ftp} W · erstellt ${P.generated.replace("T", " ").slice(0, 16)}` + (P.event_date ? ` · Event ${P.event_date}` : "");
  const today = todayIso();
  $("weeks").innerHTML = P.weeks.map(w => {
    const current = w.start <= today && today < isoDate(addDays(parseDate(w.start), 7));
    return `<div class="card week ${current ? "current" : ""}" ${current ? 'id="currentWeek"' : ""}><div class="week-head">
      <b>Woche ${w.index}</b><span class="phase ph-${w.phase}">${w.phase_label}</span>
      <span class="muted">ab ${w.start.slice(8, 10)}.${w.start.slice(5, 7)}. · ${w.hours} h · ~${w.tss} TSS</span></div>
      <div class="days">${w.days.map(d => `<div class="day ${d.date < today ? "past" : ""} ${d.date === today ? "today" : ""}" data-id="${d.workout.id}">
        <div class="d">${d.weekday} ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.${d.time ? " · " + d.time : ""}</div>
        <div class="n">${esc(d.workout.name)}</div>${profile(d.workout.segments)}
        <div class="d">${d.workout.minutes ? d.workout.minutes + " min · TSS " + d.workout.tss : ""}</div></div>`).join("")}</div></div>`;
  }).join("");
  document.querySelectorAll(".day").forEach(el => el.onclick = () => detail(el.dataset.id));
}
function findDay(id) {
  for (const w of S.plan.weeks) for (const d of w.days) if (d.workout.id === id) return d;
}
function detail(id) {
  const d = findDay(id), o = d.workout;
  $("dlgBody").innerHTML = `<h2>${esc(o.name)}</h2>
    <div class="muted">${d.weekday}, ${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.${d.date.slice(0, 4)}${d.time ? " · " + d.time + " Uhr" : ""}${o.minutes ? ` · ${o.minutes} min · TSS ${o.tss} · IF ${o.if}` : ""}</div>
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
function renderAll() { renderForm(); renderData(); renderPlan(); renderAnalysis(); }
document.querySelectorAll("[data-generate]").forEach(b => b.onclick = () => generate(b.dataset.generate));
$("todayBtn").onclick = () => $("currentWeek")?.scrollIntoView({ behavior: "smooth", block: "start" });

renderAll();
const h = location.hash.slice(1);
show(h && $(h) ? h : (S.plan ? "plan" : "ziel"));
handleOAuthReturn();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
