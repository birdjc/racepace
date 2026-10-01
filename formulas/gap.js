// Grade-adjusted pace (GAP) — standalone formulas
// Extracted from John J. Davis, gap-app-main/scripts.js (MIT, see LICENSE-JohnDavis.md)
//
// Language: JavaScript (ES module, no dependencies)
// Data:     data/black_data_gam.json — Black et al. 2018 flat-ground cost of running,
//           smoothed with mgcv::gam in R (export_black_gam.R), 201-point grid, 0–10 m/s
//           columns: speed_m_s, energy_j_kg_m (J/kg/m), energy_j_kg_s (W/kg)
// Model:    total cost (J/kg/m) = flat cost from Black GAM + Minetti et al. 2002 quintic
//           incline/decline term (intercept dropped).
//
// Two directions:
//   gapFromHillSpeed(v, grade)       — "pace mode" in the original app:
//                                      actual hill speed -> equivalent flat speed
//   hillSpeedFromFlatEffort(v, grade) — "effort mode" (reverse) in the original app:
//                                      flat-ground effort speed -> speed achievable on the hill
//                                      at the same metabolic power. THIS is the one the race
//                                      app needs (goal flat pace -> per-segment adjusted pace).

import blackGam from './data/black_data_gam.json' with { type: 'json' };

// Minetti 2002 quintic: *added* cost of running above level ground, J/kg/m.
// grade: decimal (0.10 = 10%), negative for downhill. Fitted on −0.45…+0.45.
export function calcDeltaEC(grade) {
  return 155.4 * grade ** 5 - 30.4 * grade ** 4 - 43.3 * grade ** 3 + 46.3 * grade ** 2 + 19.5 * grade;
}

// Linear interpolation of the Black GAM table. col = 'energy_j_kg_m' | 'energy_j_kg_s'.
// Returns NaN outside 0–10 m/s.
export function lookupSpeed(speed_m_s, col) {
  const speed = blackGam.speed_m_s;
  const energy = blackGam[col];
  if (!(speed_m_s >= speed[0] && speed_m_s <= speed[speed.length - 1])) return NaN;
  let i = 0;
  for (; i < speed.length - 1; i++) {
    if (speed_m_s >= speed[i] && speed_m_s <= speed[i + 1]) break;
  }
  return energy[i] + (energy[i + 1] - energy[i]) * ((speed_m_s - speed[i]) / (speed[i + 1] - speed[i]));
}

// Inverse of lookupSpeed on the W/kg column (monotonic): metabolic power -> flat speed.
export function getEquivFlatSpeed(W_kg) {
  const speed = blackGam.speed_m_s;
  const power = blackGam.energy_j_kg_s;
  if (!(W_kg >= power[0] && W_kg <= power[power.length - 1])) return NaN;
  let i = 0;
  for (; i < power.length - 1; i++) {
    if (W_kg >= power[i] && W_kg <= power[i + 1]) break;
  }
  return speed[i] + (speed[i + 1] - speed[i]) * ((W_kg - power[i]) / (power[i + 1] - power[i]));
}

// Pace mode: actual speed on a grade -> metabolically equivalent flat speed (m/s).
export function gapFromHillSpeed(hill_speed_m_s, grade) {
  const total_Cr = lookupSpeed(hill_speed_m_s, 'energy_j_kg_m') + calcDeltaEC(grade);
  return getEquivFlatSpeed(total_Cr * hill_speed_m_s);
}

// Effort mode: flat-ground speed -> speed on this grade at equal metabolic power (m/s).
// Fixed-point iteration, 10 steps, exactly as in the original updateResult().
export function hillSpeedFromFlatEffort(flat_speed_m_s, grade) {
  const target_W_kg = lookupSpeed(flat_speed_m_s, 'energy_j_kg_s');
  const delta_Cr = calcDeltaEC(grade);
  const flat_Cr = lookupSpeed(flat_speed_m_s, 'energy_j_kg_m');
  let v = target_W_kg / (flat_Cr + delta_Cr);
  for (let i = 0; i < 10; i++) {
    v = target_W_kg / (lookupSpeed(v, 'energy_j_kg_m') + delta_Cr);
  }
  return v;
}
