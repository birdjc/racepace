// Course preparation: GPX text -> uniform 10 m profile with elevation.
import { parseGpx } from './gpx.js';
import { resample, centroid } from './geo.js';
import { sampleElevations } from './elevation.js';

export const RESAMPLE_SPACING_M = 10;
export const MIN_GPX_ELE_COVERAGE = 0.9; // use embedded elevation if ≥ 90% of points have <ele>

export async function buildCourse(gpxText, { loadTile, spacing = RESAMPLE_SPACING_M, forceDem = false } = {}) {
  const gpx = parseGpx(gpxText);
  const useGpxEle = !forceDem && gpx.eleCoverage >= MIN_GPX_ELE_COVERAGE;
  const points = resample(gpx.points, spacing);
  let elevationSource = 'gpx';
  if (!useGpxEle) {
    const ele = await sampleElevations(points, loadTile ? { loadTile } : {});
    points.forEach((p, i) => { p.ele = ele[i]; });
    elevationSource = 'dem';
  }
  return {
    name: gpx.name,
    points,
    spacing: points[1].d - points[0].d,
    distance: points[points.length - 1].d,
    centroid: centroid(points),
    elevationSource,
    gpxEleCoverage: gpx.eleCoverage
  };
}
