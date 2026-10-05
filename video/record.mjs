// Records a scripted demo of the live app as a LinkedIn-ready MP4 (1080×1350, 4:5, H.264, 30 fps).
//
// Frame-by-frame ("stop-motion") capture: each step takes a full-resolution screenshot and gives it an
// on-screen duration, and animations (scrolls, fades, taps, typing) are stepped one frame at a time,
// so playback is smooth at 30 fps whatever the capture speed. Network waits are simply not filmed.
//
//   node record.mjs "<path to race GPX>" [race name]
//   APP_URL=http://localhost:5173/ node record.mjs ...   (defaults to the live site)
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const APP_URL = process.env.APP_URL ?? 'https://birdjc.github.io/racepace/';
const GPX = process.argv[2];
const RACE_NAME = process.argv[3] ?? 'Philadelphia Distance Run';
if (!GPX || !fs.existsSync(GPX)) throw new Error('Usage: node record.mjs "<path to GPX>" [race name]');
const FPS = 30;
const OUT = path.resolve('out');
const FR = path.join(OUT, 'frames');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 540, height: 675 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: 'dark', locale: 'en-US', timezoneId: 'America/New_York'
});
const page = await ctx.newPage();

// ---------------------------------------------------------------- frame timeline
const frames = [];
async function snap(dur) {
  const f = `f${String(frames.length).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: path.join(FR, f), type: 'jpeg', quality: 92 });
  frames.push({ f, dur });
}
const hold = sec => snap(sec);
const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
async function animate(sec, fn) {
  const steps = Math.max(1, Math.round(sec * FPS));
  for (let i = 1; i <= steps; i++) { await fn(ease(i / steps)); await snap(1 / FPS); }
}

// ---------------------------------------------------------------- overlays (caption, cards, taps)
async function injectOverlays() {
  await page.addStyleTag({ content: `
    * { -webkit-tap-highlight-color: transparent !important; } /* the video draws its own tap ripple */
    #vid-cap { position: fixed; left: 14px; right: 14px; bottom: 26px; z-index: 5000; opacity: 0; pointer-events: none;
      background: rgba(12, 14, 18, 0.94); border: 1px solid rgba(255,255,255,0.14); border-left: 4px solid #9085e9;
      border-radius: 14px; padding: 12px 16px; box-shadow: 0 10px 30px rgba(0,0,0,.45); font-family: system-ui, "Segoe UI", sans-serif; }
    #vid-cap .t { color: #fff; font-size: 21px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
    #vid-cap .s { color: #c9ced8; font-size: 15px; margin-top: 4px; line-height: 1.35; }
    #vid-card { position: fixed; inset: 0; z-index: 6000; background: #0e1013; display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center; padding: 40px; gap: 14px; opacity: 0; pointer-events: none; font-family: system-ui, "Segoe UI", sans-serif; }
    #vid-card .logo { width: 84px; height: 84px; border-radius: 20px; background: #f3f4f6; display: grid; place-items: center; }
    #vid-card h1 { color: #fff; font-size: 38px; margin: 6px 0 0; letter-spacing: -0.02em; }
    #vid-card p { color: #c3c7cf; font-size: 19px; margin: 0; line-height: 1.4; }
    #vid-card .pills { display: flex; gap: 8px; margin-top: 6px; }
    #vid-card .pill { color: #fff; font-size: 15px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); }
    #vid-card .url { color: #9085e9; font-size: 21px; font-weight: 700; margin-top: 10px; }
    #vid-card .small { color: #8b919b; font-size: 13px; margin-top: 18px; }
    #vid-tap { position: fixed; z-index: 5500; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
      background: rgba(255,255,255,.35); border: 3px solid rgba(255,255,255,.9); opacity: 0; pointer-events: none; }
  ` });
  await page.evaluate(() => {
    for (const id of ['vid-cap', 'vid-card', 'vid-tap']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
  });
}
const LOGO = '<svg viewBox="0 0 32 32" width="56" height="56"><path d="M5 23l7-9 5 5 4-6 6 10" fill="none" stroke="#0e1013" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
async function card(html) { await page.evaluate(h => { document.getElementById('vid-card').innerHTML = h; }, html); }
const setOpacity = (id, o) => page.evaluate(([i, v]) => { document.getElementById(i).style.opacity = v; }, [id, o]);

async function caption(title, sub, holdSec = 0) {
  const visible = await page.evaluate(() => getComputedStyle(document.getElementById('vid-cap')).opacity > 0.5);
  if (visible) await animate(0.18, t => setOpacity('vid-cap', 1 - t));
  await page.evaluate(([t, s]) => { document.getElementById('vid-cap').innerHTML = `<div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}`; }, [title, sub]);
  await animate(0.25, t => setOpacity('vid-cap', t));
  if (holdSec) await hold(holdSec);
}
const hideCaption = () => animate(0.2, t => setOpacity('vid-cap', 1 - t));

// Tap ripple at an element (or a point), then perform the tap
async function tap(target, { action = true } = {}) {
  let x, y;
  if (typeof target === 'string') {
    const el = page.locator(target).first();
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    x = b.x + b.width / 2; y = b.y + b.height / 2;
  } else ({ x, y } = target);
  await page.evaluate(([px, py]) => { const r = document.getElementById('vid-tap'); r.style.left = `${px}px`; r.style.top = `${py}px`; }, [x, y]);
  await animate(0.18, t => page.evaluate(v => { const r = document.getElementById('vid-tap'); r.style.opacity = v; r.style.transform = `scale(${0.6 + 0.4 * v})`; }, t));
  if (action) await page.touchscreen.tap(x, y);
  await animate(0.22, t => page.evaluate(v => { const r = document.getElementById('vid-tap'); r.style.opacity = 1 - v; r.style.transform = `scale(${1 + 0.4 * v})`; }, t));
}

async function scrollToEl(selector, offset = 70, sec = 0.8) {
  const from = await page.evaluate(() => window.scrollY);
  const to = await page.evaluate(([s, o]) => {
    const el = document.querySelector(s);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.max(0, Math.min(max, el.getBoundingClientRect().top + window.scrollY - o));
  }, [selector, offset]);
  await animate(sec, t => page.evaluate(y => window.scrollTo(0, y), from + (to - from) * t));
}

async function typeInto(selector, text, perFrame = 2) {
  await page.evaluate(s => { const el = document.querySelector(s); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, selector);
  for (let i = perFrame; i < text.length + perFrame; i += perFrame) {
    await page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [selector, text.slice(0, i)]);
    await snap(1 / FPS);
  }
}

const waitResults = async () => {
  await page.waitForSelector('#results-view:not([hidden])', { timeout: 90000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
};
const settled = () => page.waitForFunction(() => !document.getElementById('results-view').classList.contains('updating'));

// ================================================================= the script
await page.goto(APP_URL, { waitUntil: 'networkidle' });
await injectOverlays();

// --- Title card
await card(`<div class="logo">${LOGO}</div><h1>Race Pace Adjuster</h1>
  <p>What's a race time really worth, and how should you pace the next one?</p>
  <div class="pills"><span class="pill">Hills</span><span class="pill">Wind</span><span class="pill">Heat &amp; humidity</span></div>`);
await setOpacity('vid-card', 1);
await hold(2.4);
await animate(0.45, t => setOpacity('vid-card', 1 - t));

// --- 1. Upload the course
await tap('#mode [data-mode="evaluate"]');
await caption('Upload a race course', `Any GPX file. This one: the ${RACE_NAME}, straight from Strava`);
await hold(0.6);
await tap('#dropzone', { action: false });
await page.setInputFiles('#gpx-file', GPX);
await page.waitForTimeout(400);
await hold(1.1);
await scrollToEl('#dropzone', 90, 0.6);
await hold(0.5);

// --- 2. Recorded run toggle
await page.waitForFunction(() => !document.getElementById('use-recorded').disabled && !document.getElementById('recorded-summary').textContent.includes('looking up'), null, { timeout: 30000 });
await caption('Ran it with a watch?', 'Use the recorded run: the date, start time and finish time fill in automatically');
await scrollToEl('#recorded-box', 150, 0.6);
await hold(0.8);
await tap('#recorded-box .toggle-row');
await page.waitForTimeout(300);
await hold(0.7);
await scrollToEl('#race-name-input', 120, 0.7);
await typeInto('#race-name-input', RACE_NAME, 2);
await hold(0.5);
await scrollToEl('#step3-title', 260, 0.7);
await hold(1.3);

// --- 3. Evaluate
await caption('What was that result worth?', 'The app pulls the elevation profile and the actual race-morning weather');
await scrollToEl('#submit', 300, 0.5);
await tap('#submit');
await page.waitForTimeout(250);
await hold(1.2);
await waitResults();
await page.evaluate(() => window.scrollTo(0, 0));

// --- 4. Headline
const fx = await page.evaluate(() => {
  const s = window.__rpa.state, t0 = Date.parse(`${s.startLocal}:00Z`), t1 = t0 + s.enteredSec * 1000;
  const hrs = s.weather.hours.filter(h => { const t = Date.parse(`${h.time}:00Z`); return t + 3600000 > t0 && t < t1; });
  const avg = k => hrs.reduce((a, h) => a + h[k], 0) / hrs.length;
  const card = f => document.querySelector(`.factor[data-f="${f}"] .factor-val`).textContent;
  return { course: document.getElementById('goal-time-out').textContent, flat: document.getElementById('adj-time-out').textContent,
    tempF: Math.round(avg('tempC') * 9 / 5 + 32), rh: Math.round(avg('rh')), heat: card('heat'), wind: card('wind'), grade: card('grade') };
});
await caption(`${fx.course} on a ${fx.tempF}°F, ${fx.rh}% humidity morning…`, `…is worth <b style="color:#fff">${fx.flat}</b> on a flat course in ideal conditions`);
const thumbFrame = frames.length;
await hold(3.4);

// --- 5. Factors
await scrollToEl('.factors', 110, 0.7);
await caption('See what each factor cost', `Heat ${fx.heat} · Wind ${fx.wind} · Hills ${fx.grade}. Tap any card to include or exclude it`);
await hold(1.4);
await tap('.factor[data-f="heat"]');
await settled(); await page.waitForTimeout(150);
await scrollToEl('.finish-card', 80, 0.5);
await hold(1.2);
await scrollToEl('.factors', 110, 0.5);
await tap('.factor[data-f="heat"]');
await settled(); await page.waitForTimeout(150);
await hold(0.6);

// --- 6. Effort map
await scrollToEl('.course-card', 64, 0.9);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(600);
await caption('Your effort, mile by mile', 'Terrain and weather removed: blue = pushed harder, red = eased off');
await hold(2.6);

// --- 7. Profile taps
await scrollToEl('#profile', 120, 0.8);
await caption('Tap anywhere on the course', 'Actual pace, flat-equivalent pace, grade, wind and heat at that point');
for (const frac of [0.3, 0.78]) {
  const b = await page.locator('#profile').boundingBox();
  await tap({ x: b.x + 40 + (b.width - 50) * frac, y: b.y + 70 });
  await page.waitForTimeout(100);
  await hold(1.7);
}
await page.evaluate(() => { document.getElementById('tooltip').hidden = true; });

// --- 8. Splits
await scrollToEl('#splits-title', 70, 0.9);
await caption('Real splits, adjusted', 'Each mile’s actual time and what it was worth on a flat course');
await hold(1.0);
await scrollToEl('.table-wrap', 90, 0.7);
await hold(1.1);
await animate(1.2, t => page.evaluate(v => { const w = document.querySelector('.table-wrap'); w.scrollTop = v * (w.scrollHeight - w.clientHeight) * 0.6; }, t));
await hold(0.5);

// --- 9. Plan mode
await caption('Planning the next one?', 'Switch to “Plan a race” and enter a goal time');
const topFrom = await page.evaluate(() => window.scrollY);
await animate(0.8, t => page.evaluate(y => window.scrollTo(0, y), topFrom * (1 - t)));
await tap('#back');
await page.waitForTimeout(200);
await hold(0.4);
await scrollToEl('#recorded-box', 150, 0.5);
await tap('#recorded-box .toggle-row');
await page.waitForTimeout(200);
await scrollToEl('#mode', 80, 0.5);
await tap('#mode [data-mode="plan"]');
await hold(0.5);
await scrollToEl('#race-date', 200, 0.6);
await page.fill('#race-date', '2027-09-19');
await page.fill('#start-time', '07:30');
await page.evaluate(() => document.activeElement?.blur());
await hold(0.6);
await scrollToEl('#goal-split', 240, 0.5);
await tap('#goal-h', { action: false });
await typeInto('#goal-h', '1', 1);
await typeInto('#goal-m', '05', 1);
await typeInto('#goal-s', '00', 1);
await page.evaluate(() => { for (const id of ['goal-h', 'goal-m', 'goal-s']) document.getElementById(id).dispatchEvent(new Event('input', { bubbles: true })); });
await hold(0.9);
await scrollToEl('#submit', 300, 0.5);
await tap('#submit');
await page.waitForTimeout(250);
await hold(0.8);
await waitResults();
await page.evaluate(() => window.scrollTo(0, 0));
await caption('A pacing plan for that course and day', 'Typical race-morning weather for a date beyond the forecast, adjusted for hills, wind and heat');
await hold(2.5);
await scrollToEl('#splits-title', 70, 0.9);
await hold(0.8);
await scrollToEl('.table-wrap', 90, 0.6);
await hold(1.5);
await hideCaption();

// --- End card
await card(`<div class="logo">${LOGO}</div><h1>Race Pace Adjuster</h1>
  <p>Plan a race, or find out what a result was really worth.</p>
  <div class="pills"><span class="pill">Hills</span><span class="pill">Wind</span><span class="pill">Heat &amp; humidity</span><span class="pill">Watch files</span></div>
  <div class="url">birdjc.github.io/racepace</div>
  <div class="small">Pace models adapted from John J. Davis, Running Writings (MIT). Weather: Open-Meteo.</div>`);
await animate(0.45, t => setOpacity('vid-card', t));
await hold(3.4);

await browser.close();

// ================================================================= encode
const list = frames.map(fr => `file '${fr.f}'\nduration ${fr.dur.toFixed(5)}`).join('\n') + `\nfile '${frames.at(-1).f}'\n`;
fs.writeFileSync(path.join(FR, 'list.txt'), list);
const total = frames.reduce((s, fr) => s + fr.dur, 0);
const mp4 = path.join(OUT, 'race-pace-adjuster-linkedin.mp4');
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'concat', '-safe', '0', '-i', path.join(FR, 'list.txt'),
  '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
  '-vf', `fps=${FPS},scale=1080:1350:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.1',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', mp4
]);
// Thumbnail (LinkedIn lets you upload a custom cover image): the headline results frame
fs.copyFileSync(path.join(FR, frames[thumbFrame].f), path.join(OUT, 'race-pace-adjuster-thumbnail.jpg'));
console.log(`frames: ${frames.length}, duration ${total.toFixed(1)} s → ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
