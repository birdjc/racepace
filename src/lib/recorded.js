// Recorded runs: GPX files whose points carry timestamps (e.g. exported from a watch).
// Turns the timestamps into per-stretch times, converts each stretch's actual pace to its flat,
// ideal-conditions equivalent ("effort"), flags stops, and smooths the effort for display.
import { flatEquivalentSpeed, runModel, PACE_SMOOTH_M } from './adjust.js';

// Near-stationary: below this a stretch is always a stop (≈ 26:49/mi, 16:40/km).
export const STOP_SPEED = 1.0; // m/s
// A stretch whose flat-equivalent speed is below this share of your median effort is a stop or a
// walking break (pauses inside a 100 m stretch, aid stations). Grade, wind and heat are already
// accounted for, so walking up a steep hill at the same effort is not flagged.
export const STOP_EFFORT_FRACTION = 0.6;

// Local wall-clock "YYYY-MM-DDTHH:MM" for a UTC instant in an IANA time zone (DST-aware)
export function utcToLocal(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const g = type => parts.find(p => p.type === type).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

// Length-weighted harmonic smoothing over ±PACE_SMOOTH_M of a per-window speed, skipping stops
function smoothSpeeds(windows, speeds, stopped) {
  const mid = windows.map(w => (w.d0 + w.d1) / 2);
  return windows.map((_, i) => {
    if (stopped[i]) return NaN;
    let len = 0, time = 0;
    for (let j = i; j >= 0 && mid[i] - mid[j] <= PACE_SMOOTH_M; j--) if (!stopped[j]) { len += windows[j].length; time += windows[j].length / speeds[j]; }
    for (let j = i + 1; j < windows.length && mid[j] - mid[i] <= PACE_SMOOTH_M; j++) if (!stopped[j]) { len += windows[j].length; time += windows[j].length / speeds[j]; }
    return time > 0 ? len / time : NaN;
  });
}

// points: resampled course points with interpolated timestamps (ms); windows: calculation windows
// with weather attached; on: factor switches.
export function analyseRecording(windows, points, on) {
  const times = windows.map(w => Math.max(0, (points[w.i1].t - points[w.i0].t) / 1000));
  const speeds = windows.map((w, i) => (times[i] > 0 ? w.length / times[i] : NaN));
  const cum = [0];
  times.forEach(t => cum.push(cum[cum.length - 1] + t));

  // 1. Convert each stretch's raw pace to its flat equivalent (terrain and weather removed first)
  const rawFlat = windows.map((w, i) => (speeds[i] >= STOP_SPEED ? flatEquivalentSpeed(w, speeds[i], on) : NaN));
  const sorted = rawFlat.filter(Number.isFinite).sort((a, b) => a - b);
  const medianFlat = sorted[sorted.length >> 1];
  // 2. Stops: near-stationary, or far below your typical effort
  const stopped = rawFlat.map(v => !(v >= STOP_EFFORT_FRACTION * medianFlat));
  // Estimated stop time: time beyond what your typical effort would take on that stretch
  const stoppedSec = windows.reduce((s, w, i) => {
    if (!stopped[i]) return s;
    const typical = runModel([w], medianFlat, on, { smoothM: 0 }).speeds[0];
    return s + Math.max(0, times[i] - w.length / typical);
  }, 0);
  // 3. Smooth GPS noise: the effort (flat equivalent) and, for display, the actual pace
  return {
    times, cum, total: cum[cum.length - 1], speeds,
    smoothSpeeds: smoothSpeeds(windows, speeds, stopped),
    flatSpeeds: smoothSpeeds(windows, rawFlat, stopped),
    medianFlat, stopped, stoppedSec, stoppedCount: stopped.filter(Boolean).length
  };
}
