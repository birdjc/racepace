// Geometry helpers: distance, bearing, resampling.

const R_EARTH = 6371008.8; // mean Earth radius, m
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial compass bearing from point 1 to point 2, degrees in [0, 360)
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Adds cumulative distance `d` (m) and drops consecutive duplicate points.
export function withDistance(points) {
  const out = [];
  let d = 0;
  for (const p of points) {
    if (out.length) {
      const q = out[out.length - 1];
      const step = haversine(q.lat, q.lon, p.lat, p.lon);
      if (step < 0.01) continue;
      d += step;
    }
    out.push({ ...p, d });
  }
  return out;
}

// Linearly interpolate lat/lon/ele onto a uniform distance grid (spacing in m).
// NaN elevations are filled by interpolating between the nearest valid neighbours.
export function resample(points, spacing = 10) {
  const pts = withDistance(points);
  const total = pts[pts.length - 1].d;
  const n = Math.max(2, Math.round(total / spacing) + 1);
  const step = total / (n - 1);
  const ele = fillNaN(pts.map(p => p.ele));
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i === n - 1 ? total : i * step;
    while (j < pts.length - 2 && pts[j + 1].d < d) j++;
    const a = pts[j], b = pts[j + 1];
    const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
    out.push({
      d,
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: ele[j] + (ele[j + 1] - ele[j]) * t
    });
  }
  return out;
}

export function fillNaN(values) {
  const out = values.slice();
  const n = out.length;
  const prev = new Array(n), next = new Array(n);
  for (let i = 0, last = -1; i < n; i++) { if (Number.isFinite(values[i])) last = i; prev[i] = last; }
  for (let i = n - 1, last = -1; i >= 0; i--) { if (Number.isFinite(values[i])) last = i; next[i] = last; }
  if (prev[n - 1] === -1) return out; // no valid values at all
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(values[i])) continue;
    const a = prev[i], b = next[i];
    if (a === -1) out[i] = values[b];
    else if (b === -1) out[i] = values[a];
    else out[i] = values[a] + (values[b] - values[a]) * (i - a) / (b - a);
  }
  return out;
}

// Heading (compass bearing) of the course over [d0, d1], using its endpoints.
export function headingBetween(p0, p1) {
  return bearing(p0.lat, p0.lon, p1.lat, p1.lon);
}

export function centroid(points) {
  const n = points.length;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lon: points.reduce((s, p) => s + p.lon, 0) / n
  };
}
