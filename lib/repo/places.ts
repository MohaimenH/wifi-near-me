import type { Sql } from "@/lib/db";
import type { EntryRow } from "@/lib/serializers/wifiEntry";
import type { Category, PlaceSummary } from "@/lib/types";

export async function findNearby(
  sql: Sql,
  q: { lat: number; lng: number; radius_m: number; limit: number },
): Promise<PlaceSummary[]> {
  const rows = await sql`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${q.lng}::float8, ${q.lat}::float8), 4326)::geography AS g
    )
    SELECT p.id, p.name, p.category,
           ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
           ST_Distance(p.geom, o.g) AS distance_m,
           (SELECT count(*) FROM wifi_entries e WHERE e.place_id = p.id AND e.status = 'active') AS entry_count
    FROM places p, origin o
    WHERE ST_DWithin(p.geom, o.g, ${q.radius_m}::float8)
    ORDER BY distance_m
    LIMIT ${q.limit}`;
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category, lat: r.lat, lng: r.lng,
    distance_m: r.distance_m, entry_count: r.entry_count,
  })) as PlaceSummary[];
}

export async function getPlaceRow(sql: Sql, id: number) {
  const [row] = await sql`
    SELECT id, name, category, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, source
    FROM places WHERE id = ${id}`;
  if (!row) return null;
  return row as { id: number; name: string; category: Category; lat: number; lng: number; source: "osm" | "user" };
}

/** Active entries only. Its rows go to clients ONLY through serializeEntry. */
export async function listEntryRows(sql: Sql, placeId: number): Promise<EntryRow[]> {
  const rows = await sql`
    SELECT e.id, e.place_id, e.label, e.access_type, e.steps_text, e.language,
           e.password, e.password_policy, e.status,
           (SELECT count(*) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'works') AS works,
           (SELECT count(*) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'broken') AS broken,
           GREATEST(
             e.updated_at,
             COALESCE((SELECT max(v.created_at) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'works'), e.updated_at)
           ) AS last_confirmed_at
    FROM wifi_entries e
    WHERE e.place_id = ${placeId} AND e.status = 'active'
    ORDER BY e.created_at, e.id`;
  return rows as unknown as EntryRow[];
}
