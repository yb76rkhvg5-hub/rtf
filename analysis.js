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
  if (tsb < -30) return { cls: "critical", icon: "⛔", label: "Überlastungsgefahr" };
  if (tsb < -10) return { cls: "warning", icon: "⚠️", label: "Im Training belastet" };
  if (tsb <= 5) return { cls: "good", icon: "✅", label: "Ausgeglichen" };
  if (tsb <= 25) return { cls: "good", icon: "✅", label: "Frisch / bereit" };
  return { cls: "serious", icon: "↘️", label: "Sehr erholt – Fitness sinkt" };
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
      [tsb, "Form (TSB)", stt ? `${stt.icon} ${stt.label}` : ""],
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
        if (e) { const tsb = r1(e.ctl - e.atl), stt = tsbStatus(tsb); li(`Form am Eventtag: <b>${tsb}</b> – ${stt.icon} ${stt.label}${tsb >= 5 && tsb <= 25 ? " (Zielbereich +5 bis +25)" : ""}.`); }
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
    const add = (cls, icon, label, text) => tips.push({ cls, icon, label, text });
    if (hasSeries) {
      const now = P.series.at(-1), tsb = now.ctl - now.atl;
      if (tsb < -30) add("critical", "⛔", "Ermüdung", "Deine Form liegt unter −30. Plane 2–3 lockere Tage ein, bevor es intensiv weitergeht.");
      else if (tsb > 25) add("serious", "↘️", "Pause", "Du bist sehr erholt – die Fitness baut gerade ab. Ein guter Moment für einen FTP-Test oder den Planstart.");
      const last8 = []; for (let i = 0; i < 8; i++) {
        const a = isoDate(addDays(new Date(), -7 * (i + 1))), b = isoDate(addDays(new Date(), -7 * i));
        last8.push(acts.filter(x => x.date > a && x.date <= b).length);
      }
      const regular = last8.filter(n => n >= 3).length;
      add(regular >= 6 ? "good" : "warning", regular >= 6 ? "✅" : "⚠️", "Regelmäßigkeit",
        `In ${regular} von 8 Wochen hattest du mindestens 3 Einheiten.${regular < 6 ? " Gleichmäßigkeit bringt mehr als einzelne harte Wochen." : ""}`);
      const tests = acts.filter(a => /ftp|ramp/i.test(a.name || "")).map(a => a.date).sort();
      if (tests.length) {
        const days = Math.round((Date.now() - ts(tests.at(-1))) / DAY);
        add(days > 56 ? "warning" : "good", days > 56 ? "⚠️" : "✅", "FTP-Test",
          `Letzter FTP-Test vor ${days} Tagen (${fmtDate(tests.at(-1))}).${days > 56 ? " Ein neuer Test hält die Wattvorgaben aktuell." : ""}`);
      }
      if (P.ftp_estimate && Math.abs(P.ftp_estimate - st.ftp) / st.ftp > 0.05)
        add("warning", "⚠️", "FTP", `Deine Fahrten deuten auf ${P.ftp_estimate} W hin, eingestellt sind ${st.ftp} W. Prüfe die FTP unter „Leistung“.`);
      const kraft = acts.filter(a => a.type === "WeightTraining" && a.date > isoDate(addDays(new Date(), -28))).length;
      if (kraft) add("good", "💪", "Kraft", `${r1(kraft / 4)}× Krafttraining pro Woche. Es fließt in Fitness und Ermüdung ein, aber nicht in den Radplan – lege es möglichst auf lockere Tage.`);
    }
    if (plan && Number(plan.ftp) !== Number(st.ftp))
      add("warning", "⚠️", "Plan veraltet", `Der Plan wurde mit FTP ${plan.ftp} W erstellt, eingestellt sind ${st.ftp} W. Bitte „Plan neu berechnen“.`);
    if (plan && S.lastSync && (Date.now() - new Date(S.lastSync)) / DAY > 7)
      add("warning", "⚠️", "Daten", "Deine Leistungsdaten sind älter als eine Woche – unter „Leistung“ neu laden.");
    if (tips.length) {
      const c = card("Hinweise");
      for (const t of tips) {
        const d = document.createElement("div"); d.className = `tip st-${t.cls}`;
        const b = document.createElement("b"); b.textContent = `${t.icon} ${t.label}`;
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

// Neu zeichnen bei Größen- oder Farbwechsel, wenn die Seite sichtbar ist
let _rt;
const _redraw = () => { clearTimeout(_rt); _rt = setTimeout(() => { if ($("analyse")?.classList.contains("active")) renderAnalysis(); }, 200); };
window.addEventListener("resize", _redraw);
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", _redraw);
