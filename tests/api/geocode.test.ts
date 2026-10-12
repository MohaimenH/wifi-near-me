import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/geocode/route";
import { getSql } from "@/lib/db";
import { cacheClear } from "@/lib/geocode";
import { LIMITS } from "@/lib/rate-limit";
import { resetDb } from "../helpers/db";

const sql = getSql();
const saved = { ...LIMITS.geocode };
afterAll(() => sql.end());
beforeEach(async () => { await resetDb(sql); cacheClear(); });
afterEach(() => { vi.unstubAllGlobals(); LIMITS.geocode = { ...saved }; });

const photon = { features: [{ geometry: { coordinates: [28.98, 41.03] }, properties: { name: "Taksim", osm_key: "place", osm_value: "quarter", state: "Istanbul", country: "Turkey" } }] };
const ok = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify(photon), { status: 200 }));
const call = (qs: string, ip = "3.3.3.3") => GET(new Request(`http://x/api/geocode?${qs}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/geocode", () => {
  it("returns normalized results and sends a rounded location bias", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("q=taksim&lat=41.0123&lng=28.9876");
    expect(res.status).toBe(200);
    expect((await res.json()).results[0]).toMatchObject({ name: "Taksim", kind: "District" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("q=taksim");
    expect(url).toContain("lat=41.0");
    expect(url).toContain("lon=29.0");
  });

  it("serves a repeated query from the cache", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    await call("q=taksim&lat=41&lng=29");
    await call("q=TAKSIM&lat=41.01&lng=29.01");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a missing, short, or long query", async () => {
    for (const qs of ["", "q=a", `q=${"a".repeat(101)}`]) expect((await call(qs)).status).toBe(400);
  });

  it("returns 429 when one IP searches too much", async () => {
    vi.stubGlobal("fetch", ok());
    LIMITS.geocode = { limit: 1, windowSeconds: 3600 };
    expect((await call("q=first")).status).toBe(200);
    const res = await call("q=second");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ results: [], error: "rate_limited" });
  });

  it("returns 502 with an empty list when the service fails or answers with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await call("q=taksim");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ results: [], error: "geocoder_unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    expect((await call("q=other")).status).toBe(502);
  });

  it("does not send bad lat/lng values upstream", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    await call("q=taksim&lat=abc&lng=999");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain("lat=");
    expect(url).not.toContain("lon=");
  });
});
