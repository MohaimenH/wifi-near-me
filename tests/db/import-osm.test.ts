import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { importPlaces, type PlaceSeed } from "@/lib/osm";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const seeds: PlaceSeed[] = [
  { osm_type: "node", osm_id: 1, name: "Çay Bahçesi's \"Best\"", category: "cafe", lat: 41.0, lng: 29.0, country_code: "TR" },
  { osm_type: "way", osm_id: 2, name: "Hotel Ay", category: "hotel", lat: 41.1, lng: 29.1, country_code: "TR" },
];

describe("importPlaces", () => {
  it("inserts places, keeps special characters, and stores the country", async () => {
    expect(await importPlaces(sql, seeds)).toBe(2);
    const rows = await sql`SELECT name, source, country_code, ST_Y(geom::geometry) AS lat FROM places ORDER BY osm_id`;
    expect(rows[0]).toMatchObject({ name: "Çay Bahçesi's \"Best\"", source: "osm", country_code: "TR" });
    expect(rows[0].lat).toBeCloseTo(41.0, 6);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await importPlaces(sql, seeds);
    await importPlaces(sql, seeds);
    const [{ n }] = await sql`SELECT count(*) AS n FROM places`;
    expect(n).toBe(2);
  });

  it("updates a changed name, keeps WiFi entries, and keeps the country when the new value is null", async () => {
    await importPlaces(sql, seeds);
    const [p] = await sql`SELECT id FROM places WHERE osm_id = 2`;
    await insertEntry(sql, p.id);
    await importPlaces(sql, [{ ...seeds[1], name: "Hotel Ay Yeni", country_code: null }]);
    const [after] = await sql`SELECT name, country_code FROM places WHERE osm_id = 2`;
    expect(after).toMatchObject({ name: "Hotel Ay Yeni", country_code: "TR" });
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries WHERE place_id = ${p.id}`;
    expect(n).toBe(1);
  });

  it("does nothing for an empty list", async () => {
    expect(await importPlaces(sql, [])).toBe(0);
  });
});
