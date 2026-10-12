/** Public Google Maps URL format. No API key, no billing. Coordinates only, so the route goes to the pin. */
export function directionsUrl(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}
