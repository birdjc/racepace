import { parseGpx } from './lib/gpx.js';
import { withDistance } from './lib/geo.js';
import { buildCourse } from './lib/course.js';
import { getRaceWeather, localToMs } from './lib/weather.js';
import { smoothElevation } from './lib/profile.js';
import { buildWindows, hillSegments, WINDOW_M } from './lib/segments.js';
import { attachWeather, computeAll, pacingOpportunity, headwindComponent, WIND_ALPHA, RUNNER_KG, DOWNHILL_CAP_GRADE, PACE_SMOOTH_M } from './lib/adjust.js';
import { makeSplits, splitBoundaries, splitPace, splitPaceDelta, timeAt } from './lib/splits.js';
import { parseDuration } from './lib/pace.js';
import { reverseGeocode } from './lib/geocode.js';
import {
  $, esc, unitM, eleUnit, eleScale, deltaClass, formatDuration, formatDelta, formatPaceSec, compass,
  load, save, currentTheme, onThemeChange, toggleTheme, divergingColor, divergingPalette,
  showTooltip, hideTooltip, ttRow
} from './ui/util.js';
import { CourseMap, BASEMAP_PROVIDER } from './ui/map.js';
import { ProfileChart } from './ui/profile.js';
import { SplitChart, renderSplitTable, downloadCsv } from './ui/splits.js';

const LAYER_NAMES = { total: 'Total', grade: 'Elevation', wind: 'Wind', heat: 'Heat & humidity' };

// ---------------------------------------------------------------- state
const input = { gpxText: null, fileName: null, preview: null, nameAuto: true };
let units = load('units', 'mi') === 'km' ? 'km' : 'mi';
let S = null;          // results state
let map = null, profile = null, splitChart = null;

// ---------------------------------------------------------------- top bar
function syncUnitsButtons() {
  $('units').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === units)));
}
function setUnits(u, { fromSplitMode = false } = {}) {
  if (u === units) return;
  units = u;
  save('units', u);
  syncUnitsButtons();
  updateInputHints();
  if (S) {
    if (!fromSplitMode && S.splitMode !== 'hill') { S.splitMode = u; S.selected = null; syncSeg('split-mode', 'm', u, 'aria-checked'); }
    renderResults();
  }
}
$('units').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setUnits(b.dataset.u); });
syncUnitsButtons();

function syncThemeButton() {
  const dark = currentTheme() === 'dark';
  $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
$('theme-toggle').addEventListener('click', toggleTheme);
onThemeChange(() => {
  syncThemeButton();
  if (S && map) { map.setTheme(currentTheme()); drawMapRoute(); applyHighlightState(); }
});
syncThemeButton();

// ---------------------------------------------------------------- input view
const dz = $('dropzone');
$('gpx-file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('gpx-file').click(); } });
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
$('demo-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('./demo/demo-course.gpx');
    if (!res.ok) throw new Error('Could not load the demo course.');
    setGpx(await res.text(), 'demo-course.gpx');
    if (!$('race-name-input').value) { $('race-name-input').value = 'Demo course'; input.nameAuto = true; }
  } catch (ex) { showFormError(ex.message); }
});

async function loadFile(file) {
  setGpx(await file.text(), file.name);
}

function setGpx(text, fileName) {
  hideFormError();
  let gpx;
  try {
    gpx = parseGpx(text);
  } catch (ex) {
    showFormError(`${fileName}: ${ex.message}`);
    return;
  }
  const pts = withDistance(gpx.points);
  input.gpxText = text;
  input.fileName = fileName;
  input.preview = { distance: pts[pts.length - 1].d, points: gpx.points.length, eleCoverage: gpx.eleCoverage, name: gpx.name };
  const nameField = $('race-name-input');
  if (gpx.name && (input.nameAuto || !nameField.value)) { nameField.value = gpx.name; input.nameAuto = true; }
  dz.querySelector('.dz-empty').hidden = true;
  dz.querySelector('.dz-loaded').hidden = false;
  $('dz-filename').textContent = fileName;
  drawSpark(pts, gpx.eleCoverage);
  updateInputHints();
}
$('race-name-input').addEventListener('input', () => { input.nameAuto = false; });

function drawSpark(pts, coverage) {
  const svg = $('dz-spark');
  if (coverage < 0.9) { svg.innerHTML = ''; svg.hidden = true; return; }
  svg.hidden = false;
  const step = Math.max(1, Math.floor(pts.length / 300));
  const s = pts.filter((p, i) => i % step === 0 && Number.isFinite(p.ele));
  const lo = Math.min(...s.map(p => p.ele)), hi = Math.max(...s.map(p => p.ele));
  const total = pts[pts.length - 1].d, span = Math.max(hi - lo, 10);
  const xy = p => `${(p.d / total * 300).toFixed(1)},${(46 - (p.ele - lo) / span * 42).toFixed(1)}`;
  const line = s.map((p, i) => `${i ? 'L' : 'M'}${xy(p)}`).join('');
  svg.innerHTML = `<path class="area" d="${line}L300,48L0,48Z"/><path class="line" d="${line}"/>`;
}

function updateInputHints() {
  const p = input.preview;
  if (p) {
    const dist = `${(p.distance / unitM(units)).toFixed(2)} ${units}`;
    const ele = p.eleCoverage >= 0.9 ? 'elevation from file' : 'no elevation in file, so it will be looked up';
    $('dz-stats').textContent = `${dist} · ${p.points.toLocaleString()} points · ${ele}`;
  }
  const goal = parseDuration($('goal-time').value);
  const hint = $('goal-hint');
  if (goal > 0 && p) {
    hint.textContent = `Average ${formatPaceSec(goal / p.distance * unitM(units), units)} on flat ground in ideal weather.`;
    hint.classList.add('ok');
  } else {
    hint.textContent = isTouch()
      ? 'The time you\'d run on a flat course in ideal weather.'
      : 'h:mm:ss, the time you\'d run on a flat course in ideal weather.';
    hint.classList.remove('ok');
  }
}
$('goal-time').addEventListener('input', () => { $('goal-time').removeAttribute('aria-invalid'); updateInputHints(); });
$('goal-time').addEventListener('blur', () => {
  const v = $('goal-time').value.trim();
  if (v && !(parseDuration(v) > 0)) $('goal-time').setAttribute('aria-invalid', 'true');
});

// ---------- touch devices (phones/tablets) vs mouse devices ----------
// Touch: no file-type filter (iOS greys out .gpx files; contents are checked after choosing instead)
// and three number boxes for the goal time (phone number pads have no colon).
// Mouse: .gpx filter on the file picker and one h:mm:ss box.
const touchQuery = window.matchMedia('(pointer: coarse)');
const isTouch = () => touchQuery.matches;
const GOAL_PARTS = ['goal-h', 'goal-m', 'goal-s'];

function applyDeviceMode() {
  const touch = isTouch();
  if (touch) $('gpx-file').removeAttribute('accept');
  else $('gpx-file').setAttribute('accept', '.gpx,application/gpx+xml');
  $('goal-time').hidden = touch;
  $('goal-split').hidden = !touch;
  $('goal-label').htmlFor = touch ? 'goal-h' : 'goal-time';
  if (touch) setGoalParts($('goal-time').value);
  updateInputHints();
}

// Split boxes → the canonical h:mm:ss value in #goal-time
function syncGoalFromParts() {
  const [h, m, sec] = GOAL_PARTS.map(id => $(id).value.trim());
  $('goal-time').value = (h || m || sec)
    ? `${Number(h || 0)}:${String(Number(m || 0)).padStart(2, '0')}:${String(Number(sec || 0)).padStart(2, '0')}`
    : '';
}
function setGoalParts(value) {
  const sec = parseDuration(value);
  if (!(sec > 0)) { GOAL_PARTS.forEach(id => { $(id).value = ''; }); return; }
  $('goal-h').value = String(Math.floor(sec / 3600));
  $('goal-m').value = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  $('goal-s').value = String(Math.round(sec % 60)).padStart(2, '0');
}
// Minutes and seconds must be 0–59; returns false (and marks the box) if not
function goalPartsValid() {
  let ok = true;
  for (const id of ['goal-m', 'goal-s']) {
    const v = $(id).value.trim();
    const bad = v !== '' && Number(v) > 59;
    if (bad) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
    if (bad) ok = false;
  }
  return ok;
}
GOAL_PARTS.forEach((id, i) => {
  const el = $(id);
  el.addEventListener('input', () => {
    el.value = el.value.replace(/\D/g, '').slice(0, 2);   // digits only
    el.removeAttribute('aria-invalid');
    syncGoalFromParts();
    $('goal-time').removeAttribute('aria-invalid');
    updateInputHints();
    // Move on once a box is full
    if (el.value.length === 2 && i < GOAL_PARTS.length - 1) $(GOAL_PARTS[i + 1]).focus();
  });
  el.addEventListener('blur', goalPartsValid);
  el.addEventListener('focus', () => el.select());
});
touchQuery.addEventListener('change', applyDeviceMode);

// Restore last-used inputs (convenience only)
(function restoreInputs() {
  const last = load('inputs', {}) || {};
  if (last.date) $('race-date').value = last.date;
  if (last.time) $('start-time').value = last.time;
  if (last.goal) $('goal-time').value = last.goal;
  applyDeviceMode();
})();

function showFormError(msg) { const el = $('form-error'); el.textContent = msg; el.hidden = false; }
function hideFormError() { $('form-error').hidden = true; }

function setProgress(step) {
  const steps = ['course', 'elevation', 'weather', 'model'];
  const idx = steps.indexOf(step);
  $('progress').querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('done', i < idx);
    li.classList.toggle('active', i === idx);
  });
}

$('input-form').addEventListener('submit', async e => {
  e.preventDefault();
  hideFormError();
  const date = $('race-date').value, time = $('start-time').value;
  const goalSec = parseDuration($('goal-time').value);
  const problems = [];
  if (!input.gpxText) problems.push('add a GPX course');
  if (!date) problems.push('choose a race date');
  if (!time) problems.push('choose a start time');
  const partsOk = !isTouch() || goalPartsValid();
  if (!partsOk) problems.push('keep minutes and seconds between 0 and 59');
  else if (!(goalSec > 0)) {
    problems.push(isTouch() ? 'enter an expected finish time (hours, minutes, seconds)' : 'enter an expected finish time like 3:15:00');
    $('goal-time').setAttribute('aria-invalid', 'true');
    if (isTouch()) GOAL_PARTS.forEach(id => $(id).setAttribute('aria-invalid', 'true'));
  }
  if (problems.length) { showFormError(`Please ${problems.join(', ')}.`); return; }
  save('inputs', { date, time, goal: $('goal-time').value });

  const btn = $('submit');
  btn.disabled = true;
  $('progress').hidden = false;
  try {
    setProgress('course');
    await new Promise(r => setTimeout(r, 0));
    setProgress('elevation');
    const course = await buildCourse(input.gpxText);
    const prof = smoothElevation(course);
    const baseWindows = buildWindows(course.points, prof.ele);
    const hills = hillSegments(baseWindows);
    const startLocal = `${date}T${time}`;
    const v0 = course.distance / goalSec;
    setProgress('weather');
    const [weather, place] = await Promise.all([
      getRaceWeather({ lat: course.centroid.lat, lon: course.centroid.lon, startLocal, durationSec: goalSec }),
      reverseGeocode(course.points[0].lat, course.points[0].lon).catch(() => null)
    ]);
    setProgress('model');
    const windows = attachWeather(baseWindows, v0, weather.hours, startLocal);
    let gain = 0, loss = 0;
    windows.forEach(w => { const dz = w.ele1 - w.ele0; if (dz > 0) gain += dz; else loss -= dz; });
    S = {
      course, prof, windows, hills, weather, place, startLocal, goalSec, v0, gain, loss,
      name: $('race-name-input').value.trim() || course.name || input.fileName.replace(/\.gpx$/i, ''),
      toggles: { grade: true, wind: true, heat: true },
      splitMode: units, layer: 'total', selected: null, hovered: null
    };
    S.result = computeAll(windows, v0, S.toggles);
    showResults();
  } catch (ex) {
    console.error(ex);
    showFormError(ex.message || 'Something went wrong while building the plan.');
  } finally {
    btn.disabled = false;
    $('progress').hidden = true;
  }
});

// ---------------------------------------------------------------- results view
function showResults() {
  $('input-view').hidden = true;
  $('results-view').hidden = false;
  window.scrollTo({ top: 0 });
  if (!map) initResultViews();
  syncSeg('layer', 'l', S.layer, 'aria-checked');
  syncSeg('split-mode', 'm', S.splitMode, 'aria-checked');
  document.querySelectorAll('.factor').forEach(b => b.setAttribute('aria-pressed', String(S.toggles[b.dataset.f])));
  map.setTheme(currentTheme());
  renderResults();
  requestAnimationFrame(() => { map.invalidate(); map.fit(false); });
}

$('back').addEventListener('click', () => {
  hideTooltip();
  $('results-view').hidden = true;
  $('input-view').hidden = false;
  document.title = 'Race Pace Adjuster';
  window.scrollTo({ top: 0 });
});

function initResultViews() {
  map = new CourseMap($('map'), { onHover: (d, ev) => focusAt(d, ev), onLeave: clearFocus });
  profile = new ProfileChart($('profile'), { onHover: (d, ev) => focusAt(d, ev), onLeave: clearFocus });
  splitChart = new SplitChart($('split-chart'), {
    onHover: (i, ev) => hoverSplit(i, ev, 'chart'),
    onLeave: () => hoverSplit(null),
    onSelect: i => selectSplit(i)
  });
  const tbl = $('split-table');
  tbl.addEventListener('pointerover', e => { const tr = e.target.closest('tr[data-i]'); if (tr) hoverSplit(Number(tr.dataset.i), e, 'table'); });
  tbl.addEventListener('pointerleave', () => hoverSplit(null));
  tbl.addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) selectSplit(Number(tr.dataset.i)); });
  tbl.addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectSplit(Number(tr.dataset.i)); }
  });
  tbl.addEventListener('focusin', e => { const tr = e.target.closest('tr[data-i]'); if (tr) hoverSplit(Number(tr.dataset.i), null, 'table'); });
  tbl.addEventListener('focusout', () => hoverSplit(null));
}

function syncSeg(id, attr, val, aria) {
  $(id).querySelectorAll('button').forEach(b => {
    const on = b.dataset[attr] === val;
    b.setAttribute(aria, String(on));
    b.tabIndex = on ? 0 : -1;
  });
}
function segRadio(id, attr, onPick) {
  const el = $(id);
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) onPick(b.dataset[attr]); });
  el.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const btns = [...el.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    onPick(next.dataset[attr]);
    next.focus();
    e.preventDefault();
  });
}
segRadio('layer', 'l', l => { if (!S) return; S.layer = l; syncSeg('layer', 'l', l, 'aria-checked'); renderLayer(); renderSplits(); });
segRadio('split-mode', 'm', m => {
  if (!S) return;
  S.splitMode = m;
  S.selected = null;
  S.hovered = null;
  syncSeg('split-mode', 'm', m, 'aria-checked');
  if (m !== 'hill' && m !== units) setUnits(m, { fromSplitMode: true });
  else { renderLayer(); renderSplits(); }
  map.fit();
});
document.querySelectorAll('.factor').forEach(b => b.addEventListener('click', () => {
  if (!S) return;
  const f = b.dataset.f;
  S.toggles[f] = !S.toggles[f];
  b.setAttribute('aria-pressed', String(S.toggles[f]));
  S.result = computeAll(S.windows, S.v0, S.toggles);
  renderResults();
}));
$('map-fit').addEventListener('click', () => { if (!S) return; S.selected = null; applyHighlightState(); map.fit(); });
$('map-expand').addEventListener('click', () => {
  const wrap = document.querySelector('.map-wrap');
  const tall = wrap.classList.toggle('tall');
  $('map-expand').setAttribute('aria-pressed', String(tall));
  $('map-expand').setAttribute('aria-label', tall ? 'Make the map shorter' : 'Make the map taller');
  setTimeout(() => { map.invalidate(); map.fit(); }, 280);
});
$('csv-btn').addEventListener('click', exportCsv);
window.addEventListener('scroll', hideTooltip, { passive: true });
// Touch: tapping anywhere outside the interactive views closes the tooltip and re-locks the map
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !S || !map) return;
  if (e.target.closest('#map')) return;
  if (!e.target.closest('#profile, #split-chart, #split-table')) clearFocus();
  map.lock();
}, { passive: true });

// ---------------------------------------------------------------- rendering
function renderResults() {
  renderHeader();
  renderSummary();
  renderLayer();
  renderSplits();
  renderWeather();
  renderMethod();
}

function deltasFor(layer) {
  const run = S.result.runs[layer], u = unitM(units);
  return S.windows.map((_, i) => u * (1 / run.speeds[i] - 1 / S.v0));
}

function renderHeader() {
  const { course, weather, place, startLocal, gain, loss } = S;
  $('race-title').textContent = S.name;
  const when = new Date(`${startLocal}:00`);
  const src = { forecast: 'Forecast weather', archive: 'Recorded weather', climatology: '3-year weather average' }[weather.source];
  const tz = (() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: weather.timezone, timeZoneName: 'short' })
        .formatToParts(new Date(localToMs(startLocal) + 12 * 3600000)).find(p => p.type === 'timeZoneName')?.value;
    } catch { return null; }
  })();
  const items = [
    when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    `${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ${tz ?? 'local'}`,
    place ?? `${course.centroid.lat.toFixed(3)}, ${course.centroid.lon.toFixed(3)}`,
    `${(course.distance / unitM(units)).toFixed(2)} ${units}`,
    `↑ ${Math.round(gain * eleScale(units))} ${eleUnit(units)}  ↓ ${Math.round(loss * eleScale(units))} ${eleUnit(units)}`,
    src
  ];
  $('race-meta').innerHTML = items.map(t => `<span>${esc(t)}</span>`).join('<span aria-hidden="true">·</span>');
  document.title = `${S.name} · Race Pace Adjuster`;
}

function renderSummary() {
  const { goalSec, course, result, toggles } = S;
  const u = unitM(units);
  const adj = result.runs.total.total, d = adj - goalSec;
  $('goal-time-out').textContent = formatDuration(goalSec, { forceHours: true });
  $('goal-pace-out').textContent = `${formatPaceSec(goalSec / course.distance * u, units)} average`;
  $('adj-time-out').textContent = formatDuration(adj, { forceHours: true });
  $('adj-pace-out').innerHTML = `${esc(formatPaceSec(adj / course.distance * u, units))} · <span class="delta ${deltaClass(d)}">${esc(formatDelta(d))}</span>`;

  for (const b of document.querySelectorAll('.factor')) {
    const f = b.dataset.f, sec = result.impact[f];
    const v = b.querySelector('.factor-val');
    v.textContent = formatDelta(sec);
    v.className = `factor-val ${toggles[f] ? deltaClass(sec) : ''}`;
    const per = sec / course.distance * u;
    b.querySelector('.factor-sub').textContent = `${per >= 0 ? '+' : '−'}${Math.abs(per).toFixed(1)} s/${units}${toggles[f] ? '' : ' · excluded'}`;
    b.setAttribute('aria-label', `${b.querySelector('.factor-name').textContent}: ${formatDelta(sec)}, ${toggles[f] ? 'included' : 'excluded'}. Click to ${toggles[f] ? 'exclude' : 'include'}.`);
  }
  const opp = pacingOpportunity(result.impact.total, goalSec);
  $('opp-mark').style.left = `${opp.score * 100}%`;
  const anyOn = toggles.grade || toggles.wind || toggles.heat;
  $('opp-label').textContent = anyOn ? opp.label : 'No adjustments';
  $('opp-gauge').setAttribute('aria-label', `Pacing opportunity: ${anyOn ? opp.label : 'no adjustments included'}`);
  $('opp-note').textContent = anyOn
    ? `The included conditions ${opp.pct >= 0 ? 'add' : 'take'} ${Math.abs(opp.pct).toFixed(1)}% ${opp.pct >= 0 ? 'to' : 'off'} your goal time.`
    : 'All adjustments are excluded, so the plan is your goal pace throughout.';
}

// Map colours, legend, profile and notes for the current layer
function renderLayer() {
  drawMapRoute();
  const deltas = deltasFor(S.layer);
  profile.set({
    windows: S.windows, deltas, eleScale: eleScale(units), eleUnit: eleUnit(units), unitM: unitM(units), unitLabel: units,
    bands: S.splitMode === 'hill' ? S.hills : null
  });
  const notes = {
    total: 'Bars show how each 100 m stretch of your plan differs from goal pace, with all included adjustments.',
    grade: `Bars show the effect of the grade alone. Descents steeper than ${Math.round(DOWNHILL_CAP_GRADE * 100)}% get no extra benefit.`,
    wind: (() => {
      const hw = S.windows.map(headwindComponent);
      const head = hw.filter(x => x > 0.3).length / hw.length, tail = hw.filter(x => x < -0.3).length / hw.length;
      return `Bars show the effect of wind alone: ${Math.round(head * 100)}% of the course is into a headwind and ${Math.round(tail * 100)}% has a tailwind.`;
    })(),
    heat: 'Bars show the effect of temperature and humidity alone, stepping hour by hour from the start.'
  };
  const excluded = S.layer !== 'total' && !S.toggles[S.layer] ? ` ${LAYER_NAMES[S.layer]} is currently excluded from your plan.` : '';
  $('profile-note').textContent = `${LAYER_NAMES[S.layer]} · hover, tap or use ← → to explore`;
  $('profile-sub').textContent = `${notes[S.layer]}${excluded}${S.splitMode === 'hill' ? ' Shaded bands mark the hill segments.' : ''}`;
  applyHighlightState();
}

function drawMapRoute() {
  const deltas = deltasFor(S.layer);
  // Map colours saturate at the 95th percentile so a few extreme stretches don't wash out the rest
  // (the profile chart below stays uncapped)
  const abs = deltas.map(Math.abs).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = abs[Math.floor(0.95 * (abs.length - 1))] ?? 0;
  const maxAbs = Math.max(3, p95);
  const clipped = abs[abs.length - 1] > maxAbs + 0.5;
  const pal = divergingPalette();
  map.setRoute(S.course, S.windows, deltas.map(v => divergingColor(v, maxAbs, pal)));
  map.setDistanceMarkers(unitM(units), units);
  const r = `${Math.round(maxAbs)}${clipped ? '+' : ''}`;
  $('map-legend').innerHTML = `<div><strong>${esc(LAYER_NAMES[S.layer])}</strong> · pace change, s/${units}</div>
    <div class="bar" style="background:linear-gradient(90deg, ${pal.fast}, ${pal.zero} 50%, ${pal.slow})"></div>
    <div class="ticks"><span>${r} faster</span><span>0</span><span>${r} slower</span></div>`;
}

// ---------------------------------------------------------------- splits
function splitRunRows(layer) {
  return makeSplits(S.windows, S.result.runs[layer], S.result.runs.base, splitBoundaries(S.splitMode, S.windows, S.hills));
}
function paceUnit() { return S.splitMode === 'hill' ? units : S.splitMode; }

function buildSplitRows() {
  const { course, windows, hills, splitMode, result, goalSec } = S;
  const pu = paceUnit(), u = unitM(pu);
  const rows = splitRunRows('total');
  const out = [];
  const half = course.distance / 2;
  let halfDone = splitMode === 'hill' || course.distance < 30000;
  rows.forEach((r, i) => {
    let label, sub = null, kind = null;
    if (splitMode === 'hill') {
      const h = hills[i];
      label = `${(h.d0 / unitM(units)).toFixed(1)}–${(h.d1 / unitM(units)).toFixed(1)} ${units}`;
      sub = `${h.label} ${h.grade >= 0 ? '+' : '−'}${Math.abs(h.grade * 100).toFixed(1)}% · ${(h.length / unitM(units)).toFixed(2)} ${units}`;
      kind = h.kind;
    } else {
      const x = r.d1 / u;
      label = `${Math.abs(x - Math.round(x)) < 1e-6 ? Math.round(x) : x.toFixed(2)} ${pu}`;
    }
    const pd = splitPaceDelta(r, pu);
    out.push({
      index: i, label, sub, kind, d0: r.d0, d1: r.d1,
      time: formatDuration(r.time), pace: formatDuration(splitPace(r, pu)), paceDelta: formatDelta(pd), paceDeltaSec: pd,
      cum: formatDuration(r.cum, { forceHours: true }), cumDelta: formatDelta(r.cumDelta), cumDeltaSec: r.cumDelta,
      raw: r
    });
    if (!halfDone && r.d1 >= half - 1) {
      halfDone = true;
      const th = timeAt(windows, result.runs.total.cum, half), bh = timeAt(windows, result.runs.base.cum, half);
      out.push({ summary: true, label: 'Half', time: '', pace: formatDuration(th / half * u), paceDelta: formatDelta((th - bh) / half * u), paceDeltaSec: (th - bh) / half * u, cum: formatDuration(th, { forceHours: true }), cumDelta: formatDelta(th - bh), cumDeltaSec: th - bh });
    }
  });
  const tot = result.runs.total.total, dt = tot - goalSec;
  out.push({ summary: true, label: 'Finish', time: '', pace: formatDuration(tot / course.distance * u), paceDelta: formatDelta(dt / course.distance * u), paceDeltaSec: dt / course.distance * u, cum: formatDuration(tot, { forceHours: true }), cumDelta: formatDelta(dt), cumDeltaSec: dt });
  return out;
}

function renderSplits() {
  S.rows = buildSplitRows();
  const splitRows = S.rows.filter(r => !r.summary);
  S.layerRows = splitRunRows(S.layer);
  splitChart.set({
    values: S.layerRows.map(r => r.delta),
    labels: S.splitMode === 'hill' ? splitRows.map((_, i) => String(i + 1)) : splitRows.map(r => r.label.split(' ')[0]),
    active: S.hovered ?? S.selected
  });
  const desc = S.splitMode === 'hill' ? `${S.hills.length} terrain-based segments` : `${S.splitMode === 'mi' ? 'Mile' : 'Kilometre'} splits`;
  $('splits-sub').textContent = `${desc}. Bars show time gained or lost per split (${LAYER_NAMES[S.layer].toLowerCase()}). Hover to see a split on the map and profile; click to zoom to it.`;
  renderSplitTable($('split-table'), S.rows, { firstHeader: S.splitMode === 'hill' ? 'Segment' : 'Distance', unit: paceUnit() });
  applyHighlightState();
}

function hoverSplit(i, ev, source) {
  if (!S) return;
  S.hovered = i;
  applyHighlightState();
  if (i === null || source !== 'chart' || !ev) { hideTooltip(); return; }
  const r = S.rows.find(x => x.index === i), lr = S.layerRows[i];
  const html = `<div class="tt-title">${esc(r.label)}</div>${r.sub ? `<div class="note">${esc(r.sub)}</div>` : ''}
    ${ttRow('Split', esc(r.time))}
    ${ttRow(`Pace /${paceUnit()}`, `${esc(r.pace)} (${esc(r.paceDelta)})`)}
    ${S.layer !== 'total' ? ttRow(`${LAYER_NAMES[S.layer]} alone`, esc(formatDelta(lr.delta))) : ttRow('vs goal', esc(formatDelta(r.raw.delta)))}
    ${ttRow('Elapsed', esc(r.cum))}`;
  showTooltip(html, ev.clientX, ev.clientY);
}

function selectSplit(i) {
  S.selected = S.selected === i ? null : i;
  applyHighlightState();
  if (S.selected !== null) {
    const r = S.rows.find(x => x.index === i);
    const rect = $('map').getBoundingClientRect();
    if (rect.bottom < 80 || rect.top > window.innerHeight - 80) document.querySelector('.course-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    map.zoomTo(r.d0, r.d1);
  } else {
    map.fit();
  }
}

// One place decides what is highlighted: hover wins, otherwise the selection
function applyHighlightState() {
  if (!S || !map) return;
  const i = S.hovered ?? S.selected;
  const r = i === null || i === undefined ? null : S.rows?.find(x => x.index === i);
  if (r) { map.highlight(r.d0, r.d1); profile.setRange(r.d0, r.d1); }
  else { map.clearHighlight(); profile.clearRange(); }
  $('split-table').querySelectorAll('tr[data-i]').forEach(tr => tr.classList.toggle('active', Number(tr.dataset.i) === i));
  if (splitChart.data && splitChart.data.active !== (i ?? null)) { splitChart.data.active = i ?? null; splitChart.render(); }
}

// ---------------------------------------------------------------- focus (map ↔ profile)
function windowAt(d) {
  const ws = S.windows;
  let lo = 0, hi = ws.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ws[m].d1 < d) lo = m + 1; else hi = m; }
  return lo;
}

function focusAt(d, ev) {
  if (!S) return;
  map.focus(d);
  profile.setFocus(d);
  const k = windowAt(d), w = S.windows[k], u = unitM(units);
  const t = (d - w.d0) / w.length;
  const ele = (w.ele0 + (w.ele1 - w.ele0) * t) * eleScale(units);
  const plan = S.result.runs.total;
  const planDelta = u * (1 / plan.speeds[k] - 1 / S.v0);
  // Per-factor effects for this stretch alone (before the ±200 m plan smoothing)
  const raw = run => u * (1 / S.result.runs[run].rawSpeeds[k] - 1 / S.v0);
  const ang = ((w.windAngle + 180) % 360) - 180;
  const windDesc = w.wx.windMs < 0.5 ? 'calm' : Math.abs(ang) <= 45 ? 'headwind' : Math.abs(ang) >= 135 ? 'tailwind' : 'crosswind';
  const windSpd = units === 'mi' ? `${(w.wx.windMs * 2.23694).toFixed(0)} mph` : `${(w.wx.windMs * 3.6).toFixed(0)} km/h`;
  const temp = units === 'mi' ? `${Math.round(w.wx.tempC * 9 / 5 + 32)}°F` : `${Math.round(w.wx.tempC)}°C`;
  const elapsed = timeAt(S.windows, plan.cum, d);
  const f = run => `<span class="${S.toggles[run] ? deltaClass(raw(run)) : ''}">${formatDelta(raw(run))}</span>${S.toggles[run] ? '' : ' · off'}`;
  const html = `<div class="tt-title">${(d / u).toFixed(2)} ${units} · ${formatDuration(elapsed, { forceHours: true })} elapsed</div>
    ${ttRow('Plan pace', `${formatPaceSec(u / plan.speeds[k], units)} <span class="${deltaClass(planDelta)}">(${formatDelta(planDelta)})</span>`)}
    <div class="tt-sep">This 100 m stretch</div>
    ${ttRow('Elevation', `${Math.round(ele)} ${eleUnit(units)} · ${w.grade >= 0 ? '+' : '−'}${Math.abs(w.grade * 100).toFixed(1)}%`)}
    ${ttRow('Weather', `${temp} · ${Math.round(w.wx.rh)}% RH`)}
    ${ttRow('Wind', `${windSpd}${windDesc === 'calm' ? ' · calm' : ` ${windDesc}`}`)}
    ${ttRow('Grade effect', f('grade'))}
    ${ttRow('Wind effect', f('wind'))}
    ${ttRow('Heat effect', f('heat'))}
    <div class="tt-foot">Plan pace is smoothed over ±${PACE_SMOOTH_M} m</div>`;
  if (ev) showTooltip(html, ev.clientX, ev.clientY);
}
function clearFocus() {
  hideTooltip();
  map?.clearFocus();
  profile?.clearFocus();
}

// ---------------------------------------------------------------- weather strip
function renderWeather() {
  const w = S.weather;
  const labels = {
    forecast: 'Forecast from Open-Meteo',
    archive: 'Recorded conditions for the race date (Open-Meteo, ERA5 reanalysis)',
    climatology: `No forecast yet, so this is the average of ${w.years?.join(', ')} for the same date and hours`
  };
  $('wx-source').textContent = `${labels[w.source]}. Times in ${w.timezone}; highlighted hours are during your race.`;
  const t0 = localToMs(S.startLocal), t1 = t0 + S.result.runs.total.total * 1000;
  $('wx-strip').innerHTML = w.hours.map(h => {
    const t = localToMs(h.time);
    const inRace = t + 3600000 > t0 && t < t1;
    const temp = units === 'mi' ? `${Math.round(h.tempC * 9 / 5 + 32)}°F` : `${Math.round(h.tempC)}°C`;
    const spd = units === 'mi' ? `${(h.windMs * 2.23694).toFixed(0)} mph` : `${(h.windMs * 3.6).toFixed(0)} km/h`;
    const hour = new Date(t).getUTCHours();
    const label = `${((hour + 11) % 12) + 1} ${hour < 12 ? 'AM' : 'PM'}`;
    const tag = t <= t0 && t0 < t + 3600000 ? 'Start' : t <= t1 && t1 < t + 3600000 ? 'Finish' : '';
    // Arrow points the way the wind blows (from + 180°)
    return `<div class="wx-hour${inRace ? ' in-race' : ''}" title="Wind from ${compass(h.windFromDeg)} (${Math.round(h.windFromDeg)}°)">
      <span class="wx-time">${label}</span>
      <span class="wx-temp">${temp}</span>
      <span class="wx-rh">${Math.round(h.rh)}% RH</span>
      <svg class="wx-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="transform: rotate(${(h.windFromDeg + 180) % 360}deg)"><path d="M12 20V5m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="wx-wind">${spd} ${compass(h.windFromDeg)}</span>
      <span class="wx-tag">${tag || '&nbsp;'}</span>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- method & notes
function renderMethod() {
  const { course, prof, windows, hills, result } = S;
  const eleSrc = course.elevationSource === 'gpx'
    ? `from the GPX file (${Math.round(course.gpxEleCoverage * 100)}% of points)`
    : 'from AWS Terrain Tiles (USGS 3DEP ~10 m in the US, ~30 m elsewhere), because the GPX has no elevation';
  $('method').innerHTML = `
    <p><b>Course.</b> Resampled every ${course.spacing.toFixed(0)} m. Elevation came ${eleSrc}.
      A spike filter replaced ${prof.spikesReplaced} points, then a Savitzky–Golay filter (${prof.windowM} m window) smoothed the profile${prof.windowM > 150 ? '. The wider window was used because the GPX elevation looked noisy' : ''}.</p>
    <p><b>Segments.</b> Paces are calculated on ${windows.length} stretches of about ${WINDOW_M} m, each with its own grade and heading.
      For the hill-segment view these are grouped into ${hills.length} segments, with hills found relative to this course's own terrain.</p>
    <p><b>Adjustments</b> are applied in the order grade → wind → heat, each keeping the effort of your goal pace on flat ground in calm, cool air.
      Grade uses Minetti (2002) and the Black et al. (2018) running-cost data, with descents steeper than ${Math.round(DOWNHILL_CAP_GRADE * 100)}% given no extra benefit.
      Wind uses an aerodynamic drag model, with wind measured at 10 m and scaled to chest height (α = ${WIND_ALPHA}), for a ${RUNNER_KG} kg runner.
      Heat uses a temperature and humidity model fit to marathon results (Mantzios et al. 2022); applying it hour by hour is an approximation.
      Each hour's weather is assigned using elapsed time at your goal pace. The pace plan is then smoothed over ±${PACE_SMOOTH_M} m, which leaves the finish time unchanged.</p>
    <p><b>Credits.</b> Models adapted from John J. Davis's <a href="https://apps.runningwritings.com/" target="_blank" rel="noopener">Running Writings</a> calculators (MIT license).
      Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Map tiles © OpenStreetMap contributors${BASEMAP_PROVIDER === 'carto' ? ', © CARTO' : ''}. Elevation: Mapzen / AWS Terrain Tiles. Place names: Nominatim.</p>`;
  $('warnings').innerHTML = result.warnings.map(w => `<li>${esc(w)}</li>`).join('');
  $('warnings').hidden = !result.warnings.length;
}

// ---------------------------------------------------------------- CSV
function exportCsv() {
  if (!S) return;
  const pu = paceUnit();
  const header = [S.splitMode === 'hill' ? 'Segment' : 'Distance', 'Detail', `From (${units})`, `To (${units})`, 'Split time', `Pace /${pu}`, 'Pace vs goal', 'Elapsed', 'Elapsed vs goal'];
  const ascii = s => (s ?? '').replace(/−/g, '-').replace(/–/g, '-');
  const rows = S.rows.map(r => [
    ascii(r.label), ascii(r.sub), r.summary ? '' : (r.d0 / unitM(units)).toFixed(2), r.summary ? '' : (r.d1 / unitM(units)).toFixed(2),
    r.time, r.pace, ascii(r.paceDelta), r.cum, ascii(r.cumDelta)
  ]);
  const safe = S.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'race';
  downloadCsv(`${safe}-${S.splitMode}-splits.csv`, header, rows);
}

// Read-only hook for debugging in the console
window.__rpa = { get state() { return S; }, get map() { return map; } };
