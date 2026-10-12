import { beforeEach, describe, expect, it } from "vitest";
import { cacheClear, cacheGet, cacheSet, normalizePhoton } from "@/lib/geocode";

const feature = (props: Record<string, unknown>, coords: [number, number] = [28.98, 41.03]) => ({
  geometry: { coordinates: coords },
  properties: props,
});

describe("normalizePhoton", () => {
  it("maps place types, builds the area text, and returns lat/lng", () => {
    const out = normalizePhoton({
      features: [
        feature({ name: "Taksim", osm_key: "railway", osm_value: "station", district: "Gümüşsuyu", state: "Istanbul", country: "Turkey" }),
        feature({ name: "Istanbul", osm_key: "place", osm_value: "city", state: "Istanbul", country: "Turkey" }),
        feature({ name: "Istanbul Airport", osm_key: "aeroway", osm_value: "aerodrome", country: "Turkey" }),
      ],
    });
    expect(out[0]).toMatchObject({ name: "Taksim", kind: "Station", where: "Gümüşsuyu, Istanbul, Turkey", lat: 41.03, lng: 28.98, zoom: 16 });
    expect(out[1]).toMatchObject({ kind: "City", zoom: 11.5, where: "Istanbul, Turkey" });
    expect(out[2]).toMatchObject({ kind: "Airport", zoom: 14 });
  });

  it("removes exact duplicates and limits to 6", () => {
    const f = feature({ name: "Taksim", osm_key: "railway", osm_value: "station", state: "Istanbul", country: "Turkey" });
    expect(normalizePhoton({ features: [f, f, f] })).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => feature({ name: `P${i}`, osm_key: "place", osm_value: "town" }));
    expect(normalizePhoton({ features: many })).toHaveLength(6);
  });

  it("skips features without coordinates and tolerates bad input", () => {
    expect(normalizePhoton({ features: [{ properties: { name: "X" } }] })).toEqual([]);
    expect(normalizePhoton(null)).toEqual([]);
    expect(normalizePhoton({})).toEqual([]);
  });
});

describe("geocode cache", () => {
  beforeEach(() => cacheClear());
  const r = [{ name: "A", kind: "City", where: "", lat: 1, lng: 2, zoom: 11 }];

  it("returns a stored value until it expires", () => {
    cacheSet("k", r, 1_000);
    expect(cacheGet("k", 1_000 + 60_000)).toEqual(r);
    expect(cacheGet("k", 1_000 + 11 * 60_000)).toBeNull();
  });

  it("keeps at most 500 keys", () => {
    for (let i = 0; i < 501; i++) cacheSet(`k${i}`, r, 1_000);
    expect(cacheGet("k0", 1_000)).toBeNull();
    expect(cacheGet("k500", 1_000)).toEqual(r);
  });
});
