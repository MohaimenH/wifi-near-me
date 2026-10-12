import type { Sql } from "@/lib/db";

export async function insertPlace(
  sql: Sql,
  o: Partial<{ name: string; lat: number; lng: number; category: string; source: "osm" | "user"; osm_id: number | null }> = {},
): Promise<number> {
  const { name = "Test Cafe", lat = 41.0086, lng = 28.9795, category = "cafe", source = "osm" } = o;
  const osmId = o.osm_id === undefined ? Math.floor(Math.random() * 1e12) : o.osm_id;
  const osmType = osmId === null ? null : "node";
  const [row] = await sql`
    INSERT INTO places (osm_type, osm_id, name, category, geom, source)
    VALUES (${osmType}, ${osmId}, ${name}, ${category},
            ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography, ${source})
    RETURNING id`;
  return row.id as number;
}

export async function insertEntry(
  sql: Sql,
  placeId: number,
  o: Partial<{
    label: string; access_type: string; steps_text: string; password: string | null;
    password_policy: string; status: string;
  }> = {},
): Promise<number> {
  const {
    label = "Guest", access_type = "password", steps_text = "Ask the staff.",
    password = null, password_policy = "none", status = "active",
  } = o;
  const [row] = await sql`
    INSERT INTO wifi_entries (place_id, label, access_type, steps_text, password, password_policy, status)
    VALUES (${placeId}, ${label}, ${access_type}, ${steps_text}, ${password}, ${password_policy}, ${status})
    RETURNING id`;
  return row.id as number;
}
