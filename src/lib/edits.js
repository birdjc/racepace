// Editable target splits. An edit fixes the time for one distance range [d0, d1]. Inside it, time is
// spread in proportion to the model's pacing there; everything outside keeps the model's times, so an
// edit moves the finish time by exactly the change to that split and leaves every other split alone.
// Edits are absolute times, so they hold when factors are switched on or off. They never overlap: a
// new edit replaces any edit it overlaps (only possible after switching between mile, km and hill splits).
import { timeAt } from './splits.js';
import { flatEquivalentSpeed } from './adjust.js';

const EPS = 0.5; // m

// sec = null removes the edit for [d0, d1]
export function addEdit(edits, d0, d1, sec) {
  const rest = edits.filter(e => e.d1 <= d0 + EPS || e.d0 >= d1 - EPS);
  return sec == null ? rest : [...rest, { d0, d1, sec }].sort((a, b) => a.d0 - b.d0);
}

export const findEdit = (edits, d0, d1) =>
  edits.find(e => Math.abs(e.d0 - d0) < EPS && Math.abs(e.d1 - d1) < EPS) ?? null;

// run: a runModel result. Returns the same shape plus timeAt(d), the exact elapsed time at any distance
// (split boundaries can fall inside a 100 m window, so cum alone can't represent an edit exactly).
export function applyEdits(windows, run, edits) {
  const base = d => timeAt(windows, run.cum, d);
  if (!edits.length) return { ...run, timeAt: base };
  const segs = edits.map(e => ({ ...e, t0: base(e.d0), t1: base(e.d1) }));
  const at = d => {
    let shift = 0;
    for (const e of segs) {
      if (d >= e.d1) shift += e.sec - (e.t1 - e.t0);
      else if (d > e.d0) return e.t0 + shift + e.sec * (base(d) - e.t0) / (e.t1 - e.t0);
      else break;
    }
    return base(d) + shift;
  };
  const cum = [0, ...windows.map(w => at(w.d1))];
  const times = windows.map((_, i) => cum[i + 1] - cum[i]);
  const speeds = windows.map((w, i) => w.length / times[i]);
  return { ...run, timeAt: at, cum, times, speeds, total: cum[cum.length - 1] };
}

// What the edits are worth on a flat course in ideal conditions: for each edit, the flat-equivalent time
// of its range at the edited pace minus at the model's pace (per 100 m stretch, weighted by overlap).
// 0 with no edits; with every factor off it equals the change in course time.
export function editFlatShift(windows, run, edits, on) {
  let shift = 0;
  for (const e of edits) {
    const k = e.sec / (timeAt(windows, run.cum, e.d1) - timeAt(windows, run.cum, e.d0));
    windows.forEach((w, i) => {
      const len = Math.min(w.d1, e.d1) - Math.max(w.d0, e.d0);
      if (len <= 0) return;
      const flat = v => { const f = flatEquivalentSpeed(w, v, on); return len / (Number.isFinite(f) ? f : v); };
      shift += flat(run.speeds[i] / k) - flat(run.speeds[i]);
    });
  }
  return shift;
}
