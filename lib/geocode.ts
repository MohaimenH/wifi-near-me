import type { GeocodeResult } from "./types";

interface PhotonProps {
  name?: string; street?: string; osm_key?: string; osm_value?: string;
  district?: string; city?: string; state?: string; country?: string;
}

function kindFor(p: PhotonProps): { label: string; zoom: number } {
  const k = p.osm_key, v = p.osm_value;
  if (k === "aeroway") return { label: "Airport", zoom: 14 };
  if (k === "railway" || k === "public_transport") return { label: "Station", zoom: 16 };
  if (k === "place") {
    if (v === "city") return { label: "City", zoom: 11.5 };
    if (v === "town") return { label: "Town", zoom: 12.5 };
    if (v === "village") return { label: "Village", zoom: 13.5 };
    if (v === "suburb" || v === "quarter" || v === "neighbourhood" || v === "district") return { label: "District", zoom: 14 };
    if (v === "country" || v === "state" || v === "region") return { label: "Region", zoom: 6 };
    return { label: "Place", zoom: 14 };
  }
  if (k === "tourism") return { label: v === "hotel" || v === "hostel" ? "Hotel" : "Attraction", zoom: 16 };
  if (k === "amenity") return { label: String(v ?? "place").replace(/_/g, " "), zoom: 16 };
  if (k === "highway") return { label: "Street", zoom: 16 };
  return { label: String(v ?? k ?? "place").replace(/_/g, " "), zoom: 15 };
}

interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: PhotonProps }

export function normalizePhoton(json: unknown): GeocodeResult[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: GeocodeResult[] = [];
  for (const f of features as PhotonFeature[]) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const kind = kindFor(p);
    const where = [p.district || p.city, p.state, p.country]
      .filter((x): x is string => !!x)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join(", ");
    const name = p.name || p.street || "Unnamed";
    const key = `${name}|${kind.label}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind: kind.label, where, lat: c[1], lng: c[0], zoom: kind.zoom });
    if (out.length === 6) break;
  }
  return out;
}

// Small per-instance cache. It cuts repeated upstream calls; it is not shared between server instances.
const TTL_MS = 10 * 60_000;
const MAX_KEYS = 500;
const cache = new Map<string, { at: number; results: GeocodeResult[] }>();

export function cacheGet(key: string, now = Date.now()): GeocodeResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

export function cacheSet(key: string, results: GeocodeResult[], now = Date.now()): void {
  if (!cache.has(key) && cache.size >= MAX_KEYS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, results });
}

export function cacheClear(): void {
  cache.clear();
}
