// Editable effort splits. A plan starts from one flat, ideal-conditions effort pace (the goal, or in
// evaluate mode the solved equivalent). An edit sets a different effort speed for one distance range
// [d0, d1] (a mile, km or hill segment). Each 100 m stretch inside it is run through the models again
// at the new effort, and its time changes by the ratio of old to new adjusted speed. The ±200 m pace
// smoothing keeps its shape and nothing outside the range moves, so the finish changes by exactly the
// change to that split. Edits are effort speeds (m/s), so they hold when factors are switched on or
// off. A new edit replaces any edit it overlaps (only possible after switching mile / km / hill splits).
import { timeAt } from './splits.js';
import { adjustSpeed } from './adjust.js';

const EPS = 0.5; // m

// v = null removes the edit for [d0, d1]
export function addEdit(edits, d0, d1, v) {
  const rest = edits.filter(e => e.d1 <= d0 + EPS || e.d0 >= d1 - EPS);
  return v == null ? rest : [...rest, { d0, d1, v }].sort((a, b) => a.d0 - b.d0);
}

export const findEdit = (edits, d0, d1) =>
  edits.find(e => Math.abs(e.d0 - d0) < EPS && Math.abs(e.d1 - d1) < EPS) ?? null;

// The run with its time per metre multiplied by factor(i, edit) where window i overlaps an edit.
// Returns the same shape plus timeAt(d), the exact elapsed time at any distance (split boundaries can
// fall inside a 100 m window, so cum alone can't represent an edit exactly).
function withFactors(windows, run, edits, factor) {
  const base = d => timeAt(windows, run.cum, d);
  if (!edits.length) return { ...run, timeAt: base };
  const pieces = []; // [a, b] with x extra seconds per metre
  for (const e of edits) {
    windows.forEach((w, i) => {
      const a = Math.max(w.d0, e.d0), b = Math.min(w.d1, e.d1);
      if (b > a) pieces.push({ a, b, x: (factor(i, e) - 1) / run.speeds[i] });
    });
  }
  pieces.sort((p, q) => p.a - q.a);
  const at = d => {
    let t = base(d);
    for (const p of pieces) {
      if (d <= p.a) break;
      t += (Math.min(d, p.b) - p.a) * p.x;
    }
    return t;
  };
  const cum = [0, ...windows.map(w => at(w.d1))];
  const times = windows.map((_, i) => cum[i + 1] - cum[i]);
  const speeds = windows.map((w, i) => w.length / times[i]);
  return { ...run, timeAt: at, cum, times, speeds, total: cum[cum.length - 1] };
}

// Effort profile: the flat, ideal-conditions run (runs.base) with the edited effort speeds
export const effortRun = (windows, base, edits) =>
  withFactors(windows, base, edits, (i, e) => base.speeds[i] / e.v);

// Course plan: the adjusted run (runs.total) with each edited stretch re-run at its new effort
export const adjustedRun = (windows, run, edits, on) =>
  withFactors(windows, run, edits, (i, e) => run.rawSpeeds[i] / adjustSpeed(windows[i], e.v, on));
