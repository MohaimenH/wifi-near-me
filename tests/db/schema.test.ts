import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "@/lib/db";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const APP_TABLES = ["schema_migrations", "places", "wifi_entries", "wifi_entry_revisions", "votes", "reports", "rate_events"];

describe("schema", () => {
  it("has PostGIS and all tables", async () => {
    const [{ v }] = await sql`SELECT PostGIS_Version() AS v`;
    expect(v).toBeTruthy();
    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of APP_TABLES) expect(names).toContain(t);
  });

  it("enables row level security on every app table", async () => {
    const rows = await sql`SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname IN ${sql(APP_TABLES)}`;
    expect(rows).toHaveLength(APP_TABLES.length);
    for (const r of rows) expect(r.relrowsecurity).toBe(true);
  });

  it("hides rows from a role that is not the owner, even with SELECT granted", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "secret" });
    await sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN CREATE ROLE rls_probe; END IF; END $$`;
    await sql`GRANT SELECT ON wifi_entries TO rls_probe`;
    const seen = await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as Sql;
      await tx`SET LOCAL ROLE rls_probe`;
      const [{ n }] = await tx`SELECT count(*) AS n FROM wifi_entries`;
      return n as number;
    });
    expect(seen).toBe(0);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(1);
  });

  it("rejects a duplicate OSM place but allows many user places without an OSM id", async () => {
    await insertPlace(sql, { osm_id: 5 });
    await expect(insertPlace(sql, { osm_id: 5 })).rejects.toThrow(/duplicate key/);
    await insertPlace(sql, { osm_id: null, source: "user", name: "U1" });
    await insertPlace(sql, { osm_id: null, source: "user", name: "U2" });
    const [{ n }] = await sql`SELECT count(*) AS n FROM places WHERE osm_id IS NULL`;
    expect(n).toBe(2);
  });

  it("finds a place inside a radius with ST_DWithin", async () => {
    await insertPlace(sql, { name: "Near", lat: 41.0086, lng: 28.9795 });
    await insertPlace(sql, { name: "Far", lat: 36.8841, lng: 30.7056 });
    const rows = await sql`
      SELECT name FROM places
      WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(28.98::float8, 41.01::float8), 4326)::geography, 3000)`;
    expect(rows.map((r) => r.name)).toEqual(["Near"]);
  });

  it("rejects bad values through check constraints", async () => {
    const placeId = await insertPlace(sql);
    await expect(insertEntry(sql, placeId, { access_type: "magic" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { steps_text: "" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { status: "disputed" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { password_policy: "ask_staff" })).rejects.toThrow(/check constraint/);
  });

  it("allows one vote per device per entry", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd1', 'i1', 'works')`;
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd2', 'i1', 'works')`;
    await expect(
      sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd1', 'i9', 'broken')`,
    ).rejects.toThrow(/duplicate key/);
  });
});
