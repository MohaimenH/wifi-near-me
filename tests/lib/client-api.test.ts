import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchNearby, fetchPlace } from "@/lib/client/api";

afterEach(() => vi.unstubAllGlobals());

describe("client request", () => {
  it("throws bad_response when an OK answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy page</html>", { status: 200 })));
    const err = await fetchPlace(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, code: "bad_response" });
  });

  it("rethrows an AbortError from reading the body unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(abort) }));
    await expect(fetchPlace(1)).rejects.toBe(abort);
  });

  it("keeps server_error for a failed answer that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(fetchPlace(1)).rejects.toMatchObject({ status: 500, code: "server_error" });
  });
});

describe("fetchNearby", () => {
  it("sends lat and lng rounded to 3 decimals", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchNearby({ lat: 41.0123456, lng: -28.9876543, radius_m: 1234.56 });
    const qs = new URL(String(fetchMock.mock.calls[0][0]), "http://x").searchParams;
    expect(Object.fromEntries(qs)).toEqual({ lat: "41.012", lng: "-28.988", radius_m: "1235" });
  });
});
