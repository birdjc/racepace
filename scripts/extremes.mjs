// What drives the extreme per-stretch paces? Compares model variants and window sizes on the test course.
import fs from 'fs';
import { nodeTileLoader } from './node-tile-loader.mjs';
import { buildCourse } from '../src/lib/course.js';
import { smoothElevation } from '../src/lib/profile.js';
import { buildWindows } from '../src/lib/segments.js';
import { calcDeltaEC, lookupSpeed } from '../formulas/gap.js';
const pace = v => { const s = 1609.344 / v; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const v0 = 1609.344 / 473;
const P = lookupSpeed(v0, 'energy_j_kg_s');
const solve = (g, costFn) => { // equal metabolic power, bisection
  const f = v => (costFn(v) + calcDeltaEC(g)) * v - P;
  let lo = 0.05, hi = 9.9; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; f(m) > 0 ? hi = m : lo = m; } return (lo + hi) / 2;
};
const original = v => lookupSpeed(v, 'energy_j_kg_m');
const clamped = v => lookupSpeed(Math.min(4.7, Math.max(2.2, v)), 'energy_j_kg_m'); // no extrapolation outside Black's data
console.log('Model response at 7:53/mi flat effort:');
console.log('grade   original   flat-cost held outside measured speeds');
for (const g of [-0.2, -0.1, -0.05, 0.05, 0.1, 0.2]) console.log(`${String(g * 100).padStart(4)}%   ${pace(solve(g, original)).padStart(6)}     ${pace(solve(g, clamped)).padStart(6)}`);

const course = await buildCourse(fs.readFileSync('test/fixtures/boston-like-no-ele.gpx', 'utf8'), { loadTile: nodeTileLoader });
const ele = smoothElevation(course).ele;
console.log('\nTest course, grade only: calculation-window size vs. extremes');
for (const wm of [100, 200, 400, 800]) {
  const W = buildWindows(course.points, ele, wm);
  const sp = W.map(w => solve(Math.max(-0.45, Math.min(0.45, w.grade)), original));
  const t = W.reduce((s, w, i) => s + w.length / sp[i], 0), base = course.distance / v0;
  const gs = W.map(w => w.grade);
  console.log(`${String(wm).padStart(4)} m windows: steepest ${(Math.max(...gs) * 100).toFixed(1)}% / ${(Math.min(...gs) * 100).toFixed(1)}%, slowest ${pace(Math.min(...sp))}, fastest ${pace(Math.max(...sp))}, total grade effect +${((t - base) / 60).toFixed(2)} min`);
}
const W = buildWindows(course.points, ele, 100);
const share = lim => (W.filter(w => Math.abs(w.grade) > lim).reduce((s, w) => s + w.length, 0) / course.distance * 100).toFixed(1);
console.log(`\nShare of test course steeper than ±4%: ${share(0.04)}%, ±6%: ${share(0.06)}%, ±8%: ${share(0.08)}%`);

// Pace-plan smoothing: moving average of seconds-per-metre over ±R m (length-weighted). Total time is preserved
// only approximately at the ends, so report it.
const sp100 = W.map(w => solve(Math.max(-0.45, Math.min(0.45, w.grade)), original));
const spm = sp100.map(v => 1 / v);
const base = course.distance / v0, t0 = W.reduce((s, w, i) => s + w.length * spm[i], 0);
console.log('\nPace-plan smoothing (100 m calculation unchanged):');
for (const R of [0, 200, 400, 800]) {
  const k = Math.round(R / 100);
  const sm = spm.map((_, i) => { let a = 0, b = 0; for (let j = Math.max(0, i - k); j <= Math.min(W.length - 1, i + k); j++) { a += spm[j] * W[j].length; b += W[j].length; } return a / b; });
  const t = W.reduce((s, w, i) => s + w.length * sm[i], 0);
  console.log(`  ±${String(R).padStart(3)} m: slowest ${pace(1 / Math.max(...sm))}, fastest ${pace(1 / Math.min(...sm))}, total grade effect +${((t - base) / 60).toFixed(2)} min (unsmoothed +${((t0 - base) / 60).toFixed(2)})`);
}
