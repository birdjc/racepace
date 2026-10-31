import { describe, it, expect } from 'vitest';
import { buildWindows } from '../src/lib/segments.js';
import { attachWeather, runModel } from '../src/lib/adjust.js';
import { makeSplits, unitBoundaries } from '../src/lib/splits.js';
import { addEdit, findEdit, effortRun, adjustedRun } from '../src/lib/edits.js';
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

describe('edited effort splits', () => {
  const model = splits(run);
  const mi = M_PER_MI;
  it('re-runs only the edited split at the new effort; the finish moves by that change', () => {
    const v = 3.8; // faster effort for mile 3
    const edits = addEdit([], model[2].d0, model[2].d1, v);
    const plan = adjustedRun(windows, run, edits, on);
    const rows = splits(plan);
    rows.forEach((r, i) => { if (i !== 2) expect(r.time).toBeCloseTo(model[i].time, 6); });
    expect(rows[2].time).toBeLessThan(model[2].time - 15);
    expect(plan.total - run.total).toBeCloseTo(rows[2].time - model[2].time, 6);
    // per-window speeds and cumulative times agree with the exact time function
    expect(plan.cum[plan.cum.length - 1]).toBeCloseTo(plan.total, 6);
    expect(windows.reduce((s, w, i) => s + w.length / plan.speeds[i], 0)).toBeCloseTo(plan.total, 6);
  });
  it('the effort profile changes the same split by exactly the new effort time', () => {
    const edits = addEdit([], model[2].d0, model[2].d1, 3.8);
    const eff = effortRun(windows, base, edits);
    const rows = makeSplits(windows, eff, base, bounds);
    expect(rows[2].time).toBeCloseTo(mi / 3.8, 6);
    expect(rows[1].time).toBeCloseTo(mi / 3.5, 6);
    expect(eff.total - base.total).toBeCloseTo(mi / 3.8 - mi / 3.5, 6);
  });
  it('with every factor off, the adjusted split equals the effort split', () => {
    const off = { grade: false, wind: false, heat: false };
    const plain = runModel(windows, 3.5, off);
    const edits = addEdit([], model[1].d0, model[1].d1, 4);
    expect(splits(adjustedRun(windows, plain, edits, off))[1].time).toBeCloseTo(mi / 4, 6);
  });
  it('setting the base effort back changes nothing', () => {
    const plan = adjustedRun(windows, run, addEdit([], model[3].d0, model[3].d1, 3.5), on);
    expect(plan.total).toBeCloseTo(run.total, 6);
  });
  it('stacks several edits and resets one', () => {
    let edits = addEdit([], model[0].d0, model[0].d1, 3.2);
    edits = addEdit(edits, model[4].d0, model[4].d1, 3.9);
    expect(edits).toHaveLength(2);
    edits = addEdit(edits, model[0].d0, model[0].d1, null);
    expect(edits).toHaveLength(1);
    expect(findEdit(edits, model[4].d0, model[4].d1).v).toBe(3.9);
    const rows = splits(adjustedRun(windows, run, edits, on));
    expect(rows[0].time).toBeCloseTo(model[0].time, 6);
    expect(rows[4].time).toBeLessThan(model[4].time);
  });
  it('a new edit replaces any edit it overlaps (e.g. km edit over a mile edit)', () => {
    let edits = addEdit([], 0, M_PER_MI, 3.6);
    edits = addEdit(edits, 1000, 2000, 3.7);
    expect(edits).toEqual([{ d0: 1000, d1: 2000, v: 3.7 }]);
    edits = addEdit(edits, 2000, 3000, 3.7); // touching is not overlapping
    expect(edits).toHaveLength(2);
  });
  it('no edits leaves the runs unchanged', () => {
    const plan = adjustedRun(windows, run, [], on);
    expect(plan.total).toBe(run.total);
    expect(plan.timeAt(5000)).toBeCloseTo(run.cum[50], 6);
    expect(effortRun(windows, base, []).total).toBe(base.total);
  });
});
