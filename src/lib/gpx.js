// GPX parsing. Regex-based so it runs identically in the browser and in Node tests.
// Reads track points (trkpt), falling back to route points (rtept), then waypoints (wpt).
// Keeps lat, lon, ele, the point timestamp (ms since epoch, NaN if absent) and the track segment
// index; HR, cadence and other extensions are ignored.
import { haversine } from './geo.js';

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
  // Track points: remember which <trkseg> each came from (some apps start a new segment after a pause)
  if (tag === 'trkpt') {
    const chunks = xml.split(/<(?:\w+:)?trkseg\b/).slice(1);
    if (chunks.length > 1) return chunks.flatMap((c, seg) => parseChunk(c, tag, seg));
  }
  return parseChunk(xml, tag, 0);
}

function parseChunk(xml, tag, seg) {
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
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : NaN, t: parseGpxTime(timeText), seg });
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
  const pauses = findPauses(points);
  const pausedSec = pauses.reduce((s, q) => s + q.sec, 0);
  return { ok: true, coverage, startMs, endMs, elapsedSec, pauses, pausedSec };
}

// Watch pauses. GPX has no pause flag: a paused watch simply stops recording, which leaves a time gap
// between two neighbouring points with little distance between them. Some apps also start a new
// <trkseg> after a pause. A gap counts as a pause when it is longer than 10 s and 5× the file's usual
// point spacing and the distance across it is covered slower than 1 m/s; a slower-than-that gap
// covered at running pace is a GPS dropout (e.g. a tunnel) and keeps its time. Distance moved while
// paused keeps the time it would take at your usual moving speed, so only the rest is removed.
// Returns [{ d (m along the track), startMs, endMs, sec (removed), moved (m), segBreak }].
export const PAUSE_MIN_GAP_SEC = 10;
export const PAUSE_GAP_FACTOR = 5;
export const PAUSE_MAX_SPEED = 1.0; // m/s
export function findPauses(points) {
  // Distance along the track without dropping duplicate points (matches withDistance within 1 cm)
  let d = 0;
  const pts = [];
  points.forEach((p, i) => {
    if (i) d += haversine(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon);
    if (Number.isFinite(p.t)) pts.push({ ...p, d });
  });
  const steps = pts.slice(1).map((b, i) => ({ dt: (b.t - pts[i].t) / 1000, dd: b.d - pts[i].d })).filter(x => x.dt > 0);
  if (steps.length < 2) return [];
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
  const spacing = median(steps.map(x => x.dt));
  const moving = steps.filter(x => x.dt <= 3 * spacing && x.dd / x.dt >= PAUSE_MAX_SPEED).map(x => x.dd / x.dt);
  const vTypical = moving.length ? median(moving) : 3;
  const minGap = Math.max(PAUSE_MIN_GAP_SEC, PAUSE_GAP_FACTOR * spacing);
  const pauses = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dt = (b.t - a.t) / 1000, moved = b.d - a.d;
    const segBreak = a.seg !== b.seg;
    const gap = dt > minGap && moved / dt < PAUSE_MAX_SPEED;
    if (!gap && !(segBreak && dt > Math.max(2, 2 * spacing))) continue;
    const sec = Math.max(0, dt - moved / vTypical);
    if (sec >= 1) pauses.push({ d: a.d, startMs: a.t, endMs: b.t, sec, moved, segBreak });
  }
  return pauses;
}

// Moving clock: a real timestamp → the same timestamp with all pause time before it removed
// (spread evenly across a pause that is in progress)
export function movingClock(pauses) {
  return t => {
    let removed = 0;
    for (const q of pauses) {
      if (t >= q.endMs) removed += q.sec * 1000;
      else if (t > q.startMs) removed += q.sec * 1000 * (t - q.startMs) / (q.endMs - q.startMs);
    }
    return t - removed;
  };
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
