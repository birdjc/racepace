// Reverse geocoding for the race location label (OpenStreetMap Nominatim; no key, max 1 req/s).
export async function reverseGeocode(lat, lon, fetchFn = fetch) {
  const q = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4), format: 'jsonv2', zoom: '10' });
  const res = await fetchFn(`https://nominatim.openstreetmap.org/reverse?${q}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Reverse geocode failed (${res.status})`);
  const a = (await res.json()).address ?? {};
  const city = a.city || a.town || a.village || a.municipality || a.county;
  const region = a.state || a.region || a.country;
  return [city, region].filter(Boolean).join(', ') || null;
}
