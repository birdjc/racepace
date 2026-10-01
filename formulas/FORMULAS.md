# Adjustment formulas: reference

Extracted from John J. Davis's Running Writings apps (MIT license, see `LICENSE-JohnDavis.md`).
The originals are in `../reference/`. Each file here is a pure ES module with no DOM code, and
`../verify_formulas.mjs` checks it against the original code (all cases match to 1e-9).

For each component, the race app uses the **effort** direction: it takes a flat, calm, cool goal
pace and returns the pace the runner can expect at the same effort under the course conditions.

---

## 1. Grade: `gap.js`

| | |
|---|---|
| **Source file** | `gap-app-main/scripts.js` (`calcDeltaEC`, `lookupSpeed`, `getEquivFlatSpeed`, `updateResult` reverse branch) |
| **Language** | JavaScript (original); the model table was built in R (`export_black_gam.R`: mgcv, tidyverse, jsonlite) |
| **Data** | `data/black_data_gam.json`: Black et al. 2018 flat cost of running, GAM-smoothed, 201 rows at 0–10 m/s |
| **Packages** | none at runtime |
| **Math** | `Cr_total(v, g) = Cr_flat(v) [Black GAM, J/kg/m] + ΔCr(g) [Minetti 2002 quintic, intercept dropped]`<br>`ΔCr(g) = 155.4g⁵ − 30.4g⁴ − 43.3g³ + 46.3g² + 19.5g` |
| **App function** | `hillSpeedFromFlatEffort(flat_speed_m_s, grade)` returns the hill speed in m/s |
| **Inputs** | `flat_speed_m_s` (m/s); `grade` as a decimal (0.05 = 5%, negative means downhill) |
| **Output** | speed on that grade at the same metabolic power (W/kg). Solved by 10 fixed-point iterations. |
| **Valid range** | Minetti was fitted on grades from −45% to +45%. The Black table covers 0–10 m/s (reliable data ~2.2–4.7 m/s), and lookups outside it return NaN. |
| **Other direction** | `gapFromHillSpeed(v, grade)` converts an actual hill speed to its flat equivalent |
| **App policy** | Not part of John Davis's formula: the race app (`src/lib/adjust.js`) caps the downhill benefit at −8% (steeper descents are paced as −8%) and caps uphill grades at +45%. |

## 2. Wind: `wind.js`

| | |
|---|---|
| **Source file** | `wind-calculator-main/scripts.js` (`doWindCalcs` and helpers) |
| **Language** | JavaScript (original); R prototypes are in `analysis/black_polynomial.R` and `kipp_analysis.R` |
| **Data** | none (closed-form) |
| **Packages** | none |
| **Math** | Still-air cost `C_t(v) = 8.09986 + 0.12910v + 0.48105v² − 1.13918·elite` (W/kg, Black)<br>Chest-height wind `w = w₁₀ · (1.5/10)^α` (power law, **α = 0.3**)<br>Frontal area `Ap = 0.266 · 0.1173·m^0.6466`; drag `F = ½ρ·Cd·Ap·v_rel²` (ρ 1.225, Cd 0.8)<br>Air penalty `pct = F·sin(θ_rel) / (m·g) · 6.13`; total `C = C_t(v)·(1 + pct)`<br>Solves for the speed where `C_wind(v) = C_calm(v_goal)` on a 0.01 m/s grid from 0–12 m/s |
| **App function** | `speedInWindFromEffort(speed_m_s, wind10m_m_s, windAngleDeg, {weightKg, alpha})` returns the speed in wind, in m/s |
| **Inputs** | runner speed (m/s); wind speed **at 10 m** (m/s), the height forecast APIs report; `windAngleDeg` = wind-from bearing − runner heading (0° is a headwind, 180° a tailwind); `weightKg` (default 68); `alpha` (fixed at 0.3) |
| **Output** | achievable speed at the same metabolic cost (m/s) |
| **Other direction** | `calmEquivalentSpeed(...)` |
| **Note** | Body mass affects the result slightly: the penalty scales with `m^−0.35`. The original default is 68 kg. |

## 3. Heat & humidity: `heat.js`

| | |
|---|---|
| **Source file** | `heat-adjusted-pace-main/scripts.js` (`createLogspeedAdjustInterpolator`, `create1DInterpolationLookup`, `doHeatAdjustment`, `calculateRelativeHumidity`) |
| **Language** | JavaScript (original); the model was fit in R (`analysis/heat_app_analysis.R`: mgcv, tidyverse, readxl, jsonlite) |
| **Data** | `data/heat_humidity_adjustments_fine_v2025-09-04.json`: a 46 × 101 grid (0–45 °C × 0–100% RH) of `logspeed_adjust`. It is the one the live app uses; the "coarse" file is unused. `data/heat_index_adjustments_v2025-09-04.json` is an alternative 1-D table keyed on heat index. |
| **Packages** | none at runtime |
| **Math** | `ln(v_hot) = ln(v_cool) + adj(T, RH)`, with bilinear interpolation and linear extrapolation outside the grid. `adj ≤ 0`, and it is 0 at the optimum (~8–14 °C). |
| **App function** | `heatAdjustedSpeedFromEffort(speed_m_s, tempC, rh)` returns the expected speed in m/s |
| **Inputs** | speed (m/s); air temperature (°C); relative humidity (%). Dew point converts to RH with `calculateRelativeHumidity` (Magnus). |
| **Output** | expected speed (m/s) |
| **Other direction** | `coolEquivalentSpeed(...)` |
| **Caveat** | The model is fit to **whole-marathon** results (Mantzios et al. 2022). Applying it hour by hour is an approximation, though a reasonable one because the adjustment is multiplicative and does not depend on speed. |

---

## Stacking (race app)
In effort mode each adjustment maps a speed to a speed, so they chain in the specified order:

```
v_goal ─► GAP(grade_seg) ─► Wind(w, θ_seg) ─► Heat(T_hour, RH_hour) ─► v_adjusted
```
Any stage can be switched off by replacing it with the identity function. To show per-factor
impacts (the Elev, Wind and Heat cards), the app also computes each factor alone against `v_goal`.
