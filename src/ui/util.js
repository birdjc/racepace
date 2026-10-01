// Small shared UI helpers: DOM, formatting, colours, theme, tooltip, persistence.
import { M_PER_MI, M_PER_KM, formatDuration, formatDelta } from '../lib/pace.js';

export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const unitM = u => (u === 'mi' ? M_PER_MI : M_PER_KM);
export const FT_PER_M = 3.28084;
export const eleUnit = u => (u === 'mi' ? 'ft' : 'm');
export const eleScale = u => (u === 'mi' ? FT_PER_M : 1);
export const deltaClass = sec => (sec > 0.5 ? 'slow' : sec < -0.5 ? 'fast' : '');
export { formatDuration, formatDelta };

export function formatPaceSec(secPerUnit, u) {
  return `${formatDuration(secPerUnit)}/${u}`;
}
export function formatDist(m, u, digits = 1) {
  return `${(m / unitM(u)).toFixed(digits)} ${u}`;
}
export function signedSeconds(sec, digits = 0) {
  if (!Number.isFinite(sec)) return '—';
  const v = Math.abs(sec) < 0.5 * 10 ** -digits ? 0 : sec;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)} s`;
}
export const compass = d => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16];

// ---------- persistence (per-viewer conveniences only) ----------
export function load(key, fallback = null) {
  try { const v = localStorage.getItem(`rpa.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(`rpa.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// ---------- theme ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : (darkQuery.matches ? 'dark' : 'light');
}
const themeListeners = new Set();
export function onThemeChange(fn) { themeListeners.add(fn); }
function emitTheme() { themeListeners.forEach(fn => fn(currentTheme())); }
darkQuery.addEventListener('change', () => { if (!document.documentElement.dataset.theme) emitTheme(); });
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('rpa.theme', next); } catch { /* ignore */ }
  emitTheme();
}
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------- colour ----------
function toRgb(c) {
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const m = c.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
export function mix(a, b, t) {
  const A = toRgb(a), B = toRgb(b);
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`;
}
// Diverging colour for a pace change: blue (faster) ← grey → red (slower).
// A square-root ramp keeps small changes visible when a few stretches are extreme.
export function divergingColor(value, maxAbs, palette) {
  if (!Number.isFinite(value) || maxAbs <= 0) return palette.zero;
  const t = Math.min(1, Math.abs(value) / maxAbs);
  return mix(palette.zero, value > 0 ? palette.slow : palette.fast, Math.sqrt(t));
}
export function divergingPalette() {
  return { slow: cssVar('--slow'), fast: cssVar('--fast'), zero: cssVar('--zero') };
}

// ---------- tooltip ----------
const tip = () => $('tooltip');
export function showTooltip(html, clientX, clientY) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14, r = t.getBoundingClientRect();
  let x = clientX + pad, y = clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
export function hideTooltip() { tip().hidden = true; }
export const ttRow = (k, v) => `<div class="tt-row"><span>${k}</span><span>${v}</span></div>`;

// Width-aware rendering: call render(width) now and whenever the element's width changes.
export function observeWidth(el, render) {
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(el.clientWidth);
    if (w && w !== last) { last = w; render(w); }
  });
  ro.observe(el);
  return () => ro.disconnect();
}
