// Speed change vs grade at equal effort, from the app's grade model (Minetti 2002 + Black et al. 2018).
// "app": with the app's caps (descents steeper than −8% treated as −8%, climbs capped at +45%).
// "uncapped": the same formulas with no caps. Reference flat pace in argv[2] (min/mi, default 8).
import { hillSpeedFromFlatEffort } from '../formulas/gap.js';
import { DOWNHILL_CAP_GRADE, MAX_ABS_GRADE } from '../src/lib/adjust.js';
const paces = (process.argv[2] ?? '8').split(',').map(Number);
const out = {};
for (const p of paces) {
  const v0 = 1609.344 / (p * 60);
  const rows = [];
  for (let g = -50; g <= 50.001; g += 0.5) {
    const gr = g / 100;
    const app = hillSpeedFromFlatEffort(v0, Math.max(DOWNHILL_CAP_GRADE, Math.min(MAX_ABS_GRADE, gr)));
    const unc = hillSpeedFromFlatEffort(v0, gr);
    rows.push([+g.toFixed(1), +((app / v0 - 1) * 100).toFixed(2), Number.isFinite(unc) ? +((unc / v0 - 1) * 100).toFixed(2) : null]);
  }
  out[p] = rows;
}
console.log(JSON.stringify(out));
