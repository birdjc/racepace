// Elevation profile preparation: spike filter -> adaptive Savitzky–Golay smoothing.
import { savitzkyGolay } from './smoothing.js';

export const SG_WINDOW_DEFAULT_M = 150; // DEM or barometric elevation
export const SG_WINDOW_NOISY_M = 250;   // noisy GPS elevation
export const SG_ORDER = 2;
export const NOISE_RMS_THRESHOLD_M = 1.5;
export const HAMPEL_HALF_WINDOW_M = 100;
export const HAMPEL_K = 3;
export const HAMPEL_MIN_DEV_M = 2;

// Spike filter (Hampel-style, with a robust local line as the baseline).
// For each point, a line is fit to the surrounding ±halfWindowM with bisquare reweighting
// (LOWESS-style), so a dip or spike covering less than about half the window doesn't pull the fit.
// The point is replaced by the fitted value when its residual exceeds
// max(k·1.4826·MAD of the window residuals, minDev). This removes bridge/overpass dips in DEM data
// and GPS spikes, even partway up a climb, while steady grades are left alone.
export function hampel(values, spacing, { halfWindowM = HAMPEL_HALF_WINDOW_M, k = HAMPEL_K, minDev = HAMPEL_MIN_DEV_M } = {}) {
  const h = Math.max(2, Math.round(halfWindowM / spacing));
  const n = values.length;
  const out = values.slice();
  let replaced = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n - 1, i + h);
    const { centre, mad } = robustLine(values, a, b, i);
    if (Math.abs(values[i] - centre) > Math.max(k * 1.4826 * mad, minDev)) {
      out[i] = centre;
      replaced++;
    }
  }
  return { values: out, replaced };
}

// Weighted least-squares line over [a, b] with 3 bisquare reweighting passes.
// Returns the fitted value at `centre` and the MAD of the final residuals.
function robustLine(y, a, b, centre, passes = 3) {
  const m = b - a + 1;
  const w = new Float64Array(m).fill(1);
  const r = new Float64Array(m);
  let c0 = 0, c1 = 0, mad = 0;
  for (let pass = 0; pass <= passes; pass++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = 0; j < m; j++) {
      const x = a + j - centre, wj = w[j];
      sw += wj; sx += wj * x; sy += wj * y[a + j]; sxx += wj * x * x; sxy += wj * x * y[a + j];
    }
    const det = sw * sxx - sx * sx;
    c1 = Math.abs(det) > 1e-12 ? (sw * sxy - sx * sy) / det : 0;
    c0 = (sy - c1 * sx) / sw;
    for (let j = 0; j < m; j++) r[j] = y[a + j] - (c0 + c1 * (a + j - centre));
    mad = median(Array.from(r, Math.abs));
    if (pass === passes) break;
    const s = 6 * Math.max(mad, 1e-6);
    for (let j = 0; j < m; j++) {
      const u = r[j] / s;
      w[j] = Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
    }
  }
  return { centre: c0, mad };
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// RMS of the difference between the series and a 150 m SG fit: a measure of high-frequency noise
export function noiseRms(values, spacing) {
  const fit = savitzkyGolay(values, spacing, SG_WINDOW_DEFAULT_M, SG_ORDER);
  return Math.sqrt(values.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0) / values.length);
}

// course: { points: [{ele}], spacing, elevationSource }
export function smoothElevation(course) {
  const raw = course.points.map(p => p.ele);
  const spike = hampel(raw, course.spacing);
  const noise = noiseRms(spike.values, course.spacing);
  const noisy = course.elevationSource === 'gpx' && noise > NOISE_RMS_THRESHOLD_M;
  const windowM = noisy ? SG_WINDOW_NOISY_M : SG_WINDOW_DEFAULT_M;
  return {
    raw,
    ele: savitzkyGolay(spike.values, course.spacing, windowM, SG_ORDER),
    windowM,
    noiseRms: noise,
    spikesReplaced: spike.replaced
  };
}
