import { describe, expect, it } from "vitest";
import { categoryFor, parseOverpass } from "@/lib/osm";

describe("categoryFor", () => {
  it.each([
    [{ amenity: "cafe" }, "cafe"], [{ amenity: "bar" }, "restaurant"], [{ amenity: "restaurant" }, "restaurant"],
    [{ amenity: "library" }, "library"], [{ amenity: "coworking_space" }, "coworking"],
    [{ tourism: "hotel" }, "hotel"], [{ tourism: "guest_house" }, "hotel"], [{ tourism: "hostel" }, "hostel"],
    [{ aeroway: "aerodrome" }, "airport"], [{ aeroway: "terminal" }, "airport"], [{ railway: "station" }, "station"],
  ])("maps %j to %s", (tags, expected) => {
    expect(categoryFor(tags as Record<string, string>)).toBe(expected);
  });
  it("returns null for unknown tags", () => {
    expect(categoryFor({ amenity: "bench" })).toBeNull();
    expect(categoryFor({})).toBeNull();
  });
});

describe("parseOverpass", () => {
  const file = {
    elements: [
      { type: "node", id: 1, lat: 41.0, lon: 29.0, tags: { name: "Çay Bahçesi's \"Best\"", amenity: "cafe" } },
      { type: "way", id: 2, center: { lat: 41.1, lon: 29.1 }, tags: { name: "Hotel Ay", tourism: "hotel" } },
      { type: "node", id: 3, lat: 41.2, lon: 29.2, tags: { amenity: "cafe" } },
      { type: "node", id: 4, lat: 41.3, lon: 29.3, tags: { name: "Bench", amenity: "bench" } },
      { type: "way", id: 5, tags: { name: "No coords", amenity: "cafe" } },
      { type: "node", id: 1, lat: 41.0, lon: 29.0, tags: { name: "Duplicate of 1", amenity: "cafe" } },
      { type: "node", id: 6, lat: 41.4, lon: 29.4, tags: { name: "   ", amenity: "cafe" } },
    ],
  };

  it("keeps valid places, uses way centers, and keeps special characters", () => {
    const seeds = parseOverpass(file);
    expect(seeds.map((s) => s.osm_id)).toEqual([1, 2]);
    expect(seeds[0]).toMatchObject({ osm_type: "node", name: "Çay Bahçesi's \"Best\"", category: "cafe", lat: 41.0, lng: 29.0 });
    expect(seeds[1]).toMatchObject({ osm_type: "way", lat: 41.1, lng: 29.1, category: "hotel" });
  });

  it("returns an empty list for bad input", () => {
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({})).toEqual([]);
    expect(parseOverpass({ elements: "no" })).toEqual([]);
  });
});
