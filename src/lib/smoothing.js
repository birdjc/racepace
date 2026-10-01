// Elevation smoothing candidates. All take elevations on a uniform distance grid (spacing m)
// and return a new array of the same length.

// Centered moving average over a distance window (m). The window shrinks at the ends.
export function movingAverage(ele, spacing, windowM = 100) {
  const k = Math.max(0, Math.round(windowM / spacing / 2));
  const n = ele.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + ele[i];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

// Savitzky–Golay: local least-squares polynomial of `order` over a distance window,
// evaluated at the centre point. Near the ends the window is truncated (asymmetric fit).
export function savitzkyGolay(ele, spacing, windowM = 150, order = 2) {
  const k = Math.max(order, Math.round(windowM / spacing / 2));
  const n = ele.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
    out[i] = polyFitAt(ele, a, b, i, order);
  }
  return out;
}

function polyFitAt(y, a, b, centre, order) {
  const m = order + 1;
  // Normal equations (X'X) c = X'y with x = index offset from centre
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const r = new Float64Array(m);
  for (let j = a; j <= b; j++) {
    const x = j - centre;
    const pw = new Float64Array(m);
    pw[0] = 1;
    for (let p = 1; p < m; p++) pw[p] = pw[p - 1] * x;
    for (let p = 0; p < m; p++) {
      r[p] += pw[p] * y[j];
      for (let q = 0; q < m; q++) A[p][q] += pw[p] * pw[q];
    }
  }
  return solve(A, r)[0]; // value at x = 0
}

function solve(A, r) {
  const m = r.length;
  const M = A.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let i = c + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let i = 0; i < m; i++) {
      if (i === c) continue;
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= m; j++) M[i][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[m] / row[i]);
}

// Kalman filter + Rauch–Tung–Striebel smoother with a constant-grade model.
// State = [elevation, grade]; grade performs a random walk with std `gradeNoise` per metre^0.5;
// measurements have std `measNoise` (m).
export function kalmanRts(ele, spacing, { measNoise = 3, gradeNoise = 0.004 } = {}) {
  const n = ele.length, dx = spacing;
  const R = measNoise ** 2;
  const q = gradeNoise ** 2;
  // Process noise for integrated random walk over dx
  const Q = [[q * dx ** 3 / 3, q * dx ** 2 / 2], [q * dx ** 2 / 2, q * dx]];
  const xs = [], Ps = [], xp = [], Pp = [];
  let x = [ele[0], 0], P = [[R, 0], [0, 0.01]];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      x = [x[0] + dx * x[1], x[1]];
      P = [
        [P[0][0] + dx * (P[1][0] + P[0][1]) + dx * dx * P[1][1] + Q[0][0], P[0][1] + dx * P[1][1] + Q[0][1]],
        [P[1][0] + dx * P[1][1] + Q[1][0], P[1][1] + Q[1][1]]
      ];
    }
    xp.push(x); Pp.push(P);
    const S = P[0][0] + R;
    const K = [P[0][0] / S, P[1][0] / S];
    const innov = ele[i] - x[0];
    x = [x[0] + K[0] * innov, x[1] + K[1] * innov];
    P = [
      [(1 - K[0]) * P[0][0], (1 - K[0]) * P[0][1]],
      [P[1][0] - K[1] * P[0][0], P[1][1] - K[1] * P[0][1]]
    ];
    xs.push(x); Ps.push(P);
  }
  // RTS backward pass
  const out = new Array(n);
  let xsm = xs[n - 1], Psm = Ps[n - 1];
  out[n - 1] = xsm[0];
  for (let i = n - 2; i >= 0; i--) {
    const P = Ps[i], Pn = Pp[i + 1];
    // C = P F' Pn^-1, with F = [[1, dx], [0, 1]]
    const PF = [[P[0][0] + dx * P[0][1], P[0][1]], [P[1][0] + dx * P[1][1], P[1][1]]];
    const det = Pn[0][0] * Pn[1][1] - Pn[0][1] * Pn[1][0];
    const inv = [[Pn[1][1] / det, -Pn[0][1] / det], [-Pn[1][0] / det, Pn[0][0] / det]];
    const C = [
      [PF[0][0] * inv[0][0] + PF[0][1] * inv[1][0], PF[0][0] * inv[0][1] + PF[0][1] * inv[1][1]],
      [PF[1][0] * inv[0][0] + PF[1][1] * inv[1][0], PF[1][0] * inv[0][1] + PF[1][1] * inv[1][1]]
    ];
    const d0 = xsm[0] - xp[i + 1][0], d1 = xsm[1] - xp[i + 1][1];
    xsm = [xs[i][0] + C[0][0] * d0 + C[0][1] * d1, xs[i][1] + C[1][0] * d0 + C[1][1] * d1];
    out[i] = xsm[0];
    // (smoothed covariance not needed for the elevation estimate)
  }
  return out;
}

// Summary stats used to compare methods
export function profileStats(ele, spacing, gradeWindowM = 100) {
  let gain = 0, loss = 0;
  for (let i = 1; i < ele.length; i++) {
    const d = ele[i] - ele[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  const k = Math.max(1, Math.round(gradeWindowM / spacing));
  let maxUp = -Infinity, maxDown = Infinity;
  for (let i = k; i < ele.length; i += k) {
    const g = (ele[i] - ele[i - k]) / (k * spacing);
    maxUp = Math.max(maxUp, g);
    maxDown = Math.min(maxDown, g);
  }
  return { gain, loss, maxUp, maxDown };
}
