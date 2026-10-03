import { describe, it, expect } from 'vitest';
import { hampel, smoothElevation } from '../src/lib/profile.js';
import { buildWindows, hillSegments } from '../src/lib/segments.js';
import { attachWeather, computeAll, runModel, pacingOpportunity } from '../src/lib/adjust.js';
import { makeSplits, splitBoundaries, timeAt } from '../src/lib/splits.js';

// Straight course heading due east along the equator, 10 m spacing
function course(n, eleFn) {
  const dLon = 10 / 111195;
  return Array.from({ length: n }, (_, i) => ({ d: i * 10, lat: 0, lon: i * dLon, ele: eleFn(i * 10) }));
}
const hours = h => [7, 8, 9, 10, 11, 12].map(t => ({ time: `2026-10-01T${String(t).padStart(2, '0')}:00`, ...h }));

describe('profile', () => {
  it('hampel removes a bridge-like dip but leaves a steady ramp alone', () => {
    const ramp = Array.from({ length: 100 }, (_, i) => i * 0.5);
    expect(hampel(ramp, 10).replaced).toBe(0);
    const dip = ramp.slice(); for (let i = 48; i < 53; i++) dip[i] -= 8;
    const r = hampel(dip, 10);
    expect(r.replaced).toBe(5);
    expect(Math.abs(r.values[50] - ramp[50])).toBeLessThan(1);
  });
  it('uses the wider window only for noisy GPX elevation', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const pts = course(500, d => 20 * Math.sin(d / 800) + 12 * rnd());
    expect(smoothElevation({ points: pts, spacing: 10, elevationSource: 'gpx' }).windowM).toBe(250);
    expect(smoothElevation({ points: pts, spacing: 10, elevationSource: 'dem' }).windowM).toBe(150);
    const clean = course(500, d => 20 * Math.sin(d / 800));
    expect(smoothElevation({ points: clean, spacing: 10, elevationSource: 'gpx' }).windowM).toBe(150);
  });
});

describe('segments', () => {
  // 0–2 km flat, 2–3 km climb at 6%, 3–5 km flat
  const ele = d => (d < 2000 ? 0 : d < 3000 ? (d - 2000) * 0.06 : 60);
  const pts = course(501, ele);
  const windows = buildWindows(pts, pts.map(p => p.ele));
  it('builds 100 m windows with grade and heading', () => {
    expect(windows).toHaveLength(50);
    expect(windows[25].grade).toBeCloseTo(0.06, 6);
    expect(windows[0].grade).toBeCloseTo(0, 6);
    expect(windows[10].heading).toBeCloseTo(90, 3);
  });
  it('finds flat / climb / flat hill segments', () => {
    const hills = hillSegments(windows);
    expect(hills.map(h => h.kind)).toEqual(['flat', 'climb', 'flat']);
    // the climb is trimmed to its core (85% of the rise), so its ends move in slightly
    expect(Math.abs(hills[1].d0 - 2000)).toBeLessThanOrEqual(150);
    expect(Math.abs(hills[1].d1 - 3000)).toBeLessThanOrEqual(150);
    expect(hills[1].gain).toBeGreaterThan(0.8 * 60);
  });
  it('finds a small hill on an otherwise flat course (relative, not absolute)', () => {
    // 10 km dead flat with one 8 m, 1% rise at 4–4.8 km and back down at 6–6.8 km
    const ele = d => (d < 4000 ? 0 : d < 4800 ? (d - 4000) * 0.01 : d < 6000 ? 8 : d < 6800 ? 8 - (d - 6000) * 0.01 : 0);
    const p = course(1001, ele);
    const hills = hillSegments(buildWindows(p, p.map(x => x.ele)));
    expect(hills.map(h => h.kind)).toEqual(['flat', 'climb', 'flat', 'descent', 'flat']);
  });
  it('a completely flat course is one flat segment', () => {
    const p = course(1001, () => 12);
    expect(hillSegments(buildWindows(p, p.map(x => x.ele))).map(h => h.kind)).toEqual(['flat']);
  });
  it('ignores bumps below the 5 m floor', () => {
    const p = course(1001, d => 2 * Math.sin(d / 300));
    expect(hillSegments(buildWindows(p, p.map(x => x.ele))).map(h => h.kind)).toEqual(['flat']);
  });
});

describe('adjustments', () => {
  const pts = course(4001, () => 0); // 40 km flat, heading east
  const windows = buildWindows(pts, pts.map(p => p.ele));
  const v0 = 40000 / (3 * 3600);
  it('is exactly the goal time with no adjustments or neutral conditions', () => {
    const w = attachWeather(windows, v0, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00');
    const r = computeAll(w, v0, { grade: true, wind: true, heat: true });
    expect(r.runs.base.total).toBeCloseTo(3 * 3600, 6);
    expect(Math.abs(r.impact.total)).toBeLessThan(1);
  });
  it('headwind slows, tailwind speeds up (course heads east)', () => {
    const head = attachWeather(windows, v0, hours({ tempC: 10, rh: 50, windMs: 5, windFromDeg: 90 }), '2026-10-01T08:00');
    const tail = attachWeather(windows, v0, hours({ tempC: 10, rh: 50, windMs: 5, windFromDeg: 270 }), '2026-10-01T08:00');
    expect(head[0].windAngle).toBeCloseTo(0, 3);
    const on = { grade: false, wind: true, heat: false };
    expect(runModel(head, v0, on).total).toBeGreaterThan(3 * 3600 + 60);
    expect(runModel(tail, v0, on).total).toBeLessThan(3 * 3600);
  });
  it('heat slows in hot humid conditions', () => {
    const w = attachWeather(windows, v0, hours({ tempC: 28, rh: 70, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00');
    expect(runModel(w, v0, { grade: false, wind: false, heat: true }).total).toBeGreaterThan(3 * 3600 + 180);
  });
  it('uphill costs more time than the same downhill saves', () => {
    const up = course(1001, d => d * 0.04), down = course(1001, d => -d * 0.04);
    const mk = p => attachWeather(buildWindows(p, p.map(x => x.ele)), v0, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00');
    const on = { grade: true, wind: false, heat: false };
    const base = 10000 / v0;
    const gainUp = runModel(mk(up), v0, on).total - base, gainDown = runModel(mk(down), v0, on).total - base;
    expect(gainUp).toBeGreaterThan(0);
    expect(gainDown).toBeLessThan(0);
    expect(gainUp).toBeGreaterThan(-gainDown);
  });
  it('descents steeper than −8% get no more benefit than −8%', () => {
    const mk = g => { const p = course(101, d => -d * g); return attachWeather(buildWindows(p, p.map(x => x.ele)), v0, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00'); };
    const on = { grade: true, wind: false, heat: false };
    const t8 = runModel(mk(0.08), v0, on).total, t15 = runModel(mk(0.15), v0, on).total, t5 = runModel(mk(0.05), v0, on).total;
    expect(t15).toBeCloseTo(t8, 6);
    expect(t5).toBeGreaterThan(t8); // gentler descents still scale normally
  });
  it('pace smoothing softens extremes but keeps the finish time exactly', async () => {
    const { smoothPacePlan } = await import('../src/lib/adjust.js');
    const p = course(2001, d => (d > 9000 && d < 9200 ? (d - 9000) * 0.1 : d >= 9200 ? 20 : 0)); // short 200 m, 10% pitch
    const w = attachWeather(buildWindows(p, p.map(x => x.ele)), v0, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00');
    const on = { grade: true, wind: false, heat: false };
    const raw = runModel(w, v0, on, { smoothM: 0 }), sm = runModel(w, v0, on);
    expect(sm.total).toBeCloseTo(raw.total, 6);
    expect(Math.min(...sm.speeds)).toBeGreaterThan(Math.min(...raw.speeds));
    // a uniform plan is unchanged
    smoothPacePlan(w, w.map(() => 3)).forEach(v => expect(v).toBeCloseTo(3, 9));
  });
  it('pacing opportunity scale', () => {
    expect(pacingOpportunity(-0.02 * 10000, 10000).score).toBeCloseTo(1);
    expect(pacingOpportunity(0.02 * 10000, 10000).score).toBeCloseTo(0.5);
    expect(pacingOpportunity(0.08 * 10000, 10000).label).toBe('Challenging');
  });
});

describe('evaluate mode (reverse conversion)', () => {
  // Hilly, windy, warm course: 3 rolling hills on a 20 km out-and-back-ish line heading east
  const pts = course(2001, d => 25 * Math.sin(d / 1500) + 10 * Math.sin(d / 400));
  const base = buildWindows(pts, pts.map(p => p.ele));
  const wxHours = [6, 7, 8, 9, 10, 11].map(t => ({ time: `2026-10-01T${String(t).padStart(2, '0')}:00`, tempC: 14 + (t - 6) * 2, rh: 70, windMs: 6, windFromDeg: 80 }));
  const goal = 5400; // 1:30:00 flat goal for 20 km
  const v0 = 20000 / goal;
  const combos = [
    { grade: true, wind: true, heat: true }, { grade: true, wind: false, heat: false },
    { grade: false, wind: true, heat: false }, { grade: false, wind: false, heat: true },
    { grade: true, wind: true, heat: false }, { grade: false, wind: false, heat: false }
  ];
  it('round trip: plan time → evaluate gives back the goal (same weather timing)', async () => {
    const { solveFlatSpeed } = await import('../src/lib/adjust.js');
    const w = attachWeather(base, v0, wxHours, '2026-10-01T08:00');
    for (const on of combos) {
      const courseTime = runModel(w, v0, on).total;
      const flat = 20000 / solveFlatSpeed(w, courseTime, on);
      expect(Math.abs(flat - goal)).toBeLessThan(0.05);
    }
  }, 30000); // heavy: many full model runs
  it('with weather timed by the actual pace (as the app does) the round trip stays within seconds', async () => {
    const { solveFlatSpeed } = await import('../src/lib/adjust.js');
    const on = combos[0];
    const courseTime = runModel(attachWeather(base, v0, wxHours, '2026-10-01T08:00'), v0, on).total;
    const w = attachWeather(base, 20000 / courseTime, wxHours, '2026-10-01T08:00');
    const flat = 20000 / solveFlatSpeed(w, courseTime, on);
    expect(Math.abs(flat - goal)).toBeLessThan(10);
  }, 30000); // heavy: many full model runs
  it('a hard course and day make the flat equivalent faster than the actual time', async () => {
    const { solveFlatSpeed } = await import('../src/lib/adjust.js');
    const actual = 6000;
    const w = attachWeather(base, 20000 / actual, wxHours, '2026-10-01T08:00');
    const flat = 20000 / solveFlatSpeed(w, actual, combos[0]);
    expect(flat).toBeLessThan(actual);
    // with every factor excluded the equivalent is the actual time
    expect(20000 / solveFlatSpeed(w, actual, combos[5])).toBeCloseTo(actual, 1);
  }, 30000); // heavy: many full model runs
});

describe('splits', () => {
  const pts = course(4001, () => 0);
  const windows = buildWindows(pts, pts.map(p => p.ele));
  const v0 = 4;
  const w = attachWeather(windows, v0, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-01T08:00');
  const base = runModel(w, v0, { grade: false, wind: false, heat: false });
  it('mile splits sum to the total and end with a partial mile', () => {
    const b = splitBoundaries('mi', w, []);
    const rows = makeSplits(w, base, base, b);
    expect(rows.reduce((s, r) => s + r.time, 0)).toBeCloseTo(base.total, 6);
    expect(rows[0].time).toBeCloseTo(1609.344 / 4, 6);
    expect(rows.at(-1).length).toBeLessThan(1609.344);
    expect(rows.every(r => Math.abs(r.delta) < 1e-9)).toBe(true);
  });
  it('timeAt interpolates within windows', () => {
    expect(timeAt(w, base.cum, 150)).toBeCloseTo(150 / 4, 6);
  });
});

describe('steep grade notes', () => {
  it('flags steep downhills and very steep uphills like the original app', async () => {
    const { steepGradeNotes } = await import('../src/lib/adjust.js');
    const w = [{ grade: -0.1, length: 500 }, { grade: 0.3, length: 200 }, { grade: 0.05, length: 1000 }];
    const notes = steepGradeNotes(w);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^0\.5 km/);
    expect(steepGradeNotes([{ grade: 0.02, length: 100 }])).toHaveLength(0);
  });
});
