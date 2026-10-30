# Race Pace Adjustment App: dev plan & to-do

## Pipeline (target architecture)
1. **Inputs**: GPX, start date/time (local to the course), goal duration → base speed = distance / duration
2. **Course prep**: parse the GPX → resample → elevation (from the GPX or a DEM) → smooth → segment → grade per segment
3. **Weather prep**: course centroid → hourly T, RH, wind speed/dir @10 m for the race window
   (forecast if ≤ 16 days out, else a 3-year same-date/hour average)
4. **Profiles**
   - Primary (terrain): elevation segments with grades
   - Secondary (direction): heading per segment → wind angle vs. the hourly wind direction
   - Secondary (weather): hour buckets from the start time, assigned by cumulative time at base pace
     (optionally re-assigned once with adjusted times)
5. **Adjust** (independent toggles, order GAP → wind → heat): speed → speed per segment
6. **Output**: summary, impact cards, pacing-opportunity gauge, profile chart, splits
   (mi / km / hill segment) showing split time, split pace, cumulative time and delta vs. base

## Status
### Step 1: Codebase review & factoring
- [x] Review gap-app-main, wind-calculator-main, heat-adjusted-pace-main
- [x] Identify formula files (all in each app's `scripts.js`; R is used only to build the lookup tables)
- [x] Extract standalone formulas → `formulas/{gap,wind,heat}.js` + data JSON
- [x] Document requirements and I/O → `formulas/FORMULAS.md`
- [x] Verify the extracted formulas against the originals → `verify_formulas.mjs` (all match)
- [x] DECISION: language/stack → **A: client-side JS (Vite + vanilla JS)**
- [x] DECISION: deployment platform → **GitHub Pages** (repo birdjc/racepace, public)
- [x] DECISION: APIs → Open-Meteo (grid point at the course centroid; approved), AWS Terrain Tiles, OSM tiles, Nominatim. No keys.
- [x] DECISION: wind runner mass → fixed at 68 kg

### Step 2: Inputs
- [x] Project scaffold (Vite, Vitest, Leaflet); `npm run dev` / `npm test` / `npm run build`
- [x] GPX parser (trk/rte/wpt, with or without `<ele>`, ignore extensions) → `src/lib/gpx.js`
- [x] Start date/time input (local time at the course, via Open-Meteo `timezone=auto`)
- [x] Goal time input → avg pace (min/mi and min/km)

### Step 3: Data prep
- [x] Resample the track to 10 m uniform spacing → `src/lib/geo.js`
- [x] Elevation from a DEM when the GPX covers < 90% of points → `src/lib/elevation.js` (checked against Mt Washington and Denver, within about 1 m)
- [x] Smoothing candidates implemented and compared in the UI (moving average, Savitzky–Golay, Kalman/RTS) → `src/lib/smoothing.js`
- [x] DECISION: smoothing → **Savitzky–Golay** (150 m; 250 m for noisy GPX) + spike filter → `src/lib/profile.js`
- [x] DECISION: segmentation → **C: 100 m calculation windows + terrain hill segments for display** → `src/lib/segments.js`
- [x] Hill segments → **relative (zigzag/prominence) method, sensitive setting** (2026-09-26, replacing A and then B): a hill must rise or drop max(5 m, 2σ), where σ is the course's robust undulation around a 3 km trend; each hill is trimmed to the core holding 85% of its rise; flats shorter than 600 m are absorbed. Prototype results: flat course h = 5 m, rolling h = 14 m, mountain h = 88 m. **Calibrate on real GPX files (flat road, hilly road, trail).**
- [x] Grade per window
- [x] Heading per window (length-weighted circular mean), wind angle per window
- [x] Weather fetch: forecast (≤ 15 days) / archive (past) / 3-year climatology, hourly blocks from the start → `src/lib/weather.js`

### Step 4: Adjustments
- [x] Wire gap.js, wind.js (α = 0.3, 68 kg) and heat.js per window, with toggles, in the order GAP → wind → heat → `src/lib/adjust.js`
- [x] Per-factor impacts and total impact
- [x] Edge cases: NaN → left unadjusted with a warning; grades capped at ±45%; heat table extrapolates

### UI / output
- [x] **UI revamp (2026-10-01)**: input steps with race-name field, course preview and demo course; results with goal → adjusted summary, factor cards that double as toggles, pacing-opportunity gauge, large themed map (keyless OSM tiles, dark via CSS filter), shared Total/Elevation/Wind/Heat layer selector, linked hover between map ↔ profile ↔ splits, click-to-zoom splits, hourly weather strip, CSV export, light/dark toggle
- [x] Splits by mi / km / hill segment (split time, pace ± delta, cumulative ± delta, Half and Finish rows)
- [x] Final interaction checks (2026-10-01): factor toggles, layer selector, units ↔ split mode, split hover/select/deselect (mouse and keyboard), map hover, map fit/expand, theme switch, CSV, Edit inputs → rebuild, keyboard navigation, phone layout, file errors
- Map colours saturate at the 95th percentile (legend shows "N+"); profile chart stays uncapped
- **Basemap (2026-10-01): CARTO light_all/dark_all via `VITE_CARTO_KEY`** (build-time env var, `.env.local` locally, host env var in deployment); falls back to OSM tiles without a key. Key is visible in the browser by design, so restrict it to the app's domains in the CARTO dashboard
- [x] CARTO key added to `.env.local` and verified (2026-10-01): real light_all/dark_all tiles load, attribution shown, build embeds key, source files clean. Still to do: restrict the key to the app domains in the CARTO dashboard at deploy time

### Deployment
- [x] Local run instructions (README)
- [x] Deployed 2026-10-01: https://birdjc.github.io/racepace/ via `.github/workflows/deploy.yml` (tests → build with `VITE_CARTO_KEY` secret → Pages) on every push to main
- [ ] Restrict the CARTO key to `birdjc.github.io` in the CARTO dashboard
- Dev key: separate localhost CARTO key in `.env.development.local` (gitignored, used by `npm run dev`); production key only in the GitHub secret
- [x] Mobile fixes (2026-10-02): touch devices (`pointer: coarse`) get no file-type filter (iOS greys out .gpx; contents still checked) and three h/min/sec goal boxes; desktop keeps the .gpx filter and one h:mm:ss box. Date/time inputs fit narrow screens (iOS min-width). Touch map pans only after a tap (no scroll trap); tapping elsewhere closes tooltips. Charts render without waiting for ResizeObserver
- [x] User re-tested on iPhone (2026-10-03: "looks good")
- [x] **Evaluate mode (reverse conversion), 2026-10-03**: input mode switch ("Plan a race" / "Evaluate a result", name may change); solves for the flat-equivalent time with `solveFlatSpeed` (exact inverse of plan mode, round-trip tests); weather timed by the actual average pace; results reuse the whole engine with evaluate wording; gauge renamed "Course difficulty" in this mode; splits = estimated even-effort splits; factor toggles re-solve (busy state while updating)
- [x] **Recorded runs (decision 5), 2026-10-05**: toggle appears only when the GPX passes the timestamp check (≥ 90% timed points, in order, 1 min–48 h); fills and locks date/start/finish (elapsed, incl. stops) and forces evaluate mode; off restores previous values. Results: actual splits ± vs even effort, Flat equiv. column, "Your effort" layer (per-stretch flat equivalent vs headline), stop detection (near-stationary or < 60% of median effort), weather placed by recorded times. Demo recording in public/demo/demo-run.gpx (scripts/make-demo-run.mjs)
- Note: per-split Flat equiv. (actual pacing) can differ by a few s/mi from the headline (even-effort assumption); explained in the Method section

## Open questions / notes
- The heat model is fit to whole marathons; applying it hourly is an approximation (see FORMULAS.md)
- Pacing Opportunity: total impact as % of goal time; −2% = Favorable end, +2% = middle, +6% = Challenging end (user OK "for now", 2026-09-26)
- Climatology wind: mean speed + vector-mean direction; direction is weakly meaningful across 3 random years
- Past races use the actual ERA5 weather for that day, not a 3-year average
- DEM along roads: bridges and overpasses can show dips (the DEM sees the valley below). Smoothing helps; a median pre-filter is an option
- Hour blocks for weather use elapsed time at the base (goal) pace. DECIDED: keep it, so heat and wind stand independent of the hills
- Profile chart bar scale is uncapped (user decision; trail races have long >12% stretches)
- Grade calculation: uphill capped at +45% (Minetti fit range). **Downhill benefit capped at −8%** (decided 2026-10-01): steeper descents are paced as −8%. Test course: fastest stretch 4:48 → 5:31/mi, grade effect +6:47 → +7:14. Info notes for < −8% and > +25% grades
- **Pace-plan smoothing ±200 m** (decided 2026-10-01; user asked for gentler than ±400 m): seconds per metre averaged over ±200 m, rescaled so the finish time is exactly unchanged. Test course: 100 m stretches 5:31–16:16 → 5:31–13:44/mi, mile splits 7:04–9:06 → 7:08–9:05. Setting: `PACE_SMOOTH_M` in `src/lib/adjust.js`
- Trail use: 150 m SG smoothing + 100 m windows will soften very short, steep pitches; revisit if trail races become a focus
- Real-file testing: Philadelphia Distance Run (Strava export, timestamps + elevation) works end to end (2026-10-05). Still worth trying a hilly road race and a trail race to calibrate hill segments

## Future ideas (noted 2026-10-05, not started)
- [ ] **Image export for sharing:** download individual images of output sections (summary/finish card, factor cards, map, elevation profile, splits) and/or one overview image of the whole result. Likely approach: render sections to PNG in the browser (e.g. html-to-image or a canvas renderer); check map tiles render cross-origin (CARTO/OSM tiles must allow CORS for canvas capture) and that CARTO attribution is kept in exported map images
- [ ] **Course-to-course comparison:** compare a GPX race result with a second route profile (e.g. "what would my Philly time be worth on Boston?") instead of flat/ideal conditions. Likely approach: evaluate on course A → flat-equivalent effort → plan on course B with that effort (both engines already exist); decide whose weather applies to course B (its own date/forecast, or neutral)
- [ ] **Real Boston Marathon demo course:** replace the synthetic straight-line demo (public/demo/demo-course.gpx, demo-run.gpx) with the actual Boston course. Needs a GPX source whose licence allows redistribution in a public repo (e.g. an OpenStreetMap relation export, ODbL with attribution), then regenerate demo-run.gpx with scripts/make-demo-run.mjs and update video/record.mjs captions if used
- [ ] **Drag-to-select on the profile:** drag across the elevation profile to select any stretch and show its adjusted pace (plus split time, elevation gain/loss, average grade and the grade/wind/heat breakdown; recorded runs: actual and flat-equivalent pace). Likely approach: reuse `timeAt()` on the cumulative times for start/end distances (as splits do), highlight the range on the map and profile (`highlight()`/`setRange()` already exist), and show a small summary panel. On touch, decide how a drag coexists with tap-for-tooltip and page scrolling (e.g. long-press then drag, or a "select" mode toggle)

### Advanced settings & model ideas (noted 2026-10-30, not started)
- [ ] **Factor strength sliders:** an Advanced settings section with a 0–100%+ slider per factor (elevation, wind, heat), e.g. wind at 50% effect. Likely approach: scale each factor's effect on speed per stretch (interpolate in log-speed between unadjusted and fully adjusted) so 0% = off, 100% = current model; the existing on/off cards become shortcuts for 0%/100%. Applies to plan, evaluate and recorded runs; keep round-trip tests passing at any setting
- [ ] **Flatten the elevation extremes:** an advanced setting that compresses the grade effect at the extremes (steep uphills less slow, steep downhills less fast). Likely approach: a "steepness response" control that shrinks the effective grade beyond a threshold before the GAP formula (e.g. soft-knee compression), shown with a small preview of pace vs. grade
- [ ] **Better downhill model — DECIDED APPROACH (2026-10-30, not implemented yet):** remove the −8% downhill cap (`DOWNHILL_CAP_GRADE` in `src/lib/adjust.js`, also used by `flatEquivalentSpeed`) so the full Minetti/Black curve applies (benefit peaks ≈ +73% at −18% for an 8:00/mi runner, then fades and reverses on very steep descents; see `docs/grade-curve.png`). Pair it with the elevation "flattener" (the factor-strength / flatten-extremes ideas above) so users can tame the steep-grade extremes themselves. Ship them together, since removing the cap alone makes steep descents much faster again. When doing it: update the info notes (the "< −8%" note), the Method text, FORMULAS.md "App policy" row, `scripts/cap-effect.mjs`, and the tests that assert −15% equals −8%; regenerate the grade chart
- [ ] **Use terrain elevation even when the GPX has elevation:** input-page option to ignore the file's elevation and use AWS Terrain Tiles instead (useful for noisy GPS/barometer data). `buildCourse` already supports `forceDem`; needs a checkbox on the input page (shown when the file has elevation) and a note in the Method section
- [ ] **Editable target splits:** let the user type their own target split times/paces (per mile, km or hill segment) and regenerate the adjusted splits and totals on the fly. Needs a decision on what's edited (adjusted course splits vs. flat-effort splits) and how the remaining splits rebalance when one changes (keep the finish time fixed, or let it move)
- [ ] **Negative/positive split slider (plan mode):** an advanced slider that tilts the base pace profile from negative split (faster second half) through even to positive split, before the course adjustments. Likely approach: apply a linear (or smooth) effort ramp along the distance that averages to the goal pace, so the finish time is unchanged; show the first-half/second-half split difference next to the slider
- [ ] **Altitude adjustment (model to be provided by the user):** a fourth factor for running at elevation above sea level (thinner air: less oxygen, slightly less air resistance), separate from the grade/hill effect. Waiting on the user's model before any design. Groundwork already in place: every 100 m stretch knows its elevation (`ele0`/`ele1`, from the GPX or AWS Terrain Tiles). Likely fits as another speed→speed step in `adjustOne` (and its inverse in `flatEquivalentSpeed`), with its own factor card, map/profile layer, and on/off switch like the others. To decide when the model arrives: where it sits in the grade → wind → heat order; whether it needs a "home altitude"/acclimatisation input; and how it interacts with the wind model's fixed sea-level air density (1.225 kg/m³)
