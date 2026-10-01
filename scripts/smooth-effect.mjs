// Effect of pace-plan smoothing on the test course (grade only, 7:53/mi effort, −8% cap on)
import fs from 'fs';
import { nodeTileLoader } from './node-tile-loader.mjs';
import { buildCourse } from '../src/lib/course.js';
import { smoothElevation } from '../src/lib/profile.js';
import { buildWindows } from '../src/lib/segments.js';
import { attachWeather, runModel } from '../src/lib/adjust.js';
import { makeSplits, splitBoundaries } from '../src/lib/splits.js';
const pace = v => { const s = 1609.344 / v; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const c = await buildCourse(fs.readFileSync('test/fixtures/boston-like-no-ele.gpx', 'utf8'), { loadTile: nodeTileLoader });
const v0 = c.distance / 11700;
const hours = [6, 7, 8, 9, 10, 11, 12].map(h => ({ time: `2026-10-01T${String(h).padStart(2, '0')}:00`, tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }));
const W = attachWeather(buildWindows(c.points, smoothElevation(c).ele), v0, hours, '2026-10-01T08:00');
const on = { grade: true, wind: false, heat: false };
const base = runModel(W, v0, { grade: false, wind: false, heat: false });
for (const R of [0, 200, 400]) {
  const r = runModel(W, v0, on, { smoothM: R });
  const miles = makeSplits(W, r, base, splitBoundaries('mi', W, []));
  const mp = miles.slice(0, -1).map(m => m.time);
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`±${String(R).padStart(3)} m: 100 m stretches ${pace(Math.max(...r.speeds))}–${pace(Math.min(...r.speeds))}/mi | mile splits ${fmt(Math.min(...mp))}–${fmt(Math.max(...mp))} | grade effect +${((r.total - base.total) / 60).toFixed(2)} min`);
}
