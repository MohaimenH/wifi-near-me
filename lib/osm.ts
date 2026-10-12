import type { Sql } from "./db";
import type { Category } from "./types";

export interface PlaceSeed {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  country_code?: string | null;
}

export function categoryFor(tags: Record<string, string>): Category | null {
  switch (tags.amenity) {
    case "cafe": return "cafe";
    case "restaurant":
    case "bar": return "restaurant";
    case "library": return "library";
    case "coworking_space": return "coworking";
  }
  switch (tags.tourism) {
    case "hotel":
    case "guest_house": return "hotel";
    case "hostel": return "hostel";
  }
  if (tags.aeroway === "aerodrome") return "airport";
  if (tags.railway === "station") return "station";
  return null;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Reads the JSON that the Overpass API returns for `out center tags;`. */
export function parseOverpass(json: unknown): PlaceSeed[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const out: PlaceSeed[] = [];
  for (const el of elements as OverpassElement[]) {
    if (el.type !== "node" && el.type !== "way" && el.type !== "relation") continue;
    if (typeof el.id !== "number") continue;
    const tags = el.tags ?? {};
    const name = (tags.name ?? "").trim();
    const category = categoryFor(tags);
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || !category || typeof lat !== "number" || typeof lng !== "number") continue;
    const key = `${el.type}:${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ osm_type: el.type, osm_id: el.id, name: name.slice(0, 200), category, lat, lng });
  }
  return out;
}

/** Idempotent upsert keyed by (osm_type, osm_id). Never deletes. Returns rows written. */
export async function importPlaces(sql: Sql, seeds: PlaceSeed[]): Promise<number> {
  if (seeds.length === 0) return 0;
  // JSON goes in as text, then is cast, so postgres.js does not encode it twice.
  const rows = await sql`
    INSERT INTO places (osm_type, osm_id, name, category, geom, country_code, source)
    SELECT t.osm_type, t.osm_id, t.name, t.category,
           ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)::geography, t.country_code, 'osm'
    FROM jsonb_to_recordset(${JSON.stringify(seeds)}::text::jsonb)
         AS t(osm_type text, osm_id bigint, name text, category text, lat float8, lng float8, country_code text)
    ON CONFLICT (osm_type, osm_id)
    DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, geom = EXCLUDED.geom,
                  country_code = COALESCE(EXCLUDED.country_code, places.country_code)
    RETURNING id`;
  return rows.length;
}
