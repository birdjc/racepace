// GPX parsing. Regex-based so it runs identically in the browser and in Node tests.
// Reads track points (trkpt), falling back to route points (rtept), then waypoints (wpt).
// Keeps lat, lon, ele and the point timestamp (ms since epoch, NaN if absent); HR, cadence and
// other extensions are ignored.

const POINT_TAGS = ['trkpt', 'rtept', 'wpt'];

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? parseFloat(m[1]) : NaN;
}

function firstText(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null;
}

function parsePoints(xml, tag) {
  // Matches both <trkpt ...>...</trkpt> and self-closing <trkpt .../>
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
  const points = [];
  for (const m of xml.matchAll(re)) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleText = m[2] ? firstText(m[2], 'ele') : null;
    const ele = eleText === null ? NaN : parseFloat(eleText);
    const timeText = m[2] ? firstText(m[2], 'time') : null;
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : NaN, t: parseGpxTime(timeText) });
  }
  return points;
}

// GPX times are UTC by spec. A time written without a zone is treated as UTC too
// (JavaScript would otherwise read it as the browser's local time).
export function parseGpxTime(text) {
  if (!text) return NaN;
  const iso = /(Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

// Does the file hold a usable recording? Requires timestamps on ≥ 90% of points, times that run
// forwards, and a duration between 1 minute and 48 hours.
export const MIN_TIME_COVERAGE = 0.9;
export function timestampInfo(points) {
  const timed = points.filter(p => Number.isFinite(p.t));
  const coverage = timed.length / points.length;
  if (coverage < MIN_TIME_COVERAGE) return { ok: false, coverage, reason: timed.length ? 'only some points have timestamps' : 'no timestamps' };
  let backwards = 0;
  for (let i = 1; i < timed.length; i++) if (timed[i].t < timed[i - 1].t) backwards++;
  if (backwards > timed.length * 0.01) return { ok: false, coverage, reason: 'timestamps are out of order' };
  const startMs = timed[0].t, endMs = timed[timed.length - 1].t;
  const elapsedSec = (endMs - startMs) / 1000;
  if (!(elapsedSec >= 60 && elapsedSec <= 48 * 3600)) return { ok: false, coverage, reason: 'the recorded duration is implausible' };
  return { ok: true, coverage, startMs, endMs, elapsedSec };
}

export function parseGpx(xml) {
  if (typeof xml !== 'string' || !/<(?:\w+:)?gpx\b/.test(xml)) {
    throw new Error('Not a GPX file.');
  }
  let points = [];
  for (const tag of POINT_TAGS) {
    points = parsePoints(xml, tag);
    if (points.length >= 2) break;
  }
  if (points.length < 2) throw new Error('GPX file has no usable track or route points.');

  const metadata = firstText(xml, 'metadata');
  const trk = firstText(xml, 'trk') ?? firstText(xml, 'rte');
  const name = (metadata && firstText(metadata, 'name')) || (trk && firstText(trk, 'name')) || null;

  const withEle = points.filter(p => Number.isFinite(p.ele)).length;
  return { name, points, eleCoverage: withEle / points.length, timestamps: timestampInfo(points) };
}
