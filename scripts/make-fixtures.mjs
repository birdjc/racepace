// Builds synthetic test GPX files along approximate Boston Marathon waypoints.
// Straight lines between waypoints, so this is a test course, not the real route.
import fs from 'fs';
const wps = [
  [42.2296, -71.5226], [42.2449, -71.4880], [42.2612, -71.4634], [42.2793, -71.4162],
  [42.2835, -71.3495], [42.2968, -71.2924], [42.3130, -71.2520], [42.3355, -71.2006],
  [42.3389, -71.1690], [42.3364, -71.1497], [42.3489, -71.0951], [42.3499, -71.0786]
];
const pts = [];
for (let i = 0; i < wps.length - 1; i++) {
  const [a, b] = [wps[i], wps[i + 1]];
  const n = 60;
  for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
}
pts.push(wps[wps.length - 1]);
const gpx = (body, name) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  <trk><name>${name}</name><trkseg>
${body}
  </trkseg></trk>
</gpx>
`;
fs.writeFileSync('test/fixtures/boston-like-no-ele.gpx',
  gpx(pts.map(([la, lo]) => `    <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"></trkpt>`).join('\n'), 'Boston-like test course'));
console.log('points', pts.length);
