// GPX parsing. Regex-based so it runs identically in the browser and in Node tests.
// Reads track points (trkpt), falling back to route points (rtept), then waypoints (wpt).
// Keeps lat, lon and ele; HR, cadence, time and other extensions are ignored.

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
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : NaN });
  }
  return points;
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
  return { name, points, eleCoverage: withEle / points.length };
}
