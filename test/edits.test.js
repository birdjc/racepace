import { describe, it, expect } from 'vitest';
import { buildWindows } from '../src/lib/segments.js';
import { attachWeather, runModel } from '../src/lib/adjust.js';
import { makeSplits, unitBoundaries } from '../src/lib/splits.js';
import { addEdit, findEdit, applyEdits, editFlatShift } from '../src/lib/edits.js';
import { parseSplit, M_PER_MI } from '../src/lib/pace.js';

// 10 km due east along the equator: rolling hills, warm and breezy
const dLon = 10 / 111195;
const pts = Array.from({ length: 1001 }, (_, i) => ({ d: i * 10, lat: 0, lon: i * dLon, ele: 15 * Math.sin(i * 10 / 600) }));
const hours = [7, 8, 9].map(t => ({ time: `2026-10-01T0${t}:00`, tempC: 24, rh: 70, windMs: 4, windFromDeg: 60 }));
const windows = attachWeather(buildWindows(pts, pts.map(p => p.ele)), 3.5, hours, '2026-10-01T07:00');
const on = { grade: true, wind: true, heat: true };
const run = runModel(windows, 3.5, on);
const base = runModel(windows, 3.5, { grade: false, wind: false, heat: false });
const bounds = unitBoundaries(10000, M_PER_MI);
const splits = r => makeSplits(windows, r, base, bounds);

describe('parseSplit', () => {
  it('reads m:ss, h:mm:ss and digits-only entries', () => {
    expect(parseSplit('7:42')).toBe(462);
    expect(parseSplit('1:02:30')).toBe(3750);
    expect(parseSplit('742')).toBe(462);
    expect(parseSplit('8')).toBe(480);
    expect(parseSplit('10230')).toBe(3750);
    expect(parseSplit(' 6:05.5 ')).toBe(365.5);
  });
  it('rejects bad entries', () => {
    for (const t of ['', '7:75', '760', 'abc', '1:2:3:4', '0:00', '7:', ':30']) expect(parseSplit(t)).toBeNaN();
  });
});

describe('edited splits', () => {
  const model = splits(run);
  it('changes only the edited split, and the finish by the same amount', () => {
    const edits = addEdit([], model[2].d0, model[2].d1, model[2].time + 20);
    const plan = applyEdits(windows, run, edits);
    const rows = splits(plan);
    rows.forEach((r, i) => expect(r.time).toBeCloseTo(i === 2 ? model[2].time + 20 : model[i].time, 6));
    expect(plan.total).toBeCloseTo(run.total + 20, 6);
    // per-window speeds and cumulative times agree with the exact time function
    expect(plan.cum[plan.cum.length - 1]).toBeCloseTo(plan.total, 6);
    expect(windows.reduce((s, w, i) => s + w.length / plan.speeds[i], 0)).toBeCloseTo(plan.total, 6);
  });
  it('stacks several edits and resets one', () => {
    let edits = addEdit([], model[0].d0, model[0].d1, 400);
    edits = addEdit(edits, model[4].d0, model[4].d1, 520);
    let rows = splits(applyEdits(windows, run, edits));
    expect(rows[0].time).toBeCloseTo(400, 6);
    expect(rows[4].time).toBeCloseTo(520, 6);
    expect(rows[2].time).toBeCloseTo(model[2].time, 6);
    edits = addEdit(edits, model[0].d0, model[0].d1, null);
    expect(edits).toHaveLength(1);
    expect(findEdit(edits, model[4].d0, model[4].d1).sec).toBe(520);
    rows = splits(applyEdits(windows, run, edits));
    expect(rows[0].time).toBeCloseTo(model[0].time, 6);
  });
  it('a new edit replaces any edit it overlaps (e.g. km edit over a mile edit)', () => {
    let edits = addEdit([], 0, M_PER_MI, 420);
    edits = addEdit(edits, 1000, 2000, 270);
    expect(edits).toEqual([{ d0: 1000, d1: 2000, sec: 270 }]);
    edits = addEdit(edits, 2000, 3000, 270); // touching is not overlapping
    expect(edits).toHaveLength(2);
  });
  it('no edits leaves the run unchanged', () => {
    const plan = applyEdits(windows, run, []);
    expect(plan.total).toBe(run.total);
    expect(plan.timeAt(5000)).toBeCloseTo(run.cum[50], 6);
    expect(editFlatShift(windows, run, [], on)).toBe(0);
  });
  it('flat equivalent of an edit: equal to the course change with every factor off, smaller-or-similar with them on', () => {
    const off = { grade: false, wind: false, heat: false };
    const plain = runModel(windows, 3.5, off);
    const m = makeSplits(windows, plain, base, bounds);
    const e = addEdit([], m[1].d0, m[1].d1, m[1].time - 15);
    expect(editFlatShift(windows, plain, e, off)).toBeCloseTo(-15, 6);
    const e2 = addEdit([], model[1].d0, model[1].d1, model[1].time - 15);
    const shift = editFlatShift(windows, run, e2, on);
    expect(shift).toBeLessThan(0);
    expect(Math.abs(shift)).toBeGreaterThan(10);
    expect(Math.abs(shift)).toBeLessThan(20);
  });
});
