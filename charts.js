// RTF – RoadToFTP: kleine SVG-Diagramme (Linie mit Fadenkreuz-Tooltip, Balken mit Tooltip)
"use strict";

const NS = "http://www.w3.org/2000/svg";
const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const fmtDay = t => { const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`; };

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 100) / 100);
  return t;
}
function legend(host, items) {
  const lg = document.createElement("div");
  lg.className = "viz-legend";
  for (const it of items) {
    const s = document.createElement("span");
    const k = document.createElement("i");
    k.className = it.kind === "bar" ? "key-bar" : it.kind === "dot" ? "key-dot" : it.kind === "band" ? "key-band" : "key-line";
    if (it.dash) k.classList.add("dash");
    k.style.setProperty("--c", it.color);
    s.append(k, document.createTextNode(it.name));
    lg.appendChild(s);
  }
  host.appendChild(lg);
}
function tooltip(host) {
  const tt = document.createElement("div");
  tt.className = "viz-tip";
  tt.hidden = true;
  host.appendChild(tt);
  return {
    show(x, y, title, rows) {
      tt.replaceChildren();
      const h = document.createElement("div"); h.className = "tt-h"; h.textContent = title; tt.appendChild(h);
      for (const r of rows) {
        const row = document.createElement("div"); row.className = "tt-r";
        const k = document.createElement("i"); k.className = "key-line"; if (r.dash) k.classList.add("dash"); k.style.setProperty("--c", r.color);
        const v = document.createElement("b"); v.textContent = r.value;
        const n = document.createElement("span"); n.textContent = r.name;
        row.append(k, v, n); tt.appendChild(row);
      }
      tt.hidden = false;
      const hw = host.clientWidth, tw = tt.offsetWidth;
      tt.style.left = Math.max(0, Math.min(hw - tw, x + 12 > hw - tw ? x - tw - 12 : x + 12)) + "px";
      tt.style.top = Math.max(0, y - 10) + "px";
    },
    hide() { tt.hidden = true; },
  };
}

/**
 * Liniendiagramm über der Zeit.
 * opts: { series:[{name,color,data:[{x,y}],dash,dots}], band:{name,color,data:[{x,lo,hi}]},
 *         refs:[{y,label}], marks:[{x,label}], height, yFmt, yMin, yMax, title }
 */
function lineChart(host, opts) {
  host.replaceChildren();
  host.classList.add("viz");
  const items = opts.series.filter(s => s.data.length).map(s => ({ name: s.name, color: s.color, dash: s.dash, kind: s.dots ? "dot" : "line" }));
  if (opts.band?.data.length) items.push({ name: opts.band.name, color: opts.band.color, kind: "band" });
  if (items.length > 1) legend(host, items);
  const W = Math.max(280, host.clientWidth || 320), H = opts.height || 180;
  const m = { l: 36, r: 10, t: 10, b: 22 };
  const all = opts.series.flatMap(s => s.data);
  const band = opts.band?.data || [];
  const xs = [...all.map(p => p.x), ...band.map(p => p.x)];
  if (!xs.length) return;
  const ys = [...all.map(p => p.y), ...band.flatMap(p => [p.lo, p.hi]), ...(opts.refs || []).map(r => r.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(opts.yMin ?? Math.min(...ys), opts.yMax ?? Math.max(...ys));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const X = t => m.l + (t - x0) / Math.max(1, x1 - x0) * (W - m.l - m.r);
  const Y = v => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": opts.title || "" }, host);
  // Raster + y-Achse
  for (const v of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? "viz-base" : "viz-grid" }, svg);
    el("text", { x: m.l - 6, y: Y(v) + 4, class: "viz-ax", "text-anchor": "end" }, svg).textContent = (opts.yFmt || String)(v);
  }
  // x-Achse: Monatsanfänge
  const d = new Date(x0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  const span = (x1 - x0) / DAY, every = span > 300 ? 3 : span > 150 ? 2 : 1;
  for (let i = 0; d.getTime() <= x1; d.setMonth(d.getMonth() + 1), i++) {
    if (i % every) continue;
    el("text", { x: X(d.getTime()), y: H - 6, class: "viz-ax", "text-anchor": "middle" }, svg).textContent = MONTHS[d.getMonth()];
  }
  // Referenzlinien und Markierungen
  for (const r of opts.refs || []) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y), class: "viz-ref" }, svg);
    el("text", { x: W - m.r - 2, y: Y(r.y) - 4, class: "viz-ax", "text-anchor": "end" }, svg).textContent = r.label;
  }
  for (const mk of opts.marks || []) {
    if (mk.x < x0 || mk.x > x1) continue;
    el("line", { x1: X(mk.x), x2: X(mk.x), y1: m.t, y2: H - m.b, class: "viz-mark" }, svg);
    el("text", { x: X(mk.x) + 3, y: m.t + 9, class: "viz-ax" }, svg).textContent = mk.label;
  }
  // Spanne
  if (band.length) {
    const pts = band.map(p => `${X(p.x)},${Y(p.hi)}`).concat([...band].reverse().map(p => `${X(p.x)},${Y(p.lo)}`));
    el("polygon", { points: pts.join(" "), fill: opts.band.color, "fill-opacity": 0.18 }, svg);
  }
  // Linien
  for (const s of opts.series) {
    if (!s.data.length) continue;
    if (s.dots) {
      for (const p of s.data) el("circle", { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.color, class: "viz-dot" }, svg);
    } else {
      el("path", { d: s.data.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(""),
        fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        ...(s.dash ? { "stroke-dasharray": "5 4" } : {}) }, svg);
    }
  }
  // Fadenkreuz + Tooltip
  const cross = el("line", { y1: m.t, y2: H - m.b, class: "viz-cross", visibility: "hidden" }, svg);
  const tt = tooltip(host);
  const hit = el("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", tabindex: 0 }, svg);
  const nearest = (arr, t) => arr.reduce((b, p) => (!b || Math.abs(p.x - t) < Math.abs(b.x - t) ? p : b), null);
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const t = x0 + (px - m.l) / (W - m.l - m.r) * (x1 - x0);
    const anchor = nearest(xs.map(x => ({ x })), t).x;
    cross.setAttribute("x1", X(anchor)); cross.setAttribute("x2", X(anchor)); cross.setAttribute("visibility", "visible");
    const rows = [];
    for (const s of opts.series) {
      const p = s.data.find(q => Math.abs(q.x - anchor) < DAY / 2);
      if (p) rows.push({ name: s.name, color: s.color, dash: s.dash, value: (opts.yFmt || String)(p.y) });
    }
    const b = band.find(q => Math.abs(q.x - anchor) < DAY / 2);
    if (b) rows.push({ name: opts.band.name, color: opts.band.color, value: `${(opts.yFmt || String)(b.lo)}–${(opts.yFmt || String)(b.hi)}` });
    if (!rows.length) return tt.hide();
    tt.show(X(anchor) * (r.width / W), (ev.clientY - r.top), fmtDay(anchor), rows);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { tt.hide(); cross.setAttribute("visibility", "hidden"); });
  hit.addEventListener("focus", () => { const p = xs.at(-1); move({ clientX: svg.getBoundingClientRect().left + X(p) * svg.getBoundingClientRect().width / W, clientY: svg.getBoundingClientRect().top + 20 }); });
  hit.addEventListener("blur", () => { tt.hide(); cross.setAttribute("visibility", "hidden"); });
}

/**
 * Säulendiagramm. bars: [{label, value, color, series, tip}], legend: [{name,color}]
 */
function barChart(host, { bars, legendItems, height = 160, yFmt = String, title = "" }) {
  host.replaceChildren();
  host.classList.add("viz");
  if (legendItems?.length > 1) legend(host, legendItems.map(l => ({ ...l, kind: "bar" })));
  const W = Math.max(280, host.clientWidth || 320), H = height, m = { l: 32, r: 6, t: 8, b: 22 };
  const ticks = niceTicks(0, Math.max(1, ...bars.map(b => b.value)));
  const y1 = ticks.at(-1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": title }, host);
  const Y = v => m.t + (1 - v / y1) * (H - m.t - m.b);
  for (const v of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? "viz-base" : "viz-grid" }, svg);
    el("text", { x: m.l - 6, y: Y(v) + 4, class: "viz-ax", "text-anchor": "end" }, svg).textContent = yFmt(v);
  }
  const slot = (W - m.l - m.r) / bars.length, bw = Math.max(3, Math.min(22, slot - 2));
  const every = Math.ceil(bars.length / Math.floor((W - m.l) / 34));
  const tt = tooltip(host);
  bars.forEach((b, i) => {
    const x = m.l + i * slot + (slot - bw) / 2, y = Y(b.value), h = Math.max(0, Y(0) - y);
    const r = Math.min(4, bw / 2, h);
    // nur oben abgerundet, unten an der Grundlinie verankert
    const path = h > 0 ? `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z` : "";
    if (path) el("path", { d: path, fill: b.color, class: "viz-bar" }, svg);
    if (i % every === 0) el("text", { x: x + bw / 2, y: H - 6, class: "viz-ax", "text-anchor": "middle" }, svg).textContent = b.label;
    const hit = el("rect", { x: m.l + i * slot, y: m.t, width: slot, height: H - m.t - m.b, fill: "transparent", tabindex: 0 }, svg);
    const show = () => {
      const rr = svg.getBoundingClientRect(), sc = rr.width / W;
      tt.show((x + bw / 2) * sc, y * sc, b.tip || b.label, [{ name: b.series, color: b.color, value: yFmt(b.value) }]);
    };
    hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show); hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", () => tt.hide()); hit.addEventListener("blur", () => tt.hide());
  });
}

/** Waagerechte Balken als HTML (Kategorien mit Wert). rows: [{label, value, text}] */
function hBars(host, rows, color) {
  host.replaceChildren();
  const max = Math.max(1, ...rows.map(r => r.value));
  for (const r of rows) {
    const row = document.createElement("div"); row.className = "hb-row";
    const l = document.createElement("span"); l.className = "hb-l"; l.textContent = r.label;
    const track = document.createElement("span"); track.className = "hb-t";
    const bar = document.createElement("span"); bar.className = "hb-b"; bar.style.width = (r.value / max * 100) + "%"; bar.style.background = color;
    track.appendChild(bar);
    const v = document.createElement("span"); v.className = "hb-v"; v.textContent = r.text;
    row.append(l, track, v); host.appendChild(row);
  }
}
