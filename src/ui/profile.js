// Interactive elevation profile with per-stretch pace-change bars underneath.
// Rendered at the element's real pixel width (so text stays legible), re-rendered on resize.
import { esc, observeWidth } from './util.js';

// Touch: press and hold this long (without moving) before a drag selects instead of scrubbing
const HOLD_MS = 400;
const MIN_SELECT_M = 20;

const niceStep = span => {
  const raw = span / 4, p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
};

export class ProfileChart {
  // onHover(distanceM, event) / onLeave()
  // onSelect(d0, d1, done): a stretch dragged out (live while dragging, done = true on release)
  // onSelectClear(): a click or tap without a drag, or Escape
  constructor(el, { onHover, onLeave, onSelect, onSelectClear }) {
    this.el = el;
    Object.assign(this, { onHover, onLeave, onSelect, onSelectClear });
    this.data = null;
    this.focusD = null;
    this.range = null;
    this.drag = null;
    observeWidth(el, w => { this.width = w; this.render(); });
    // Mouse: press and drag to select. Touch: press and hold, then drag (a plain drag scrubs the
    // tooltip and a vertical swipe scrolls the page).
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', () => this.endDrag());
    el.addEventListener('touchmove', e => { if (this.drag?.active) e.preventDefault(); }, { passive: false });
    // Touch: lifting the finger fires pointerleave right after the tap, so keep the tooltip until the
    // user taps elsewhere (handled in main.js); mouse: hide when the pointer leaves
    el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') this.onLeave?.(); });
    el.addEventListener('keydown', e => this.key(e));
    el.addEventListener('blur', () => this.onLeave?.());
  }

  // data: { windows, deltas (s per unit), eleScale, eleUnit, unitM, unitLabel, bands: [{d0,d1}] | null,
  //         pauses: [{ d, label }] (recorded runs: watch pauses, drawn as dashed lines),
  //         segments: [{ d0, d1, delta }] | null (hill-segment mode: one bar per segment instead of per 100 m) }
  set(data) {
    this.data = data;
    // Measure directly too, so the first render doesn't depend on a ResizeObserver callback
    if (!this.width) this.width = Math.round(this.el.clientWidth) || 0;
    this.render();
  }

  layout() {
    const W = this.width || this.el.clientWidth || 600;
    const compact = W < 520;
    return { W, padL: compact ? 40 : 48, padR: 10, top: 10, eleH: compact ? 120 : 160, gap: 26, barH: compact ? 80 : 100, bottom: 24 };
  }

  render() {
    const d = this.data;
    if (!d || !this.width) return;
    const L = this.layout();
    const { W, padL, padR, top, eleH, gap, barH, bottom } = L;
    const H = top + eleH + gap + barH + bottom;
    const ws = d.windows, total = ws[ws.length - 1].d1;
    const x = m => padL + (W - padL - padR) * m / total;
    const elev = [ws[0].ele0, ...ws.map(w => w.ele1)].map(e => e * d.eleScale);
    const dists = [ws[0].d0, ...ws.map(w => w.d1)];
    let lo = Math.min(...elev), hi = Math.max(...elev);
    if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
    const padE = (hi - lo) * 0.08; lo -= padE; hi += padE;
    const y = e => top + eleH * (1 - (e - lo) / (hi - lo));
    const line = dists.map((m, i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(elev[i]).toFixed(1)}`).join('');
    const area = `${line}L${x(total).toFixed(1)},${top + eleH}L${x(0)},${top + eleH}Z`;

    // Bars: one per 100 m stretch, or one per hill segment
    const barItems = d.segments ?? ws.map((w, i) => ({ d0: w.d0, d1: w.d1, delta: d.deltas[i] }));
    const gapPx = d.segments ? 1.5 : 0.4;
    const maxAbs = Math.max(5, ...barItems.map(b => Math.abs(b.delta)).filter(Number.isFinite));
    const base = top + eleH + gap + barH / 2;
    const by = v => base - (barH / 2) * v / maxAbs;
    const bars = barItems.map(b => {
      const v = b.delta;
      if (!Number.isFinite(v) || Math.abs(v) < 0.05) return '';
      const y0 = Math.min(by(v), base), h = Math.max(0.5, Math.abs(by(v) - base));
      return `<rect x="${(x(b.d0) + gapPx / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(0.8, x(b.d1) - x(b.d0) - gapPx).toFixed(1)}" height="${h.toFixed(1)}" class="${v > 0 ? 'bar-slow' : 'bar-fast'}"/>`;
    }).join('');

    const bands = (d.bands ?? []).map((b, i) => i % 2
      ? `<rect x="${x(b.d0).toFixed(1)}" y="${top}" width="${(x(b.d1) - x(b.d0)).toFixed(1)}" height="${eleH}" fill="currentColor" opacity="0.035"/>` : '').join('');

    const pauses = (d.pauses ?? []).map(q => {
      const px = x(q.d), anchor = px < padL + 30 ? 'start' : px > W - padR - 30 ? 'end' : 'middle';
      return `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${top + 14}" y2="${top + eleH}" class="pause-line"/>
        <text x="${px.toFixed(1)}" y="${top + 9}" class="tick pause-tick" text-anchor="${anchor}">${esc(q.label)}</text>`;
    }).join('');

    const unitsTotal = total / d.unitM;
    const xs = niceStep(unitsTotal), xt = [];
    for (let v = 0; v <= unitsTotal + 1e-9; v += xs) xt.push(v);
    const es = niceStep(hi - lo), yt = [];
    for (let v = Math.ceil(lo / es) * es; v <= hi; v += es) yt.push(v);

    this.geom = { x, y, by, base, total, top, eleH, gap, barH, H, W, padL, padR, elev, dists };
    this.el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile with pace change per 100 m">
      ${bands}
      ${yt.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="tick" text-anchor="end">${Math.round(v)}</text>`).join('')}
      <text x="${padL - 8}" y="${top - 0}" class="tick" text-anchor="end" dy="-1">${esc(d.eleUnit)}</text>
      <path d="${area}" class="elev-area"/><path d="${line}" class="elev-line"/>
      ${pauses}
      <rect class="range-band" id="pf-range" x="0" y="${top}" width="0" height="${eleH + gap + barH}" visibility="hidden"/>
      <line x1="${padL}" x2="${W - padR}" y1="${base}" y2="${base}" class="axis"/>
      ${bars}
      <text x="${padL - 8}" y="${(by(maxAbs) + 4).toFixed(1)}" class="tick" text-anchor="end">+${Math.round(maxAbs)}</text>
      <text x="${padL - 8}" y="${(base + 4).toFixed(1)}" class="tick" text-anchor="end">0</text>
      <text x="${padL - 8}" y="${(by(-maxAbs) + 4).toFixed(1)}" class="tick" text-anchor="end">−${Math.round(maxAbs)}</text>
      <text x="${padL}" y="${top + eleH + gap - 8}" class="tick">Pace change, s/${esc(d.unitLabel)}${d.segments ? ' per hill segment' : ''} · red slower, blue faster</text>
      ${xt.map(v => `<text x="${x(v * d.unitM).toFixed(1)}" y="${H - 6}" class="tick" text-anchor="${v === 0 ? 'start' : 'middle'}">${+v.toFixed(1)}</text>`).join('')}
      <text x="${W - padR}" y="${H - 6}" class="tick" text-anchor="end">${esc(d.unitLabel)}</text>
      <g id="pf-hover" visibility="hidden">
        <line class="hover-line" id="pf-hline" y1="${top}" y2="${top + eleH + gap + barH}"/>
        <circle class="hover-dot" id="pf-hdot" r="4.5"/>
      </g>
    </svg>`;
    if (this.focusD !== null) this.setFocus(this.focusD);
    if (this.range) this.setRange(...this.range);
  }

  distanceAtClientX(clientX) {
    const g = this.geom, r = this.el.getBoundingClientRect();
    const px = (clientX - r.left) * (g.W / r.width);
    return Math.max(0, Math.min(g.total, (px - g.padL) / (g.W - g.padL - g.padR) * g.total));
  }

  pointer(e) {
    if (!this.geom) return;
    this.onHover?.(this.distanceAtClientX(e.clientX), e);
  }

  down(e) {
    if (!this.geom || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.pointer(e);
    const touch = e.pointerType !== 'mouse';
    const g = this.drag = { id: e.pointerId, start: this.distanceAtClientX(e.clientX), x: e.clientX, y: e.clientY, touch, moved: false, active: false };
    if (touch) {
      g.timer = setTimeout(() => {
        if (this.drag !== g || g.moved) return;
        g.active = true;
        navigator.vibrate?.(10);
        this.onLeave?.();
        this.dragTo(g.start, false);
      }, HOLD_MS);
    }
  }

  move(e) {
    const g = this.drag;
    if (g && g.id === e.pointerId) {
      if (Math.abs(e.clientX - g.x) > (g.touch ? 10 : 5) || Math.abs(e.clientY - g.y) > 10) g.moved = true;
      if (!g.touch && g.moved && !g.active) {
        g.active = true;
        this.el.setPointerCapture?.(e.pointerId);
        this.onLeave?.();
      }
      if (g.active) {
        const dd = this.distanceAtClientX(e.clientX);
        this.setFocus(dd);
        this.dragTo(dd, false);
        return;
      }
    }
    this.pointer(e);
  }

  up(e) {
    const g = this.drag;
    if (!g || g.id !== e.pointerId) return;
    if (g.active) this.dragTo(this.distanceAtClientX(e.clientX), true);
    else if (!g.moved) this.onSelectClear?.();
    this.endDrag();
  }

  endDrag() {
    const g = this.drag;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.active && this.range) this.onSelect?.(...this.range, true);
    if (this.el.hasPointerCapture?.(g.id)) this.el.releasePointerCapture(g.id);
    this.drag = null;
  }

  dragTo(d, done) {
    const g = this.drag;
    const a = Math.min(g.start, d), b = Math.max(g.start, d);
    if (b - a < MIN_SELECT_M) {
      if (done) { g.active = false; this.onSelectClear?.(); }
      return;
    }
    this.setRange(a, b);
    this.onSelect?.(a, b, done);
    if (done) g.active = false;
  }

  key(e) {
    if (!this.geom) return;
    const step = this.geom.total / 100 * (e.shiftKey ? 5 : 1);
    let d = this.focusD ?? 0;
    if (e.key === 'ArrowRight') d = Math.min(this.geom.total, d + step);
    else if (e.key === 'ArrowLeft') d = Math.max(0, d - step);
    else if (e.key === 'Home') d = 0;
    else if (e.key === 'End') d = this.geom.total;
    else if (e.key === 'Escape') { this.onLeave?.(); this.onSelectClear?.(); return; }
    else return;
    e.preventDefault();
    const svg = this.el.querySelector('svg').getBoundingClientRect();
    const g = this.geom;
    const cx = svg.left + g.x(d) * svg.width / g.W, cy = svg.top + g.top * svg.height / g.H;
    this.onHover?.(d, { clientX: cx, clientY: cy });
  }

  setFocus(d) {
    this.focusD = d;
    const g = this.geom;
    if (!g) return;
    const hv = this.el.querySelector('#pf-hover');
    if (!hv) return;
    // elevation at d (linear between window boundaries)
    let i = Math.min(g.dists.length - 2, Math.max(0, g.dists.findIndex(v => v >= d) - 1));
    if (i < 0) i = 0;
    const t = (d - g.dists[i]) / ((g.dists[i + 1] - g.dists[i]) || 1);
    const e = g.elev[i] + (g.elev[i + 1] - g.elev[i]) * Math.max(0, Math.min(1, t));
    const px = g.x(d).toFixed(1);
    const hl = this.el.querySelector('#pf-hline');
    hl.setAttribute('x1', px); hl.setAttribute('x2', px);
    const dot = this.el.querySelector('#pf-hdot');
    dot.setAttribute('cx', px); dot.setAttribute('cy', g.y(e).toFixed(1));
    hv.setAttribute('visibility', 'visible');
  }
  clearFocus() {
    this.focusD = null;
    this.el.querySelector('#pf-hover')?.setAttribute('visibility', 'hidden');
  }

  setRange(d0, d1) {
    this.range = [d0, d1];
    const r = this.el.querySelector('#pf-range');
    if (!r || !this.geom) return;
    r.setAttribute('x', this.geom.x(d0).toFixed(1));
    r.setAttribute('width', Math.max(1, this.geom.x(d1) - this.geom.x(d0)).toFixed(1));
    r.setAttribute('visibility', 'visible');
  }
  clearRange() {
    this.range = null;
    this.el.querySelector('#pf-range')?.setAttribute('visibility', 'hidden');
  }
}
