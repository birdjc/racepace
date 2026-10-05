// Builds public/demo/demo-run.gpx: the demo course with synthetic watch timestamps, for trying the
// "use the recorded run" option. Even effort by the grade model (3:20 flat equivalent) with ±4%
// random variation per 100 m and a 45 s stop near halfway; start 2026-04-20 10:00 EDT (14:00 UTC).
import fs from 'fs';
import { nodeTileLoader } from './node-tile-loader.mjs';
import { buildCourse } from '../src/lib/course.js';
import { smoothElevation } from '../src/lib/profile.js';
import { buildWindows } from '../src/lib/segments.js';
import { runModel } from '../src/lib/adjust.js';
import { parseGpx } from '../src/lib/gpx.js';
import { withDistance } from '../src/lib/geo.js';
import { timeAt } from '../src/lib/splits.js';

const src = fs.readFileSync('public/demo/demo-course.gpx', 'utf8');
const course = await buildCourse(src, { loadTile: nodeTileLoader });
const windows = buildWindows(course.points, smoothElevation(course).ele).map(w => ({ ...w, wx: { tempC: 10, rh: 50, windMs: 0, windFromDeg: 0 }, windAngle: 0 }));
const v0 = course.distance / (3 * 3600 + 20 * 60);
const run = runModel(windows, v0, { grade: true, wind: false, heat: false });

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
// Even effort: the unsmoothed per-stretch paces (what a runner holding steady effort would do), ±4% noise
const times = windows.map((w, i) => w.length / run.rawSpeeds[i] * (1 + 0.08 * rand()));
const stopAt = Math.floor(windows.length * 0.52);
times[stopAt] += 45;
const cum = [0];
times.forEach(t => cum.push(cum[cum.length - 1] + t));

const start = Date.parse('2026-04-20T14:00:00Z');
const pts = withDistance(parseGpx(src).points);
const scale = course.distance / pts[pts.length - 1].d;
const body = pts.map(p => {
  const t = start + timeAt(windows, cum, p.d * scale) * 1000;
  return `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(Math.round(t / 1000) * 1000).toISOString().replace('.000', '')}</time></trkpt>`;
}).join('\n');
fs.writeFileSync('public/demo/demo-run.gpx', `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="race-pace-app demo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Demo recorded run</name><time>2026-04-20T14:00:00Z</time></metadata>
  <trk><name>Demo recorded run</name><trkseg>
${body}
  </trkseg></trk>
</gpx>
`);
console.log(`demo-run.gpx: ${pts.length} points, elapsed ${(cum[cum.length - 1] / 60).toFixed(1)} min`);
