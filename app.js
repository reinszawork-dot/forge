/* Forge — train & eat. All data stays in this browser (localStorage). */
'use strict';

/* ---------- state ---------- */
const KEY = 'forge:v1';
const blank = () => ({
  profile: null,
  diary: {},
  customFoods: [],
  customExercises: [],
  routines: DEFAULT_ROUTINES.map((r) => ({ ...r, exercises: [...r.exercises] })),
  workouts: [],
  active: null,
  weights: [],
  settings: { restSec: 90, deloadEvery: 6, deloadUntil: 0, deloadDismissed: 0 },
  reminders: { days: [], time: '17:30', foodTime: '' },
  meta: { updatedAt: 0 },
});
function hydrate(data) {
  const b = blank(), s = Object.assign(b, data || {});
  s.settings = { ...b.settings, ...(data?.settings || {}) };
  s.reminders = { ...b.reminders, ...(data?.reminders || {}) };
  s.meta = { ...b.meta, ...(data?.meta || {}) };
  return s;
}
let state;
try { state = hydrate(JSON.parse(localStorage.getItem(KEY))); } catch { state = blank(); }
function save(touch = true) {
  if (touch) state.meta.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  if (touch) scheduleSync();
}

let tab = 'today';
let eatDate = null; // date key shown in Eat tab
let progressEx = null;

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const fmtDate = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('en-ZA', o);
const kfmt = (n) => Math.round(n).toLocaleString('en-ZA');
const e1rm = (w, r) => (r > 0 ? w * (1 + r / 30) : 0); // Epley

const allExercises = () => EXERCISES.concat(state.customExercises);
const exById = (id) => allExercises().find((e) => e.id === id) || { id, name: id, muscle: 'Other', equip: '', type: 'c' };

/* ---------- targets (Mifflin-St Jeor) ---------- */
const ACTIVITY = [
  [1.2, 'Desk job, little exercise'],
  [1.375, 'Light (1–3 sessions/wk)'],
  [1.55, 'Moderate (3–5 sessions/wk)'],
  [1.725, 'Very active (6–7 sessions/wk)'],
  [1.9, 'Athlete / physical job'],
];
function targets() {
  const p = state.profile;
  if (!p) return { kcal: 2000, p: 150, c: 200, f: 65, tdee: 2000 };
  const w = latestWeight() || p.weight;
  const bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * p.activity;
  const adj = p.goal === 'cut' ? -(p.rate * 7700) / 7 : p.goal === 'bulk' ? (p.rate * 7700) / 7 : 0;
  const kcal = Math.max(1200, Math.round((tdee + adj) / 10) * 10);
  const prot = Math.round(w * (p.goal === 'cut' ? 2.2 : 1.8));
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  return { kcal, p: prot, c: carbs, f: fat, tdee: Math.round(tdee) };
}
const latestWeight = () => { const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)); return w.length ? w[w.length - 1].kg : null; };
function weightTrend() {
  // Exponentially smoothed trend (like MacroFactor/Happy Scale) so daily noise doesn't panic you.
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  let t = null;
  return w.map((x) => { t = t == null ? x.kg : t + 0.15 * (x.kg - t); return { date: x.date, kg: x.kg, trend: t }; });
}

/* ---------- diary ---------- */
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
function getDay(k) {
  if (!state.diary[k]) state.diary[k] = { breakfast: [], lunch: [], dinner: [], snacks: [], water: 0 };
  return state.diary[k];
}
const peekDay = (k) => state.diary[k];
function totals(day) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!day) return t;
  for (const [m] of MEALS) for (const e of day[m] || []) { t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; }
  return t;
}
const dayHasFood = (k) => { const d = peekDay(k); return !!d && MEALS.some(([m]) => (d[m] || []).length); };
function recentFoods() {
  const seen = new Map();
  for (const k of Object.keys(state.diary).sort().reverse()) {
    for (const [m] of MEALS) for (const e of state.diary[k][m] || []) {
      if (e.src && !seen.has(e.name)) seen.set(e.name, e.src);
    }
    if (seen.size >= 8) break;
  }
  return [...seen.values()];
}

/* ---------- workouts ---------- */
const workoutDays = () => new Set(state.workouts.map((w) => dkey(new Date(w.start))));
function lastSession(exId, excludeId) {
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    const w = state.workouts[i];
    if (w.id === excludeId) continue;
    const ex = w.exercises.find((e) => e.exId === exId);
    if (ex && ex.sets.length) return ex.sets;
  }
  return null;
}
function bestE1RM(exId) {
  let best = 0;
  for (const w of state.workouts) for (const e of w.exercises) if (e.exId === exId) for (const s of e.sets) best = Math.max(best, e1rm(s.w, s.r));
  return best;
}
/* Effort (RPE): how close to failure a set was. 10 = nothing left. */
const RPE = [null, 7, 8, 9, 10];
const RPE_LABEL = { 7: ['😌', 'Easy — 3+ reps left'], 8: ['🙂', 'Solid — 2 reps left'], 9: ['😤', 'Hard — 1 rep left'], 10: ['💀', 'Max — nothing left'] };
const roundW = (w, step = 1.25) => Math.round(w / step) * step;
const sessionsFor = (exId) => state.workouts.filter((w) => w.exercises.some((e) => e.exId === exId))
  .map((w) => w.exercises.filter((e) => e.exId === exId).flatMap((e) => e.sets));
const deloadActive = () => state.settings.deloadUntil > Date.now();

function suggestion(exId, opts = {}) {
  // Double progression (8→12 reps, then add load), tuned by effort, stalls, deloads and rough days.
  const sessions = sessionsFor(exId);
  const last = sessions[sessions.length - 1];
  if (!last || !last.length) return null;
  const ex = exById(exId);
  const topW = Math.max(...last.map((s) => s.w));
  const minR = Math.min(...last.map((s) => s.r));
  const rpes = last.map((s) => s.rpe).filter(Boolean);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const n = last.length;
  const inc = ex.type === 'i' ? 1.25 : ['Legs', 'Glutes'].includes(ex.muscle) || exId === 'deadlift' ? 5 : 2.5;

  if (deloadActive()) {
    return { w: topW ? roundW(topW * 0.85) : 0, r: minR, sets: Math.max(1, Math.ceil(n / 2)), tag: 'deload', note: `Deload week: ${topW ? roundW(topW * 0.85) + ' kg' : 'bodyweight'} × ${minR}, half the sets. Recover, then come back stronger.` };
  }
  if (opts.easyDay) {
    return { w: topW ? roundW(topW * 0.9) : 0, r: minR, sets: n, tag: 'easy', note: `Rough day: ${topW ? roundW(topW * 0.9) + ' kg' : 'same'} × ${minR}. Showing up is the win today.` };
  }
  // Stall: no e1RM improvement across the last 3 sessions → small reset.
  if (sessions.length >= 3 && topW > 0) {
    const best = (ss) => Math.max(...ss.map((s) => e1rm(s.w, s.r)));
    const [a, b, c] = sessions.slice(-3).map(best);
    if (b <= a + 0.01 && c <= a + 0.01) {
      const w = roundW(topW * 0.9);
      return { w, r: Math.min(minR + 2, 12), sets: n, tag: 'stall', note: `Stuck for 3 sessions. Reset to ${w} kg × ${Math.min(minR + 2, 12)} and build back past it.` };
    }
  }
  if (ex.type === 'b' && topW === 0) {
    const add = avgRpe && avgRpe <= 7 ? 2 : 1;
    return { w: 0, r: minR + add, sets: n, note: `Beat last time: aim for ${minR + add}+ reps` };
  }
  if (minR >= 12) {
    const jump = avgRpe && avgRpe <= 7 ? inc * 2 : inc;
    const w = topW + jump;
    return { w, r: 8, sets: n, tag: 'up', note: `You hit 12s${jump > inc ? ' with room to spare' : ''}. Go up to ${w} kg × 8` };
  }
  if (avgRpe && avgRpe >= 9.5) return { w: topW, r: minR, sets: n, note: `Last time was all-out. Match ${topW} kg × ${minR} with better form first.` };
  const add = avgRpe && avgRpe <= 7 ? 2 : 1;
  return { w: topW, r: Math.min(minR + add, 12), sets: n, note: `Same weight, add ${add > 1 ? 'reps' : 'a rep'}: ${topW} kg × ${Math.min(minR + add, 12)}` };
}

/* Deload check: N straight weeks of training since the last deload → suggest one. */
function deloadDue() {
  const every = state.settings.deloadEvery;
  if (!every || deloadActive() || !state.workouts.length) return false;
  const since = Math.max(state.settings.deloadUntil, state.settings.deloadDismissed);
  const mon = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return +d; };
  const weeks = new Set(state.workouts.filter((w) => w.start > since).map((w) => mon(w.start)));
  let streak = 0, wk = mon(Date.now());
  if (!weeks.has(wk)) wk -= 7 * 864e5;
  while (weeks.has(wk)) { streak++; wk = mon(wk - 3 * 864e5); }
  return streak >= every;
}
const volume = (w) => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.w * s.r, 0), 0);
const setCount = (w) => w.exercises.reduce((a, e) => a + e.sets.length, 0);

function streak() {
  const wd = workoutDays();
  const active = (k) => wd.has(k) || dayHasFood(k);
  let d = new Date();
  if (!active(dkey(d))) d = addDays(d, -1);
  let n = 0;
  while (active(dkey(d)) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- UI primitives ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

let sheetCloseT = 0;
function openSheet(html, mount) {
  const sheet = $('#sheet'), bd = $('#sheetBackdrop');
  clearTimeout(sheetCloseT);
  stopScan(); // never leave the camera running behind another sheet
  // Fresh element each time so listeners from a previous sheet never leak.
  const old = $('#sheetBody'), body = old.cloneNode(false);
  old.replaceWith(body);
  body.innerHTML = html;
  sheet.classList.remove('closing'); bd.classList.remove('closing');
  sheet.hidden = false; bd.hidden = false; sheet.scrollTop = 0;
  mount && mount($('#sheetBody'));
}
function closeSheet() {
  const sheet = $('#sheet'), bd = $('#sheetBackdrop');
  stopScan();
  if (sheet.hidden) return;
  sheet.classList.add('closing'); bd.classList.add('closing');
  sheetCloseT = setTimeout(() => { sheet.hidden = true; bd.hidden = true; $('#sheetBody').innerHTML = ''; }, 240);
}
$('#sheetBackdrop').addEventListener('click', () => { if (state.profile) closeSheet(); });

// Material-style ripple on buttons
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn, .item');
  if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 0.5;
  const sp = document.createElement('span');
  sp.className = 'ripple';
  sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden';
  b.appendChild(sp); setTimeout(() => sp.remove(), 650);
});

// Count-up numbers, ring and bar fills after render
function animateIn(root = document) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of $$('[data-count]', root)) {
    const to = num(el.dataset.count), dec = +(el.dataset.dec || 0);
    if (reduce) { el.textContent = round(to, dec).toLocaleString('en-ZA'); continue; }
    const t0 = performance.now(), dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = round(to * e, dec).toLocaleString('en-ZA');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const c of $$('[data-ring]', root)) c.style.strokeDashoffset = c.dataset.ring;
    for (const b of $$('[data-w]', root)) b.style.width = b.dataset.w + '%';
  }));
}

/* ---------- confetti ---------- */
const confetti = (() => {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  let parts = [], raf = 0;
  const colors = ['#c8f560', '#ff8a3d', '#5cc8ff', '#ffd25c', '#ff6fae', '#3ddc97'];
  function frame() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
    for (const p of parts) {
      p.vy += 0.25 * devicePixelRatio; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life / 40);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(frame) : 0;
  }
  return (n = 150, originY = 0.35) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    const d = devicePixelRatio;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = (8 + Math.random() * 10) * d;
      parts.push({ x: cv.width / 2, y: cv.height * originY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, s: (6 + Math.random() * 7) * d, c: colors[i % colors.length], life: 160 + Math.random() * 60 });
    }
    if (!raf) raf = requestAnimationFrame(frame);
  };
})();

/* ---------- sound + haptics ---------- */
let audio;
function beep(freq = 880, dur = 0.15, times = 1) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.22;
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
    }
  } catch { /* no audio */ }
}
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* ignore */ } };

/* ---------- charts (inline SVG) ---------- */
const W = 320, H = 170, PL = 34, PR = 8, PT = 10, PB = 22;
function lineChart(series, { yFmt = (v) => round(v), xLabels = [] } = {}) {
  const pts = series.flatMap((s) => s.pts);
  if (pts.length < 2) return `<p class="empty">Log at least two entries to see a chart.</p>`;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 === x0) x1 = x0 + 1;
  const padY = (y1 - y0) * 0.15 || 1; y0 -= padY; y1 += padY;
  const sx = (x) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR);
  const sy = (y) => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = y0 + ((y1 - y0) * i) / 3, y = sy(v);
    g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}"/><text class="axis" x="${PL - 6}" y="${y + 3}" text-anchor="end">${yFmt(v)}</text>`;
  }
  for (const [x, label] of xLabels) g += `<text class="axis" x="${sx(x)}" y="${H - 4}" text-anchor="middle">${esc(label)}</text>`;
  for (const s of series) {
    const P = s.pts.map((p) => [sx(p.x), sy(p.y)]);
    if (s.line !== false && P.length > 1) {
      let len = 0; for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      g += `<path class="line draw" style="--len:${Math.ceil(len)}" stroke="${s.color}" d="M${P.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join('L')}"/>`;
    }
    if (s.dots) P.forEach((p, i) => { g += `<circle class="dot" style="animation-delay:${i * 25}ms" cx="${p[0]}" cy="${p[1]}" r="${s.r || 3}" fill="${s.color}" opacity="${s.opacity ?? 1}"/>`; });
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}
function barChart(bars, { color = 'var(--accent)', target = null, yFmt = (v) => kfmt(v) } = {}) {
  const max = Math.max(1, ...bars.map((b) => b.v), target || 0) * 1.1;
  const bw = (W - PL - PR) / bars.length;
  const sy = (v) => PT + (1 - v / max) * (H - PT - PB);
  let g = '';
  for (let i = 0; i <= 2; i++) { const v = (max * i) / 2, y = sy(v); g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}"/><text class="axis" x="${PL - 6}" y="${y + 3}" text-anchor="end">${yFmt(v)}</text>`; }
  bars.forEach((b, i) => {
    const x = PL + i * bw + bw * 0.18, w = bw * 0.64, y = sy(b.v), h = H - PB - y;
    const fill = target && b.v > target * 1.05 ? 'var(--bad)' : color;
    if (b.v > 0) g += `<rect class="barr" style="animation-delay:${i * 45}ms" x="${x}" y="${y}" width="${w}" height="${Math.max(0, h)}" rx="4" fill="${fill}"/>`;
    if (b.label) g += `<text class="axis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  if (target) g += `<line x1="${PL}" x2="${W - PR}" y1="${sy(target)}" y2="${sy(target)}" stroke="var(--text)" stroke-dasharray="4 4" opacity=".5"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

/* ---------- shared fragments ---------- */
const RING_C = 2 * Math.PI * 63;
function calorieCard(k) {
  const t = targets(), tot = totals(peekDay(k)), left = t.kcal - tot.kcal, frac = Math.min(1, tot.kcal / t.kcal);
  const bar = (label, v, goal, c) => `<div class="macro"><small>${label}<b>${Math.round(v)}/${goal}g</b></small><div class="bar"><i style="--c:${c}" data-w="${Math.min(100, (v / goal) * 100).toFixed(1)}"></i></div></div>`;
  return `<section class="card">
    <div class="hero">
      <div class="ring ${left < 0 ? 'over' : ''}">
        <svg viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="63"/><circle class="prog" cx="75" cy="75" r="63" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" data-ring="${RING_C * (1 - frac)}"/></svg>
        <div class="ring-label"><b data-count="${Math.abs(left)}">0</b><small>kcal ${left < 0 ? 'over' : 'left'}</small></div>
      </div>
      <div>
        <div class="stat-row"><span class="muted">Target</span><b>${kfmt(t.kcal)}</b></div>
        <div class="stat-row"><span class="muted">Eaten</span><b data-count="${Math.round(tot.kcal)}">0</b></div>
        <div class="stat-row"><span class="muted">Maintenance</span><b>${kfmt(t.tdee)}</b></div>
      </div>
    </div>
    <div class="macros">${bar('Protein', tot.p, t.p, 'var(--protein)')}${bar('Carbs', tot.c, t.c, 'var(--carbs)')}${bar('Fat', tot.f, t.f, 'var(--fat)')}</div>
  </section>`;
}
function waterCard(k) {
  const d = peekDay(k), n = d ? d.water : 0;
  return `<section class="card"><div class="meal-head"><h3>Water</h3><span class="muted">${n * 250} ml of 2 000 ml</span></div>
    <div class="water">${Array.from({ length: 8 }, (_, i) => `<button class="glass ${i < n ? 'full' : ''}" data-water="${i + 1}" aria-label="${i + 1} glasses"></button>`).join('')}</div></section>`;
}
function bindWater(k) {
  for (const b of $$('[data-water]')) b.onclick = () => {
    const d = getDay(k), v = +b.dataset.water;
    d.water = d.water === v ? v - 1 : v; save();
    $$('[data-water]').forEach((g, i) => g.classList.toggle('full', i < d.water));
    b.closest('.card').querySelector('.muted').textContent = `${d.water * 250} ml of 2 000 ml`;
    if (d.water === 8) { confetti(60, 0.5); toast('Hydration goal hit 💧'); }
  };
}

/* ---------- render ---------- */
function render(animate = true) {
  const v = $('#view');
  const views = { today: viewToday, train: state.active ? viewWorkout : viewTrain, eat: viewEat, progress: viewProgress };
  v.innerHTML = views[tab]();
  v.classList.remove('enter', 'no-anim');
  if (animate) { void v.offsetWidth; v.classList.add('enter'); [...v.children].forEach((c, i) => c.style.setProperty('--i', i)); }
  else v.classList.add('no-anim');
  binders[tab]?.();
  animateIn(v);
  updateFloating();
}
const binders = {};

function setTab(t) {
  tab = t;
  const btns = $$('#tabbar button');
  btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  moveIndicator();
  render();
  scrollTo({ top: 0, behavior: 'smooth' });
}
function moveIndicator() {
  const btns = $$('#tabbar button'), i = btns.findIndex((b) => b.dataset.tab === tab), ind = $('#tabIndicator');
  const w = btns[0].getBoundingClientRect().width;
  ind.style.width = w + 'px'; ind.style.transform = `translateX(${i * w}px)`;
}
$$('#tabbar button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
addEventListener('resize', moveIndicator);

/* ===== TODAY ===== */
function viewToday() {
  const k = dkey(), wd = workoutDays();
  const monday = addDays(new Date(), -((new Date().getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekCount = week.filter((d) => wd.has(dkey(d))).length;
  const s = streak();
  const next = nextRoutine();
  const tr = weightTrend(), lastT = tr[tr.length - 1], wkAgo = tr.filter((x) => fromKey(x.date) <= addDays(new Date(), -7)).pop();
  const delta = lastT && wkAgo ? lastT.trend - wkAgo.trend : null;
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `
    <h2 style="font-size:26px;margin:6px 2px 14px">${hi}${state.profile?.name ? ', ' + esc(state.profile.name) : ''} 👋</h2>
    ${calorieCard(k)}
    <div class="grid2" style="margin-top:12px">
      <section class="card streak"><span class="flame">🔥</span><div><div class="big-num" data-count="${s}">0</div><small class="muted">day streak</small></div></section>
      <section class="card streak"><span class="flame" style="animation:none">⚖️</span><div><div class="big-num">${lastT ? round(lastT.trend, 1) : '—'}<small style="font-size:13px"> kg</small></div><small class="muted">${delta == null ? 'trend weight' : (delta <= 0 ? '▼ ' : '▲ ') + Math.abs(round(delta, 2)) + ' kg / wk'}</small></div></section>
    </div>
    <section class="card" style="margin-top:12px">
      <div class="meal-head"><h3>This week</h3><span class="chip accent">${weekCount} workout${weekCount === 1 ? '' : 's'}</span></div>
      <div class="week">${week.map((d, i) => `<div>${'MTWTFSS'[i]}<i style="--d:${i}" class="${wd.has(dkey(d)) ? 'on' : ''} ${dkey(d) === k ? 'today' : ''}"></i></div>`).join('')}</div>
    </section>
    ${deloadActive() ? `<section class="card banner" style="margin-top:12px"><span style="font-size:28px">🧘</span><div class="grow"><b>Deload week</b><div class="muted" style="font-size:13px">Lighter weights, half the sets, until ${fmtDate(state.settings.deloadUntil, { weekday: 'long' })}. Recovery is when you grow.</div></div><button class="btn small" data-deload="end">End</button></section>`
      : deloadDue() ? `<section class="card banner pulse-border" style="margin-top:12px"><span style="font-size:28px">🔋</span><div class="grow"><b>Time for a deload?</b><div class="muted" style="font-size:13px">${state.settings.deloadEvery} straight weeks of training. An easy week lets your joints and nervous system recover.</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn small primary" data-deload="start">Start</button><button class="btn small" data-deload="skip">Not now</button></div></section>` : ''}
    ${!sync.token && (state.workouts.length >= 3 || Object.keys(state.diary).length >= 5) && Date.now() - lastExport() > 7 * 864e5 ? `<button class="item" id="bkNudge" style="margin-top:12px"><div class="badge">☁️</div><div class="grow"><div class="title">Protect your progress</div><div class="meta">Your data lives only on this phone. Turn on cloud backup.</div></div><span class="muted">›</span></button>` : ''}
    <div class="section-title"><h2>Train</h2><button class="link" data-go="train">All routines</button></div>
    ${state.active
      ? `<button class="btn primary block shine" data-go="train">▶ Continue ${esc(state.active.name)}</button>`
      : next ? `<section class="card"><div class="meal-head"><div><small class="muted">Up next</small><h3 style="font-size:20px">${esc(next.name)}</h3></div><button class="btn primary shine" data-start="${next.id}">Start</button></div>
          <div class="muted" style="font-size:13px">${next.exercises.map((e) => esc(exById(e).name)).join(' · ')}</div></section>`
      : `<button class="btn primary block" data-empty>Start empty workout</button>`}
    <div class="section-title"><h2>Hydrate</h2><button class="link" data-go="eat">Food diary</button></div>
    ${waterCard(k)}`;
}
binders.today = () => {
  for (const b of $$('[data-go]')) b.onclick = () => setTab(b.dataset.go);
  for (const b of $$('[data-start]')) b.onclick = () => startWorkout(state.routines.find((r) => r.id === b.dataset.start));
  for (const b of $$('[data-empty]')) b.onclick = () => startWorkout(null);
  for (const b of $$('[data-deload]')) b.onclick = () => {
    const act = b.dataset.deload;
    if (act === 'start') { state.settings.deloadUntil = Date.now() + 7 * 864e5; toast('🧘 Deload week started. Targets are lighter for 7 days.'); }
    if (act === 'end') { state.settings.deloadUntil = 0; state.settings.deloadDismissed = Date.now(); toast('Deload ended. Back to normal targets.'); }
    if (act === 'skip') { state.settings.deloadDismissed = Date.now(); toast('OK, we’ll check again in a few weeks'); }
    save(); render(false);
  };
  const nudge = $('#bkNudge'); if (nudge) nudge.onclick = backupSheet;
  bindWater(dkey());
};
function nextRoutine() {
  if (!state.routines.length) return null;
  const last = (r) => { for (let i = state.workouts.length - 1; i >= 0; i--) if (state.workouts[i].routineId === r.id) return state.workouts[i].start; return 0; };
  return [...state.routines].sort((a, b) => last(a) - last(b))[0];
}

/* ===== TRAIN (not in a workout) ===== */
function viewTrain() {
  const hist = [...state.workouts].reverse().slice(0, 25);
  return `
    <button class="btn primary block shine" data-empty style="margin-top:6px">＋ Start empty workout</button>
    <div class="section-title"><h2>Routines</h2><button class="link" data-new-routine>＋ New</button></div>
    <div class="list">${state.routines.map((r, i) => `
      <div class="item" style="--i:${i}">
        <div class="badge">${esc(r.name.slice(0, 1))}</div>
        <div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${r.exercises.map((e) => esc(exById(e).name)).join(' · ') || 'No exercises'}</div></div>
        <button class="btn small" data-edit="${r.id}">Edit</button>
        <button class="btn small primary" data-start="${r.id}">Start</button>
      </div>`).join('') || '<p class="empty">No routines yet.</p>'}</div>
    <div class="section-title"><h2>History</h2><span class="muted">${state.workouts.length} total</span></div>
    <div class="list">${hist.map((w, i) => `
      <button class="item" style="--i:${i}" data-hist="${w.id}">
        <div class="grow"><div class="title">${esc(w.name)}</div><div class="meta">${fmtDate(w.start)} · ${fmtDur(w.end - w.start)} · ${setCount(w)} sets</div></div>
        <div class="right">${kfmt(volume(w))}<div class="meta">kg vol</div></div>
      </button>`).join('') || '<p class="empty">Finish a workout and it shows up here.</p>'}</div>`;
}
binders.train = () => {
  if (state.active) return bindWorkout();
  $('[data-empty]').onclick = () => startWorkout(null);
  $('[data-new-routine]').onclick = () => routineEditor(null);
  for (const b of $$('[data-start]')) b.onclick = () => startWorkout(state.routines.find((r) => r.id === b.dataset.start));
  for (const b of $$('[data-edit]')) b.onclick = () => routineEditor(state.routines.find((r) => r.id === b.dataset.edit));
  for (const b of $$('[data-hist]')) b.onclick = () => historySheet(state.workouts.find((w) => w.id === b.dataset.hist));
};

function newExerciseEntry(exId) {
  const sug = suggestion(exId, { easyDay: state.active?.easyDay });
  const n = sug ? sug.sets : 3;
  return { exId, sets: Array.from({ length: n }, () => ({ w: '', r: '', done: false })) };
}
function startWorkout(routine) {
  if (state.active) return setTab('train');
  state.active = {
    id: uid(), name: routine ? routine.name : 'Workout', routineId: routine?.id || null, start: Date.now(),
    exercises: routine ? routine.exercises.map(newExerciseEntry) : [], prs: [],
  };
  save(); buzz(20);
  tab = 'train'; setTab('train');
  toast(`${state.active.name} started — let's go 💪`);
}

/* ===== ACTIVE WORKOUT ===== */
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function viewWorkout() {
  const a = state.active;
  return `
    <section class="card">
      <div class="meal-head" style="margin:0">
        <div style="flex:1;min-width:0">
          <input id="wkName" value="${esc(a.name)}" aria-label="Workout name" style="background:none;border:0;font:700 22px var(--display);width:100%;padding:0">
          <div class="timer-big" id="wkTimer">${fmtDur(Date.now() - a.start)}</div>
        </div>
        <button class="btn primary" id="finishBtn">Finish</button>
      </div>
      <div class="row" style="margin-top:10px;align-items:center">
        ${deloadActive() ? '<span class="chip accent" style="flex:none">🧘 Deload week</span>' : `<button class="btn small ${a.easyDay ? 'on-soft' : ''}" id="easyBtn" style="flex:none">😴 ${a.easyDay ? 'Rough day on' : 'Rough day?'}</button>`}
        <small class="muted" style="text-align:right">Rate sets with <b>Feel</b> for smarter suggestions</small>
      </div>
    </section>
    ${a.exercises.map((e, i) => exerciseCard(e, i)).join('')}
    <button class="btn block" id="addExBtn" style="margin-top:12px">＋ Add exercise</button>
    <button class="btn block danger" id="cancelWk" style="margin-top:8px;background:none;border-color:transparent">Discard workout</button>`;
}
const TAG_ICON = { deload: '🧘', easy: '😴', stall: '🔁', up: '🚀' };
function exerciseCard(e, i) {
  const ex = exById(e.exId), prev = lastSession(e.exId), sug = suggestion(e.exId, { easyDay: state.active.easyDay });
  return `<section class="card ex-card" style="--i:${i}" data-exi="${i}">
    <div class="ex-head">
      <div><h3>${esc(ex.name)} <button class="info-btn" data-guide="${esc(e.exId)}" aria-label="How to do ${esc(ex.name)}">i</button></h3>${sug ? `<div class="suggest ${sug.tag || ''}">${TAG_ICON[sug.tag] || '🔮'} ${esc(sug.note)}</div>` : `<div class="suggest muted">First time — find a weight you can do for 8–12 clean reps</div>`}</div>
      <button class="btn small" data-rmex="${i}" aria-label="Remove exercise">✕</button>
    </div>
    <table class="sets">
      <thead><tr><th>Set</th><th>Prev</th><th>kg</th><th>Reps</th><th title="How hard was it?">Feel</th><th></th></tr></thead>
      <tbody>${e.sets.map((s, j) => {
        const p = prev && prev[j];
        return `<tr class="${s.done ? 'done' : ''}" data-row="${i}-${j}">
          <td><b>${j + 1}</b>${s.pr ? '<span class="pr-flag">PR</span>' : ''}</td>
          <td class="prev">${p ? `${p.w}×${p.r}` : '—'}</td>
          <td><input inputmode="decimal" data-f="w" data-i="${i}" data-j="${j}" value="${esc(s.w)}" placeholder="${sug ? sug.w : ''}" aria-label="Weight in kg"></td>
          <td><input inputmode="numeric" data-f="r" data-i="${i}" data-j="${j}" value="${esc(s.r)}" placeholder="${sug ? sug.r : ''}" aria-label="Reps"></td>
          <td><button class="feel" data-rpe="${i}-${j}" aria-label="Effort: ${s.rpe ? RPE_LABEL[s.rpe][1] : 'not rated'}" title="${s.rpe ? RPE_LABEL[s.rpe][1] : 'Tap to rate effort'}">${s.rpe ? RPE_LABEL[s.rpe][0] : '·'}</button></td>
          <td><button class="check ${s.done ? 'on' : ''}" data-check="${i}-${j}" aria-label="Complete set">${CHECK}</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <div class="row" style="margin-top:8px"><button class="btn small" data-addset="${i}">＋ Set</button><button class="btn small" data-rmset="${i}">− Set</button></div>
  </section>`;
}
function bindWorkout() {
  const a = state.active;
  $('#wkName').oninput = (e) => { a.name = e.target.value || 'Workout'; save(); updateFloating(); };
  $('#finishBtn').onclick = finishWorkout;
  $('#cancelWk').onclick = () => {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    state.active = null; stopRest(); save(); render();
  };
  $('#addExBtn').onclick = () => exercisePicker('Add exercises', (ids) => { ids.forEach((id) => a.exercises.push(newExerciseEntry(id))); save(); render(false); setTimeout(() => $('#addExBtn').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); });
  const easy = $('#easyBtn');
  if (easy) easy.onclick = () => {
    a.easyDay = !a.easyDay; save();
    // Re-fill the placeholders on sets not yet started
    render(false);
    toast(a.easyDay ? 'Lighter targets today. Still counts 💪' : 'Back to normal targets');
  };
  for (const b of $$('[data-guide]')) b.onclick = () => guideSheet(b.dataset.guide);
  for (const b of $$('[data-rpe]')) b.onclick = () => {
    const [i, j] = b.dataset.rpe.split('-').map(Number), s = a.exercises[i].sets[j];
    s.rpe = RPE[(RPE.indexOf(s.rpe ?? null) + 1) % RPE.length];
    b.textContent = s.rpe ? RPE_LABEL[s.rpe][0] : '·';
    b.title = s.rpe ? RPE_LABEL[s.rpe][1] : 'Tap to rate effort';
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    if (s.rpe) toast(RPE_LABEL[s.rpe][1]);
    save();
  };
  for (const inp of $$('.sets input')) inp.oninput = () => { a.exercises[+inp.dataset.i].sets[+inp.dataset.j][inp.dataset.f] = inp.value; save(); };
  for (const b of $$('[data-check]')) b.onclick = () => toggleSet(...b.dataset.check.split('-').map(Number), b);
  for (const b of $$('[data-addset]')) b.onclick = () => { const ex = a.exercises[+b.dataset.addset]; const last = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: last ? last.w : '', r: last ? last.r : '', done: false }); save(); render(false); };
  for (const b of $$('[data-rmset]')) b.onclick = () => { const ex = a.exercises[+b.dataset.rmset]; if (ex.sets.length > 1) { ex.sets.pop(); save(); render(false); } };
  for (const b of $$('[data-rmex]')) b.onclick = () => { a.exercises.splice(+b.dataset.rmex, 1); save(); render(false); };
}
function toggleSet(i, j, btn) {
  const a = state.active, ex = a.exercises[i], s = ex.sets[j];
  const row = btn.closest('tr'), [wIn, rIn] = $$('input', row);
  if (!s.done) {
    if (s.w === '' && wIn.placeholder !== '') s.w = wIn.placeholder;
    if (s.r === '' && rIn.placeholder !== '') s.r = rIn.placeholder;
    if (!(num(s.r) > 0)) { rIn.focus(); toast('Enter your reps first'); return; }
    if (s.w === '') s.w = '0';
    wIn.value = s.w; rIn.value = s.r;
    s.done = true;
    // PR check against all previous sessions + earlier sets this session
    const prevBest = Math.max(bestE1RM(ex.exId), ...a.exercises.filter((e) => e.exId === ex.exId).flatMap((e) => e.sets.filter((x) => x.done && x !== s).map((x) => e1rm(num(x.w), num(x.r)))), 0);
    const mine = e1rm(num(s.w), num(s.r));
    if (prevBest > 0 && mine > prevBest + 0.01 && num(s.w) > 0) {
      s.pr = true; a.prs = [...new Set([...(a.prs || []), ex.exId])];
      confetti(170); beep(660, 0.12, 3); buzz([40, 60, 40, 60, 120]);
      toast(`🏆 New PR on ${exById(ex.exId).name}! ~${round(mine, 1)} kg est. 1RM`);
      row.cells[0].insertAdjacentHTML('beforeend', '<span class="pr-flag">PR</span>');
    } else buzz(25);
    startRest(state.settings.restSec);
  } else {
    s.done = false; s.pr = false; row.cells[0].querySelector('.pr-flag')?.remove();
  }
  row.classList.toggle('done', s.done); btn.classList.toggle('on', s.done);
  save();
}
function finishWorkout() {
  const a = state.active;
  const exercises = a.exercises.map((e) => ({ exId: e.exId, sets: e.sets.filter((s) => s.done).map((s) => ({ w: num(s.w), r: num(s.r), ...(s.rpe ? { rpe: s.rpe } : {}), ...(s.pr ? { pr: true } : {}) })) })).filter((e) => e.sets.length);
  if (!exercises.length) { if (confirm('No completed sets. Discard this workout?')) { state.active = null; stopRest(); save(); render(); } return; }
  const w = { id: a.id, name: a.name, routineId: a.routineId, start: a.start, end: Date.now(), exercises };
  state.workouts.push(w); state.active = null; stopRest(); save();
  const prs = exercises.filter((e) => e.sets.some((s) => s.pr)).length;
  render();
  confetti(220, 0.45); beep(523, 0.12); setTimeout(() => beep(784, 0.2), 140);
  openSheet(`<div class="pr-banner"><div class="trophy">${prs ? '🏆' : '💪'}</div><h2>${prs ? `${prs} new PR${prs > 1 ? 's' : ''}!` : 'Workout complete'}</h2><p class="muted">${esc(w.name)} · ${fmtDate(w.start)}</p></div>
    <div class="summary-stats">
      <div><b>${fmtDur(w.end - w.start)}</b><span>time</span></div>
      <div><b data-count="${volume(w)}">0</b><span>kg volume</span></div>
      <div><b data-count="${setCount(w)}">0</b><span>sets</span></div>
    </div>
    <div class="list">${exercises.map((e, i) => `<div class="item" style="--i:${i}"><div class="grow"><div class="title">${esc(exById(e.exId).name)}</div><div class="meta">${e.sets.map((s) => `${s.w}×${s.r}`).join(', ')}</div></div>${e.sets.some((s) => s.pr) ? '<span class="pr-flag">PR</span>' : ''}</div>`).join('')}</div>
    <button class="btn primary block" style="margin-top:16px" id="doneSum">Nice</button>`, (b) => { animateIn(b); $('#doneSum', b).onclick = closeSheet; });
}

/* ---------- rest timer ---------- */
let rest = null, restTick = 0;
function startRest(sec) {
  rest = { end: Date.now() + sec * 1000, total: sec, done: false };
  $('#restPill').hidden = false; $('#restPill').classList.remove('ending');
  clearInterval(restTick); restTick = setInterval(tickRest, 250); tickRest();
}
function stopRest() { rest = null; clearInterval(restTick); $('#restPill').hidden = true; }
function tickRest() {
  if (!rest) return;
  const left = Math.max(0, rest.end - Date.now());
  $('#restText').textContent = fmtDur(left + 999);
  $('#restProg').style.strokeDashoffset = 94.25 * (1 - left / (rest.total * 1000));
  $('#restPill').classList.toggle('ending', left < 5000);
  if (left <= 0 && !rest.done) { rest.done = true; beep(880, 0.18, 2); buzz([200, 100, 200]); setTimeout(stopRest, 1500); }
}
$('#restPill').addEventListener('click', (e) => {
  const act = e.target.dataset.rest;
  if (!rest || !act) return;
  if (act === 'skip') return stopRest();
  rest.end += +act * 1000; rest.total = Math.max(5, rest.total + +act); rest.done = false; tickRest();
});

function updateFloating() {
  const bar = $('#activeBar');
  bar.hidden = !state.active || tab === 'train';
  if (state.active) { $('#activeName').textContent = state.active.name; $('#activeTime').textContent = fmtDur(Date.now() - state.active.start); }
}
$('#activeBar').onclick = () => setTab('train');
setInterval(() => {
  if (!state.active) return;
  const t = fmtDur(Date.now() - state.active.start);
  const el = $('#wkTimer'); if (el) el.textContent = t;
  $('#activeTime').textContent = t;
}, 1000);

/* ---------- exercise picker ---------- */
function exercisePicker(title, onDone, preselected = []) {
  const picked = new Set(preselected);
  let q = '', muscle = 'All';
  const muscles = ['All', ...new Set(allExercises().map((e) => e.muscle))];
  const show = () => openSheet(`<h2>${esc(title)}</h2>
    <input class="search" id="exQ" placeholder="Search ${allExercises().length} exercises…" autocomplete="off" value="${esc(q)}">
    <div class="filters" id="exF">${muscles.map((m) => `<button data-m="${esc(m)}" class="${m === muscle ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>
    <div class="list" id="exL"></div>
    <button class="btn primary block" id="exGo" style="position:sticky;bottom:0;margin-top:12px">Add</button>`, (b) => {
    const list = $('#exL', b), go = $('#exGo', b);
    const draw = () => {
      const ql = q.trim().toLowerCase();
      const rows = allExercises().filter((e) => (muscle === 'All' || e.muscle === muscle) && (!ql || e.name.toLowerCase().includes(ql)));
      list.innerHTML = rows.map((e, i) => `<div class="item" role="button" tabindex="0" style="--i:${Math.min(i, 12)}" data-id="${esc(e.id)}"><div class="badge" style="${picked.has(e.id) ? 'background:var(--accent);color:var(--accent-ink)' : ''}">${picked.has(e.id) ? '✓' : esc(e.name[0])}</div><div class="grow"><div class="title">${esc(e.name)}</div><div class="meta">${esc(e.muscle)} · ${esc(e.equip)}</div></div>${GUIDES[e.id] ? `<button class="info-btn" data-guide="${esc(e.id)}" aria-label="How to do ${esc(e.name)}">i</button>` : ''}</div>`).join('')
        + (ql && !rows.some((e) => e.name.toLowerCase() === ql) ? `<button class="item" data-create><div class="badge">＋</div><div class="grow"><div class="title">Create “${esc(q.trim())}”</div><div class="meta">Custom exercise</div></div></button>` : '');
      go.textContent = picked.size ? `Add ${picked.size} exercise${picked.size > 1 ? 's' : ''}` : 'Done';
    };
    list.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.item')) { e.preventDefault(); e.target.click(); } };
    list.onclick = (e) => {
      const g = e.target.closest('[data-guide]');
      if (g) return guideSheet(g.dataset.guide, show);
      const it = e.target.closest('.item'); if (!it) return;
      if (it.hasAttribute('data-create')) {
        const ex = { id: 'c-' + uid(), name: q.trim(), muscle: muscle === 'All' ? 'Other' : muscle, equip: 'Custom', type: 'c' };
        state.customExercises.push(ex); save(); picked.add(ex.id); q = ''; $('#exQ', b).value = ''; draw(); return;
      }
      const id = it.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); draw();
    };
    $('#exQ', b).oninput = (e) => { q = e.target.value; draw(); };
    $('#exF', b).onclick = (e) => { const m = e.target.dataset.m; if (!m) return; muscle = m; $$('#exF button', b).forEach((x) => x.classList.toggle('on', x.dataset.m === m)); draw(); };
    go.onclick = () => { const ids = [...picked].filter((id) => !preselected.includes(id)); closeSheet(); onDone(preselected.length ? [...picked] : ids); };
    draw();
  });
  show();
}

function guideSheet(exId, onBack) {
  const ex = exById(exId), g = GUIDES[exId];
  const best = bestE1RM(exId), last = lastSession(exId), sug = suggestion(exId);
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' proper form')}`;
  openSheet(`${onBack ? '<button class="link" id="gBack" style="margin-bottom:8px">‹ Back</button>' : ''}
    <h2>${esc(ex.name)}</h2>
    <div class="filters" style="padding-top:0">${g ? `<span class="chip accent">${esc(g[0])}</span>${g[1] !== '—' ? `<span class="chip">${esc(g[1])}</span>` : ''}` : `<span class="chip">${esc(ex.muscle)}</span>`}<span class="chip">${esc(ex.equip)}</span></div>
    ${g ? `<ol class="cues">${g[2].map((c, i) => `<li style="--i:${i}">${esc(c)}</li>`).join('')}</ol>
      <div class="mistake"><b>⚠️ Common mistake</b><br>${esc(g[3])}</div>` : '<p class="muted">Custom exercise: no guide yet.</p>'}
    <a class="btn block" href="${yt}" target="_blank" rel="noopener" style="margin-top:14px;text-decoration:none">▶ Watch a form video</a>
    <div class="summary-stats">
      <div><b>${best ? round(best, 1) : '—'}</b><span>best est. 1RM</span></div>
      <div><b>${last ? last.map((s) => s.w).reduce((a, b) => Math.max(a, b), 0) + '×' + last[0].r : '—'}</b><span>last top set</span></div>
      <div><b>${sessionsFor(exId).length}</b><span>sessions</span></div>
    </div>
    ${sug ? `<p class="suggest" style="font-size:13px">${TAG_ICON[sug.tag] || '🔮'} Next time: ${esc(sug.note)}</p>` : ''}`, (b) => {
    const back = $('#gBack', b); if (back) back.onclick = onBack;
  });
}

function routineEditor(r) {
  const isNew = !r;
  const draft = r ? { ...r, exercises: [...r.exercises] } : { id: 'r-' + uid(), name: '', exercises: [] };
  const draw = () => openSheet(`<h2>${isNew ? 'New routine' : 'Edit routine'}</h2>
    <div class="field"><label>Name</label><input id="rName" value="${esc(draft.name)}" placeholder="e.g. Upper A"></div>
    <div class="list">${draft.exercises.map((id, i) => `<div class="item" style="--i:${i}"><div class="badge">${i + 1}</div><div class="grow"><div class="title">${esc(exById(id).name)}</div><div class="meta">${esc(exById(id).muscle)}</div></div>
      <button class="btn small" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn small" data-rm="${i}">✕</button></div>`).join('') || '<p class="empty">No exercises yet.</p>'}</div>
    <button class="btn block" id="rAdd" style="margin-top:10px">＋ Add exercises</button>
    <div class="row" style="margin-top:14px">${isNew ? '' : '<button class="btn danger" id="rDel">Delete</button>'}<button class="btn primary" id="rSave">Save routine</button></div>`, (b) => {
    $('#rName', b).oninput = (e) => (draft.name = e.target.value);
    $('#rAdd', b).onclick = () => exercisePicker('Add to routine', (ids) => { draft.exercises.push(...ids.filter((id) => !draft.exercises.includes(id))); setTimeout(draw, 260); });
    for (const x of $$('[data-rm]', b)) x.onclick = () => { draft.exercises.splice(+x.dataset.rm, 1); draw(); };
    for (const x of $$('[data-up]', b)) x.onclick = () => { const i = +x.dataset.up; [draft.exercises[i - 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i - 1]]; draw(); };
    $('#rSave', b).onclick = () => {
      if (!draft.name.trim()) { toast('Give it a name'); return; }
      if (isNew) state.routines.push(draft); else Object.assign(r, draft);
      save(); closeSheet(); render(); toast('Routine saved');
    };
    const del = $('#rDel', b); if (del) del.onclick = () => { if (confirm(`Delete routine “${r.name}”?`)) { state.routines = state.routines.filter((x) => x.id !== r.id); save(); closeSheet(); render(); } };
  });
  draw();
}

function historySheet(w) {
  openSheet(`<h2>${esc(w.name)}</h2><p class="muted" style="margin-top:-6px">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtDur(w.end - w.start)}</p>
    <div class="summary-stats"><div><b>${kfmt(volume(w))}</b><span>kg volume</span></div><div><b>${setCount(w)}</b><span>sets</span></div><div><b>${w.exercises.length}</b><span>exercises</span></div></div>
    <div class="list">${w.exercises.map((e, i) => `<div class="item" style="--i:${i}"><div class="grow"><div class="title">${esc(exById(e.exId).name)}</div><div class="meta">${e.sets.map((s) => `${s.w}×${s.r}`).join(', ')}</div></div>${e.sets.some((s) => s.pr) ? '<span class="pr-flag">PR</span>' : ''}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="btn danger" id="hDel">Delete</button><button class="btn" id="hRepeat">Repeat workout</button></div>`, (b) => {
    $('#hDel', b).onclick = () => { if (confirm('Delete this workout from history?')) { state.workouts = state.workouts.filter((x) => x.id !== w.id); save(); closeSheet(); render(); } };
    $('#hRepeat', b).onclick = () => { closeSheet(); startWorkout({ id: w.routineId, name: w.name, exercises: w.exercises.map((e) => e.exId) }); };
  });
}

/* ===== EAT ===== */
function viewEat() {
  const k = eatDate || dkey(), day = peekDay(k), today = dkey();
  const label = k === today ? 'Today' : k === dkey(addDays(new Date(), -1)) ? 'Yesterday' : fmtDate(fromKey(k));
  return `
    <div class="meal-head" style="margin:6px 0 12px">
      <button class="icon-btn" data-day="-1" aria-label="Previous day">‹</button>
      <h2 style="font-size:20px">${label}</h2>
      <button class="icon-btn" data-day="1" aria-label="Next day" ${k >= today ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>
    ${calorieCard(k)}
    ${MEALS.map(([m, name]) => {
      const items = (day && day[m]) || [], kc = items.reduce((a, e) => a + e.kcal, 0);
      return `<section class="card" style="margin-top:12px"><div class="meal-head"><div><h3>${name}</h3><small class="muted">${kfmt(kc)} kcal</small></div><button class="add-btn" data-add="${m}" aria-label="Add food to ${name}">+</button></div>
        ${items.map((e, i) => `<div class="food-row ${e.id === lastAdded ? 'new' : ''}" style="animation-delay:${i * 40}ms"><div><div>${esc(e.name)}</div><small class="muted">${esc(e.serving)} · P${round(e.p)} C${round(e.c)} F${round(e.f)}</small></div><div style="display:flex;align-items:center;gap:6px"><b>${kfmt(e.kcal)}</b><button class="x" data-del="${m}:${e.id}" aria-label="Remove">✕</button></div></div>`).join('') || '<div class="empty">Nothing logged</div>'}
      </section>`;
    }).join('')}
    <div style="margin-top:12px">${waterCard(k)}</div>`;
}
let lastAdded = null;
binders.eat = () => {
  const k = eatDate || dkey();
  for (const b of $$('[data-day]')) b.onclick = () => { const n = dkey(addDays(fromKey(k), +b.dataset.day)); if (n > dkey()) return; eatDate = n; render(); };
  for (const b of $$('[data-add]')) b.onclick = () => foodSheet(k, b.dataset.add);
  for (const b of $$('[data-del]')) b.onclick = () => {
    const [m, id] = b.dataset.del.split(':'); const d = getDay(k);
    const row = b.closest('.food-row'); row.style.transition = 'opacity .25s, transform .25s'; row.style.opacity = 0; row.style.transform = 'translateX(30px)';
    setTimeout(() => { d[m] = d[m].filter((e) => e.id !== id); save(); render(false); }, 230);
  };
  bindWater(k);
};

function foodSheet(k, meal) {
  const mealName = MEALS.find(([m]) => m === meal)[1];
  let mode = 'search';
  const draw = () => openSheet(`<h2>Add to ${mealName}</h2>
    <div class="seg" id="fMode">${[['search', 'Foods'], ['scan', 'Scan'], ['online', 'Online'], ['quick', 'Quick'], ['create', 'Create']].map(([m, l]) => `<button data-mode="${m}" class="${mode === m ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="fBody" style="margin-top:12px"></div>`, (b) => {
    $('#fMode', b).onclick = (e) => { if (e.target.dataset.mode) { mode = e.target.dataset.mode; draw(); } };
    const body = $('#fBody', b);
    if (mode === 'scan') {
      body.innerHTML = `<div class="scan-box"><video id="scanV" playsinline muted autoplay></video><div class="scan-line"></div><div class="scan-msg" id="scanMsg">Starting camera…</div></div>
        <form id="bcF" class="row" style="margin-top:12px"><input class="search" id="bcQ" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off"><button class="btn primary" style="flex:none">Look up</button></form>
        <p class="muted" style="font-size:12px">Barcode data comes from Open Food Facts. SA products are hit-and-miss: if one isn’t found, use Quick or Create.</p>`;
      const msg = $('#scanMsg', body);
      let busy = false;
      const handle = async (code) => {
        if (busy) return; busy = true;
        buzz(30); beep(1200, 0.08);
        msg.textContent = `Found ${code}, looking it up…`; msg.hidden = false;
        try {
          const food = await lookupBarcode(code);
          if (food) { stopScan(); portionSheet(k, meal, food); return; }
          msg.textContent = `No product found for ${code}. Try Quick add or Create.`;
        } catch { msg.textContent = 'Couldn’t reach Open Food Facts. Check your connection.'; }
        setTimeout(() => { busy = false; }, 2500);
      };
      $('#bcF', body).onsubmit = (e) => { e.preventDefault(); const c = $('#bcQ', body).value.replace(/\D/g, ''); if (c.length >= 8) handle(c); else toast('Barcodes are 8–14 digits'); };
      startScanner($('#scanV', body), handle)
        .then(() => { msg.hidden = true; })
        .catch((err) => { msg.textContent = err && err.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings, or type the number below.' : 'No camera available here. Type the barcode number below.'; });
      return;
    }
    if (mode === 'search') {
      body.innerHTML = `<input class="search" id="fQ" placeholder="Search foods (try “biltong”)" autocomplete="off"><div class="list" id="fL" style="margin-top:10px"></div>`;
      const list = $('#fL', body);
      const drawList = (q) => {
        const ql = q.trim().toLowerCase();
        const pool = ql ? state.customFoods.concat(FOODS).filter((f) => f.name.toLowerCase().includes(ql)) : recentFoods().concat(state.customFoods, FOODS);
        const seen = new Set(), rows = pool.filter((f) => !seen.has(f.name) && seen.add(f.name)).slice(0, 60);
        list.innerHTML = (!ql && recentFoods().length ? '<small class="muted">Recent first</small>' : '') + rows.map((f, i) => `<button class="item" style="--i:${Math.min(i, 12)}" data-i="${i}"><div class="grow"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.serving)} · P${f.p} C${f.c} F${f.f}</div></div><span class="chip kcal">${f.kcal} kcal</span></button>`).join('') || `<p class="empty">No match. Try the Online tab or Create.</p>`;
        list.onclick = (e) => { const it = e.target.closest('[data-i]'); if (it) portionSheet(k, meal, rows[+it.dataset.i]); };
      };
      $('#fQ', body).oninput = (e) => drawList(e.target.value);
      drawList('');
    } else if (mode === 'online') {
      body.innerHTML = `<form id="oF" class="row"><input class="search" id="oQ" placeholder="Search packaged foods (e.g. Woolworths yoghurt)" autocomplete="off"><button class="btn primary" style="flex:none">Search</button></form>
        <label class="muted" style="display:flex;gap:8px;align-items:center;font-size:13px;margin:10px 2px"><input type="checkbox" id="oSA" checked style="width:18px;height:18px;accent-color:var(--accent)"> 🇿🇦 South African products first</label>
        <p class="muted" style="font-size:12px">Powered by Open Food Facts, a free, crowd-sourced database. Values are per 100 g.</p><div class="list" id="oL"></div>`;
      $('#oF', body).onsubmit = async (e) => {
        e.preventDefault();
        const q = $('#oQ', body).value.trim(), list = $('#oL', body);
        if (!q) return;
        list.innerHTML = '<p class="empty">Searching…</p>';
        try {
          let rows = $('#oSA', body).checked ? await offSearch(q, true, (m) => (list.innerHTML = `<p class="empty">${m}</p>`)) : [];
          if (rows.length < 3) {
            const more = await offSearch(q, false, (m) => (list.innerHTML = `<p class="empty">${m}</p>`));
            const seen = new Set(rows.map((r) => r.name)); rows = rows.concat(more.filter((r) => !seen.has(r.name)));
          }
          list.innerHTML = rows.map((f, i) => `<button class="item" style="--i:${Math.min(i, 12)}" data-i="${i}"><div class="grow"><div class="title">${esc(f.name)}</div><div class="meta">per 100 g · P${f.p} C${f.c} F${f.f}</div></div><span class="chip kcal">${f.kcal} kcal</span></button>`).join('') || '<p class="empty">Nothing found. Try fewer words, the Scan tab, or Create.</p>';
          list.onclick = (ev) => { const it = ev.target.closest('[data-i]'); if (it) portionSheet(k, meal, rows[+it.dataset.i]); };
        } catch (err) {
          list.innerHTML = `<p class="empty">${!navigator.onLine ? 'You’re offline. Online search needs a connection.' : 'Open Food Facts is busy right now (it limits searches). Wait 30 seconds and try again, or use Scan.'}</p>`;
        }
      };
    } else if (mode === 'quick') {
      body.innerHTML = `<div class="field"><label>Name (optional)</label><input id="qN" placeholder="Quick add"></div>
        <div class="row"><div class="field"><label>Calories</label><input id="qK" inputmode="numeric"></div><div class="field"><label>Protein g</label><input id="qP" inputmode="decimal"></div></div>
        <div class="row"><div class="field"><label>Carbs g</label><input id="qC" inputmode="decimal"></div><div class="field"><label>Fat g</label><input id="qF" inputmode="decimal"></div></div>
        <button class="btn kcal block" id="qGo">Add</button>`;
      $('#qGo', body).onclick = () => {
        const kc = num($('#qK', body).value); if (!kc) return toast('Enter calories');
        addEntry(k, meal, { name: $('#qN', body).value.trim() || 'Quick add', serving: '1 serving', kcal: kc, p: num($('#qP', body).value), c: num($('#qC', body).value), f: num($('#qF', body).value) });
      };
    } else {
      body.innerHTML = `<div class="field"><label>Food name</label><input id="cN" placeholder="e.g. Mom’s lasagne"></div>
        <div class="field"><label>Serving</label><input id="cS" placeholder="1 plate" value="1 serving"></div>
        <div class="row"><div class="field"><label>Calories</label><input id="cK" inputmode="numeric"></div><div class="field"><label>Protein g</label><input id="cP" inputmode="decimal"></div></div>
        <div class="row"><div class="field"><label>Carbs g</label><input id="cC" inputmode="decimal"></div><div class="field"><label>Fat g</label><input id="cF" inputmode="decimal"></div></div>
        <button class="btn kcal block" id="cGo">Save & add</button>`;
      $('#cGo', body).onclick = () => {
        const name = $('#cN', body).value.trim(), kc = num($('#cK', body).value);
        if (!name || !kc) return toast('Name and calories are required');
        const f = { id: 'cf-' + uid(), name, serving: $('#cS', body).value.trim() || '1 serving', kcal: kc, p: num($('#cP', body).value), c: num($('#cC', body).value), f: num($('#cF', body).value) };
        state.customFoods.unshift(f); save();
        portionSheet(k, meal, f);
      };
    }
  });
  draw();
}
/* ---------- barcode scanning ---------- */
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let scanCleanup = null, scanGen = 0;
const stopScan = () => { scanGen++; if (scanCleanup) { try { scanCleanup(); } catch { /* ignore */ } scanCleanup = null; } };
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
async function startScanner(video, onCode) {
  stopScan();
  const gen = scanGen;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  if (gen !== scanGen) { stream.getTracks().forEach((t) => t.stop()); return; } // sheet changed while the camera was opening
  let stopped = false, reader = null;
  scanCleanup = () => { stopped = true; try { reader && reader.reset(); } catch { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); };
  video.srcObject = stream;
  await video.play().catch(() => {});
  let native = null;
  if ('BarcodeDetector' in window) {
    try {
      const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      const have = await BarcodeDetector.getSupportedFormats();
      const formats = want.filter((f) => have.includes(f));
      if (formats.length) native = new BarcodeDetector({ formats });
    } catch { native = null; }
  }
  if (native) {
    const loop = async () => {
      if (stopped) return;
      try { const r = await native.detect(video); if (r[0]?.rawValue) onCode(r[0].rawValue); } catch { /* frame not ready */ }
      setTimeout(loop, 200);
    };
    loop();
  } else {
    await loadScript(ZXING_URL);
    if (stopped) return;
    reader = new ZXing.BrowserMultiFormatReader();
    reader.decodeFromStream(stream, video, (res) => { if (res && !stopped) onCode(res.getText()); }).catch(() => {});
  }
}
/* Open Food Facts text search. Their server rate-limits and often answers 503 (with no CORS header,
   so the browser reports it as a network error), so we retry with backoff. */
async function offSearch(q, saOnly, onStatus) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&sort_by=unique_scans_n&fields=product_name,brands,nutriments`
    + (saOnly ? '&tagtype_0=countries&tag_contains_0=contains&tag_0=south-africa' : '');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) { onStatus?.(`Open Food Facts is busy. Retrying (${attempt}/2)…`); await new Promise((r) => setTimeout(r, attempt * 2500)); }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return (data.products || []).filter((p) => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] != null).map((p) => ({
        name: p.product_name + (p.brands ? ` (${String(p.brands).split(',')[0]})` : ''), serving: '100 g', per100: true,
        kcal: Math.round(p.nutriments['energy-kcal_100g']), p: round(p.nutriments.proteins_100g || 0, 1), c: round(p.nutriments.carbohydrates_100g || 0, 1), f: round(p.nutriments.fat_100g || 0, 1),
      }));
    } catch (e) { lastErr = e; if (!navigator.onLine) break; }
  }
  throw lastErr;
}

async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`);
  if (res.status === 404) return null;
  const j = await res.json();
  const p = j.product, n = p?.nutriments;
  if (!j.status || !p || !n || n['energy-kcal_100g'] == null) return null;
  return {
    name: (p.product_name || 'Scanned product') + (p.brands ? ` (${p.brands.split(',')[0]})` : ''), serving: '100 g', per100: true, barcode: code,
    kcal: Math.round(n['energy-kcal_100g']), p: round(n.proteins_100g || 0, 1), c: round(n.carbohydrates_100g || 0, 1), f: round(n.fat_100g || 0, 1),
    defaultQty: p.serving_quantity ? Math.round(+p.serving_quantity) : 100, servingLabel: p.serving_size || '',
  };
}

function portionSheet(k, meal, food) {
  const unit = food.per100 ? 'grams (or ml)' : 'servings';
  let qty = food.per100 ? (food.defaultQty || 100) : 1;
  openSheet(`<h2>${esc(food.name)}</h2><p class="muted" style="margin-top:-6px">${food.per100 ? `${food.kcal} kcal per 100 g${food.servingLabel ? ` · 1 serving = ${esc(food.servingLabel)}` : ''}` : esc(food.serving)}</p>
    <div class="summary-stats" id="pS"></div>
    <div class="field"><label>How many ${unit}?</label>
      <div class="row" style="align-items:center"><button class="btn" id="pMinus" style="flex:none">−</button><input id="pQ" inputmode="decimal" value="${qty}" style="text-align:center;font:700 22px var(--display)"><button class="btn" id="pPlus" style="flex:none">+</button></div></div>
    <button class="btn kcal block" id="pGo">Add to ${MEALS.find(([m]) => m === meal)[1]}</button>`, (b) => {
    const step = food.per100 ? 10 : 0.5, inp = $('#pQ', b);
    const calc = () => { const f = food.per100 ? qty / 100 : qty; return { kcal: Math.round(food.kcal * f), p: round(food.p * f, 1), c: round(food.c * f, 1), f: round(food.f * f, 1) }; };
    const show = () => { const c = calc(); $('#pS', b).innerHTML = `<div><b style="color:var(--kcal)">${c.kcal}</b><span>kcal</span></div><div><b style="color:var(--protein)">${c.p}g</b><span>protein</span></div><div><b style="color:var(--carbs)">${c.c}g / ${c.f}g</b><span>carbs / fat</span></div>`; };
    inp.oninput = () => { qty = Math.max(0, num(inp.value)); show(); };
    $('#pMinus', b).onclick = () => { qty = Math.max(step, round(qty - step, 2)); inp.value = qty; show(); };
    $('#pPlus', b).onclick = () => { qty = round(qty + step, 2); inp.value = qty; show(); };
    $('#pGo', b).onclick = () => {
      if (!(qty > 0)) return toast('Enter an amount');
      const c = calc();
      const src = { ...food }; delete src.id;
      addEntry(k, meal, { name: food.name, serving: food.per100 ? `${qty} g` : qty === 1 ? food.serving : `${qty} × ${food.serving}`, ...c, src });
    };
    show();
  });
}
function addEntry(k, meal, e) {
  const entry = { id: uid(), ...e };
  getDay(k)[meal].push(entry); lastAdded = entry.id; save();
  closeSheet(); render(false); buzz(15);
  toast(`Added ${entry.kcal} kcal`);
  const t = targets(), tot = totals(peekDay(k));
  if (tot.p >= t.p && tot.p - entry.p < t.p) { confetti(80, 0.4); toast('Protein goal smashed 🥩'); }
}

/* ===== PROGRESS ===== */
function viewProgress() {
  const tr = weightTrend().slice(-60);
  const t = targets();
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 13));
  const kcalBars = days.map((d) => ({ v: totals(peekDay(dkey(d))).kcal, label: d.getDate() % 2 ? '' : String(d.getDate()) }));
  // weekly volume, last 8 weeks
  const mon = addDays(new Date(), -((new Date().getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(mon, (i - 7) * 7));
  const volBars = weeks.map((w) => ({ v: state.workouts.filter((x) => x.start >= +w && x.start < +addDays(w, 7)).reduce((a, x) => a + volume(x), 0), label: fmtDate(w, { day: 'numeric', month: 'numeric' }) }));
  // muscle sets last 7 days
  const since = Date.now() - 7 * 864e5, muscleSets = {};
  for (const w of state.workouts) if (w.start >= since) for (const e of w.exercises) { const m = exById(e.exId).muscle; muscleSets[m] = (muscleSets[m] || 0) + e.sets.length; }
  const muscles = ['Chest', 'Back', 'Shoulders', 'Legs', 'Glutes', 'Arms', 'Core', 'Full body'];
  // lifts
  const done = [...new Set(state.workouts.flatMap((w) => w.exercises.map((e) => e.exId)))];
  if (!progressEx || !done.includes(progressEx)) progressEx = done.includes('bench') ? 'bench' : done[0];
  const liftPts = progressEx ? state.workouts.filter((w) => w.exercises.some((e) => e.exId === progressEx)).map((w) => ({ x: w.start, y: Math.max(...w.exercises.filter((e) => e.exId === progressEx).flatMap((e) => e.sets.map((s) => e1rm(s.w, s.r)))) })) : [];
  const prs = done.map((id) => ({ id, best: bestE1RM(id) })).filter((x) => x.best > 0).sort((a, b) => b.best - a.best).slice(0, 6);

  const tx = (d) => fromKey(d).getTime();
  return `
    <section class="card" style="margin-top:6px">
      <div class="meal-head"><div><h3>Body weight</h3><small class="muted">Dots = scale, line = smoothed trend</small></div><button class="btn small primary" id="logW">Log weight</button></div>
      ${lineChart([{ pts: tr.map((x) => ({ x: tx(x.date), y: x.kg })), color: 'var(--muted)', dots: true, line: false, r: 2.5, opacity: 0.6 }, { pts: tr.map((x) => ({ x: tx(x.date), y: x.trend })), color: 'var(--accent)' }], { yFmt: (v) => round(v, 1), xLabels: tr.length > 1 ? [[tx(tr[0].date), fmtDate(fromKey(tr[0].date), { day: 'numeric', month: 'short' })], [tx(tr[tr.length - 1].date), fmtDate(fromKey(tr[tr.length - 1].date), { day: 'numeric', month: 'short' })]] : [] })}
    </section>
    <section class="card">
      <div class="meal-head"><div><h3>Calories, last 14 days</h3><small class="muted">Dashed line = your ${kfmt(t.kcal)} kcal target</small></div></div>
      ${barChart(kcalBars, { color: 'var(--kcal)', target: t.kcal })}
    </section>
    <section class="card">
      <div class="meal-head"><h3>Muscles trained · 7 days</h3><small class="muted">sets</small></div>
      <div class="heat">${muscles.map((m, i) => { const n = muscleSets[m] || 0, v = Math.min(1, n / 16); return `<div style="--v:${v};--i:${i}" class="${v > 0.55 ? 'hot' : ''}"><b>${n}</b>${m}</div>`; }).join('')}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">10–20 hard sets per muscle per week is a solid target for growth.</p>
    </section>
    <section class="card">
      <div class="meal-head"><h3>Weekly volume</h3><small class="muted">kg lifted</small></div>
      ${barChart(volBars, { yFmt: (v) => (v >= 1000 ? round(v / 1000, 1) + 'k' : round(v)) })}
    </section>
    <section class="card">
      <div class="meal-head"><h3>Strength</h3>${done.length ? `<select id="liftSel" class="search" style="width:auto;padding:8px 10px">${done.map((id) => `<option value="${esc(id)}" ${id === progressEx ? 'selected' : ''}>${esc(exById(id).name)}</option>`).join('')}</select>` : ''}</div>
      ${done.length ? lineChart([{ pts: liftPts, color: 'var(--protein)', dots: true }], { yFmt: (v) => round(v) }) + '<p class="muted" style="font-size:12px;margin:6px 0 0">Estimated 1-rep max (Epley) — best set each session.</p>' : '<p class="empty">Finish a workout to start tracking strength.</p>'}
    </section>
    ${prs.length ? `<div class="section-title"><h2>Personal records</h2></div><div class="list">${prs.map((p, i) => `<div class="item" style="--i:${i}"><div class="badge" style="background:var(--carbs);color:#1b0d03">${i + 1}</div><div class="grow"><div class="title">${esc(exById(p.id).name)}</div><div class="meta">estimated 1RM</div></div><div class="right"><span data-count="${round(p.best, 1)}" data-dec="1">0</span> kg</div></div>`).join('')}</div>` : ''}
    <div class="section-title"><h2>Your data</h2></div>
    <button class="item" id="bkBtn"><div class="badge">☁️</div><div class="grow"><div class="title">Backup & sync</div><div class="meta">${sync.token ? (sync.error ? '⚠️ ' + esc(sync.error) : `Cloud backup on · synced ${ago(sync.lastOkAt)}`) : `Cloud backup off · last file backup ${ago(lastExport())}`}</div></div><span class="muted">›</span></button>
    <button class="item" id="remBtn" style="margin-top:8px"><div class="badge">🔔</div><div class="grow"><div class="title">Reminders</div><div class="meta">${state.reminders.days.length ? state.reminders.days.slice().sort().map((d) => DAY_LABEL[d]).join(', ') + ' at ' + state.reminders.time : 'Off'}</div></div><span class="muted">›</span></button>`;
}
binders.progress = () => {
  $('#logW').onclick = weightSheet;
  const sel = $('#liftSel'); if (sel) sel.onchange = () => { progressEx = sel.value; render(false); };
  $('#bkBtn').onclick = backupSheet;
  $('#remBtn').onclick = remindersSheet;
};
function weightSheet() {
  const last = latestWeight() || state.profile?.weight || 75;
  openSheet(`<h2>Log weight</h2>
    <div class="field"><label>Date</label><input id="wD" type="date" value="${dkey()}" max="${dkey()}"></div>
    <div class="field"><label>Weight (kg)</label><input id="wK" inputmode="decimal" value="${last}" style="font:700 26px var(--display);text-align:center"></div>
    <p class="muted" style="font-size:12.5px">Tip: weigh in the morning after the bathroom, before eating. Daily ups and downs are mostly water — Forge smooths them into a trend.</p>
    <button class="btn primary block" id="wGo">Save</button>`, (b) => {
    $('#wGo', b).onclick = () => {
      const kg = num($('#wK', b).value), date = $('#wD', b).value || dkey();
      if (kg < 25 || kg > 350) return toast('That weight looks off');
      state.weights = state.weights.filter((x) => x.date !== date).concat({ date, kg: round(kg, 1) });
      save(); closeSheet(); render(); toast('Weight logged');
    };
  });
}

/* ---------- cloud backup: a private GitHub Gist ----------
   The token lives only in this browser (separate key), never in backups or exports. */
const SYNC_KEY = 'forge:sync', GIST_FILE = 'forge-backup.json';
let sync = { token: '', gistId: '', lastSyncedAt: 0, lastOkAt: 0, error: '' };
try { sync = { ...sync, ...JSON.parse(localStorage.getItem(SYNC_KEY)) }; } catch { /* fresh */ }
const saveSync = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch { /* ignore */ } };
const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
async function gh(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, { ...opts, headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 401) throw new Error('GitHub rejected the token. Make a new one with the “gist” box ticked.');
  if (res.status === 403 || res.status === 404) throw new Error('The token can’t access gists. Tick the “gist” scope.');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json();
}
async function findGist() {
  for (let page = 1; page <= 3; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find((x) => x.files && x.files[GIST_FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return '';
}
async function pullRemote() {
  const g = await gh(`/gists/${sync.gistId}`), f = g.files[GIST_FILE];
  if (!f) return null;
  return JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
}
async function pushRemote() {
  const files = { [GIST_FILE]: { content: JSON.stringify(state) } };
  if (sync.gistId) await gh(`/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files }) });
  else sync.gistId = (await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'Forge backup (workouts & food log). Private.', public: false, files }) })).id;
}
const localIsEmpty = () => !state.workouts.length && !Object.keys(state.diary).some(dayHasFood) && !state.active;
let syncing = false, syncAgain = false, syncT = 0;
function scheduleSync() { if (!sync.token) return; clearTimeout(syncT); syncT = setTimeout(() => syncNow(), 4000); }
async function syncNow() {
  if (!sync.token || !navigator.onLine) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; paintSync('Syncing…');
  try {
    if (!sync.gistId) sync.gistId = await findGist();
    const remote = sync.gistId ? await pullRemote() : null;
    const rU = remote?.meta?.updatedAt || 0, lU = state.meta.updatedAt || 0;
    const remoteChanged = rU > sync.lastSyncedAt && rU !== lU, localChanged = lU > sync.lastSyncedAt;
    let adopt = false;
    if (remote && remoteChanged) {
      adopt = !localChanged || localIsEmpty()
        || confirm(`Both this device and your cloud backup have changes.\n\nCloud copy: saved ${ago(rU)}\nThis device: changed ${ago(lU)}\n\nOK = use the cloud copy here.\nCancel = keep this device and overwrite the cloud.`);
    }
    if (adopt) {
      state = hydrate(remote); save(false); render(false);
      toast('☁️ Synced from your cloud backup');
    } else if (localChanged || !remote) await pushRemote();
    sync.lastSyncedAt = state.meta.updatedAt; sync.lastOkAt = Date.now(); sync.error = '';
  } catch (e) {
    sync.error = navigator.onLine ? (e.message || 'Sync failed') : 'Offline. Will sync when you’re back online.';
  } finally {
    saveSync(); syncing = false; paintSync();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
function paintSync(msg) {
  const el = $('#syncStatus'); if (!el) return;
  el.textContent = msg || (sync.error ? '⚠️ ' + sync.error : sync.token ? `✅ Cloud backup on · last synced ${ago(sync.lastOkAt)}` : 'Off');
}
addEventListener('online', () => scheduleSync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sync.token && Date.now() - sync.lastOkAt > 60000) syncNow();
  if (document.visibilityState === 'hidden' && sync.token && state.meta.updatedAt > sync.lastSyncedAt) syncNow();
});

const LAST_EXPORT = 'forge:lastExport';
const lastExport = () => { try { return +localStorage.getItem(LAST_EXPORT) || 0; } catch { return 0; } };
async function shareBackup() {
  const name = `forge-backup-${dkey()}.json`, text = JSON.stringify(state, null, 2);
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Forge backup' });
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    localStorage.setItem(LAST_EXPORT, Date.now()); toast('Backup saved');
  } catch (e) { if (e.name !== 'AbortError') toast('Couldn’t save the backup'); }
}
function importBackup() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!data || !Array.isArray(data.workouts)) throw 0;
      if (!confirm('Replace all current data with this backup?')) return;
      state = hydrate(data); state.meta.updatedAt = Date.now(); save(); closeSheet(); render(); toast('Backup restored');
    } catch { toast('That file isn’t a Forge backup'); }
  };
  inp.click();
}

function backupSheet() {
  const connected = !!sync.token;
  openSheet(`<h2>Backup & sync</h2>
    <section class="card" style="margin-bottom:12px">
      <div class="meal-head"><h3>☁️ Cloud backup</h3><span class="chip ${connected ? 'accent' : ''}">${connected ? 'On' : 'Off'}</span></div>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Saves everything to a <b>private</b> gist on your GitHub account, automatically. Use the same token on another phone and it picks up all your data.</p>
      <p id="syncStatus" style="font-size:13px;margin:0 0 10px"></p>
      ${connected ? `<div class="row"><button class="btn" id="syncGo">Sync now</button><button class="btn danger" id="syncOff">Turn off</button></div>`
        : `<ol class="cues" style="margin-top:0">
            <li><a class="link" href="https://github.com/settings/tokens/new?scopes=gist&description=Forge%20backup" target="_blank" rel="noopener">Open GitHub token page ↗</a>. Signed in, the <b>gist</b> box is already ticked.</li>
            <li>Set <b>Expiration</b> to “No expiration”, scroll down, tap <b>Generate token</b>, and copy it.</li>
            <li>Paste it below. It stays on this device only.</li>
          </ol>
          <div class="field"><label>GitHub token</label><input id="tok" type="password" autocomplete="off" placeholder="ghp_…"></div>
          <button class="btn primary block" id="syncOn">Turn on cloud backup</button>`}
    </section>
    <section class="card">
      <div class="meal-head"><h3>📦 Backup file</h3><small class="muted">last: ${ago(lastExport())}</small></div>
      <p class="muted" style="font-size:13px;margin:0 0 10px">Send a backup file to WhatsApp, Drive or email. Restore it on any device.</p>
      <div class="row"><button class="btn" id="bkShare">Save / share backup</button><button class="btn" id="bkImport">Restore from file</button></div>
    </section>`, (b) => {
    paintSync();
    const on = $('#syncOn', b);
    if (on) on.onclick = async () => {
      const t = $('#tok', b).value.trim();
      if (!/^(ghp_|github_pat_|gho_)/.test(t)) return toast('That doesn’t look like a GitHub token');
      sync = { token: t, gistId: '', lastSyncedAt: 0, lastOkAt: 0, error: '' }; saveSync();
      on.disabled = true; on.textContent = 'Connecting…';
      await syncNow();
      if (sync.error) { toast(sync.error); sync.token = ''; saveSync(); on.disabled = false; on.textContent = 'Turn on cloud backup'; return; }
      confetti(80, 0.4); toast('☁️ Cloud backup is on'); backupSheet();
    };
    const go = $('#syncGo', b); if (go) go.onclick = () => syncNow();
    const off = $('#syncOff', b);
    if (off) off.onclick = () => { if (confirm('Turn off cloud backup on this device? Your gist stays on GitHub.')) { sync = { token: '', gistId: '', lastSyncedAt: 0, lastOkAt: 0, error: '' }; saveSync(); backupSheet(); } };
    $('#bkShare', b).onclick = shareBackup;
    $('#bkImport', b).onclick = importBackup;
  });
}

/* ---------- reminders ---------- */
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const todayIdx = () => (new Date().getDay() + 6) % 7;
let swReg = null;
async function notify(title, body, tag) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { if (swReg) { await swReg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' }); return; } } catch { /* fall through */ }
    try { new Notification(title, { body, tag, icon: 'icon-192.png' }); return; } catch { /* fall through */ }
  }
  toast(`${title}: ${body}`);
}
function checkReminders() {
  const r = state.reminders, now = new Date(), nowM = now.getHours() * 60 + now.getMinutes(), k = dkey();
  let sent = {}; try { sent = JSON.parse(localStorage.getItem('forge:remSent')) || {}; } catch { /* ignore */ }
  if (sent.date !== k) sent = { date: k, keys: [] };
  const due = (t) => t && nowM >= toMin(t) && nowM - toMin(t) <= 120;
  const fire = (key, title, body) => { if (sent.keys.includes(key)) return; sent.keys.push(key); notify(title, body, key); };
  if (r.days.includes(todayIdx()) && due(r.time) && !workoutDays().has(k) && !state.active) {
    const n = nextRoutine(); fire('train', 'Time to train 💪', n ? `Up next: ${n.name}. Tap to start.` : 'Tap to start a workout.');
  }
  if (due(r.foodTime) && totals(peekDay(k)).kcal < targets().kcal * 0.5) fire('food', 'Log your food 🍽️', 'Quick check-in: what did you eat today?');
  try { localStorage.setItem('forge:remSent', JSON.stringify(sent)); } catch { /* ignore */ }
}
setInterval(checkReminders, 30000);

function remindersIcs() {
  const r = state.reminders, pad2 = (n) => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const at = (t, d = new Date()) => { const [h, m] = t.split(':'); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(h)}${pad2(m)}00`; };
  const ev = (uid, summary, desc, start, rule) => ['BEGIN:VEVENT', `UID:${uid}@forge`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, 'DURATION:PT15M', `RRULE:${rule}`, `SUMMARY:${summary}`, `DESCRIPTION:${desc}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Forge//Reminders//EN', 'CALSCALE:GREGORIAN'];
  if (r.days.length && r.time) {
    let d = new Date(); while (!r.days.includes((d.getDay() + 6) % 7)) d = addDays(d, 1);
    lines.push(...ev('forge-train', 'Forge: time to train 💪', 'Open Forge and start your workout.', at(r.time, d), `FREQ=WEEKLY;BYDAY=${[...r.days].sort().map((i) => DAYS[i]).join(',')}`));
  }
  if (r.foodTime) lines.push(...ev('forge-food', 'Forge: log your food 🍽️', 'Quick check-in in Forge.', at(r.foodTime), 'FREQ=DAILY'));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function remindersSheet() {
  const r = { ...state.reminders, days: [...state.reminders.days] };
  const permText = () => !('Notification' in window) ? 'This browser can’t show notifications. Use the calendar button for reminders.'
    : Notification.permission === 'granted' ? '✅ Notifications on. They show while Forge is open. Add them to your calendar to get them anytime.'
    : Notification.permission === 'denied' ? 'Notifications are blocked for this site. Use the calendar button instead.'
    : 'Tap Save and we’ll ask to send notifications.';
  openSheet(`<h2>Reminders</h2>
    <div class="field"><label>Training days</label><div class="days" id="rDays">${DAY_LABEL.map((d, i) => `<button data-d="${i}" class="${r.days.includes(i) ? 'on' : ''}">${d[0]}</button>`).join('')}</div></div>
    <div class="row"><div class="field"><label>Training reminder time</label><input id="rTime" type="time" value="${r.time}"></div>
    <div class="field"><label>Food-log nudge (optional)</label><input id="rFood" type="time" value="${r.foodTime}"></div></div>
    <p class="muted" style="font-size:12.5px" id="rPerm"></p>
    <button class="btn primary block" id="rSave">Save reminders</button>
    <button class="btn block" id="rCal" style="margin-top:8px">📅 Add to my phone’s calendar</button>
    <p class="muted" style="font-size:12px">The calendar option works even when Forge is closed. Your calendar app does the alerting.</p>`, (b) => {
    $('#rPerm', b).textContent = permText();
    $('#rDays', b).onclick = (e) => { const x = e.target.closest('[data-d]'); if (!x) return; const d = +x.dataset.d; r.days = r.days.includes(d) ? r.days.filter((y) => y !== d) : [...r.days, d]; x.classList.toggle('on'); };
    const read = () => { r.time = $('#rTime', b).value || '17:30'; r.foodTime = $('#rFood', b).value || ''; };
    $('#rSave', b).onclick = async () => {
      read(); state.reminders = r; save();
      if ((r.days.length || r.foodTime) && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
      closeSheet(); toast(r.days.length || r.foodTime ? '🔔 Reminders saved' : 'Reminders off');
    };
    $('#rCal', b).onclick = () => {
      read(); state.reminders = r; save();
      if (!r.days.length && !r.foodTime) return toast('Pick training days or a food time first');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([remindersIcs()], { type: 'text/calendar' })); a.download = 'forge-reminders.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast('Calendar file saved. Open it to add the reminders.');
    };
  });
}

/* ---------- profile / onboarding ---------- */
function profileSheet(first = false) {
  const p = state.profile || { name: '', sex: 'm', age: 28, height: 175, weight: latestWeight() || 75, activity: 1.55, goal: 'maintain', rate: 0.5 };
  const d = { ...p };
  openSheet(`<h2>${first ? 'Welcome to Forge 🔥' : 'Profile & targets'}</h2>
    ${first ? '<p class="muted" style="margin-top:-6px">A few quick details so we can set your calorie and macro targets.</p>' : ''}
    <div class="field"><label>Name</label><input id="pN" value="${esc(d.name)}" placeholder="Optional"></div>
    <div class="field"><label>Sex (for the BMR formula)</label><div class="seg" data-k="sex"><button data-v="m">Male</button><button data-v="f">Female</button></div></div>
    <div class="row"><div class="field"><label>Age</label><input id="pA" inputmode="numeric" value="${d.age}"></div><div class="field"><label>Height cm</label><input id="pH" inputmode="numeric" value="${d.height}"></div><div class="field"><label>Weight kg</label><input id="pW" inputmode="decimal" value="${d.weight}"></div></div>
    <div class="field"><label>Activity</label><select id="pAct">${ACTIVITY.map(([v, l]) => `<option value="${v}" ${v === d.activity ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Goal</label><div class="seg" data-k="goal"><button data-v="cut">Lose fat</button><button data-v="maintain">Maintain</button><button data-v="bulk">Build muscle</button></div></div>
    <div class="field" id="rateF"><label>Rate (kg per week)</label><div class="seg" data-k="rate"><button data-v="0.25">0.25</button><button data-v="0.5">0.5</button><button data-v="0.75">0.75</button></div></div>
    <div class="field"><label>Rest timer</label><div class="seg" data-k="rest"><button data-v="60">1:00</button><button data-v="90">1:30</button><button data-v="120">2:00</button><button data-v="180">3:00</button></div></div>
    <div class="field"><label>Suggest a deload week after</label><div class="seg" data-k="deload"><button data-v="0">Never</button><button data-v="4">4 wks</button><button data-v="6">6 wks</button><button data-v="8">8 wks</button></div></div>
    <section class="card" id="pPrev" style="margin:4px 0 14px"></section>
    <button class="btn primary block" id="pGo">${first ? 'Let’s go' : 'Save'}</button>
    ${first ? '' : `<div class="row" style="margin-top:8px"><button class="btn" id="pBk">☁️ Backup</button><button class="btn" id="pRem">🔔 Reminders</button></div>
      <button class="btn block" id="pDeload" style="margin-top:8px">${deloadActive() ? '🧘 End deload week' : '🧘 Start a deload week now'}</button>
      <button class="btn danger block" id="pReset" style="margin-top:8px;background:none;border-color:transparent">Erase all data</button>`}`, (b) => {
    const segs = { sex: d.sex, goal: d.goal, rate: String(d.rate), rest: String(state.settings.restSec), deload: String(state.settings.deloadEvery) };
    const bk = $('#pBk', b); if (bk) bk.onclick = backupSheet;
    const rem = $('#pRem', b); if (rem) rem.onclick = remindersSheet;
    const dl = $('#pDeload', b);
    if (dl) dl.onclick = () => {
      if (deloadActive()) { state.settings.deloadUntil = 0; state.settings.deloadDismissed = Date.now(); toast('Deload ended'); }
      else { state.settings.deloadUntil = Date.now() + 7 * 864e5; toast('🧘 Deload week started'); }
      save(); closeSheet(); render(false);
    };
    const read = () => ({ name: $('#pN', b).value.trim(), sex: segs.sex, age: num($('#pA', b).value), height: num($('#pH', b).value), weight: num($('#pW', b).value), activity: num($('#pAct', b).value), goal: segs.goal, rate: num(segs.rate) });
    const preview = () => {
      $$('.seg', b).forEach((s) => $$('button', s).forEach((x) => x.classList.toggle('on', x.dataset.v === segs[s.dataset.k])));
      $('#rateF', b).hidden = segs.goal === 'maintain';
      const saved = state.profile, savedW = state.weights; state.profile = read(); state.weights = [];
      const t = targets(); state.profile = saved; state.weights = savedW;
      $('#pPrev', b).innerHTML = `<div class="summary-stats" style="margin:0"><div><b style="color:var(--kcal)">${kfmt(t.kcal)}</b><span>kcal / day</span></div><div><b style="color:var(--protein)">${t.p}g</b><span>protein</span></div><div><b>${t.c}g / ${t.f}g</b><span>carbs / fat</span></div></div>`;
    };
    b.addEventListener('click', (e) => { const x = e.target.closest('.seg button'); if (!x) return; segs[x.closest('.seg').dataset.k] = x.dataset.v; preview(); });
    b.addEventListener('input', preview);
    $('#pGo', b).onclick = () => {
      const np = read();
      if (!(np.age >= 13 && np.age <= 100 && np.height >= 120 && np.height <= 230 && np.weight >= 30 && np.weight <= 300)) return toast('Check age, height and weight');
      state.profile = np; state.settings.restSec = +segs.rest; state.settings.deloadEvery = +segs.deload;
      if (!state.weights.length || first) state.weights = state.weights.filter((x) => x.date !== dkey()).concat({ date: dkey(), kg: np.weight });
      save(); closeSheet(); render(); if (first) { confetti(120); toast('Targets set — welcome!'); } else toast('Saved');
    };
    const reset = $('#pReset', b);
    if (reset) reset.onclick = () => {
      if (!confirm(`Erase ALL workouts, food logs and settings on this device? This cannot be undone.${sync.token ? '\n\nCloud backup will be turned off here first, so your cloud copy stays safe.' : ''}`)) return;
      // Disconnect sync first so an empty state never overwrites the cloud copy.
      sync = { token: '', gistId: '', lastSyncedAt: 0, lastOkAt: 0, error: '' }; saveSync();
      state = blank(); save(); closeSheet(); setTimeout(() => profileSheet(true), 300); render();
    };
    preview();
  });
}
$('#profileBtn').onclick = () => profileSheet(false);

/* ---------- boot ---------- */
$('#todayLabel').textContent = fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
moveIndicator();
render();
if (!state.profile) setTimeout(() => profileSheet(true), 400);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
}
// Ask the browser not to evict our storage under pressure (Android/Chrome honour this).
try { navigator.storage?.persist?.(); } catch { /* ignore */ }
if (sync.token) setTimeout(syncNow, 800);
setTimeout(checkReminders, 2000);
