// Headwind / tailwind / crosswind adjustment — standalone formulas
// Extracted from John J. Davis, wind-calculator-main/scripts.js (MIT, see LICENSE-JohnDavis.md)
//
// Language: JavaScript (ES module, no dependencies, no data files)
// Model:    treadmill (still-air) metabolic cost from Black et al. 2018 quadratic (W/kg),
//           plus an aerodynamic penalty: forward drag force / body weight × Da Silva slope (6.13).
//           Drag uses frontal area from body mass (Livingston & Lee 2001 BSA × Pugh 0.266),
//           Cd 0.8, air density 1.225. Wind measured at 10 m is scaled to chest height (1.5 m)
//           with the power law, exponent alpha (race app: fixed at 0.3 = "suburbs").
//
// Angle convention (from the original dial): windAngleDeg is the direction the wind comes FROM,
// relative to the runner's heading. 0° = pure headwind, 180° = pure tailwind, ±90° = crosswind.
// For a course segment: windAngleDeg = windFromBearing − segmentHeading.
//
// Two directions:
//   calmEquivalentSpeed(...)   — "pace mode": actual speed in wind -> calm-air equivalent speed
//   speedInWindFromEffort(...) — "effort mode": calm-air effort speed -> speed achievable in wind.
//                                THIS is the one the race app needs.

export const ALPHA = { city: 0.4, suburbs: 0.3, rural: 0.16, none: 0.0 };
export const DEFAULTS = {
  weightKg: 68,
  alpha: 0.3,
  isElite: 1,
  gridMax: 12,   // m/s
  gridStep: 0.01 // m/s
};

const GRAVITY = 9.80665;
const DRAG_COEFFICIENT = 0.8;
const AIR_DENSITY = 1.225;
const AP_RATIO = 0.266;
const DA_SILVA_SLOPE = 6.13;
const WIND_REFERENCE_HEIGHT = 10; // m, standard anemometer / forecast height
const CHEST_HEIGHT = 1.5;         // m

export function getBodySurfaceArea(weightKg) {
  return 0.1173 * weightKg ** 0.6466; // m², Livingston & Lee 2001
}

export function getAp(weightKg) {
  return AP_RATIO * getBodySurfaceArea(weightKg); // projected frontal area, m²
}

// Black et al. polynomial, still-air (treadmill) cost in W/kg
export function calcTreadMetCost(speed_m_s, isElite = DEFAULTS.isElite) {
  return 8.09986 + 0.12910 * speed_m_s + 0.48105 * speed_m_s ** 2 - 1.13918 * isElite;
}

// Drag force (N); positive opposes the runner
export function calcDragForce(relativeV, weightKg) {
  return Math.sign(relativeV) * 0.5 * AIR_DENSITY * relativeV ** 2 * DRAG_COEFFICIENT * getAp(weightKg);
}

// Fractional increase in metabolic cost from the forward component of drag (0.03 = +3%)
export function calcAirPct(vRelative, relativeAngleDeg, weightKg) {
  if (!(vRelative > 1e-9)) return 0;
  const dragFwd = calcDragForce(vRelative, weightKg) * Math.sin(relativeAngleDeg * Math.PI / 180);
  return dragFwd / (weightKg * GRAVITY) * DA_SILVA_SLOPE;
}

export function windProfilePowerLaw(vRef, alpha) {
  return vRef * (CHEST_HEIGHT / WIND_REFERENCE_HEIGHT) ** alpha;
}

export function getVectorMag(x, y) {
  return Math.sqrt(x ** 2 + y ** 2);
}

// Angle of relative airflow in degrees; lateral component x, forward component y
export function getRelativeWindAngle(x, y) {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return 0;
  return Math.atan(y / Math.abs(x)) * 180 / Math.PI;
}

// Wind (10 m, m/s) + angle -> forward (headwind-positive) and lateral components at chest height
export function windComponents(wind10m_m_s, windAngleDeg, alpha = DEFAULTS.alpha) {
  const w = windProfilePowerLaw(wind10m_m_s, alpha);
  const rad = windAngleDeg * Math.PI / 180;
  return { fwd: Math.cos(rad) * w, lat: Math.sin(rad) * w };
}

export function calcCalmAirTotalMetCost(speed_m_s, weightKg, isElite = DEFAULTS.isElite) {
  return calcTreadMetCost(speed_m_s, isElite) * (1 + calcAirPct(speed_m_s, 90, weightKg));
}

// Total cost (W/kg) of running at speed v with the given chest-height wind components
export function calcTotalCostInWind(v, fwd, lat, weightKg, isElite = DEFAULTS.isElite) {
  const vRel = getVectorMag(lat, v + fwd);
  const ang = getRelativeWindAngle(lat, v + fwd);
  return calcTreadMetCost(v, isElite) * (1 + calcAirPct(vRel, ang, weightKg));
}

export function makeGrid(start, end, step) {
  const n = Math.floor((end - start) / step) + 1;
  return Array.from({ length: n }, (_, i) => parseFloat((start + i * step).toFixed(10)));
}

// Linear-interpolated inverse lookup: cost -> speed. NaN if off the grid.
export function lookupSpeedFromCost(cost, speedGrid, costGrid) {
  if (!(cost >= costGrid[0] && cost <= costGrid[costGrid.length - 1])) return NaN;
  let i = 0;
  for (; i < costGrid.length - 1; i++) {
    if (cost >= costGrid[i] && cost <= costGrid[i + 1]) break;
  }
  return speedGrid[i] + (speedGrid[i + 1] - speedGrid[i]) * ((cost - costGrid[i]) / (costGrid[i + 1] - costGrid[i]));
}

// Pace mode: actual speed in wind -> calm-air equivalent speed (m/s)
export function calmEquivalentSpeed(speed_m_s, wind10m_m_s, windAngleDeg, opts = {}) {
  const { weightKg, alpha, isElite, gridMax, gridStep } = { ...DEFAULTS, ...opts };
  if (!Number.isFinite(speed_m_s) || speed_m_s <= 0) return NaN;
  const { fwd, lat } = windComponents(wind10m_m_s, windAngleDeg, alpha);
  const vGrid = makeGrid(0, gridMax, gridStep);
  const calmGrid = vGrid.map(v => calcCalmAirTotalMetCost(v, weightKg, isElite));
  const cost = calcTotalCostInWind(speed_m_s, fwd, lat, weightKg, isElite);
  return lookupSpeedFromCost(cost, vGrid, calmGrid);
}

// Effort mode: calm-air effort speed -> achievable speed in wind (m/s)
export function speedInWindFromEffort(speed_m_s, wind10m_m_s, windAngleDeg, opts = {}) {
  const { weightKg, alpha, isElite, gridMax, gridStep } = { ...DEFAULTS, ...opts };
  if (!Number.isFinite(speed_m_s) || speed_m_s <= 0) return NaN;
  const { fwd, lat } = windComponents(wind10m_m_s, windAngleDeg, alpha);
  const target = calcCalmAirTotalMetCost(speed_m_s, weightKg, isElite);
  const vGrid = makeGrid(0, gridMax, gridStep);
  const windGrid = vGrid.map(v => calcTotalCostInWind(v, fwd, lat, weightKg, isElite));
  return lookupSpeedFromCost(target, vGrid, windGrid);
}
