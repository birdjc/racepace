// Before/after the −8% downhill cap on the test course (grade only, 7:53/mi effort)
import fs from 'fs';
import { nodeTileLoader } from './node-tile-loader.mjs';
import { buildCourse } from '../src/lib/course.js';
import { smoothElevation } from '../src/lib/profile.js';
import { buildWindows } from '../src/lib/segments.js';
import { hillSpeedFromFlatEffort } from '../formulas/gap.js';
import { DOWNHILL_CAP_GRADE } from '../src/lib/adjust.js';
const pace = v => { const s = 1609.344 / v; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const c = await buildCourse(fs.readFileSync('test/fixtures/boston-like-no-ele.gpx', 'utf8'), { loadTile: nodeTileLoader });
const W = buildWindows(c.points, smoothElevation(c).ele);
const v0 = c.distance / 11700;
for (const [label, cap] of [['before', -0.45], ['after ', DOWNHILL_CAP_GRADE]]) {
  const sp = W.map(w => hillSpeedFromFlatEffort(v0, Math.max(cap, Math.min(0.45, w.grade))));
  const t = W.reduce((s, w, i) => s + w.length / sp[i], 0);
  const sorted = [...sp].sort((a, b) => b - a);
  console.log(`${label}: fastest ${pace(sorted[0])}, 2nd-percentile fastest ${pace(sorted[Math.floor(sp.length * 0.02)])}, slowest ${pace(Math.min(...sp))}, grade effect +${((t - c.distance / v0) / 60).toFixed(2)} min`);
}
console.log(`flat 7:53 → −5%: ${pace(hillSpeedFromFlatEffort(v0, -0.05))}, −8% (cap): ${pace(hillSpeedFromFlatEffort(v0, -0.08))}, −13% uncapped: ${pace(hillSpeedFromFlatEffort(v0, -0.13))}`);
