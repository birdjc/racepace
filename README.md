# Race Pace Adjuster

Upload a GPX course and a start date and time, then choose a mode:

- **Plan a race:** enter a goal finish time and get a split-by-split pace plan adjusted for
  **grade**, **wind** and **heat/humidity**.
- **Evaluate a result:** enter a finish time on that course and see what it is worth on a flat
  course in ideal conditions. Works for past races (recorded weather) and future ones.

Both use John J. Davis's Running Writings models.

**Live: https://birdjc.github.io/racepace/**

Everything runs in the browser; there is no server. The only key is an optional CARTO map key (see below).

## Run locally
```bash
npm install
npm run dev          # http://localhost:5173
```

### Map tiles (optional CARTO key)
With a CARTO Basemaps key the map uses CARTO's light/dark styles; without one it falls back to
OpenStreetMap tiles. Get a free key at https://carto.com/basemaps/apikey/, then copy `.env.example`
to `.env.local` and paste it after `VITE_CARTO_KEY=`. `.env.local` is gitignored; restart
`npm run dev` after changing it. For deployment, set `VITE_CARTO_KEY` in the host's build
environment variables (see Deploy). The key ends up in the browser, so restrict it to your
domains in the CARTO dashboard.

Other commands:
```bash
npm test                 # unit tests (Vitest)
npm run verify-formulas  # extracted formulas vs. John Davis's original code
npm run build            # static site in dist/
node scripts/e2e.mjs [file.gpx] [YYYY-MM-DDTHH:MM]   # full pipeline in Node with live data
```

## Deploy
`npm run build` produces a static `dist/` folder. `vite.config.js` uses `base: './'`, so the same
build works on any static host:

| Host | Setup |
|---|---|
| Cloudflare Pages | Connect the repo. Build command `npm run build`, output `dist`. Add `VITE_CARTO_KEY` under Settings → Variables and Secrets |
| Vercel | Import the repo; the Vite preset is auto-detected. Add `VITE_CARTO_KEY` under Settings → Environment Variables. The Hobby tier is non-commercial only |
| GitHub Pages (**in use**) | `.github/workflows/deploy.yml` runs the tests, builds with the `VITE_CARTO_KEY` repository secret and deploys on every push to `main`. Settings → Pages → Source is "GitHub Actions" |

## How it works
1. **Course.** The GPX is parsed (track, route or waypoints) and resampled every 10 m. Elevation comes from
   the GPX when it covers at least 90% of points, otherwise from AWS Terrain Tiles.
2. **Elevation cleanup.** A spike filter (robust local line) runs first, then Savitzky–Golay smoothing (quadratic).
   The window is 150 m, or 250 m when the GPX elevation looks noisy.
3. **Segments.** Adjustments are computed on ~100 m windows, each with a grade and a heading. For the
   hill-split view, the windows are grouped into terrain segments (Douglas–Peucker turning points).
4. **Weather.** Open-Meteo hourly data at the course centroid: the forecast for races ≤ 15 days away,
   recorded (ERA5) weather for past races, or a 3-year same-date average otherwise.
   Each hour block from the start time gets that hour's conditions.
5. **Adjustments.** Applied in the order grade → wind (α = 0.3, 68 kg) → heat, each in "effort" mode.
   Each one can be switched off.
6. **Evaluate mode** searches for the flat, ideal-conditions time whose adjusted time on the course
   equals the entered time (assuming an even effort), so it is the exact inverse of plan mode. The
   hourly weather is placed using the entered time's average pace.

Formula details are in [`formulas/FORMULAS.md`](formulas/FORMULAS.md).

## Layout
```
formulas/        standalone GAP / wind / heat formulas + model tables (from John Davis, MIT)
src/lib/         gpx, geo, elevation, weather, profile (smoothing), segments, adjust, splits, pace
src/ui/          map (Leaflet), interactive profile, splits chart/table/CSV, shared helpers
src/main.js      UI state and wiring
public/demo/     demo course GPX
test/            Vitest unit tests + fixtures
scripts/         fixture generator, live smoke tests
reference/       original source of the three Running Writings apps
```

## Data & credits
- Models: John J. Davis, [Running Writings](https://apps.runningwritings.com/) (MIT)
- Weather: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Free for non-commercial use; commercial use needs their paid API plan
- Elevation: Mapzen / AWS Terrain Tiles
- Map: CARTO Basemaps with a key (© OpenStreetMap contributors, © CARTO; free up to 5M tile requests/month non-commercial, 1M commercial). Without a key: OpenStreetMap tiles (usage policy applies), dark via a CSS filter
- Place names: Nominatim (max 1 request/s)
