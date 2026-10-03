// Applies the grade, wind and heat adjustments to the 100 m calculation windows.
// Order is fixed (GAP → wind → heat) and each factor can be switched off. All three use the
// "effort" direction: goal flat, calm, cool speed -> expected speed under course conditions.
import { hillSpeedFromFlatEffort } from '../../formulas/gap.js';
import { speedInWindFromEffort } from '../../formulas/wind.js';
import { heatAdjustedSpeedFromEffort } from '../../formulas/heat.js';
import { weatherForElapsed } from './weather.js';

export const WIND_ALPHA = 0.3;
export const RUNNER_KG = 68;
export const MAX_ABS_GRADE = 0.45; // Minetti polynomial fit range (uphill cap)
// Downhill benefit cap (decided 2026-10-01): descents steeper than −8% get no more benefit than −8%.
// Minetti measured metabolic cost only; braking, footing and leg speed stop runners from using the
// full theoretical benefit of steep descents. −8% is where the original GAP app starts warning.
export const DOWNHILL_CAP_GRADE = -0.08;
// Pace-plan smoothing (decided 2026-10-01): each stretch's seconds-per-metre is averaged with its
// neighbours within ±200 m (length-weighted), then rescaled so the finish time is unchanged.
// Effort and heart rate lag terrain by 30–60 s, so runners don't switch pace every 100 m.
export const PACE_SMOOTH_M = 200;

// Weather profile: each window gets the conditions of the hour block it falls in, using elapsed
// time at a steady average speed at the window midpoint (plan mode: the goal pace; evaluate mode:
// the actual finish time's pace). Adds the wind angle relative to the runner (0° = headwind).
export function attachWeather(windows, baseSpeed, hours, startLocal) {
  return windows.map(w => {
    const elapsed = ((w.d0 + w.d1) / 2) / baseSpeed;
    const wx = weatherForElapsed(hours, startLocal, elapsed);
    return { ...w, wx, windAngle: ((wx.windFromDeg - w.heading) % 360 + 360) % 360 };
  });
}

// Headwind component (m/s, positive = headwind) at 10 m, for display
export const headwindComponent = w => w.wx.windMs * Math.cos(w.windAngle * Math.PI / 180);

function adjustOne(w, baseSpeed, on, warn) {
  let v = baseSpeed;
  if (on.grade) {
    const g = Math.max(DOWNHILL_CAP_GRADE, Math.min(MAX_ABS_GRADE, w.grade));
    if (w.grade > MAX_ABS_GRADE) warn.add('Some uphill grades are steeper than 45%, so they were capped for the grade model.');
    const v2 = hillSpeedFromFlatEffort(v, g);
    if (Number.isFinite(v2) && v2 > 0) v = v2;
    else warn.add('The grade model could not solve some very steep stretches; those were left unadjusted.');
  }
  if (on.wind) {
    const v2 = speedInWindFromEffort(v, w.wx.windMs, w.windAngle, { weightKg: RUNNER_KG, alpha: WIND_ALPHA });
    if (Number.isFinite(v2) && v2 > 0) v = v2;
    else warn.add('The wind model could not solve some stretches; those were left unadjusted.');
  }
  if (on.heat) {
    v = heatAdjustedSpeedFromEffort(v, w.wx.tempC, w.wx.rh);
  }
  return v;
}

// Length-weighted moving average of seconds-per-metre over ±radiusM, rescaled so the total time
// is preserved exactly. Returns new speeds.
export function smoothPacePlan(windows, speeds, radiusM = PACE_SMOOTH_M) {
  if (radiusM <= 0 || windows.length < 2) return speeds.slice();
  const n = windows.length;
  const spm = speeds.map(v => 1 / v);
  const mid = windows.map(w => (w.d0 + w.d1) / 2);
  const out = new Array(n);
  let lo = 0, hi = 0, num = 0, den = 0; // sliding window over [lo, hi)
  for (let i = 0; i < n; i++) {
    while (hi < n && mid[hi] <= mid[i] + radiusM) { num += spm[hi] * windows[hi].length; den += windows[hi].length; hi++; }
    while (mid[lo] < mid[i] - radiusM) { num -= spm[lo] * windows[lo].length; den -= windows[lo].length; lo++; }
    out[i] = num / den;
  }
  const before = windows.reduce((s, w, i) => s + w.length * spm[i], 0);
  const after = windows.reduce((s, w, i) => s + w.length * out[i], 0);
  return out.map(x => 1 / (x * before / after));
}

// One pass over all windows. on = {grade, wind, heat}
export function runModel(windows, baseSpeed, on, { smoothM = PACE_SMOOTH_M } = {}) {
  const warn = new Set();
  const rawSpeeds = windows.map(w => adjustOne(w, baseSpeed, on, warn));
  const speeds = smoothPacePlan(windows, rawSpeeds, smoothM);
  const times = windows.map((w, i) => w.length / speeds[i]);
  const cum = [0];
  times.forEach(t => cum.push(cum[cum.length - 1] + t));
  return { on, rawSpeeds, speeds, times, cum, total: cum[cum.length - 1], warnings: [...warn] };
}

// Everything the UI needs: base, the combined run (per toggles) and each factor alone
export function computeAll(windows, baseSpeed, toggles) {
  const none = { grade: false, wind: false, heat: false };
  const runs = {
    base: runModel(windows, baseSpeed, none),
    total: runModel(windows, baseSpeed, toggles),
    grade: runModel(windows, baseSpeed, { ...none, grade: true }),
    wind: runModel(windows, baseSpeed, { ...none, wind: true }),
    heat: runModel(windows, baseSpeed, { ...none, heat: true })
  };
  const impact = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.total - runs.base.total]));
  const warnings = [...runs.total.warnings];
  if (toggles.grade) warnings.push(...steepGradeNotes(windows));
  return { runs, impact, warnings };
}

// Evaluate mode: the flat, ideal-conditions speed whose adjusted course time equals targetSec.
// Course time falls monotonically as the flat speed rises, and is close to proportional to 1/speed,
// so scaling the guess by (model time / target) converges in a few rounds.
export function solveFlatSpeed(windows, targetSec, on, { tolSec = 0.01, maxIter = 40 } = {}) {
  const distance = windows[windows.length - 1].d1;
  let v = distance / targetSec;          // first guess: the actual average speed
  for (let i = 0; i < maxIter; i++) {
    const t = runModel(windows, v, on).total;
    if (!Number.isFinite(t)) throw new Error('Could not convert this time: it is outside the range the models cover.');
    if (Math.abs(t - targetSec) < tolSec) return v;
    v *= t / targetSec;
  }
  return v;
}

// Same thresholds as the original GAP calculator's info notes
export const STEEP_DOWN = -0.08;
export const STEEP_UP = 0.25;
export function steepGradeNotes(windows) {
  const len = pred => windows.filter(pred).reduce((s, w) => s + w.length, 0);
  const down = len(w => w.grade < STEEP_DOWN), up = len(w => w.grade > STEEP_UP);
  const notes = [];
  if (down > 0) notes.push(`${(down / 1000).toFixed(1)} km is steeper than −8% downhill. Those stretches are paced as if they were −8%, because runners can't use the full theoretical benefit of steeper descents.`);
  if (up > 0) notes.push(`${(up / 1000).toFixed(1)} km is steeper than +25% uphill. Walking may be more efficient than running there, and the model assumes running.`);
  return notes;
}

// Pacing Opportunity: where the combined impact sits on a Challenging ↔ Favorable scale.
//   −2% of goal time (net help) → 1.0 (fully favorable)
//   +2% → 0.5 (moderate)
//   +6% or worse → 0.0 (challenging)
export function pacingOpportunity(impactSec, baseSec) {
  const pct = impactSec / baseSec * 100;
  const score = Math.max(0, Math.min(1, 1 - (pct + 2) / 8));
  const label = pct < 1 ? 'Favorable' : pct < 3.5 ? 'Moderate' : 'Challenging';
  return { pct, score, label };
}
