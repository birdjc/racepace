// Render an SVG file to a 2× PNG with Playwright: node svg2png.mjs in.svg out.png
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
const [src, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(src).href);
await page.screenshot({ path: out });
await browser.close();
