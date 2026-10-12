import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { findNearby, getPlaceRow, listEntryRows } from "@/lib/repo/places";
import { getPlaceDetail } from "@/lib/services/read";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

describe("findNearby", () => {
  it("returns places inside the radius, nearest first, with entry counts", async () => {
    const near = await insertPlace(sql, { name: "Near", lat: 41.0086, lng: 28.9795 });
    const mid = await insertPlace(sql, { name: "Mid", lat: 41.0150, lng: 28.9795 });
    await insertPlace(sql, { name: "Far", lat: 36.8841, lng: 30.7056 });
    await insertEntry(sql, near);
    const rows = await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 3000, limit: 100 });
    expect(rows.map((r) => r.name)).toEqual(["Near", "Mid"]);
    expect(rows[0]).toMatchObject({ id: near, entry_count: 1, category: "cafe" });
    expect(rows[1]).toMatchObject({ id: mid, entry_count: 0 });
    expect(rows[0].distance_m).toBeLessThan(rows[1].distance_m);
    expect(rows[0].lat).toBeCloseTo(41.0086, 4);
    expect(rows[0].lng).toBeCloseTo(28.9795, 4);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) await insertPlace(sql, { name: `P${i}`, lat: 41.0086 + i * 0.001 });
    expect(await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 5000, limit: 2 })).toHaveLength(2);
  });

  it("counts only active entries", async () => {
    const id = await insertPlace(sql);
    await insertEntry(sql, id, { status: "active" });
    await insertEntry(sql, id, { status: "hidden" });
    await insertEntry(sql, id, { status: "pending" });
    const [row] = await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 500, limit: 10 });
    expect(row.entry_count).toBe(1);
  });
});

describe("place detail", () => {
  it("returns null for an unknown id", async () => {
    expect(await getPlaceRow(sql, 12345)).toBeNull();
    expect(await getPlaceDetail(sql, 12345, { exposePasswords: false })).toBeNull();
  });

  it("lists active entries with vote counts", async () => {
    const placeId = await insertPlace(sql, { name: "Hagia Cafe" });
    const entryId = await insertEntry(sql, placeId, { label: "Guest" });
    await insertEntry(sql, placeId, { label: "Hidden one", status: "hidden" });
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES
      (${entryId}, 'a', 'i', 'works'), (${entryId}, 'b', 'i', 'works'), (${entryId}, 'c', 'i', 'broken')`;
    const rows = await listEntryRows(sql, placeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: entryId, works: 2, broken: 1 });
  });

  it("never returns the password when exposure is off", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "topsecret-1", password_policy: "posted_publicly" });
    expect(JSON.stringify(await getPlaceDetail(sql, placeId, { exposePasswords: false }))).not.toContain("topsecret-1");
    const on = await getPlaceDetail(sql, placeId, { exposePasswords: true });
    expect(on?.entries[0].password).toBe("topsecret-1");
    expect(on).toMatchObject({ id: placeId, source: "osm" });
  });
});
