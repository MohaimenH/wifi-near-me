import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import PlacePage, { generateMetadata } from "@/app/place/[id]/page";
import { getSql } from "@/lib/db";
import { resetDb } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = getSql();
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));
afterEach(() => { process.env.EXPOSE_PASSWORDS = "false"; });

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("/place/[id] metadata", () => {
  it("names the place and counts its networks, and never includes a password", async () => {
    process.env.EXPOSE_PASSWORDS = "true";
    const placeId = await insertPlace(sql, { name: "Hagia Cafe" });
    await insertEntry(sql, placeId, { password: "share-leak-pw", password_policy: "posted_publicly" });
    await insertEntry(sql, placeId, { label: "Terrace" });
    const meta = await generateMetadata(params(placeId));
    expect(meta.title).toBe("Hagia Cafe – WiFi Near Me");
    expect(meta.description).toBe("2 WiFi networks, with steps to connect.");
    expect(meta.openGraph).toMatchObject({ title: "Hagia Cafe – WiFi Near Me" });
    expect(JSON.stringify(meta)).not.toContain("share-leak-pw");
  });

  it("asks for WiFi info when the place has none, and says not found for an unknown id", async () => {
    const placeId = await insertPlace(sql, { name: "Quiet Hostel", category: "hostel" });
    expect((await generateMetadata(params(placeId))).description).toBe("No WiFi info yet. Add how to connect.");
    expect((await generateMetadata(params(9999))).title).toBe("Place not found – WiFi Near Me");
  });
});

describe("/place/[id] page", () => {
  it("opens the app at the place", async () => {
    const placeId = await insertPlace(sql, { name: "Hagia Cafe", lat: 41.0086, lng: 28.9795 });
    const el = await PlacePage(params(placeId));
    expect(el.props).toMatchObject({ initialPlace: { id: placeId } });
    expect(el.props.initialPlace.lat).toBeCloseTo(41.0086, 4);
    expect(el.props.initialPlace.lng).toBeCloseTo(28.9795, 4);
  });

  it("is not found for a bad id, an unknown id, and a hidden user place", async () => {
    const hiddenUserPlace = await insertPlace(sql, { source: "user", osm_id: null });
    await insertEntry(sql, hiddenUserPlace, { status: "hidden" });
    for (const id of ["abc", "-1", 9999, hiddenUserPlace]) {
      await expect(PlacePage(params(id)), String(id)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
  });
});
