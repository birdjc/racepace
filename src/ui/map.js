// Course map: themed basemap (CARTO with a key, otherwise OSM), route coloured by pace change, distance markers,
// hover → distance callback, focus marker and range highlight driven by other views.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { currentTheme, cssVar } from './util.js';

// Basemap: CARTO light_all / dark_all when a CARTO key is configured (VITE_CARTO_KEY, injected at
// build time from the environment, never committed). Without a key, fall back to keyless
// OpenStreetMap tiles, with the dark theme made by a CSS filter (see .map-osm in styles.css).
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY ?? '').trim();
const BASEMAPS = CARTO_KEY
  ? {
      provider: 'carto',
      url: theme => `https://basemaps.cartocdn.com/rastertiles/${theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`,
      options: { maxZoom: 20 },
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  : {
      provider: 'osm',
      url: () => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19 },
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    };
export const BASEMAP_PROVIDER = BASEMAPS.provider;

export class CourseMap {
  constructor(el, { onHover, onLeave }) {
    this.map = L.map(el, { zoomControl: true, preferCanvas: true, scrollWheelZoom: false });
    this.renderer = L.canvas({ padding: 0.5, tolerance: 8 });
    this.tiles = null;
    this.setTheme(currentTheme());
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.markerLayer = L.layerGroup().addTo(this.map);
    this.highlightLayer = L.layerGroup().addTo(this.map);
    this.focusMarker = null;
    this.onHover = onHover;
    this.onLeave = onLeave;
    // Scroll-wheel zoom only after the user clicks into the map (avoids hijacking page scroll)
    this.map.on('click', () => this.map.scrollWheelZoom.enable());
    this.map.on('mouseout', () => this.map.scrollWheelZoom.disable());
    // Touch devices: one-finger panning only after the map is tapped, so swiping over it scrolls the
    // page instead of trapping it. Pinch-zoom always works. lock() is called on taps outside the map.
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    if (this.touch) {
      this.map.dragging.disable();
      el.classList.add('map-locked');
      this.map.on('click', () => this.unlock());
    }
  }

  setTheme(theme) {
    const el = this.map.getContainer();
    el.classList.toggle('map-osm', BASEMAPS.provider === 'osm');
    el.classList.toggle('map-dark', theme === 'dark');
    const url = BASEMAPS.url(theme);
    if (!this.tiles) {
      this.tiles = L.tileLayer(url, { ...BASEMAPS.options, attribution: BASEMAPS.attribution }).addTo(this.map);
      this.tiles.on('tileerror', () => this.onTileError?.());
    } else if (this.tiles._url !== url) {
      this.tiles.setUrl(url); // CARTO: swap light_all ↔ dark_all
    }
  }

  // course: { points: [{lat, lon, d}] }, windows: [{i0, i1}], colors: one per window
  setRoute(course, windows, colors) {
    this.course = course;
    this.windows = windows;
    this.routeLayer.clearLayers();
    const pts = course.points;
    // Under-stroke for contrast against any basemap
    const casing = cssVar('--surface');
    L.polyline(pts.map(p => [p.lat, p.lon]), { renderer: this.renderer, color: casing, weight: 10, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
    this.segments = windows.map((w, i) =>
      L.polyline(pts.slice(w.i0, w.i1 + 1).map(p => [p.lat, p.lon]), { renderer: this.renderer, color: colors[i], weight: 6, opacity: 1, interactive: false, lineCap: 'butt' }).addTo(this.routeLayer));
    // Invisible, wide hit line for hover
    const hit = L.polyline(pts.map(p => [p.lat, p.lon]), { renderer: this.renderer, color: '#000', weight: 22, opacity: 0, interactive: true }).addTo(this.routeLayer);
    hit.on('mousemove', e => this.onHover?.(this.nearestDistance(e.latlng), e.originalEvent));
    hit.on('mouseout', () => this.onLeave?.());
    hit.on('click', e => this.onHover?.(this.nearestDistance(e.latlng), e.originalEvent));
    this.bounds = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
  }

  recolor(colors) {
    this.segments?.forEach((s, i) => s.setStyle({ color: colors[i] }));
  }

  setDistanceMarkers(unitMeters, unitLabel) {
    this.markerLayer.clearLayers();
    if (!this.course) return;
    const pts = this.course.points, total = pts[pts.length - 1].d;
    const units = total / unitMeters;
    // Fewer labels on narrow maps so they don't collide
    const maxLabels = Math.max(5, Math.min(14, Math.floor(this.map.getContainer().clientWidth / 45)));
    const step = [1, 2, 5, 10, 20, 50].find(s => units / s <= maxLabels) ?? 100;
    for (let k = step; k < units - step * 0.45; k += step) {
      const p = this.pointAt(k * unitMeters);
      L.marker([p.lat, p.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'km-label', html: String(k), iconSize: [k >= 10 ? 24 : 20, 18], iconAnchor: [k >= 10 ? 12 : 10, 9] })
      }).addTo(this.markerLayer);
    }
    const s = pts[0], f = pts[pts.length - 1];
    const end = (p, cls, text, w) => L.marker([p.lat, p.lon], { interactive: false, keyboard: false, zIndexOffset: 1000,
      icon: L.divIcon({ className: `km-label end-label ${cls}`, html: text, iconSize: [w, 18], iconAnchor: [w / 2, 9] }) }).addTo(this.markerLayer);
    end(s, 'start', 'START', 46);
    end(f, 'finish', 'FINISH', 50);
    this.unitLabel = unitLabel;
  }

  pointAt(d) {
    const pts = this.course.points;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(d / (pts[1].d - pts[0].d))));
    return pts[i];
  }

  nearestDistance(latlng) {
    const pts = this.course.points;
    const cosLat = Math.cos(latlng.lat * Math.PI / 180);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dy = pts[i].lat - latlng.lat, dx = (pts[i].lon - latlng.lng) * cosLat;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return pts[best].d;
  }

  focus(d) {
    const p = this.pointAt(d);
    if (!this.focusMarker) {
      this.focusMarker = L.circleMarker([p.lat, p.lon], { renderer: this.renderer, radius: 7, weight: 3, color: cssVar('--surface'), fillColor: cssVar('--ink'), fillOpacity: 1, interactive: false }).addTo(this.map);
    } else {
      this.focusMarker.setLatLng([p.lat, p.lon]);
      this.focusMarker.setStyle({ color: cssVar('--surface'), fillColor: cssVar('--ink') });
    }
  }
  clearFocus() {
    if (this.focusMarker) { this.map.removeLayer(this.focusMarker); this.focusMarker = null; }
  }

  highlight(d0, d1) {
    this.highlightLayer.clearLayers();
    const pts = this.course.points, sp = pts[1].d - pts[0].d;
    const a = Math.max(0, Math.floor(d0 / sp)), b = Math.min(pts.length - 1, Math.ceil(d1 / sp));
    const ll = pts.slice(a, b + 1).map(p => [p.lat, p.lon]);
    L.polyline(ll, { renderer: this.renderer, color: cssVar('--ink'), weight: 12, opacity: 0.35, interactive: false, lineCap: 'round' }).addTo(this.highlightLayer);
    return L.latLngBounds(ll);
  }
  clearHighlight() { this.highlightLayer.clearLayers(); }

  zoomTo(d0, d1) {
    const b = this.highlight(d0, d1);
    this.map.flyToBounds(b, { padding: [40, 40], maxZoom: 16, duration: 0.6 });
  }
  fit(animate = true) {
    if (this.bounds) this.map.fitBounds(this.bounds, { padding: [28, 28], animate });
  }
  invalidate() { this.map.invalidateSize(); }

  unlock() {
    if (!this.touch) return;
    this.map.dragging.enable();
    this.map.getContainer().classList.remove('map-locked');
  }
  lock() {
    if (!this.touch) return;
    this.map.dragging.disable();
    this.map.getContainer().classList.add('map-locked');
  }
}
