// RTF – RoadToFTP: Analyse-Seite (Rückblick, Prognose, Hinweise)
"use strict";

const TYPE_LABELS = {
  VirtualRide: "Rad (Indoor)", Ride: "Rad", GravelRide: "Gravel", MountainBikeRide: "MTB", EBikeRide: "E-Bike",
  Run: "Laufen", VirtualRun: "Laufen (Indoor)", TrailRun: "Trail", WeightTraining: "Kraft", Workout: "Workout",
  Hike: "Wandern", Walk: "Gehen", Swim: "Schwimmen", Yoga: "Yoga", Rowing: "Rudern",
};
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ts = iso => parseDate(iso).getTime();
const r1 = x => Math.round(x * 10) / 10;
const fmtDate = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

function tsbStatus(tsb) {
  if (tsb == null) return null;
  if (tsb < -30) return { cls: "critical", label: "Überlastungsgefahr" };
  if (tsb < -10) return { cls: "warning", label: "Im Training belastet" };
  if (tsb <= 5) return { cls: "good", label: "Ausgeglichen" };
  if (tsb <= 25) return { cls: "good", label: "Frisch / bereit" };
  return { cls: "serious", label: "Sehr erholt – Fitness sinkt" };
}

// ------------------------------------------------ Erholung & Gesundheit (Garmin über intervals.icu)
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { const m = avg(a); return a.length > 1 ? Math.sqrt(avg(a.map(x => (x - m) ** 2))) : 0; };

/** Kennzahlen je Gesundheitswert: 7-Tage-Schnitt, persönlicher Normalbereich (Tage 8–67 zurück), Verlauf */
function recoveryStats() {
  const W = (S.wellness || []).filter(w => w.date >= isoDate(addDays(new Date(), -120))).sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date(), d7 = isoDate(addDays(today, -7)), d67 = isoDate(addDays(today, -67));
  const out = {};
  for (const k of ["hrv", "rhr", "sleepH", "sleepScore", "weight", "vo2max", "steps", "bodyFat"]) {
    const pts = W.filter(w => w[k] != null).map(w => ({ date: w.date, v: w[k] }));
    if (!pts.length) continue;
    const last7 = pts.filter(p => p.date > d7).map(p => p.v);
    const base = pts.filter(p => p.date <= d7 && p.date > d67).map(p => p.v);
    // gleitender 7-Tage-Schnitt und gleitender Normalbereich (60 Tage) für die Diagramme
    const roll = pts.map(p => {
      const t = ts(p.date);
      const w7 = pts.filter(q => ts(q.date) > t - 7 * DAY && ts(q.date) <= t).map(q => q.v);
      const w60 = pts.filter(q => ts(q.date) > t - 67 * DAY && ts(q.date) <= t - 7 * DAY).map(q => q.v);
      return { x: t, v: p.v, a7: avg(w7), lo: w60.length >= 10 ? avg(w60) - sd(w60) : null, hi: w60.length >= 10 ? avg(w60) + sd(w60) : null };
    });
    out[k] = { pts, roll, last: pts.at(-1), avg7: avg(last7), base: base.length >= 10 ? avg(base) : null, sd: base.length >= 10 ? sd(base) : null };
  }
  return out;
}

function renderRecovery(C) {
  const R = recoveryStats();
  if (!Object.keys(R).length && !S.icu?.key) return; // ohne intervals.icu keinen leeren Bereich zeigen
  const c = card("Erholung & Gesundheit", "Von Garmin über intervals.icu. Verglichen wird mit deinem persönlichen Normalbereich (Schnitt ± Streuung der letzten 60 Tage).");
  if (!Object.keys(R).length) {
    note(c, "Noch keine Gesundheitsdaten. Unter <b>Leistung → intervals.icu</b> laden. Garmin liefert Schlaf, HRV und Ruhepuls meist ab der nächsten Nacht.");
    return;
  }
  const fmtH = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")} h`;
  const rel = (s, unit, higherIsGood) => {
    if (s.avg7 == null) return `letzter Wert ${fmtDate(s.last.date)}`;
    if (s.base == null) return "Normalbereich wird noch ermittelt";
    const d = s.avg7 - s.base;
    if (Math.abs(d) <= (s.sd || 0)) return "im Normalbereich";
    return `${d > 0 ? "+" : "−"}${r1(Math.abs(d))} ${unit} ${d > 0 ? "über" : "unter"} Normal`;
  };
  const tiles = [];
  if (R.hrv) tiles.push([`${Math.round(R.hrv.avg7 ?? R.hrv.last.v)} ms`, "HRV · 7 Tage", rel(R.hrv, "ms", true)]);
  if (R.rhr) tiles.push([`${Math.round(R.rhr.avg7 ?? R.rhr.last.v)} bpm`, "Ruhepuls · 7 Tage", rel(R.rhr, "bpm", false)]);
  if (R.sleepH) tiles.push([fmtH(R.sleepH.avg7 ?? R.sleepH.last.v), "Schlaf · 7 Tage", R.sleepScore?.avg7 ? `Schlafwert ${Math.round(R.sleepScore.avg7)}` : rel(R.sleepH, "h", true)]);
  if (R.weight) {
    const p30 = R.weight.pts.filter(p => p.date <= isoDate(addDays(new Date(), -28))).at(-1);
    tiles.push([`${r1(R.weight.last.v)} kg`, "Gewicht", p30 ? `${R.weight.last.v - p30.v >= 0 ? "+" : "−"}${r1(Math.abs(R.weight.last.v - p30.v))} kg in 4 Wochen` : fmtDate(R.weight.last.date)]);
  }
  if (R.vo2max) tiles.push([r1(R.vo2max.last.v), "VO2max", `Stand ${fmtDate(R.vo2max.last.date)}`]);
  if (R.steps) tiles.push([Math.round(R.steps.avg7 ?? R.steps.last.v).toLocaleString("de-DE"), "Schritte · Ø 7 Tage", ""]);
  const g = document.createElement("div"); g.className = "kpis";
  for (const [v, l, sub] of tiles) {
    const k = document.createElement("div"); k.className = "kpi";
    const b = document.createElement("b"); b.textContent = v;
    const sp = document.createElement("span"); sp.textContent = l;
    k.append(b, sp);
    if (sub) { const sm = document.createElement("small"); sm.textContent = sub; k.appendChild(sm); }
    g.appendChild(k);
  }
  c.appendChild(g);

  // Verlauf: Tageswerte + 7-Tage-Schnitt (+ Normalbereich), oder bei seltenen Messungen nur die Werte
  const trend = (key, title, unit, { fmt = v => Math.round(v), smooth = true } = {}) => {
    const s = R[key];
    if (!s || s.pts.length < 3) return;
    const h = document.createElement("h3"); h.textContent = unit ? `${title} (${unit})` : title; c.appendChild(h);
    const band = smooth ? s.roll.filter(p => p.lo != null) : [];
    lineChart(chartHost(c), {
      title, height: 150, yFmt: fmt, marks: [{ x: ts(todayIso()), label: "heute" }],
      band: band.length ? { name: "Normalbereich", color: C.s1, data: band.map(p => ({ x: p.x, lo: p.lo, hi: p.hi })) } : null,
      series: smooth ? [
        { name: "Tageswert", color: C.q1, dots: true, data: s.roll.map(p => ({ x: p.x, y: p.v })) },
        { name: "7-Tage-Schnitt", color: C.s1, data: s.roll.map(p => ({ x: p.x, y: +p.a7.toFixed(1) })) },
      ] : [{ name: title, color: C.s1, data: s.roll.map(p => ({ x: p.x, y: p.v })) }],
    });
  };
  trend("hrv", "Herzfrequenzvariabilität", "ms");
  trend("rhr", "Ruhepuls", "bpm");

  if (R.sleepH) {
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const k = isoDate(addDays(new Date(), -i)), w = (S.wellness || []).find(x => x.date === k);
      days.push({ label: fmtDate(k).slice(0, 5), value: w?.sleepH ? +w.sleepH.toFixed(1) : 0, color: C.s1, series: "Schlaf",
        tip: `${fmtDate(k)}${w?.sleepScore ? ` · Schlafwert ${w.sleepScore}` : ""}` });
    }
    if (days.some(d => d.value)) {
      const h = document.createElement("h3"); h.textContent = "Schlaf · letzte 30 Tage"; c.appendChild(h);
      barChart(chartHost(c), { title: "Schlaf", bars: days, height: 140, yFmt: v => `${v} h` });
    }
  }
  trend("weight", "Gewicht", "kg", { fmt: v => r1(v), smooth: false });
  trend("vo2max", "VO2max", "", { fmt: v => r1(v), smooth: false });
}

function card(title, sub) {
  const c = document.createElement("div");
  c.className = "card";
  const h = document.createElement("h2"); h.textContent = title; c.appendChild(h);
  if (sub) { const p = document.createElement("p"); p.className = "muted"; p.textContent = sub; c.appendChild(p); }
  $("analysis").appendChild(c);
  return c;
}
function chartHost(parent) { const d = document.createElement("div"); parent.appendChild(d); return d; }
function note(parent, html) { const p = document.createElement("p"); p.className = "muted"; p.innerHTML = html; parent.appendChild(p); }

function renderAnalysis() {
  const root = $("analysis");
  if (!root) return;
  root.replaceChildren();
  try { renderAnalysisInner(); }
  catch (e) {
    console.error(e);
    const c = card("Analyse konnte nicht angezeigt werden");
    note(c, `Fehler: <code>${esc(e.message)}</code>. Bitte RTF schließen und neu öffnen; falls es bleibt, unter „Leistung“ die Daten neu laden.`);
  }
}

// ------------------------------------------------ Unterreiter: Ausdauer | Kraft | Fazit
const ANA_VIEWS = [["endurance", "Ausdauer"], ["strength", "Kraft"], ["verdict", "Fazit"]];
function renderAnalysisInner() {
  const view = S.ui?.anaView || "endurance";
  const seg = document.createElement("div");
  seg.className = "seg seg-wide ana-seg";
  for (const [k, label] of ANA_VIEWS) {
    const b = document.createElement("button");
    b.textContent = label; b.className = k === view ? "active" : "";
    b.onclick = () => { S.ui.anaView = k; save(); renderAnalysis(); window.scrollTo(0, 0); };
    seg.appendChild(b);
  }
  $("analysis").appendChild(seg);
  if (view === "strength") return renderStrength();
  if (view === "verdict") return renderVerdict();
  return renderEndurance();
}

/** Kennzahl-Kacheln: tiles = [[Wert, Bezeichnung, Zusatz], …] */
function kpiGrid(parent, tiles) {
  const g = document.createElement("div"); g.className = "kpis";
  for (const [v, l, sub] of tiles) {
    const k = document.createElement("div"); k.className = "kpi";
    const b = document.createElement("b"); b.textContent = v;
    const sp = document.createElement("span"); sp.textContent = l;
    k.append(b, sp);
    if (sub) { const sm = document.createElement("small"); sm.textContent = sub; k.appendChild(sm); }
    g.appendChild(k);
  }
  parent.appendChild(g);
}

function renderEndurance() {
  const P = S.performance, plan = S.plan, st = S.settings;
  const hasSeries = !!P?.series?.length;
  const today = todayIso();
  const C = { s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"), q1: cssVar("--q1"), q2: cssVar("--q2"), q3: cssVar("--q3") };

  if (!hasSeries && !plan) {
    const c = card("Analyse", "Lade unter „Leistung“ deine Daten aus Strava oder intervals.icu und erstelle einen Plan – dann erscheinen hier Rückblick und Prognose.");
    return;
  }
  if (!hasSeries) note(card("Rückblick fehlt"), "Für Verlauf, Sportarten und Intensität bitte unter <b>Leistung</b> die Aktivitäten neu laden.");

  const acts = P?.activities_list || [];
  const proj = hasSeries ? projectLoad(P, plan) : [];
  const ftpProj = projectFtp(Number(st.ftp) || 200, plan, Number(st.weight) || null);
  const evIso = plan?.event_date;

  // ------------------------------------------------ Überblick (Kennzahlen)
  if (hasSeries) {
    const c = card("Überblick", `Letzte ${P.days || 180} Tage · Quelle: ${P.source || "–"} · Stand ${fmtDate((P.updated || today).slice(0, 10))}`);
    const s = P.series, now = s.at(-1), ago = s[Math.max(0, s.length - 29)];
    const tsb = r1(now.ctl - now.atl), stt = tsbStatus(tsb);
    const weeks12 = acts.filter(a => a.date > isoDate(addDays(new Date(), -84)));
    const h12 = weeks12.reduce((x, a) => x + a.minutes, 0) / 60 / 12;
    const km = acts.reduce((x, a) => x + (a.km || 0), 0), hm = acts.reduce((x, a) => x + (a.elev || 0), 0);
    const tiles = [
      [r1(now.ctl), "Fitness (CTL)", `${now.ctl - ago.ctl >= 0 ? "+" : ""}${r1(now.ctl - ago.ctl)} in 4 Wochen`],
      [tsb, "Form (TSB)", stt ? stt.label : ""],
      [`${r1(h12)} h`, "Ø pro Woche", "letzte 12 Wochen"],
      [acts.length, "Aktivitäten", `${Math.round(km)} km · ${Math.round(hm).toLocaleString("de-DE")} hm`],
      [`${st.ftp} W`, "FTP (eingestellt)", st.weight ? `${(st.ftp / st.weight).toFixed(2)} W/kg` : ""],
    ];
    if (P.ftp_estimate) tiles.push([`${P.ftp_estimate} W`, "FTP-Schätzung", "aus Fahrten (90 Tage)"]);
    const g = document.createElement("div"); g.className = "kpis";
    for (const [v, l, sub] of tiles) {
      const k = document.createElement("div"); k.className = "kpi";
      const b = document.createElement("b"); b.textContent = v;
      const sp = document.createElement("span"); sp.textContent = l;
      k.append(b, sp);
      if (sub) { const sm = document.createElement("small"); sm.textContent = sub; k.appendChild(sm); }
      g.appendChild(k);
    }
    c.appendChild(g);
  }

  // ------------------------------------------------ Fitness & Ermüdung
  if (hasSeries) {
    const c = card("Fitness & Ermüdung", "Durchgezogen: aus deinen Aktivitäten berechnet. Gestrichelt: Prognose, wenn du den Plan wie geplant umsetzt.");
    const marks = [{ x: ts(today), label: "heute" }];
    if (evIso) marks.push({ x: ts(evIso), label: "Event" });
    lineChart(chartHost(c), {
      title: "Fitness und Ermüdung", height: 200, yFmt: v => Math.round(v), yMin: 0, marks,
      series: [
        { name: "Fitness (CTL)", color: C.s1, data: P.series.map(p => ({ x: ts(p.date), y: p.ctl })) },
        { name: "Ermüdung (ATL)", color: C.s2, data: P.series.map(p => ({ x: ts(p.date), y: p.atl })) },
        { name: "Fitness Prognose", color: C.s1, dash: true, data: proj.map(p => ({ x: ts(p.date), y: p.ctl })) },
        { name: "Ermüdung Prognose", color: C.s2, dash: true, data: proj.map(p => ({ x: ts(p.date), y: p.atl })) },
      ],
    });
    const f = document.createElement("h3"); f.textContent = "Form (TSB = Fitness − Ermüdung)"; c.appendChild(f);
    lineChart(chartHost(c), {
      title: "Form", height: 150, yFmt: v => Math.round(v), marks,
      refs: [{ y: 5, label: "frisch ab +5" }, { y: -30, label: "Überlastung unter −30" }],
      series: [
        { name: "Form", color: C.s1, data: P.series.map(p => ({ x: ts(p.date), y: r1(p.ctl - p.atl) })) },
        { name: "Form Prognose", color: C.s1, dash: true, data: proj.map(p => ({ x: ts(p.date), y: r1(p.ctl - p.atl) })) },
      ],
    });
  }

  // ------------------------------------------------ Erholung & Gesundheit
  renderRecovery(C);

  // ------------------------------------------------ Wochenumfang
  {
    const bars = [];
    if (hasSeries) {
      const wk = {};
      for (const a of acts) {
        const d = parseDate(a.date), k = isoDate(addDays(d, -weekdayMon0(d)));
        if (k < isoDate(addDays(new Date(), -7 * 16))) continue;
        wk[k] = (wk[k] || 0) + a.minutes / 60;
      }
      // auch Wochen ohne Training anzeigen
      const start = addDays(new Date(), -7 * 15), s0 = addDays(start, -weekdayMon0(start));
      for (let d = s0; d <= new Date(); d = addDays(d, 7)) {
        const k = isoDate(d);
        bars.push({ label: fmtDate(k).slice(0, 5), value: r1(wk[k] || 0), color: C.s1, series: "Absolviert", tip: `Woche ab ${fmtDate(k)}` });
      }
    }
    for (const w of (plan?.weeks || []).filter(w => w.start > today).slice(0, 12))
      bars.push({ label: fmtDate(w.start).slice(0, 5), value: w.hours, color: C.s3, series: `Geplant · ${w.phase_label}`, tip: `Woche ab ${fmtDate(w.start)}` });
    if (bars.length) {
      const c = card("Wochenumfang", "Stunden pro Woche – absolviert (alle Sportarten) und geplant (Rad).");
      barChart(chartHost(c), { title: "Wochenumfang", bars, yFmt: v => `${v} h`,
        legendItems: [{ name: "Absolviert", color: C.s1 }, { name: "Geplant", color: C.s3 }].filter(l => bars.some(b => b.color === l.color)) });
    }
  }

  // ------------------------------------------------ Sportarten & Intensität
  if (acts.length) {
    const c = card("Sportarten", `Stunden der letzten ${P.days || 180} Tage.`);
    const by = {};
    for (const a of acts) { const k = TYPE_LABELS[a.type] || a.type || "Sonstiges"; (by[k] ||= { h: 0, n: 0 }); by[k].h += a.minutes / 60; by[k].n++; }
    const rows = Object.entries(by).sort((a, b) => b[1].h - a[1].h)
      .map(([k, v]) => ({ label: k, value: v.h, text: `${r1(v.h)} h · ${v.n}×` }));
    const hb = document.createElement("div"); c.appendChild(hb); hBars(hb, rows, C.s1);

    const rides = acts.filter(a => a.np && a.power);
    if (rides.length) {
      const ftp = Number(st.ftp) || 200, zones = [0, 0, 0];
      for (const a of rides) { const IF = a.np / ftp; zones[IF < 0.75 ? 0 : IF < 0.9 ? 1 : 2] += a.minutes; }
      const tot = zones.reduce((x, y) => x + y, 0) || 1;
      const h = document.createElement("h3"); h.textContent = "Intensität deiner Radfahrten"; c.appendChild(h);
      const bar = document.createElement("div"); bar.className = "stack";
      [["Locker", C.q1, "IF unter 0,75"], ["Mittel", C.q2, "IF 0,75–0,90"], ["Hart", C.q3, "IF über 0,90"]].forEach(([n, col, d], i) => {
        if (!zones[i]) return;
        const seg = document.createElement("span"); seg.style.flex = zones[i]; seg.style.background = col;
        seg.title = `${n}: ${Math.round(zones[i] / tot * 100)} % (${d})`;
        bar.appendChild(seg);
      });
      c.appendChild(bar);
      const lg = document.createElement("div"); lg.className = "viz-legend";
      [["Locker", C.q1, "IF < 0,75"], ["Mittel", C.q2, "0,75–0,90"], ["Hart", C.q3, "> 0,90"]].forEach(([n, col, d], i) => {
        const s = document.createElement("span"); const k = document.createElement("i"); k.className = "key-bar"; k.style.setProperty("--c", col);
        s.append(k, document.createTextNode(`${n} ${Math.round(zones[i] / tot * 100)} % (${d})`)); lg.appendChild(s);
      });
      c.appendChild(lg);
      note(c, `Nach Fahrtzeit, je Fahrt eingeordnet über die gewichtete Leistung im Verhältnis zur FTP (${ftp} W). ${rides.length} Fahrten mit Leistungsmesser.`);
    }
  }

  // ------------------------------------------------ FTP-Entwicklung & Prognose
  if (ftpProj.length || P?.ftp_history?.length) {
    const c = card("FTP: Entwicklung & Prognose",
      "Punkte: beste FTP-Schätzung je Monat aus deinen Fahrten. Linie und Fläche: Prognose nach Faustregeln für den Plan – eine Schätzung, keine Messung.");
    const target = Number(st.target_ftp) || null;
    lineChart(chartHost(c), {
      title: "FTP-Prognose", height: 190, yFmt: v => `${Math.round(v)} W`,
      marks: [{ x: ts(today), label: "heute" }],
      refs: target ? [{ y: target, label: `Ziel ${target} W` }] : [],
      band: { name: "Spanne", color: C.s1, data: ftpProj.map(p => ({ x: ts(p.date), lo: p.lo, hi: p.hi })) },
      series: [
        { name: "FTP-Schätzung (Monat)", color: C.s2, dots: true, data: (P?.ftp_history || []).map(p => ({ x: ts(p.date), y: p.ftp })) },
        { name: "Prognose", color: C.s1, dash: true, data: ftpProj.map(p => ({ x: ts(p.date), y: p.mid })) },
      ],
    });
    if (ftpProj.length) {
      const end = ftpProj.at(-1), w = Number(st.weight);
      let txt = `Bei Planende (${fmtDate(end.date)}): <b>${end.mid} W</b> (Spanne ${end.lo}–${end.hi} W)` +
        (w ? `, das wären ${(end.mid / w).toFixed(2)} W/kg` : "") + ` – heute ${st.ftp} W.`;
      if (target) {
        const hit = ftpProj.find(p => p.mid >= target), hitHi = ftpProj.find(p => p.hi >= target);
        txt += hit ? ` Ziel ${target} W voraussichtlich ab <b>${fmtDate(hit.date)}</b>.`
          : hitHi ? ` Ziel ${target} W nur im günstigen Fall erreichbar (ab ${fmtDate(hitHi.date)}).`
          : ` Ziel ${target} W liegt über der Prognose – längerer Plan oder mehr Umfang nötig.`;
      }
      note(c, txt);
    }
  }

  // ------------------------------------------------ Ausblick
  if (plan) {
    const c = card("Ausblick");
    const ul = document.createElement("ul"); ul.className = "facts";
    const li = html => { const l = document.createElement("li"); l.innerHTML = html; ul.appendChild(l); };
    if (proj.length) {
      const endP = proj.at(-1);
      li(`Fitness bei Planende: <b>${Math.round(endP.ctl)}</b> (heute ${Math.round(P.series.at(-1).ctl)}).`);
      let maxRamp = 0, rampWeek = null;
      for (let i = 7; i < proj.length; i += 7) {
        const r = proj[i].ctl - proj[i - 7].ctl;
        if (r > maxRamp) { maxRamp = r; rampWeek = proj[i - 7].date; }
      }
      li(`Stärkster Fitnessanstieg: <b>+${r1(maxRamp)} pro Woche</b>${rampWeek ? ` (Woche ab ${fmtDate(rampWeek)})` : ""} – bis etwa +5 bis +7 gilt als gut verträglich.`);
      if (evIso) {
        const e = proj.find(p => p.date === evIso);
        if (e) { const tsb = r1(e.ctl - e.atl), stt = tsbStatus(tsb); li(`Form am Eventtag: <b>${tsb}</b> – <span class="dot ${stt.cls}"></span>${stt.label}${tsb >= 5 && tsb <= 25 ? " (Zielbereich +5 bis +25)" : ""}.`); }
      }
    }
    const tot = plan.weeks.reduce((x, w) => x + w.hours, 0), hard = plan.weeks.flatMap(w => w.days).filter(d => !["endurance", "recovery", "event", "endurance_tempo"].includes(d.workout.kind)).length;
    li(`Plan: ${plan.weeks.length} Wochen, ${r1(tot)} h, ${hard} intensive Einheiten.`);
    const next = plan.weeks.flatMap(w => w.days).filter(d => d.date >= today).slice(0, 4);
    if (next.length) li(`Nächste Einheiten: ${next.map(d => `${d.weekday} ${fmtDate(d.date).slice(0, 5)} ${esc(d.workout.name)}`).join(" · ")}`);
    c.appendChild(ul);
  }

  // ------------------------------------------------ Hinweise
  {
    const tips = [];
    const add = (cls, label, text) => tips.push({ cls, label, text });
    if (hasSeries) {
      const now = P.series.at(-1), tsb = now.ctl - now.atl;
      if (tsb < -30) add("critical", "Ermüdung", "Deine Form liegt unter −30. Plane 2–3 lockere Tage ein, bevor es intensiv weitergeht.");
      else if (tsb > 25) add("serious", "Pause", "Du bist sehr erholt – die Fitness baut gerade ab. Ein guter Moment für einen FTP-Test oder den Planstart.");
      const last8 = []; for (let i = 0; i < 8; i++) {
        const a = isoDate(addDays(new Date(), -7 * (i + 1))), b = isoDate(addDays(new Date(), -7 * i));
        last8.push(acts.filter(x => x.date > a && x.date <= b).length);
      }
      const regular = last8.filter(n => n >= 3).length;
      add(regular >= 6 ? "good" : "warning", "Regelmäßigkeit",
        `In ${regular} von 8 Wochen hattest du mindestens 3 Einheiten.${regular < 6 ? " Gleichmäßigkeit bringt mehr als einzelne harte Wochen." : ""}`);
      const tests = acts.filter(a => /ftp|ramp/i.test(a.name || "")).map(a => a.date).sort();
      if (tests.length) {
        const days = Math.round((Date.now() - ts(tests.at(-1))) / DAY);
        add(days > 56 ? "warning" : "good", "FTP-Test",
          `Letzter FTP-Test vor ${days} Tagen (${fmtDate(tests.at(-1))}).${days > 56 ? " Ein neuer Test hält die Wattvorgaben aktuell." : ""}`);
      }
      if (P.ftp_estimate && Math.abs(P.ftp_estimate - st.ftp) / st.ftp > 0.05)
        add("warning", "FTP", `Deine Fahrten deuten auf ${P.ftp_estimate} W hin, eingestellt sind ${st.ftp} W. Prüfe die FTP unter „Leistung“.`);
      const kraft = acts.filter(a => a.type === "WeightTraining" && a.date > isoDate(addDays(new Date(), -28))).length;
      if (kraft) add("good", "Kraft", `${r1(kraft / 4)}× Krafttraining pro Woche. Es fließt in Fitness und Ermüdung ein, aber nicht in den Radplan – lege es möglichst auf lockere Tage.`);
    }
    // Erholung aus Garmin-Daten: HRV unter bzw. Ruhepuls über dem Normalbereich, wenig Schlaf
    const R = recoveryStats();
    const low = s => s?.avg7 != null && s.base != null && s.avg7 < s.base - s.sd;
    const high = s => s?.avg7 != null && s.base != null && s.avg7 > s.base + s.sd;
    if (low(R.hrv) && high(R.rhr)) add("critical", "Erholung", "HRV unter und Ruhepuls über deinem Normalbereich – typisches Zeichen für Ermüdung oder einen beginnenden Infekt. Die nächsten Tage locker trainieren.");
    else if (low(R.hrv) || high(R.rhr)) add("warning", "Erholung", `${low(R.hrv) ? "HRV liegt unter" : "Ruhepuls liegt über"} deinem Normalbereich. Harte Einheiten nur, wenn du dich frisch fühlst.`);
    else if (R.hrv?.base != null) add("good", "Erholung", "HRV und Ruhepuls liegen im Normalbereich – gute Voraussetzungen für intensive Einheiten.");
    if (R.sleepH?.avg7 != null && R.sleepH.avg7 < 7) add("warning", "Schlaf", `Im Schnitt ${r1(R.sleepH.avg7)} h pro Nacht in den letzten 7 Tagen. Unter 7 h leidet die Anpassung an das Training.`);
    if (plan && Number(plan.ftp) !== Number(st.ftp))
      add("warning", "Plan veraltet", `Der Plan wurde mit FTP ${plan.ftp} W erstellt, eingestellt sind ${st.ftp} W. Bitte „Plan neu berechnen“.`);
    if (plan && S.lastSync && (Date.now() - new Date(S.lastSync)) / DAY > 7)
      add("warning", "Daten", "Deine Leistungsdaten sind älter als eine Woche – unter „Leistung“ neu laden.");
    if (tips.length) {
      const c = card("Hinweise");
      for (const t of tips) {
        const d = document.createElement("div"); d.className = `tip st-${t.cls}`;
        const b = document.createElement("b"); b.textContent = t.label;
        const s = document.createElement("span"); s.textContent = t.text;
        d.append(b, s); c.appendChild(d);
      }
    }
  }

  // ------------------------------------------------ Tabelle
  if (hasSeries) {
    const c = card("Daten als Tabelle");
    const det = document.createElement("details");
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = "Wochenwerte anzeigen"; det.appendChild(sum);
    const wrap = document.createElement("div"); wrap.className = "tbl";
    const rows = [];
    for (let i = 7; i <= P.series.length; i += 7) {
      const wk = P.series.slice(i - 7, i), endD = wk.at(-1);
      rows.push(`<tr><td>${fmtDate(wk[0].date)}</td><td>${wk.reduce((x, p) => x + p.tss, 0)}</td><td>${Math.round(endD.ctl)}</td><td>${Math.round(endD.atl)}</td><td>${Math.round(endD.ctl - endD.atl)}</td></tr>`);
    }
    wrap.innerHTML = `<table><tr><th>Woche ab</th><th>TSS</th><th>CTL</th><th>ATL</th><th>TSB</th></tr>${rows.reverse().join("")}</table>`;
    det.appendChild(wrap); c.appendChild(det);
  }
}

// ================================================================ Kraft
const STRENGTH_TYPES = new Set(["WeightTraining", "Workout", "Crossfit"]);
const ENDURANCE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "Run", "VirtualRun", "TrailRun", "Hike", "Swim", "Rowing", "NordicSki"]);
const weekStart = d => addDays(d, -weekdayMon0(d));
const daysAgo = n => isoDate(addDays(new Date(), -n));
function addTips(parent, tips) {
  for (const t of tips) {
    const d = document.createElement("div"); d.className = `tip st-${t.cls}`;
    const b = document.createElement("b"); b.textContent = t.label;
    const s = document.createElement("span"); s.textContent = t.text;
    d.append(b, s); parent.appendChild(d);
  }
}

function strengthStats() {
  const acts = S.performance?.activities_list || [];
  const K = acts.filter(a => STRENGTH_TYPES.has(a.type)).sort((a, b) => a.date.localeCompare(b.date));
  const last = n => K.filter(a => a.date > daysAgo(n));
  const perWeek8 = last(56).length / 8, perWeek4 = last(28).length / 4;
  // Serie: aufeinanderfolgende Wochen (rückwärts ab letzter voller Woche) mit mind. 2 Einheiten
  let streak = 0;
  for (let i = 1; i < 26; i++) {
    const ws = isoDate(addDays(weekStart(new Date()), -7 * i)), we = isoDate(addDays(parseDate(ws), 7));
    if (K.filter(a => a.date >= ws && a.date < we).length >= 2) streak++; else break;
  }
  return { acts, K, perWeek8, perWeek4, streak, recent: last(84) };
}

function renderStrength() {
  const P = S.performance;
  const C = { s1: cssVar("--s1"), q1: cssVar("--q1") };
  if (!P?.activities_list) { note(card("Krafttraining"), "Lade unter <b>Leistung</b> deine Aktivitäten (Strava oder intervals.icu), dann erscheint hier die Auswertung deines Krafttrainings."); return; }
  const { acts, K, perWeek4, perWeek8, streak, recent } = strengthStats();
  if (!K.length) { note(card("Krafttraining"), "In den letzten 180 Tagen ist kein Krafttraining erfasst. Zeichne es mit Garmin oder Strava als „Krafttraining“ auf – dann wertet RoadToFTP es hier aus."); return; }

  // Überblick
  const lastK = K.at(-1), lastDays = Math.round((Date.now() - ts(lastK.date)) / 864e5);
  const avgMin = avg(recent.map(a => a.minutes)) || avg(K.map(a => a.minutes));
  const c1 = card("Krafttraining", "Ausgewertet werden Aktivitäten vom Typ Krafttraining der letzten 180 Tage.");
  kpiGrid(c1, [
    [`${r1(perWeek4)}×`, "pro Woche · 4 Wochen", perWeek4 >= 2 ? "Ziel 2× erreicht" : "Ziel: 2× pro Woche"],
    [`${Math.round(avgMin)} min`, "Ø Dauer", `${recent.length} Einheiten in 12 Wochen`],
    [`${r1(recent.reduce((x, a) => x + a.minutes, 0) / 60)} h`, "Gesamt · 12 Wochen", ""],
    [lastDays === 0 ? "heute" : lastDays === 1 ? "gestern" : `vor ${lastDays} T.`, "Letzte Einheit", fmtDate(lastK.date)],
    [`${streak} Wo.`, "Serie mit ≥ 2×", streak ? "ohne Unterbrechung" : "noch keine Serie"],
  ]);

  // Einheiten pro Woche (16 Wochen)
  const bars = [];
  for (let i = 15; i >= 0; i--) {
    const ws = isoDate(addDays(weekStart(new Date()), -7 * i)), we = isoDate(addDays(parseDate(ws), 7));
    const wk = K.filter(a => a.date >= ws && a.date < we);
    bars.push({ label: fmtDate(ws).slice(0, 5), value: wk.length, color: C.s1, series: "Einheiten",
      tip: `Woche ab ${fmtDate(ws)} · ${wk.reduce((x, a) => x + a.minutes, 0)} min` });
  }
  const h1 = document.createElement("h3"); h1.textContent = "Einheiten pro Woche"; c1.appendChild(h1);
  barChart(chartHost(c1), { title: "Krafteinheiten pro Woche", bars, height: 140, yFmt: v => `${v}×` });

  // Wochentage & Tageszeit
  const c2 = card("Wann du Kraft trainierst");
  const byDay = WEEKDAYS.map((n, i) => ({ label: n, value: K.filter(a => weekdayMon0(parseDate(a.date)) === i).length }));
  const h2 = document.createElement("h3"); h2.textContent = "Wochentage"; h2.style.marginTop = "0"; c2.appendChild(h2);
  const hb1 = document.createElement("div"); c2.appendChild(hb1);
  hBars(hb1, byDay.map(d => ({ ...d, text: `${d.value}×` })), C.s1);
  const timed = K.filter(a => a.time);
  if (timed.length) {
    const slot = t => { const h = +t.slice(0, 2); return h < 9 ? 0 : h < 14 ? 1 : h < 18 ? 2 : 3; };
    const names = ["Früh (vor 9 Uhr)", "Mittags (9–14)", "Nachmittags (14–18)", "Abends (ab 18)"];
    const h3 = document.createElement("h3"); h3.textContent = "Tageszeit"; c2.appendChild(h3);
    const hb2 = document.createElement("div"); c2.appendChild(hb2);
    hBars(hb2, names.map((n, i) => { const v = timed.filter(a => slot(a.time) === i).length; return { label: n, value: v, text: `${v}×` }; }), C.s1);
  } else note(c2, "Für die Auswertung nach Tageszeit unter <b>Leistung</b> die Aktivitäten einmal neu laden.");

  // Zusammenspiel mit dem Rad
  const ftp = Number(S.settings.ftp) || 200;
  const hardRide = a => ENDURANCE_TYPES.has(a.type) && ((a.np && a.np / ftp >= 0.85) || a.tss >= 70);
  const hardDays = new Set(acts.filter(hardRide).map(a => a.date));
  const sameDay = K.filter(a => hardDays.has(a.date)).length;
  const dayBefore = K.filter(a => hardDays.has(isoDate(addDays(parseDate(a.date), 1)))).length;
  const c3 = card("Zusammenspiel mit dem Rad");
  const ul = document.createElement("ul"); ul.className = "facts";
  const li = h => { const l = document.createElement("li"); l.innerHTML = h; ul.appendChild(l); };
  li(`<b>${sameDay}</b> von ${K.length} Krafteinheiten am selben Tag wie eine harte Radeinheit.`);
  li(`<b>${dayBefore}</b> am Tag vor einer harten Radeinheit – das kann die Beine für die Intervalle ermüden.`);
  // passende Krafttage in der kommenden Woche aus dem Plan
  const plan = S.plan, today = todayIso();
  if (plan) {
    const next7 = plan.weeks.flatMap(w => w.days).filter(d => d.date >= today && d.date < isoDate(addDays(new Date(), 7)));
    const hard = new Set(next7.filter(d => !["endurance", "recovery", "event"].includes(d.workout.kind)).map(d => d.date));
    const good = [];
    for (let i = 0; i < 7; i++) {
      const di = isoDate(addDays(new Date(), i));
      if (hard.has(di) || hard.has(isoDate(addDays(parseDate(di), 1)))) continue;
      good.push(WEEKDAYS[weekdayMon0(parseDate(di))]);
    }
    li(`Gut geeignete Krafttage in den nächsten 7 Tagen: <b>${good.length ? good.join(", ") : "–"}</b> (kein hartes Radtraining am selben oder nächsten Tag).`);
  }
  c3.appendChild(ul);

  // Hinweise
  const tips = [];
  if (perWeek8 < 1) tips.push({ cls: "warning", label: "Häufigkeit", text: `Im Schnitt ${r1(perWeek8)}× pro Woche. Für Radfahrer bringen 2 Einheiten à 30–45 min pro Woche den meisten Nutzen (Kraft, Verletzungsschutz, Rumpfstabilität).` });
  else if (perWeek8 < 2) tips.push({ cls: "warning", label: "Häufigkeit", text: `${r1(perWeek8)}× pro Woche – schon gut. Eine zweite feste Einheit pro Woche macht den Unterschied.` });
  else tips.push({ cls: "good", label: "Häufigkeit", text: `${r1(perWeek8)}× pro Woche über 8 Wochen – sehr konsequent.` });
  if (avgMin < 25) tips.push({ cls: "warning", label: "Dauer", text: `Ø ${Math.round(avgMin)} min. Für Kraftzuwachs eher 30–45 min mit 3–4 Sätzen pro Übung einplanen.` });
  if (dayBefore >= 3) tips.push({ cls: "warning", label: "Timing", text: "Mehrmals Kraft am Tag vor harten Intervallen. Besser: Kraft direkt nach einer harten Radeinheit (gleicher Tag) oder an lockeren Tagen – so bleiben die Beine für die Intervalle frisch." });
  const phase = plan?.weeks.find(w => w.start <= today && today < isoDate(addDays(parseDate(w.start), 7)))?.phase;
  const phaseTxt = { base: "Grundlagenphase: ideale Zeit für Maximalkraft – 2× pro Woche, schwere Gewichte, wenige Wiederholungen (z. B. Kniebeuge, Kreuzheben, Ausfallschritte).",
    build: "Aufbauphase: Kraft auf 1–2× pro Woche halten, Fokus auf Explosivität und Rumpf.", peak: "Spitzenphase: 1× pro Woche kurz zum Erhalt, keine neuen schweren Reize.",
    taper: "Tapering: Krafttraining pausieren oder nur sehr leicht.", recovery: "Erholungswoche: Kraft leicht und kurz, gerne Mobilität.", test: "Testwoche: vor dem FTP-Test 2 Tage kein Beintraining." }[phase];
  if (phaseTxt) tips.push({ cls: "good", label: "Passend zur Planphase", text: phaseTxt });
  addTips(card("Hinweise"), tips);
}

// ================================================================ Fazit
function verdictScores() {
  const P = S.performance, st = S.settings;
  const acts = P?.activities_list || [];
  const out = [];
  if (!acts.length) return out;
  // 1) Umfang Ausdauer
  const endu = acts.filter(a => ENDURANCE_TYPES.has(a.type) && a.date > daysAgo(84));
  const hpw = endu.reduce((x, a) => x + a.minutes, 0) / 60 / 12, target = Number(st.weekly_hours) || 6;
  out.push({ key: "Umfang", score: Math.min(100, hpw / target * 100), detail: `${r1(hpw)} h Ausdauer pro Woche (Ziel ${target} h)`,
    good: "Du erreichst deinen geplanten Umfang.", action: `Den Ausdauerumfang Schritt für Schritt auf ${target} h pro Woche bringen – am leichtesten über eine längere, lockere Ausfahrt am Wochenende.` });
  // 2) Regelmäßigkeit
  let regular = 0;
  for (let i = 0; i < 8; i++) { const a0 = daysAgo(7 * (i + 1)), b0 = daysAgo(7 * i); if (acts.filter(x => x.date > a0 && x.date <= b0).length >= 3) regular++; }
  out.push({ key: "Regelmäßigkeit", score: regular / 8 * 100, detail: `${regular} von 8 Wochen mit mind. 3 Einheiten`,
    good: "Du trainierst sehr regelmäßig – die wichtigste Grundlage.", action: "Feste Trainingstage einhalten: lieber eine kurze Einheit als eine ausgefallene. Die Kalender-Automatik hilft dabei." });
  // 3) Intensitätsverteilung (nur mit Leistungsmesser)
  const ftp = Number(st.ftp) || 200;
  const rides = acts.filter(a => a.np && a.power && a.date > daysAgo(84));
  if (rides.length >= 5) {
    const tot = rides.reduce((x, a) => x + a.minutes, 0) || 1;
    const easy = rides.filter(a => a.np / ftp < 0.75).reduce((x, a) => x + a.minutes, 0) / tot;
    const hard = rides.filter(a => a.np / ftp >= 0.9).reduce((x, a) => x + a.minutes, 0) / tot;
    let score = easy >= 0.7 && easy <= 0.85 ? 100 : easy < 0.7 ? Math.max(20, 100 - (0.7 - easy) * 300) : Math.max(40, 100 - (easy - 0.85) * 300);
    let action = easy < 0.7 ? "Zu viel im mittleren Bereich: Lockere Einheiten wirklich locker fahren (unter 75 % FTP), harte dafür gezielt hart."
      : "Fast nur locker: 1–2 strukturierte Intervalleinheiten pro Woche (Sweet Spot, Schwelle) setzen die nötigen Reize.";
    if (easy > 0.85 && hard < 0.05) score = Math.min(score, 60);
    out.push({ key: "Intensität", score, detail: `${Math.round(easy * 100)} % locker, ${Math.round(hard * 100)} % hart (nach Fahrzeit)`,
      good: "Gute Mischung aus lockerem Grundlagentraining und harten Reizen.", action });
  }
  // 4) Kraft
  const { perWeek8 } = strengthStats();
  out.push({ key: "Kraft", score: perWeek8 >= 2 ? 100 : perWeek8 >= 1.5 ? 80 : perWeek8 >= 1 ? 60 : perWeek8 >= 0.5 ? 35 : 10,
    detail: `${r1(perWeek8)}× Krafttraining pro Woche (8 Wochen)`, good: "Krafttraining ist fester Bestandteil deiner Woche.",
    action: "Krafttraining auf 2× pro Woche à 30–45 min bringen – Fokus Beine, Gesäß und Rumpf. Am besten an lockeren Radtagen." });
  // 5) Erholung (Garmin)
  const R = typeof recoveryStats === "function" ? recoveryStats() : {};
  if (R.sleepH?.avg7 != null || R.hrv?.avg7 != null) {
    const h = R.sleepH?.avg7;
    let score = h == null ? 70 : h >= 7.5 ? 100 : h >= 7 ? 85 : h >= 6.5 ? 65 : h >= 6 ? 45 : 25;
    const hrvLow = R.hrv?.avg7 != null && R.hrv.base != null && R.hrv.avg7 < R.hrv.base - R.hrv.sd;
    if (hrvLow) score -= 20;
    out.push({ key: "Erholung", score: Math.max(0, score), detail: `${h != null ? r1(h) + " h Schlaf" : "Schlaf –"}${R.hrv?.avg7 != null ? ` · HRV ${Math.round(R.hrv.avg7)} ms${hrvLow ? " (unter Normal)" : ""}` : ""}`,
      good: "Schlaf und HRV sprechen für gute Erholung.", action: "Mehr Erholung: 7,5 h Schlaf anpeilen und an Tagen mit niedriger HRV nur locker fahren." });
  }
  // 6) Fitness-Entwicklung (CTL über 6 Wochen)
  if (P.series?.length > 42) {
    const now = P.series.at(-1).ctl, before = P.series.at(-43).ctl, delta = now - before;
    out.push({ key: "Entwicklung", score: Math.max(10, Math.min(100, 60 + delta * 6)), detail: `Fitness (CTL) ${delta >= 0 ? "+" : ""}${r1(delta)} in 6 Wochen`,
      good: "Deine Fitness steigt stetig.", action: "Belastung langsam und stetig steigern (etwa +3 bis +5 CTL pro Woche) und Erholungswochen einhalten – der Plan ist darauf ausgelegt." });
  }
  // 7) Leistungsniveau
  if (st.ftp && st.weight) {
    const wkg = st.ftp / st.weight;
    out.push({ key: "Leistung", score: wkg >= 4 ? 100 : wkg >= 3.5 ? 88 : wkg >= 3 ? 75 : wkg >= 2.5 ? 60 : 45, detail: `${wkg.toFixed(2)} W/kg (FTP ${st.ftp} W)`,
      good: "Starkes Leistungsniveau im Verhältnis zum Gewicht.",
      action: `W/kg steigern: Schwellen- und Sweet-Spot-Intervalle für die FTP${st.target_ftp ? ` (Ziel ${st.target_ftp} W)` : ""}, dazu Gewicht stabil halten.` });
  }
  return out.map(s => ({ ...s, score: Math.round(s.score) }));
}

function renderVerdict() {
  const scores = verdictScores();
  if (!scores.length) { note(card("Fazit"), "Für das Fazit unter <b>Leistung</b> deine Aktivitäten laden."); return; }
  const total = Math.round(avg(scores.map(s => s.score)));
  const label = total >= 85 ? "Sehr gut" : total >= 70 ? "Gut" : total >= 50 ? "Ausbaufähig" : "Viel Potenzial";
  // Gesamtbewertung als Ring
  const c = card("Fazit zur allgemeinen Fitness", "Einschätzung nach Faustregeln aus deinen Daten der letzten 8–12 Wochen – keine medizinische Bewertung.");
  const hero = document.createElement("div"); hero.className = "score-hero";
  const R = 52, L = 2 * Math.PI * R;
  hero.innerHTML = `<svg viewBox="0 0 128 128" class="score-ring" role="img" aria-label="Gesamtwert ${total} von 100">
      <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6639"/><stop offset="1" stop-color="#ff2e7e"/></linearGradient></defs>
      <circle cx="64" cy="64" r="${R}" class="ring-bg"/>
      <circle cx="64" cy="64" r="${R}" class="ring-fg" stroke="url(#sg)" stroke-dasharray="${L * total / 100} ${L}" transform="rotate(-90 64 64)"/>
      <text x="64" y="62" text-anchor="middle" class="ring-num">${total}</text><text x="64" y="82" text-anchor="middle" class="ring-sub">von 100</text></svg>
    <div><div class="score-label">${label}</div><div class="muted">${scores.length} Bereiche bewertet</div></div>`;
  c.appendChild(hero);
  // Bereiche
  const list = document.createElement("div"); list.className = "score-list";
  for (const s of scores) {
    const row = document.createElement("div"); row.className = "score-row";
    row.innerHTML = `<div class="score-top"><b>${esc(s.key)}</b><span>${s.score}</span></div>
      <div class="score-bar"><i style="width:${s.score}%"></i></div><div class="muted">${esc(s.detail)}</div>`;
    list.appendChild(row);
  }
  c.appendChild(list);
  // Stärken & Verbesserungen
  const sorted = [...scores].sort((a, b) => a.score - b.score);
  const improve = sorted.filter(s => s.score < 80).slice(0, 3);
  const strong = [...scores].sort((a, b) => b.score - a.score).filter(s => s.score >= 75).slice(0, 2);
  const ci = card("Was du künftig verbessern solltest");
  if (improve.length) {
    const ol = document.createElement("ol"); ol.className = "prio";
    for (const s of improve) { const li = document.createElement("li"); li.innerHTML = `<b>${esc(s.key)}</b><span>${esc(s.action)}</span>`; ol.appendChild(li); }
    ci.appendChild(ol);
  } else note(ci, "Alle Bereiche liegen auf gutem Niveau – weiter so, und die Belastung behutsam steigern.");
  if (strong.length) addTips(card("Deine Stärken"), strong.map(s => ({ cls: "good", label: s.key, text: s.good })));
}

// Neu zeichnen bei Größen- oder Farbwechsel und beim Öffnen der Seite (unabhängig von app.js)
let _rt;
const _redraw = () => { clearTimeout(_rt); _rt = setTimeout(() => { if (document.getElementById("analyse")?.classList.contains("active")) renderAnalysis(); }, 120); };
window.addEventListener("resize", _redraw);
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", _redraw);
document.addEventListener("click", e => { if (e.target.closest?.('nav button[data-s="analyse"]')) _redraw(); });
window.addEventListener("load", _redraw);
