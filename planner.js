// RTF – RoadToFTP: Trainingsplan-Generator, Workout-Bibliothek und Exporte (ZWO, ICS, intervals.icu)
"use strict";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const GOALS = {
  ftp: { label: "FTP steigern", long: "endurance", ftpTest: true,
    hard: { base: ["sweetspot", "tempo"], build: ["threshold", "sweetspot", "vo2max"], peak: ["threshold", "vo2max"], taper: ["openers"] } },
  event: { label: "Event / Radmarathon", long: "endurance_tempo",
    hard: { base: ["tempo", "sweetspot"], build: ["sweetspot", "threshold"], peak: ["threshold", "vo2max"], taper: ["openers"] } },
  endurance: { label: "Grundlagenausdauer", long: "endurance",
    hard: { base: ["tempo"], build: ["tempo", "sweetspot"], peak: ["sweetspot"], taper: ["openers"] } },
  climbing: { label: "Bergfahren", long: "endurance_tempo",
    hard: { base: ["tempo", "sweetspot"], build: ["sweetspot_long", "overunder"], peak: ["overunder", "vo2max"], taper: ["openers"] } },
  sprint: { label: "Sprint / Kriterium", long: "endurance",
    hard: { base: ["tempo", "sweetspot"], build: ["vo2max", "anaerobic"], peak: ["anaerobic", "vo2max"], taper: ["openers"] } },
  fitness: { label: "Allgemeine Fitness", long: "endurance",
    hard: { base: ["tempo"], build: ["sweetspot", "tempo"], peak: ["sweetspot", "threshold"], taper: ["openers"] } },
  custom: { label: "Individuell", long: "endurance",
    hard: { base: ["tempo", "sweetspot"], build: ["sweetspot", "threshold"], peak: ["threshold", "vo2max"], taper: ["openers"] } },
};

const HARD_TYPES = {
  tempo: "Tempo (Z3)", sweetspot: "Sweet Spot", sweetspot_long: "Sweet Spot lang", threshold: "Schwelle (FTP)",
  overunder: "Over-Unders", vo2max: "VO2max", anaerobic: "Anaerob / Sprints",
};

const PHASE_LABELS = { base: "Grundlage", build: "Aufbau", peak: "Spitze", taper: "Tapering", recovery: "Erholung", test: "Testwoche" };

const INTERVALS = {
  tempo:          { name: "Tempo",           on: 720,  onp: 0.85, off: 240, offp: 0.60, mn: 2, mx: 4,  lvlOn: 180, lvlP: 0.01 },
  sweetspot:      { name: "Sweet Spot",      on: 600,  onp: 0.90, off: 240, offp: 0.55, mn: 2, mx: 4,  lvlOn: 180, lvlP: 0.01 },
  sweetspot_long: { name: "Sweet Spot lang", on: 1200, onp: 0.89, off: 300, offp: 0.55, mn: 2, mx: 3,  lvlOn: 300, lvlP: 0.01 },
  threshold:      { name: "Schwelle",        on: 480,  onp: 1.00, off: 240, offp: 0.55, mn: 3, mx: 5,  lvlOn: 120, lvlP: 0.01 },
  vo2max:         { name: "VO2max",          on: 180,  onp: 1.18, off: 180, offp: 0.50, mn: 4, mx: 6,  lvlOn: 30,  lvlP: 0.01 },
  anaerobic:      { name: "Anaerob",         on: 30,   onp: 1.50, off: 270, offp: 0.50, mn: 6, mx: 10, lvlOn: 0,   lvlP: 0.05 },
};

// ---------------------------------------------------------------- Segmente
const r3 = x => Math.round(x * 1000) / 1000;
const ramp = (t, d, a, b) => ({ t, d: Math.round(d), from: r3(a), to: r3(b) });
const steady = (d, p) => ({ t: "steady", d: Math.round(d), p: r3(p) });
const intervals = (n, on, onp, off, offp) => ({ t: "intervals", n, on, onp: r3(onp), off, offp: r3(offp) });
const free = d => ({ t: "free", d });
const segDuration = s => s.t === "intervals" ? s.n * (s.on + s.off) : s.d;

function workoutStats(segs) {
  let total = 0, w = 0;
  for (const s of segs) {
    if (s.t === "intervals") { total += s.n * (s.on + s.off); w += s.n * (s.on * s.onp ** 2 + s.off * s.offp ** 2); }
    else if (s.t === "warmup" || s.t === "cooldown") { total += s.d; w += s.d * (s.from ** 2 + s.from * s.to + s.to ** 2) / 3; }
    else if (s.t === "free") { total += s.d; w += s.d; }
    else { total += s.d; w += s.d * s.p ** 2; }
  }
  if (!total) return [0, 0, 0];
  const IF = Math.sqrt(w / total);
  return [total, Math.round(IF * 100) / 100, Math.round(total / 3600 * IF ** 2 * 100)];
}

function fmtDur(sec) {
  if (sec < 60) return `${sec}s`;
  return sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}min` : `${sec / 60}min`;
}

function wrap(core, minutes, wu = 10, cd = 8, fillP = 0.65) {
  const segs = [ramp("warmup", wu * 60, 0.45, 0.75), ...core];
  const fill = minutes * 60 - wu * 60 - cd * 60 - core.reduce((a, s) => a + segDuration(s), 0);
  if (fill >= 300) segs.push(steady(fill, fillP));
  segs.push(ramp("cooldown", cd * 60, 0.70, 0.45));
  return segs;
}

function buildWorkout(kind, minutes, level = 0, ftp = 250) {
  minutes = Math.max(30, Math.round(minutes));
  level = Math.max(0, Math.min(2, level));
  let segs, name, desc;
  if (kind === "recovery") {
    const m = Math.min(minutes, 60);
    segs = [ramp("warmup", 300, 0.40, 0.55), steady((m - 10) * 60, 0.52), ramp("cooldown", 300, 0.55, 0.40)];
    name = "Regeneration"; desc = "Lockeres Kurbeln in Zone 1 zur aktiven Erholung.";
  } else if (kind === "endurance") {
    segs = wrap([], minutes, 10, 5, 0.68);
    name = "Grundlage"; desc = "Gleichmäßige Grundlagenausdauer in Zone 2 (65–72 % FTP).";
  } else if (kind === "endurance_tempo") {
    const blocks = 2 + level, avail = minutes * 60 - 1800;
    const blk = Math.max(600, Math.min(1200, Math.floor(avail / (blocks * 2))));
    const core = [];
    for (let i = 0; i < blocks; i++) core.push(steady(blk, 0.68), steady(blk, 0.82));
    segs = wrap(core, minutes, 10, 8, 0.68);
    name = "Lange Ausfahrt mit Tempo"; desc = "Lange Grundlage mit eingestreuten Tempoblöcken – Event-spezifisch.";
  } else if (kind === "overunder") {
    const core = [];
    for (let i = 0; i < 2 + level; i++) core.push(intervals(3, 60, 1.05, 120, 0.95), steady(300, 0.55));
    segs = wrap(core, minutes);
    name = "Over-Unders"; desc = "Wechsel knapp über/unter FTP – simuliert Tempowechsel am Berg.";
  } else if (kind === "openers") {
    const core = [steady(300, 0.65), intervals(3, 60, 1.10, 120, 0.55), steady(180, 0.60), intervals(3, 15, 1.50, 105, 0.50)];
    segs = wrap(core, Math.min(minutes, 50), 10, 5, 0.6);
    name = "Openers"; desc = "Kurze Aktivierung vor dem Event / Test – Beine wach machen, nicht ermüden.";
  } else if (kind === "ftp_test") {
    segs = [ramp("warmup", 600, 0.45, 0.75), steady(300, 0.65), intervals(3, 60, 1.10, 60, 0.50), steady(300, 0.60),
            steady(300, 1.05), steady(600, 0.55), free(1200), ramp("cooldown", 600, 0.60, 0.40)];
    name = "FTP-Test (20 min)";
    desc = "20 min maximale gleichmäßige Leistung (FreeRide-Block). Neue FTP ≈ 95 % des 20-min-Schnitts.";
  } else if (INTERVALS[kind]) {
    const d = INTERVALS[kind];
    const on = d.on + level * d.lvlOn, onp = d.onp + level * d.lvlP;
    let reps = Math.max(d.mn, Math.min(d.mx, Math.floor((minutes * 60 - 1080) / (on + d.off))));
    if (kind === "vo2max" || kind === "anaerobic") reps = Math.min(d.mx, reps + level);
    segs = wrap([intervals(reps, on, onp, d.off, d.offp)], minutes);
    name = `${d.name} ${reps}x${fmtDur(on)}`;
    desc = `${reps} × ${fmtDur(on)} @ ${Math.round(onp * 100)} % FTP (~${Math.round(onp * ftp)} W), Pause ${fmtDur(d.off)}.`;
  } else throw new Error("Unbekannter Workout-Typ " + kind);
  const [dur, IF, tss] = workoutStats(segs);
  return { kind, name, desc, segments: segs, minutes: Math.round(dur / 60), if: IF, tss };
}

function describeSegments(segs, ftp) {
  return segs.map(s => {
    const w = p => `${Math.round(p * 100)}% (${Math.round(p * ftp)} W)`;
    if (s.t === "intervals") return `${s.n}× ${fmtDur(s.on)} @ ${w(s.onp)} / ${fmtDur(s.off)} @ ${w(s.offp)}`;
    if (s.t === "warmup" || s.t === "cooldown")
      return `${s.t === "warmup" ? "Einfahren" : "Ausfahren"} ${fmtDur(s.d)} ${Math.round(s.from * 100)}→${Math.round(s.to * 100)}%`;
    if (s.t === "free") return `${fmtDur(s.d)} FreeRide – Vollgas gleichmäßig`;
    return `${fmtDur(s.d)} @ ${w(s.p)}`;
  });
}

// ---------------------------------------------------------------- Datum (lokal, ohne Zeitzonenfehler)
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekdayMon0 = d => (d.getDay() + 6) % 7;

// ---------------------------------------------------------------- Periodisierung
function phasesFor(weeks, goalKey, hasEvent) {
  const ph = new Array(weeks).fill(null);
  let end = weeks;
  if (hasEvent) {
    ph[end - 1] = "taper"; end--;
    if (weeks >= 8) { ph[end - 1] = "peak"; ph[end - 2] = "peak"; end -= 2; }
  } else if (GOALS[goalKey].ftpTest && weeks >= 4) { ph[end - 1] = "test"; end--; }
  const baseN = end > 2 ? Math.max(1, Math.round(end * 0.4)) : end;
  for (let i = 0; i < end; i++) ph[i] = i < baseN ? "base" : "build";
  let pos = 0;
  for (let i = 0; i < weeks; i++) {
    if (ph[i] === "base" || ph[i] === "build") {
      if (pos === 3) { ph[i] = "recovery"; pos = 0; } else pos++;
    }
  }
  return ph;
}

function hardTypes(st, phase) {
  const goal = GOALS[st.goal_type] || GOALS.ftp;
  if (phase === "recovery" || phase === "test") return [];
  if (phase === "taper") return goal.hard.taper;
  const custom = (st.focus || []).filter(t => HARD_TYPES[t]);
  let types = custom.length && (phase === "build" || phase === "peak" || st.goal_type === "custom") ? custom : [...goal.hard[phase]];
  let map = null;
  if (st.style === "polarized") map = { tempo: "vo2max", sweetspot: "threshold", sweetspot_long: "threshold" };
  else if (st.style === "sweetspot") map = phase !== "peak" ? { tempo: "sweetspot", vo2max: "threshold" } : { tempo: "sweetspot" };
  if (map) types = [...new Set(types.map(t => map[t] || t))];
  return types;
}

function pickHardDays(days, n, longDay) {
  const near = (a, b) => [1, 6].includes(Math.abs(a - b));
  const cands = Object.keys(days).map(Number).filter(d => d !== longDay).sort((a, b) => days[b].minutes - days[a].minutes);
  const picked = [];
  for (const d of cands) {
    if (picked.length >= n) break;
    if ((picked.every(p => !near(d, p)) && !near(d, longDay)) || cands.length <= n) picked.push(d);
  }
  for (const d of cands) { if (picked.length >= n) break; if (!picked.includes(d)) picked.push(d); }
  return picked.slice(0, n).sort((a, b) => a - b);
}

function generatePlan(st, perf) {
  const ftp = Number(st.ftp) || 200;
  let start = st.start_date ? parseDate(st.start_date) : new Date();
  start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (weekdayMon0(start)) start = addDays(start, 7 - weekdayMon0(start)); // nächster Montag
  const hasEvent = !!st.event_date && ["event", "climbing", "sprint", "custom", "endurance"].includes(st.goal_type);
  const ev = hasEvent ? parseDate(st.event_date) : null;
  if (hasEvent && ev < start) throw new Error("Das Eventdatum liegt vor dem Planstart.");
  const weeks = hasEvent ? Math.max(4, Math.min(30, Math.ceil(((ev - start) / 864e5 + 1) / 7)))
                         : Math.max(4, Math.min(30, Number(st.plan_weeks) || 12));

  const days = {};
  for (const [k, v] of Object.entries(st.days || {}))
    if (v.active) days[+k] = { minutes: Number(v.minutes) || 60, time: v.time || "18:00" };
  const dayKeys = Object.keys(days).map(Number).sort((a, b) => a - b);
  if (!dayKeys.length) throw new Error("Bitte mindestens einen Trainingstag aktivieren.");
  let longDay = Number(st.long_day ?? 5);
  if (!days[longDay]) longDay = dayKeys.reduce((a, b) => days[b].minutes > days[a].minutes ? b : a);

  const cap = dayKeys.reduce((a, d) => a + days[d].minutes, 0);
  const maxHours = Math.min(Number(st.weekly_hours) || 6, cap / 60);
  const recent = perf?.weekly_hours_avg;
  let cur = recent ? Math.min(maxHours, recent * 1.05) : maxHours * 0.8;
  cur = Math.max(cur, Math.min(maxHours, 2));
  const tsb = perf?.tsb;

  const phases = phasesFor(weeks, st.goal_type in GOALS ? st.goal_type : "ftp", hasEvent);
  const goal = GOALS[st.goal_type] || GOALS.ftp;
  const out = [];
  let level = 0, rot = 0;
  phases.forEach((phase, w) => {
    const ws = addDays(start, w * 7);
    let hours;
    if (phase === "recovery") hours = cur * 0.6;
    else if (phase === "taper") hours = cur * 0.5;
    else if (phase === "test") hours = cur * 0.65;
    else if (phase === "peak") hours = Math.min(maxHours, cur) * 0.9;
    else { if (w > 0 && phases[w - 1] !== "recovery") cur = Math.min(maxHours, cur * 1.06); hours = cur; }
    if (w === 0 && tsb != null && tsb < -25) hours *= 0.7;
    if (phase === "recovery") level = 0;

    const n = dayKeys.length;
    let hardN = { base: n < 4 ? 1 : 2, build: n < 6 ? 2 : 3, peak: 2, taper: 1, recovery: 0, test: 0 }[phase];
    hardN = Math.min(hardN, Math.max(0, n - 1));
    let hard = pickHardDays(days, hardN, longDay);
    const types = hardTypes(st, phase);
    if (phase === "taper" && hasEvent) {
      const before = dayKeys.filter(d => addDays(ws, d) < ev);
      hard = before.length ? [Math.max(...before)] : [];
    }
    const others = dayKeys.filter(d => d !== longDay);
    const testDay = others.length ? others.reduce((a, b) => days[b].minutes > days[a].minutes ? b : a) : longDay;
    const scale = Math.min(1, hours * 60 / cap);

    const wd = [];
    for (const d of dayKeys) {
      const date = addDays(ws, d);
      if (hasEvent && date >= ev) continue;
      const mins = Math.max(30, Math.round(days[d].minutes * scale / 5) * 5);
      let wo;
      if (phase === "test" && d === testDay) wo = buildWorkout("ftp_test", 75, 0, ftp);
      else if (hard.includes(d) && types.length) wo = buildWorkout(types[rot++ % types.length], Math.max(mins, 45), level, ftp);
      else if (d === longDay && !["recovery", "taper", "test"].includes(phase))
        wo = buildWorkout(phase === "build" || phase === "peak" ? goal.long : "endurance", mins, level, ftp);
      else if (["recovery", "taper", "test"].includes(phase) || hard.includes(d - 1))
        wo = buildWorkout(mins <= 60 ? "recovery" : "endurance", Math.min(mins, 60), 0, ftp);
      else wo = buildWorkout("endurance", mins, 0, ftp);
      wo.structure = describeSegments(wo.segments, ftp);
      wo.id = `W${String(w + 1).padStart(2, "0")}-${WEEKDAYS[d]}-${wo.kind}`;
      wd.push({ date: isoDate(date), weekday: WEEKDAYS[d], time: days[d].time, workout: wo });
    }
    if (hasEvent && ev >= ws && ev < addDays(ws, 7)) {
      const nm = st.goal_name || "Event";
      wd.push({ date: isoDate(ev), weekday: WEEKDAYS[weekdayMon0(ev)], time: "", workout: {
        kind: "event", name: `🏁 ${nm}`, segments: [], minutes: 0, if: 0, tss: 0, structure: [],
        id: `W${String(w + 1).padStart(2, "0")}-event`, desc: "Dein Zielevent – viel Erfolg!" } });
    }
    if (["base", "build", "peak"].includes(phase)) level = Math.min(2, level + 1);
    out.push({ index: w + 1, start: isoDate(ws), phase, phase_label: PHASE_LABELS[phase],
      hours: Math.round(wd.reduce((a, x) => a + x.workout.minutes, 0) / 6) / 10,
      tss: wd.reduce((a, x) => a + x.workout.tss, 0), days: wd });
  });
  return { generated: new Date().toISOString().slice(0, 19), ftp, goal_label: st.goal_name || goal.label,
           event_date: hasEvent ? st.event_date : null, weeks: out };
}

// ---------------------------------------------------------------- Zwift (.zwo)
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function workoutToZwo(day, ftp) {
  const wo = day.workout, [y, m, d] = day.date.split("-");
  const desc = `${wo.desc}\n\n${wo.structure.join("\n")}\n\nGeplant mit FTP ${Math.round(ftp)} W`;
  const L = ["<workout_file>", "  <author>RTF RoadToFTP</author>", `  <name>${xmlEsc(`${d}.${m}. ${wo.name}`)}</name>`,
    `  <description>${xmlEsc(desc)}</description>`, "  <sportType>bike</sportType>",
    '  <tags><tag name="RTF"/></tags>', "  <workout>"];
  for (const s of wo.segments) {
    if (s.t === "warmup") L.push(`    <Warmup Duration="${s.d}" PowerLow="${s.from}" PowerHigh="${s.to}"/>`);
    else if (s.t === "cooldown") L.push(`    <Cooldown Duration="${s.d}" PowerLow="${s.from}" PowerHigh="${s.to}"/>`);
    else if (s.t === "steady") L.push(`    <SteadyState Duration="${s.d}" Power="${s.p}"/>`);
    else if (s.t === "intervals") L.push(`    <IntervalsT Repeat="${s.n}" OnDuration="${s.on}" OffDuration="${s.off}" OnPower="${s.onp}" OffPower="${s.offp}"/>`);
    else if (s.t === "free") L.push(`    <FreeRide Duration="${s.d}" FlatRoad="1"/>`);
  }
  L.push("  </workout>", "</workout_file>", "");
  return L.join("\n");
}

// ---------------------------------------------------------------- intervals.icu Workout-Text
function icuDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h}h` : "") + (m ? `${m}m` : "") + (s ? `${s}s` : "") || "0s";
}
const pct = p => Math.round(p * 100);

function workoutToIcuText(wo) {
  const out = [];
  for (const s of wo.segments) {
    if (s.t === "warmup") out.push("Warmup", `- ${icuDur(s.d)} ramp ${pct(s.from)}-${pct(s.to)}%`, "");
    else if (s.t === "cooldown") out.push("Cooldown", `- ${icuDur(s.d)} ramp ${pct(s.from)}-${pct(s.to)}%`, "");
    else if (s.t === "steady") out.push(`- ${icuDur(s.d)} ${pct(s.p)}%`, "");
    else if (s.t === "free") out.push(`- ${icuDur(s.d)} freeride`, "");
    else if (s.t === "intervals") out.push(`${s.n}x`, `- ${icuDur(s.on)} ${pct(s.onp)}%`, `- ${icuDur(s.off)} ${pct(s.offp)}%`, "");
  }
  return `RTF: ${wo.desc}\n\n${out.join("\n").trim()}`;
}

// ---------------------------------------------------------------- Kalender (.ics)
const icsEsc = s => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function icsFold(line) {
  const enc = new TextEncoder(), parts = [];
  let cur = "", len = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (len + b > 74) { parts.push(cur); cur = " "; len = 1; }
    cur += ch; len += b;
  }
  parts.push(cur);
  return parts.join("\r\n");
}
const icsStamp = d => `${isoDate(d).replace(/-/g, "")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;

function planToIcs(plan) {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RTF RoadToFTP//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:RTF Trainingsplan", "X-WR-TIMEZONE:Europe/Berlin"];
  for (const w of plan.weeks) for (const day of w.days) {
    const wo = day.workout, d = parseDate(day.date);
    if (wo.kind === "event") {
      L.push("BEGIN:VEVENT", `UID:${day.date}-event@roadtoftp`, `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${day.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${isoDate(addDays(d, 1)).replace(/-/g, "")}`,
        icsFold("SUMMARY:" + icsEsc(wo.name)), "END:VEVENT");
      continue;
    }
    const [hh, mm] = (day.time || "18:00").split(":").map(Number);
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
    const e = new Date(s.getTime() + wo.minutes * 60000);
    const desc = `${wo.desc}\n\n${wo.structure.join("\n")}\n\nDauer: ${wo.minutes} min | TSS ~${wo.tss} | IF ${wo.if}` +
                 `\nPhase: ${w.phase_label} (Woche ${w.index})`;
    L.push("BEGIN:VEVENT", `UID:${day.date}-${wo.kind}@roadtoftp`, `DTSTAMP:${now}`, `DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`,
      icsFold("SUMMARY:" + icsEsc(`🚴 ${wo.name} (${wo.minutes} min)`)), icsFold("DESCRIPTION:" + icsEsc(desc)),
      "CATEGORIES:Training", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Training", "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Leistungsanalyse (gemeinsame Form)
// acts: [{date:"YYYY-MM-DD", name, type, minutes, np, hr, tss?}]
const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide"]);
function activityTss(a, ftp) {
  if (a.tss != null) return a.tss;
  const h = a.minutes / 60;
  if (a.np && ftp) return h * (a.np / ftp) ** 2 * 100;
  if (a.hr) return h * (a.hr / 165) ** 2 * 100;
  return h * (RIDE_TYPES.has(a.type) ? 55 : a.type === "WeightTraining" ? 30 : 60);
}

// FTP-Schätzung aus Fahrten mit Leistungsmesser (20–90 min, gewichtete Leistung)
function estimateFtp(acts) {
  let best = null;
  for (const a of acts) {
    if (!a.np || !a.power || a.minutes < 20 || a.minutes > 90 || !RIDE_TYPES.has(a.type)) continue;
    const v = a.np * (a.minutes <= 35 ? 0.95 : a.minutes >= 55 ? 1 : 0.97);
    if (!best || v > best.v) best = { v, a };
  }
  return best;
}

function analyzeActivities(acts, ftp, days = 180) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daily = {};
  for (const a of acts) daily[a.date] = (daily[a.date] || 0) + activityTss(a, ftp);
  let ctl = 0, atl = 0;
  const series = [];
  for (let d = addDays(today, -days); d <= today; d = addDays(d, 1)) {
    const k = isoDate(d), t = daily[k] || 0;
    ctl += (t - ctl) / 42; atl += (t - atl) / 7;
    series.push({ date: k, tss: Math.round(t), ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10 });
  }
  // Monatsbeste FTP-Schätzung (Leistungsentwicklung)
  const months = {};
  for (const a of acts) (months[a.date.slice(0, 7)] ||= []).push(a);
  const ftpHistory = Object.keys(months).sort().map(m => {
    const b = estimateFtp(months[m]);
    return b ? { month: m, date: b.a.date, ftp: Math.round(b.v), source: `${b.a.name} (${b.a.minutes} min, NP ${Math.round(b.a.np)} W)` } : null;
  }).filter(Boolean);
  const best = estimateFtp(acts.filter(a => a.date > isoDate(addDays(today, -90))));
  const cut = isoDate(addDays(today, -28));
  const weeklyHours = acts.filter(a => a.date > cut).reduce((s, a) => s + a.minutes, 0) / 60 / 4;
  const weekly = {};
  for (const a of acts) {
    const d = parseDate(a.date), wk = isoDate(addDays(d, -weekdayMon0(d)));
    const w = weekly[wk] ||= { week: wk, hours: 0, tss: 0 };
    w.hours += a.minutes / 60; w.tss += activityTss(a, ftp);
  }
  return {
    updated: new Date().toISOString().slice(0, 19), activities: acts.length,
    ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10,
    weekly_hours_avg: Math.round(weeklyHours * 10) / 10,
    weeks: Object.values(weekly).sort((a, b) => a.week.localeCompare(b.week)).slice(-12)
      .map(w => ({ week: w.week, hours: Math.round(w.hours * 10) / 10, tss: Math.round(w.tss) })),
    recent: [...acts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15)
      .map(a => ({ ...a, tss: Math.round(activityTss(a, ftp)) })),
    // für die Analyse-Seite
    days, series, ftp_history: ftpHistory,
    ftp_estimate: best ? Math.round(best.v) : null,
    ftp_estimate_source: best ? `${best.a.name} (${best.a.date}, ${best.a.minutes} min, NP ${Math.round(best.a.np)} W)` : null,
    activities_list: [...acts].sort((a, b) => a.date.localeCompare(b.date))
      .map(a => ({ ...a, tss: Math.round(activityTss(a, ftp)) })),
  };
}

// ---------------------------------------------------------------- Prognose
// Fitness/Ermüdung ab heute mit den geplanten Einheiten fortschreiben
function projectLoad(perf, plan) {
  const last = perf?.series?.at(-1);
  if (!last || !plan) return [];
  const planned = {};
  for (const w of plan.weeks) for (const d of w.days) planned[d.date] = (planned[d.date] || 0) + (d.workout.tss || 0);
  const end = parseDate(plan.weeks.at(-1).days.at(-1)?.date || plan.weeks.at(-1).start);
  let ctl = last.ctl, atl = last.atl;
  const out = [];
  for (let d = addDays(parseDate(last.date), 1); d <= addDays(end, 0); d = addDays(d, 1)) {
    const k = isoDate(d), t = planned[k] || 0;
    ctl += (t - ctl) / 42; atl += (t - atl) / 7;
    out.push({ date: k, tss: t, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10 });
  }
  return out;
}

// FTP-Prognose nach Faustregeln: Zuwachs pro Woche je Phase (Anteil der FTP), mit Spanne
const FTP_GAIN = { base: 0.004, build: 0.008, peak: 0.005, recovery: 0.001, taper: 0, test: 0 };
function projectFtp(ftp, plan, weightKg) {
  if (!plan) return [];
  // Abnehmender Zuwachs bei hoher W/kg
  const wkg = weightKg ? ftp / weightKg : 3;
  const damp = wkg > 4 ? 0.6 : wkg > 3.5 ? 0.8 : 1;
  let lo = ftp, mid = ftp, hi = ftp;
  const out = [{ date: plan.weeks[0].start, lo, mid, hi }];
  for (const w of plan.weeks) {
    const g = (FTP_GAIN[w.phase] ?? 0) * damp;
    lo *= 1 + g * 0.5; mid *= 1 + g; hi *= 1 + g * 1.5;
    out.push({ date: isoDate(addDays(parseDate(w.start), 7)), phase: w.phase, lo: Math.round(lo), mid: Math.round(mid), hi: Math.round(hi) });
  }
  return out;
}

if (typeof module !== "undefined") module.exports = { GOALS, HARD_TYPES, generatePlan, buildWorkout, workoutToZwo,
  workoutToIcuText, planToIcs, analyzeActivities, projectLoad, projectFtp, estimateFtp, isoDate, addDays, parseDate };
