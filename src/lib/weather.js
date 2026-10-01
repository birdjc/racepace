// Hourly race-window weather from Open-Meteo (no API key; free for non-commercial use).
//   forecast API: today−5 … today+15 days
//   archive API (ERA5 reanalysis, ~5-day lag): historical races
//   climatology fallback: same date & hours averaged over the 3 most recent archived years
// All times are local to the course (timezone=auto), handled as "YYYY-MM-DDTHH:MM" strings.

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const HOURLY_VARS = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m';
const FORECAST_DAYS_AHEAD = 15;
const ARCHIVE_LAG_DAYS = 6;
const CLIMATOLOGY_YEARS = 3;
const DAY_MS = 86400000;

// --- local-clock helpers (treat local wall time as if it were UTC so no timezone maths is needed)
export const localToMs = s => Date.parse(s.length === 16 ? `${s}:00Z` : `${s}Z`);
export const msToLocal = ms => new Date(ms).toISOString().slice(0, 16);
const dateOf = s => s.slice(0, 10);

// Which data source can serve this race date? todayIso = "YYYY-MM-DD"
export function chooseSource(raceDate, todayIso) {
  const days = (Date.parse(raceDate) - Date.parse(todayIso)) / DAY_MS;
  if (days < -(ARCHIVE_LAG_DAYS - 1)) return 'archive';
  if (days <= FORECAST_DAYS_AHEAD) return 'forecast';
  return 'climatology';
}

// Years to average for climatology: the most recent years whose same date is already archived.
export function climatologyYears(raceDate, todayIso, n = CLIMATOLOGY_YEARS) {
  const year = +raceDate.slice(0, 4);
  const cutoff = Date.parse(todayIso) - ARCHIVE_LAG_DAYS * DAY_MS;
  const years = [];
  for (let y = year - 1; years.length < n && y > year - 20; y--) {
    if (Date.parse(shiftYear(raceDate, y)) <= cutoff) years.push(y);
  }
  return years;
}

// Move a date to another year; Feb 29 becomes Feb 28 in non-leap years
export function shiftYear(date, year) {
  let md = date.slice(5, 10);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (md === '02-29' && !leap) md = '02-28';
  return `${year}-${md}`;
}

function buildUrl(base, lat, lon, startDate, endDate) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    hourly: HOURLY_VARS, wind_speed_unit: 'ms', timezone: 'auto',
    start_date: startDate, end_date: endDate
  });
  return `${base}?${q}`;
}

async function fetchHourly(base, lat, lon, startDate, endDate, fetchFn) {
  const res = await fetchFn(buildUrl(base, lat, lon, startDate, endDate));
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Weather request failed: ${body.reason ?? res.status}`);
  const h = body.hourly;
  return {
    timezone: body.timezone,
    gridLat: body.latitude, gridLon: body.longitude, gridElevation: body.elevation,
    hours: h.time.map((t, i) => ({
      time: t,
      tempC: h.temperature_2m[i],
      rh: h.relative_humidity_2m[i],
      windMs: h.wind_speed_10m[i],
      windFromDeg: h.wind_direction_10m[i]
    }))
  };
}

// Average several years' hourly records hour-by-hour.
// Temperature, RH and wind speed are simple means. Wind direction is the direction of the mean
// (u, v) vector, so opposing directions cancel instead of averaging to a meaningless angle.
export function averageHours(yearSeries, raceStartDate) {
  const n = yearSeries.length;
  return yearSeries[0].map((_, i) => {
    let t = 0, rh = 0, w = 0, u = 0, v = 0;
    for (const s of yearSeries) {
      const h = s[i];
      t += h.tempC; rh += h.rh; w += h.windMs;
      u += Math.sin(h.windFromDeg * Math.PI / 180);
      v += Math.cos(h.windFromDeg * Math.PI / 180);
    }
    const dir = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    const src = yearSeries[0][i].time;
    const dayOffset = Math.round((Date.parse(dateOf(src)) - Date.parse(dateOf(yearSeries[0][0].time))) / DAY_MS);
    const date = new Date(Date.parse(raceStartDate) + dayOffset * DAY_MS).toISOString().slice(0, 10);
    return { time: `${date}${src.slice(10)}`, tempC: t / n, rh: rh / n, windMs: w / n, windFromDeg: dir };
  });
}

// Main entry: hourly weather covering [startLocal, startLocal + durationSec]
export async function getRaceWeather({ lat, lon, startLocal, durationSec, todayIso, fetchFn = fetch }) {
  todayIso ??= new Date().toISOString().slice(0, 10);
  const startDate = dateOf(startLocal);
  const endDate = dateOf(msToLocal(localToMs(startLocal) + durationSec * 1000 + 3600000));
  const source = chooseSource(startDate, todayIso);

  let result, years = null;
  if (source === 'climatology') {
    years = climatologyYears(startDate, todayIso);
    const spanDays = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS);
    const series = await Promise.all(years.map(y => {
      const s = shiftYear(startDate, y);
      const e = new Date(Date.parse(s) + spanDays * DAY_MS).toISOString().slice(0, 10);
      return fetchHourly(ARCHIVE_URL, lat, lon, s, e, fetchFn);
    }));
    result = { ...series[0], hours: averageHours(series.map(s => s.hours), startDate) };
  } else {
    result = await fetchHourly(source === 'forecast' ? FORECAST_URL : ARCHIVE_URL, lat, lon, startDate, endDate, fetchFn);
  }

  // Keep only the hours that bracket the race window
  const t0 = localToMs(startLocal), t1 = t0 + durationSec * 1000;
  const hours = result.hours.filter(h => {
    const t = localToMs(h.time);
    return t >= t0 - 3600000 && t <= t1 + 3600000;
  });
  if (hours.some(h => h.tempC === null || h.windMs === null)) {
    throw new Error('Weather data is not available yet for part of the race window.');
  }
  return { source, years, timezone: result.timezone, grid: { lat: result.gridLat, lon: result.gridLon, elevation: result.gridElevation }, hours };
}

// Weather for the hour-block containing `elapsedSec` after the start.
// Block k covers [start + k h, start + (k+1) h) and uses conditions at start + k h, linearly
// interpolated between hourly records (exact hourly values when the start is on the hour).
export function weatherForElapsed(hours, startLocal, elapsedSec) {
  const k = Math.floor(elapsedSec / 3600);
  const t = localToMs(startLocal) + k * 3600000;
  const times = hours.map(h => localToMs(h.time));
  let i = times.findIndex(x => x > t);
  if (i === -1) return { block: k, ...hours[hours.length - 1] };
  if (i === 0) return { block: k, ...hours[0] };
  const a = hours[i - 1], b = hours[i];
  const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
  const lerp = (x, y) => x + (y - x) * f;
  // Interpolate direction along the shorter arc
  const dd = ((b.windFromDeg - a.windFromDeg + 540) % 360) - 180;
  return {
    block: k,
    time: msToLocal(t),
    tempC: lerp(a.tempC, b.tempC),
    rh: lerp(a.rh, b.rh),
    windMs: lerp(a.windMs, b.windMs),
    windFromDeg: (a.windFromDeg + dd * f + 360) % 360
  };
}
