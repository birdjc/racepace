// Heat & humidity adjustment — standalone formulas
// Extracted from John J. Davis, heat-adjusted-pace-main/scripts.js (MIT, see LICENSE-JohnDavis.md)
//
// Language: JavaScript (ES module, no dependencies)
// Data:     data/heat_humidity_adjustments_fine_v2025-09-04.json
//             46 temps (0–45 °C, 1 °C steps) × 101 RH (0–100 %, 1 % steps) = 4646 rows
//             columns: air_temp_c, humidity_pct, logspeed_adjust
//           data/heat_index_adjustments_v2025-09-04.json (alternative 1-D model)
//             columns: heat_index_noaa_2014 (0–45 °C), logspeed_adjust
//           Both are GAM predictions (mgcv, heat_app_analysis.R) fit to marathon results from
//           Mantzios et al. 2022 (3,891 runners, 754 marathons). logspeed_adjust ≤ 0 is the
//           change in ln(speed); 0 at the optimum (~8–14 °C).
// Model:    ln(v_hot) = ln(v_cool) + logspeed_adjust(T, RH)   (bilinear interpolation,
//           linear extrapolation outside the grid, as in the original app)
//
// Two directions:
//   heatAdjustedSpeedFromEffort(v, T, RH) — "effort mode": cool-weather speed -> expected speed
//                                           in these conditions. THIS is the one the race app needs.
//   coolEquivalentSpeed(v, T, RH)          — "pace mode": speed run in heat -> cool-weather equivalent

import tempModParams from './data/heat_humidity_adjustments_fine_v2025-09-04.json' with { type: 'json' };
import heatIndexModParams from './data/heat_index_adjustments_v2025-09-04.json' with { type: 'json' };

// Magnus approximation, valid −45…60 °C
export function calculateRelativeHumidity(tempC, dewPointC) {
  const a = 17.625, b = 243.04;
  const es = t => 6.112 * Math.exp((a * t) / (b + t));
  return Math.min(100, Math.max(0, (es(dewPointC) / es(tempC)) * 100));
}

export function tempFtoC(f) { return (f - 32) * 5 / 9; }

function create1DInterpolationLookup(table, xKey, yKey) {
  const xs = table[xKey], ys = table[yKey];
  return function lookup(x) {
    let i = 0;
    for (i = 0; i < xs.length; i++) {
      if (x === xs[i]) return ys[i];
      if (x < xs[i]) break;
    }
    if (i === 0) i = 1;
    else if (i === xs.length) i = xs.length - 1;
    const x1 = xs[i - 1], x2 = xs[i], y1 = ys[i - 1], y2 = ys[i];
    return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
  };
}

function createBilinearLookup(table) {
  const { air_temp_c, humidity_pct, logspeed_adjust } = table;
  const xs = [...new Set(air_temp_c)].sort((a, b) => a - b);
  const ys = [...new Set(humidity_pct)].sort((a, b) => a - b);
  const val = new Map();
  for (let i = 0; i < air_temp_c.length; i++) val.set(`${air_temp_c[i]}|${humidity_pct[i]}`, logspeed_adjust[i]);
  const z = (ix, iy) => val.get(`${xs[ix]}|${ys[iy]}`);

  function bracket(arr, q) { // extrapolate = true
    const n = arr.length;
    if (q <= arr[0]) return [0, 1, (q - arr[0]) / (arr[1] - arr[0])];
    if (q >= arr[n - 1]) return [n - 2, n - 1, (q - arr[n - 2]) / (arr[n - 1] - arr[n - 2])];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] >= q) hi = mid; else lo = mid;
    }
    return [lo, hi, (q - arr[lo]) / (arr[hi] - arr[lo])];
  }

  return function interp(tC, rh) {
    const [ix0, ix1, tx] = bracket(xs, tC);
    const [iy0, iy1, ty] = bracket(ys, rh);
    const a = z(ix0, iy0) * (1 - tx) + z(ix1, iy0) * tx;
    const b = z(ix0, iy1) * (1 - tx) + z(ix1, iy1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

export const heatHumidityLookup = createBilinearLookup(tempModParams);
export const heatIndexLookup = create1DInterpolationLookup(heatIndexModParams, 'heat_index_noaa_2014', 'logspeed_adjust');

// Effort mode: cool-weather speed -> expected speed at (tempC, rh)
export function heatAdjustedSpeedFromEffort(speed_m_s, tempC, rh) {
  return Math.exp(Math.log(speed_m_s) + heatHumidityLookup(tempC, rh));
}

// Pace mode: speed run at (tempC, rh) -> cool-weather equivalent speed
export function coolEquivalentSpeed(speed_m_s, tempC, rh) {
  return Math.exp(Math.log(speed_m_s) - heatHumidityLookup(tempC, rh));
}
