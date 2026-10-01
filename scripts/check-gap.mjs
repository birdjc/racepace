// Independent checks of the GAP implementation
import { calcDeltaEC, lookupSpeed, hillSpeedFromFlatEffort, gapFromHillSpeed } from '../formulas/gap.js';
const pace = v => { const s = 1609.344 / v; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const v0 = 1609.344 / (7 * 60 + 53); // 7:53/mi
const P = lookupSpeed(v0, 'energy_j_kg_s');
// 1. Minetti 2002 published polynomial: Cr(i) = 155.4i^5 − 30.4i^4 − 43.3i^3 + 46.3i^2 + 19.5i + 3.6
const minettiFull = i => 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
console.log('1. Minetti coefficients: max |ΔEC + 3.6 − published| over ±45% =',
  Math.max(...Array.from({ length: 91 }, (_, k) => (k - 45) / 100).map(i => Math.abs(calcDeltaEC(i) + 3.6 - minettiFull(i)))));
// 2. Fixed-point solver vs. bisection on the same equation (equal metabolic power)
console.log('2. Solver check (7:53/mi flat effort):');
for (const g of [-0.3, -0.2, -0.1, -0.05, 0.05, 0.1, 0.2, 0.3]) {
  const vf = hillSpeedFromFlatEffort(v0, g);
  const f = v => (lookupSpeed(v, 'energy_j_kg_m') + calcDeltaEC(g)) * v - P;
  let lo = 0.05, hi = 9.9; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; f(m) > 0 ? hi = m : lo = m; }
  console.log(`   ${String(g * 100).padStart(4)}%  fixed-point ${pace(vf)}  bisection ${pace((lo + hi) / 2)}  power error ${(f(vf) / P * 100).toFixed(3)}%  round-trip GAP ${pace(gapFromHillSpeed(vf, g))}`);
}
// 3. Where does the flat-cost table come from at these speeds?
console.log('3. Black flat cost J/kg/m (measured range ≈ 2.2–4.7 m/s, i.e. 12:11–5:42/mi):');
for (const v of [1.2, 1.8, 2.2, 3.0, 3.4, 4.0, 4.7, 5.8, 7.0]) console.log(`   ${v.toFixed(1)} m/s (${pace(v)}/mi): ${lookupSpeed(v, 'energy_j_kg_m').toFixed(2)}${v < 2.2 || v > 4.7 ? '  ← extrapolated' : ''}`);
