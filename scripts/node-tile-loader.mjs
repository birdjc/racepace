// Node tile loader for scripts/tests (browser uses canvas decoding instead)
import { PNG } from 'pngjs';
import { TILE_URL } from '../src/lib/elevation.js';
export async function nodeTileLoader(z, x, y) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tile ${url} ${res.status}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  return { width: png.width, height: png.height, data: png.data };
}
