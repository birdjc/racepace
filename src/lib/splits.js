// Splits by mile, kilometre or hill segment, from per-window cumulative times.
import { M_PER_MI, M_PER_KM } from './pace.js';

// Cumulative time at distance d (linear within a window)
export function timeAt(windows, cum, d) {
  if (d <= 0) return 0;
  let lo = 0, hi = windows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid].d1 < d) lo = mid + 1; else hi = mid;
  }
  const w = windows[lo];
  const f = Math.min(1, Math.max(0, (d - w.d0) / w.length));
  return cum[lo] + (cum[lo + 1] - cum[lo]) * f;
}

export function unitBoundaries(total, unitM) {
  const b = [];
  for (let d = 0; d < total - 1; d += unitM) b.push(d);
  b.push(total);
  return b;
}

// run/base: outputs of runModel. Returns one row per [b[i], b[i+1]].
export function makeSplits(windows, run, base, boundaries, labels = null) {
  const rows = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const d0 = boundaries[i], d1 = boundaries[i + 1];
    const t0 = timeAt(windows, run.cum, d0), t1 = timeAt(windows, run.cum, d1);
    const b0 = timeAt(windows, base.cum, d0), b1 = timeAt(windows, base.cum, d1);
    rows.push({
      label: labels ? labels[i] : null,
      d0, d1, length: d1 - d0,
      time: t1 - t0, baseTime: b1 - b0, delta: (t1 - t0) - (b1 - b0),
      cum: t1, cumDelta: t1 - b1
    });
  }
  return rows;
}

export function splitBoundaries(mode, windows, hills) {
  const total = windows[windows.length - 1].d1;
  if (mode === 'mi') return unitBoundaries(total, M_PER_MI);
  if (mode === 'km') return unitBoundaries(total, M_PER_KM);
  return [...hills.map(h => h.d0), total];
}

// Pace (seconds per unit) for a split
export const splitPace = (row, unit) => row.time / row.length * (unit === 'mi' ? M_PER_MI : M_PER_KM);
export const splitPaceDelta = (row, unit) => row.delta / row.length * (unit === 'mi' ? M_PER_MI : M_PER_KM);
