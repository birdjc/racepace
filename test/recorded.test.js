import { describe, it, expect } from 'vitest';
import { parseGpx, parseGpxTime, timestampInfo } from '../src/lib/gpx.js';
import { resample } from '../src/lib/geo.js';
import { buildWindows } from '../src/lib/segments.js';
import { attachWeather, runModel, flatEquivalentSpeed } from '../src/lib/adjust.js';
import { analyseRecording, utcToLocal, STOP_SPEED } from '../src/lib/recorded.js';

const gpx = pts => `<gpx><trk><trkseg>${pts.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.time ? `<time>${p.time}</time>` : ''}</trkpt>`).join('')}</trkseg></trk></gpx>`;
// Straight line heading east along the equator, one point every 10 m, 3 m/s from 11:00 UTC
const line = (n, timeFn) => Array.from({ length: n }, (_, i) => ({ lat: 0, lon: i * 10 / 111195, time: timeFn(i) }));
const iso = ms => new Date(ms).toISOString();
const T0 = Date.parse('2026-10-04T11:00:00Z');

describe('GPX timestamps', () => {
  it('parses UTC, offsets, and zone-less times (treated as UTC)', () => {
    expect(parseGpxTime('2026-10-04T11:00:00Z')).toBe(T0);
    expect(parseGpxTime('2026-10-04T07:00:00-04:00')).toBe(T0);
    expect(parseGpxTime('2026-10-04T11:00:00')).toBe(T0);
    expect(parseGpxTime(null)).toBeNaN();
    expect(parseGpxTime('not a time')).toBeNaN();
  });
  it('accepts a proper recording', () => {
    const g = parseGpx(gpx(line(200, i => iso(T0 + i * 3333))));
    expect(g.timestamps.ok).toBe(true);
    expect(g.timestamps.elapsedSec).toBeCloseTo(199 * 3.333, 1);
  });
  it('rejects files without timestamps, with gaps, out of order, or implausible', () => {
    expect(parseGpx(gpx(line(50, () => null))).timestamps).toMatchObject({ ok: false, reason: 'no timestamps' });
    expect(parseGpx(gpx(line(50, i => (i % 3 ? null : iso(T0 + i * 1000))))).timestamps.ok).toBe(false);
    expect(parseGpx(gpx(line(50, i => iso(T0 + ((i * 37) % 50) * 1000)))).timestamps).toMatchObject({ ok: false, reason: 'timestamps are out of order' });
    expect(parseGpx(gpx(line(50, () => iso(T0)))).timestamps).toMatchObject({ ok: false, reason: 'the recorded duration is implausible' });
  });
  it('resampling interpolates timestamps along the course', () => {
    const g = parseGpx(gpx([{ lat: 0, lon: 0, time: iso(T0) }, { lat: 0, lon: 1000 / 111195, time: iso(T0 + 400000) }]));
    const r = resample(g.points, 10);
    expect(r[50].t).toBeCloseTo(T0 + 200000, -1); // halfway in distance → halfway in time
  });
  it('converts the UTC start to local wall time, DST-aware', () => {
    expect(utcToLocal(T0, 'America/New_York')).toBe('2026-10-04T07:00');           // EDT, UTC−4
    expect(utcToLocal(Date.parse('2026-12-06T12:30:00Z'), 'America/New_York')).toBe('2026-12-06T07:30'); // EST, UTC−5
    expect(utcToLocal(T0, 'Asia/Kolkata')).toBe('2026-10-04T16:30');
  });
});

describe('recorded-run analysis', () => {
  const hours = h => [10, 11, 12, 13].map(t => ({ time: `2026-10-04T${t}:00`, ...h }));
  it('flat equivalent undoes the plan chain (grade, wind, heat)', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ d: i * 10, lat: 0, lon: i * 10 / 111195, ele: i * 10 * 0.04 }));
    const [w] = attachWeather(buildWindows(pts, pts.map(p => p.ele), 1000), 3.4, hours({ tempC: 24, rh: 70, windMs: 5, windFromDeg: 60 }), '2026-10-04T11:00');
    for (const on of [{ grade: true, wind: true, heat: true }, { grade: true, wind: false, heat: false }, { grade: false, wind: true, heat: true }]) {
      const flat = 3.4;
      const actual = runModel([w], flat, on, { smoothM: 0 }).speeds[0];
      expect(flatEquivalentSpeed(w, actual, on) / flat).toBeCloseTo(1, 3);
    }
  });
  it('finds stops, keeps elapsed time, and leaves stops out of the effort analysis', () => {
    // 3 km at 3 m/s with a 120 s stop at 1.5 km
    const raw = line(301, i => iso(T0 + (i * 10 / 3) * 1000 + (i > 150 ? 120000 : 0)));
    const g = parseGpx(gpx(raw));
    const pts = resample(g.points, 10).map(p => ({ ...p, ele: 0 }));
    const windows = attachWeather(buildWindows(pts, pts.map(() => 0)), 3, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-04T11:00');
    const a = analyseRecording(windows, pts, { grade: true, wind: true, heat: true });
    expect(a.total).toBeCloseTo(1000 + 120, 0);
    expect(a.stoppedCount).toBe(1);
    expect(a.stoppedSec).toBeGreaterThan(110);
    expect(a.stoppedSec).toBeLessThan(130);
    expect(a.flatSpeeds.filter(Number.isNaN).length).toBe(1);
    // moving stretches on flat, calm, cool ground: flat equivalent ≈ the actual 3 m/s
    a.flatSpeeds.filter(Number.isFinite).forEach(v => expect(v).toBeCloseTo(3, 1));
    expect(STOP_SPEED).toBeGreaterThan(0);
  });
  it('catches a short pause inside one stretch (45 s at 3 m/s still averages above 1 m/s)', () => {
    const raw = line(301, i => iso(T0 + (i * 10 / 3) * 1000 + (i > 155 ? 45000 : 0)));
    const pts = resample(parseGpx(gpx(raw)).points, 10).map(p => ({ ...p, ele: 0 }));
    const windows = attachWeather(buildWindows(pts, pts.map(() => 0)), 3, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-04T11:00');
    const a = analyseRecording(windows, pts, { grade: true, wind: true, heat: true });
    expect(a.stoppedCount).toBe(1);
    expect(a.stoppedSec).toBeGreaterThan(38);
    expect(a.stoppedSec).toBeLessThan(52);
  });
  it('an even effort over hills comes back as an even flat-equivalent effort', () => {
    // 5 km of rolling 5% hills, run at the model's even-effort paces (no smoothing)
    const pts = Array.from({ length: 501 }, (_, i) => ({ d: i * 10, lat: 0, lon: i * 10 / 111195, ele: 20 * Math.sin(i * 10 / 400) }));
    const w0 = attachWeather(buildWindows(pts, pts.map(p => p.ele)), 3.5, hours({ tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }), '2026-10-04T11:00');
    const on = { grade: true, wind: false, heat: false };
    const sp = runModel(w0, 3.5, on, { smoothM: 0 }).speeds;
    let t = T0; const timed = pts.map((p, i) => ({ ...p, t: i === 0 ? T0 : (t += (10 / sp[Math.min(sp.length - 1, Math.floor((i - 1) / 10))]) * 1000) }));
    const a = analyseRecording(w0, timed, on);
    expect(a.stoppedCount).toBe(0);
    a.flatSpeeds.forEach(v => expect(v).toBeCloseTo(3.5, 1));
  });
});
