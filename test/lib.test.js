import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseGpx } from '../src/lib/gpx.js';
import { haversine, bearing, resample, fillNaN } from '../src/lib/geo.js';
import { parseDuration, formatDuration, formatPace, formatDelta } from '../src/lib/pace.js';
import { chooseSource, climatologyYears, shiftYear, averageHours, weatherForElapsed } from '../src/lib/weather.js';
import { movingAverage, savitzkyGolay, kalmanRts, profileStats } from '../src/lib/smoothing.js';
import { decodeTerrarium, lonLatToGlobalPixel } from '../src/lib/elevation.js';

describe('gpx', () => {
  it('parses trkpt with and without ele, ignoring extensions', () => {
    const xml = `<gpx><metadata><name>My Race</name></metadata><trk><trkseg>
      <trkpt lon="-71.0" lat="42.0"><ele>10.5</ele><extensions><hr>150</hr></extensions></trkpt>
      <trkpt lat="42.001" lon="-71.0"/>
      <trkpt lat='42.002' lon='-71.0'><ele>12</ele></trkpt></trkseg></trk></gpx>`;
    const g = parseGpx(xml);
    expect(g.name).toBe('My Race');
    expect(g.points).toHaveLength(3);
    expect(g.points[0]).toEqual({ lat: 42, lon: -71, ele: 10.5, t: NaN });
    expect(g.timestamps.ok).toBe(false);
    expect(Number.isNaN(g.points[1].ele)).toBe(true);
    expect(g.eleCoverage).toBeCloseTo(2 / 3);
  });
  it('falls back to route points', () => {
    const g = parseGpx('<gpx><rte><rtept lat="1" lon="1"/><rtept lat="1.01" lon="1"/></rte></gpx>');
    expect(g.points).toHaveLength(2);
  });
  it('rejects non-GPX', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow();
  });
  it('reads the fixture', () => {
    const g = parseGpx(fs.readFileSync('test/fixtures/boston-like-no-ele.gpx', 'utf8'));
    expect(g.points.length).toBe(661);
    expect(g.eleCoverage).toBe(0);
  });
});

describe('geo', () => {
  it('haversine: 1° latitude ≈ 111.2 km', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111195, -1);
  });
  it('bearing: north, east, south, west', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90);
    expect(bearing(1, 0, 0, 0)).toBeCloseTo(180);
    expect(bearing(0, 1, 0, 0)).toBeCloseTo(270);
  });
  it('resample gives uniform spacing and preserves total distance', () => {
    const pts = [{ lat: 0, lon: 0, ele: 0 }, { lat: 0, lon: 0, ele: 0 }, { lat: 0.01, lon: 0, ele: 100 }];
    const r = resample(pts, 10);
    const total = haversine(0, 0, 0.01, 0);
    expect(r.at(-1).d).toBeCloseTo(total, 6);
    expect(r[1].d - r[0].d).toBeCloseTo(total / (r.length - 1), 6);
    expect(r[Math.floor(r.length / 2)].ele).toBeCloseTo(50, 0);
  });
  it('fillNaN interpolates interior and extends edges', () => {
    expect(fillNaN([NaN, 1, NaN, 3, NaN])).toEqual([1, 1, 2, 3, 3]);
  });
});

describe('pace', () => {
  it('parses durations', () => {
    expect(parseDuration('3:15:00')).toBe(11700);
    expect(parseDuration('3:15')).toBe(11700);
    expect(parseDuration('abc')).toBeNaN();
  });
  it('formats', () => {
    expect(formatDuration(11700)).toBe('3:15:00');
    expect(formatDuration(287)).toBe('4:47');
    expect(formatPace(1609.344 / 420, 'mi')).toBe('7:00/mi');
    expect(formatDelta(-65)).toBe('−1:05');
    expect(formatDelta(-0.2)).toBe('+0:00');
  });
});

describe('weather helpers', () => {
  it('chooses source by date', () => {
    expect(chooseSource('2025-04-21', '2026-09-26')).toBe('archive');
    expect(chooseSource('2026-09-24', '2026-09-26')).toBe('forecast');
    expect(chooseSource('2026-10-11', '2026-09-26')).toBe('forecast');
    expect(chooseSource('2026-10-12', '2026-09-26')).toBe('climatology');
  });
  it('climatology years skip not-yet-archived dates', () => {
    expect(climatologyYears('2027-04-19', '2026-09-26')).toEqual([2026, 2025, 2024]);
    expect(climatologyYears('2027-09-28', '2026-09-26')).toEqual([2025, 2024, 2023]);
    expect(shiftYear('2028-02-29', 2027)).toBe('2027-02-28');
  });
  it('averages wind direction as a vector', () => {
    const mk = (dir) => [{ time: '2025-01-01T08:00', tempC: 10, rh: 50, windMs: 2, windFromDeg: dir }];
    const avg = averageHours([mk(350), mk(10)], '2027-01-01');
    expect(avg[0].windFromDeg % 360).toBeCloseTo(0, 6);
    expect(avg[0].time).toBe('2027-01-01T08:00');
  });
  it('assigns hour blocks from the start time', () => {
    const hours = [8, 9, 10, 11].map(h => ({ time: `2026-10-01T${String(h).padStart(2, '0')}:00`, tempC: h, rh: 50, windMs: 1, windFromDeg: 350 + h }));
    expect(weatherForElapsed(hours, '2026-10-01T08:00', 0).tempC).toBe(8);
    expect(weatherForElapsed(hours, '2026-10-01T08:00', 3599).tempC).toBe(8);
    expect(weatherForElapsed(hours, '2026-10-01T08:00', 7300).tempC).toBe(10);
    const half = weatherForElapsed(hours, '2026-10-01T08:30', 0);
    expect(half.tempC).toBeCloseTo(8.5);
    expect(half.windFromDeg).toBeCloseTo(358.5);
  });
});

describe('smoothing', () => {
  const spacing = 10;
  const truth = Array.from({ length: 2000 }, (_, i) => 30 * Math.sin(i * spacing / 1500));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const noisy = truth.map(v => v + 6 * rand());
  const rmse = a => Math.sqrt(a.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0) / a.length);
  for (const [name, f] of [['movingAverage', e => movingAverage(e, spacing, 100)], ['savitzkyGolay', e => savitzkyGolay(e, spacing, 150, 2)], ['kalmanRts', e => kalmanRts(e, spacing)]]) {
    it(`${name} reduces noise and gain inflation`, () => {
      const s = f(noisy);
      expect(s).toHaveLength(noisy.length);
      expect(rmse(s)).toBeLessThan(rmse(noisy) / 2);
      const trueGain = profileStats(truth, spacing).gain;
      expect(profileStats(s, spacing).gain).toBeLessThan(profileStats(noisy, spacing).gain / 3);
      expect(profileStats(s, spacing).gain).toBeGreaterThan(trueGain * 0.8);
    });
  }
  it('savitzkyGolay preserves a straight line exactly', () => {
    const line = Array.from({ length: 50 }, (_, i) => 2 * i + 5);
    savitzkyGolay(line, 10, 100, 2).forEach((v, i) => expect(v).toBeCloseTo(line[i], 8));
  });
});

describe('elevation', () => {
  it('decodes terrarium', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(135, 125, 25.6)).toBeCloseTo(1917.1, 1);
  });
  it('projects lon/lat to pixels', () => {
    const p = lonLatToGlobalPixel(0, 0, 0);
    expect(p.x).toBeCloseTo(128); expect(p.y).toBeCloseTo(128);
  });
});
