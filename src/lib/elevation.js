// Elevation from AWS Terrain Tiles (Terrarium PNG encoding), the same source R's elevatr uses.
// No API key. Zoom 14 ≈ 9.5 m/pixel at the equator (finer at higher latitudes); US source
// data is USGS 3DEP/NED (~10 m), elsewhere mostly SRTM/GMTED (~30 m).

export const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEFAULT_ZOOM = 14;
const TILE_SIZE = 256;

export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

// Global pixel coordinates (Web Mercator) at zoom z
export function lonLatToGlobalPixel(lon, lat, z) {
  const scale = TILE_SIZE * 2 ** z;
  const x = (lon + 180) / 360 * scale;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Browser tile loader: fetch PNG -> RGBA pixels
export async function browserTileLoader(z, x, y) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url);
      if (res.ok || res.status < 500 || attempt >= 2) break;
    } catch (err) {
      if (attempt >= 2) throw err; // network error after three tries
    }
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`Elevation tile ${z}/${x}/${y} failed (${res.status})`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

// Sample elevation (m) for each {lat, lon} with bilinear interpolation between pixel centres.
// loadTile(z, x, y) -> Promise<{width, height, data: RGBA bytes}>
export async function sampleElevations(points, { zoom = DEFAULT_ZOOM, loadTile = browserTileLoader, concurrency = 6 } = {}) {
  const px = points.map(p => lonLatToGlobalPixel(p.lon, p.lat, zoom));

  // Collect every tile touched by a 2×2 bilinear neighbourhood
  const needed = new Set();
  for (const { x, y } of px) {
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
    for (const [gx, gy] of [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]]) {
      needed.add(`${Math.floor(gx / TILE_SIZE)}/${Math.floor(gy / TILE_SIZE)}`);
    }
  }

  const tiles = new Map();
  const queue = [...needed];
  async function worker() {
    while (queue.length) {
      const key = queue.pop();
      const [tx, ty] = key.split('/').map(Number);
      tiles.set(key, await loadTile(zoom, tx, ty));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const pixel = (gx, gy) => {
    const tile = tiles.get(`${Math.floor(gx / TILE_SIZE)}/${Math.floor(gy / TILE_SIZE)}`);
    const lx = ((gx % TILE_SIZE) + TILE_SIZE) % TILE_SIZE, ly = ((gy % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const i = (ly * tile.width + lx) * 4;
    return decodeTerrarium(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
  };

  return px.map(({ x, y }) => {
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const top = pixel(x0, y0) * (1 - tx) + pixel(x0 + 1, y0) * tx;
    const bot = pixel(x0, y0 + 1) * (1 - tx) + pixel(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  });
}
