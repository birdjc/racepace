// Segmentation.
//  • Calculation windows: fixed ~100 m pieces, each with a grade (terrain profile) and a heading
//    (direction profile). All pace adjustments are computed on these.
//  • Hill segments: terrain-based groups of consecutive windows, found relative to the course's
//    own hilliness, used only for display (hill splits, profile labels).
import { bearing } from './geo.js';
import { savitzkyGolay } from './smoothing.js';

export const WINDOW_M = 100;
// Hill-segment settings (relative method, chosen 2026-09-26, "sensitive" setting)
export const TREND_M = 3000;           // long-range trend the course's undulation is measured against
export const HILL_SIGMA_K = 2;         // a hill must rise or drop at least this many "typical wiggles"...
export const HILL_MIN_RISE_M = 5;      // ...and at least this many metres (above elevation-data noise)
export const HILL_CORE = 0.85;         // a hill is trimmed to the shortest stretch holding 85% of its rise
export const MIN_FLAT_M = 600;         // shorter flat stretches are absorbed into a neighbour

// points: [{d, lat, lon}] on a uniform grid; ele: smoothed elevations (same length)
export function buildWindows(points, ele, windowM = WINDOW_M) {
  const spacing = points[1].d - points[0].d;
  const step = Math.max(1, Math.round(windowM / spacing));
  const last = points.length - 1;
  const idx = [];
  for (let i = 0; i < last; i += step) idx.push(i);
  // Fold a short final remainder (< half a window) into the previous window
  if (idx.length > 1 && last - idx[idx.length - 1] < step / 2) idx.pop();
  idx.push(last);

  const windows = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    const length = points[b].d - points[a].d;
    // Heading: length-weighted circular mean of the 10 m sub-steps
    let sx = 0, sy = 0;
    for (let i = a; i < b; i++) {
      const brg = bearing(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon) * Math.PI / 180;
      const len = points[i + 1].d - points[i].d;
      sx += Math.sin(brg) * len;
      sy += Math.cos(brg) * len;
    }
    windows.push({
      i0: a, i1: b,
      d0: points[a].d, d1: points[b].d, length,
      ele0: ele[a], ele1: ele[b],
      grade: (ele[b] - ele[a]) / length,
      heading: (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360
    });
  }
  return windows;
}

const median = arr => { const t = Float64Array.from(arr).sort(); return t[t.length >> 1]; };

function makeSegment(windows, w0, w1, kind) {
  const d0 = windows[w0].d0, d1 = windows[w1].d1;
  const e0 = windows[w0].ele0, e1 = windows[w1].ele1;
  let gain = 0, loss = 0;
  for (let k = w0; k <= w1; k++) {
    const dz = windows[k].ele1 - windows[k].ele0;
    if (dz > 0) gain += dz; else loss -= dz;
  }
  return { w0, w1, d0, d1, length: d1 - d0, ele0: e0, ele1: e1, grade: (e1 - e0) / (d1 - d0), gain, loss, kind, label: kind };
}

// Alternating peaks and valleys whose elevation differs by at least h ("zigzag" / prominence).
// E: elevations at boundaries 0..n. Returns boundary indices, always including 0 and n.
export function zigzag(E, h) {
  const n = E.length - 1, ext = [0];
  let dir = 0, cand = 0;
  for (let i = 1; i <= n; i++) {
    if (dir >= 0 && E[i] > E[cand]) cand = i;
    if (dir <= 0 && E[i] < E[cand]) cand = i;
    if (dir === 0) {
      if (E[i] - E[0] >= h) { dir = 1; cand = i; }
      else if (E[0] - E[i] >= h) { dir = -1; cand = i; }
    } else if (dir === 1 && E[cand] - E[i] >= h) { ext.push(cand); dir = -1; cand = i; }
    else if (dir === -1 && E[i] - E[cand] >= h) { ext.push(cand); dir = 1; cand = i; }
  }
  if (dir !== 0 && cand !== ext[ext.length - 1] && cand !== n) ext.push(cand);
  ext.push(n);
  return ext;
}

// Minimum rise/drop (m) that counts as a hill on this course
export function hillThreshold(E, spacing) {
  const trend = savitzkyGolay(E, spacing, TREND_M, 1);
  const sigma = 1.4826 * median(E.map((e, i) => Math.abs(e - trend[i])));
  return Math.max(HILL_MIN_RISE_M, HILL_SIGMA_K * sigma);
}

// Group windows into hill segments, relative to the course's own terrain:
//  1. measure how much the elevation undulates around its 3 km trend (robust σ)
//  2. a hill is any valley→peak rise or peak→valley drop of at least max(5 m, 2σ)
//  3. each hill is trimmed to its core (shortest stretch holding 85% of the rise/drop);
//     the approach and run-out become flat
//  4. neighbouring flats merge; flats shorter than 600 m are absorbed into a neighbour
export function hillSegments(windows) {
  const n = windows.length;
  const D = [...windows.map(w => w.d0), windows[n - 1].d1];
  const E = [...windows.map(w => w.ele0), windows[n - 1].ele1];
  const h = n > 4 ? hillThreshold(E, D[n] / n) : Infinity;
  const ext = zigzag(E, h);

  // Pieces as boundary ranges [a, b] with a kind
  const pieces = [];
  for (let k = 0; k < ext.length - 1; k++) {
    const a = ext[k], b = ext[k + 1], dz = E[b] - E[a], sgn = Math.sign(dz);
    if (Math.abs(dz) < h) { pieces.push({ a, b, kind: 'flat' }); continue; }
    let best = [a, b];
    for (let i = a; i < b; i++) {
      for (let j = i + 1; j <= b; j++) {
        if (D[j] - D[i] >= D[best[1]] - D[best[0]]) break;
        if (sgn * (E[j] - E[i]) >= HILL_CORE * Math.abs(dz)) { best = [i, j]; break; }
      }
    }
    if (best[0] > a) pieces.push({ a, b: best[0], kind: 'flat' });
    pieces.push({ a: best[0], b: best[1], kind: sgn > 0 ? 'climb' : 'descent' });
    if (best[1] < b) pieces.push({ a: best[1], b, kind: 'flat' });
  }

  const grade = p => (E[p.b] - E[p.a]) / (D[p.b] - D[p.a]);
  const mergeSame = arr => arr.reduce((out, p) => {
    const q = out[out.length - 1];
    if (q && q.kind === p.kind) q.b = p.b; else out.push({ ...p });
    return out;
  }, []);
  let segs = mergeSame(pieces);
  for (;;) {
    const i = segs.findIndex(s => s.kind === 'flat' && D[s.b] - D[s.a] < MIN_FLAT_M);
    if (i < 0 || segs.length < 2) break;
    const L = segs[i - 1], R = segs[i + 1];
    const toLeft = !R || (L && Math.abs(grade(L) - grade(segs[i])) <= Math.abs(grade(R) - grade(segs[i])));
    if (toLeft) L.b = segs[i].b; else R.a = segs[i].a;
    segs.splice(i, 1);
    segs = mergeSame(segs);
  }
  // Boundary index b ↔ start of window b, so a piece [a, b] covers windows a..b-1
  return segs.map(s => makeSegment(windows, s.a, s.b - 1, s.kind));
}
