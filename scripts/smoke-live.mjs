// Live smoke test: DEM elevation + Open-Meteo for all three weather sources
import fs from 'fs';
import { nodeTileLoader } from './node-tile-loader.mjs';
import { sampleElevations } from '../src/lib/elevation.js';
import { buildCourse } from '../src/lib/course.js';
import { getRaceWeather } from '../src/lib/weather.js';
import { profileStats } from '../src/lib/smoothing.js';

const known = [
  { name: 'Mt Washington summit', lat: 44.2706, lon: -71.3033, ele: 1917 },
  { name: 'Denver Capitol steps', lat: 39.7393, lon: -104.9848, ele: 1609 },
  { name: 'Boston Common', lat: 42.3551, lon: -71.0656, ele: 15 }
];
const e = await sampleElevations(known, { loadTile: nodeTileLoader });
known.forEach((k, i) => console.log(`${k.name}: DEM ${e[i].toFixed(1)} m (reference ~${k.ele} m)`));

let t = Date.now();
const course = await buildCourse(fs.readFileSync('test/fixtures/boston-like-no-ele.gpx', 'utf8'), { loadTile: nodeTileLoader });
console.log(`course: ${(course.distance / 1000).toFixed(2)} km, ${course.points.length} pts, ele from ${course.elevationSource}, start ${course.points[0].ele.toFixed(0)} m, finish ${course.points.at(-1).ele.toFixed(0)} m, ${Date.now() - t} ms`);
const st = profileStats(course.points.map(p => p.ele), course.spacing);
console.log(`raw DEM gain/loss: +${st.gain.toFixed(0)} / -${st.loss.toFixed(0)} m`);

for (const startLocal of ['2025-04-21T10:00', '2026-10-01T08:00', '2027-04-19T10:00']) {
  const w = await getRaceWeather({ lat: course.centroid.lat, lon: course.centroid.lon, startLocal, durationSec: 3 * 3600 + 15 * 60, todayIso: '2026-09-26' });
  console.log(`\n${startLocal} -> ${w.source}${w.years ? ' ' + w.years.join(',') : ''} tz=${w.timezone}`);
  for (const h of w.hours) console.log(`  ${h.time}  ${h.tempC.toFixed(1)}°C  ${h.rh.toFixed(0)}%  wind ${h.windMs.toFixed(1)} m/s from ${h.windFromDeg.toFixed(0)}°`);
}
