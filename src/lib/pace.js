// Time / pace parsing and formatting. Backend works in seconds and m/s.

export const M_PER_MI = 1609.344;
export const M_PER_KM = 1000;

// "3:15:00", "3:15", "2:59:59.5" -> seconds. A 2-part value is read as h:mm.
export function parseDuration(text) {
  const parts = String(text).trim().split(':').map(Number);
  if (!parts.length || parts.some(p => !Number.isFinite(p) || p < 0)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return NaN;
}

export function formatDuration(sec, { forceHours = false } = {}) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

// Signed delta, e.g. "+0:12", "-1:05"
export function formatDelta(sec) {
  if (!Number.isFinite(sec)) return '—';
  // Sign follows the rounded value, so tiny negatives don't show as "−0:00"
  const sign = Math.round(sec) < 0 ? '−' : '+';
  return sign + formatDuration(Math.abs(sec));
}

export const speedToPaceSec = (m_s, unit = 'mi') => (unit === 'mi' ? M_PER_MI : M_PER_KM) / m_s;

export function formatPace(m_s, unit = 'mi') {
  return `${formatDuration(speedToPaceSec(m_s, unit))}/${unit}`;
}
