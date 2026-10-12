import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchEntry } from "@/app/api/entries/[id]/route";
import { POST as postReport } from "@/app/api/entries/[id]/report/route";
import { POST as postVote } from "@/app/api/entries/[id]/vote/route";
import { POST as postEntry } from "@/app/api/places/[id]/entries/route";
import { GET as getPlace } from "@/app/api/places/[id]/route";
import { GET as getNearby } from "@/app/api/places/nearby/route";
import { POST as postPlace } from "@/app/api/places/route";
import { getSql } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { resetDb } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = getSql();
const savedSubmit = { ...LIMITS.submit };
afterAll(() => sql.end());
beforeEach(async () => {
  await resetDb(sql);
  process.env.EXPOSE_PASSWORDS = "false";
});
afterEach(() => { LIMITS.submit = { ...savedSubmit }; });

const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const DEV_A = "a".repeat(43);
const DEV_B = "b".repeat(43);
function write(body: unknown, o: { ip?: string; device?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? "1.1.1.1", ...o.headers };
  if (o.device) headers.cookie = `wnm_device=${o.device}`;
  return new Request("http://x/api", { method: o.method ?? "POST", headers, body: JSON.stringify(body) });
}
const entry = { access_type: "password", steps_text: "Ask the staff.", label: "Guest" };
const get = (id: number | string) => getPlace(new Request("http://x"), ctx(id));

describe("GET /api/places/nearby", () => {
  it("returns places near a point", async () => {
    await insertPlace(sql, { name: "Near" });
    const res = await getNearby(new Request("http://x/api/places/nearby?lat=41.0086&lng=28.9795&radius_m=1000"));
    expect(res.status).toBe(200);
    expect((await res.json()).places.map((p: { name: string }) => p.name)).toEqual(["Near"]);
  });

  it.each([
    ["missing lat", "lng=28"], ["empty lat", "lat=&lng=28"], ["text lat", "lat=abc&lng=28"],
    ["lat out of range", "lat=95&lng=28"], ["huge radius", "lat=41&lng=28&radius_m=999999999"],
    ["negative radius", "lat=41&lng=28&radius_m=-1"],
  ])("returns 400 for %s", async (_name, qs) => {
    const res = await getNearby(new Request(`http://x/api/places/nearby?${qs}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });
});

describe("GET /api/places/:id", () => {
  it("returns 404 for unknown and bad ids", async () => {
    for (const id of [999, "abc", "-4", "1.5"]) expect((await get(id)).status).toBe(404);
  });

  it("does not leak a password unless exposure is on and the policy allows it", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "leak-test-pw", password_policy: "posted_publicly" });
    await insertEntry(sql, placeId, { password: "private-pw", password_policy: "none" });
    expect(await (await get(placeId)).text()).not.toContain("leak-test-pw");
    process.env.EXPOSE_PASSWORDS = "true";
    const text = await (await get(placeId)).text();
    expect(text).toContain("leak-test-pw");
    expect(text).not.toContain("private-pw");
  });
});

describe("same-origin JSON check", () => {
  it("refuses a write without a JSON content type", async () => {
    const placeId = await insertPlace(sql);
    const req = new Request("http://x/api", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(entry) });
    expect((await postEntry(req, ctx(placeId))).status).toBe(415);
  });

  it("refuses a foreign Origin and sec-fetch-site cross-site, and writes nothing", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    expect((await postReport(write({}, { headers: { origin: "https://evil.example" } }), ctx(entryId))).status).toBe(403);
    expect((await postReport(write({}, { headers: { "sec-fetch-site": "cross-site" } }), ctx(entryId))).status).toBe(403);
    const [{ n }] = await sql`SELECT count(*) AS n FROM reports`;
    expect(n).toBe(0);
  });

  it("accepts a same-origin request", async () => {
    const placeId = await insertPlace(sql);
    expect((await postEntry(write(entry, { headers: { origin: "http://x" } }), ctx(placeId))).status).toBe(201);
  });
});

describe("write routes", () => {
  it("creates an entry, sets the device cookie, and shows the entry in the detail", async () => {
    const placeId = await insertPlace(sql);
    const res = await postEntry(write(entry), ctx(placeId));
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/^wnm_device=/);
    expect((await postEntry(write(entry, { device: DEV_A }), ctx(placeId))).headers.get("set-cookie")).toBeNull();
    const detail = await (await get(placeId)).json();
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0]).toMatchObject({ label: "Guest", access_type: "password" });
  });

  it("returns 400 for invalid JSON and invalid input, and 404 for an unknown place", async () => {
    const placeId = await insertPlace(sql);
    const bad = new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect((await postEntry(bad, ctx(placeId))).status).toBe(400);
    const res = await postEntry(write({ ...entry, steps_text: " " }), ctx(placeId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect((await postEntry(write(entry), ctx(999))).status).toBe(404);
  });

  it("edits an entry with PATCH", async () => {
    const placeId = await insertPlace(sql);
    const { entry_id } = await (await postEntry(write(entry), ctx(placeId))).json();
    const res = await patchEntry(write({ ...entry, steps_text: "Updated steps." }, { method: "PATCH" }), ctx(entry_id));
    expect(res.status).toBe(200);
    expect((await (await get(placeId)).json()).entries[0].steps_text).toBe("Updated steps.");
  });

  it("creates a new place with its first entry", async () => {
    const res = await postPlace(write({ place: { name: "Cafe X", category: "cafe", lat: 41.02, lng: 28.97 }, entry }));
    expect(res.status).toBe(201);
    const { place_id } = await res.json();
    expect(await (await get(place_id)).json()).toMatchObject({ name: "Cafe X", source: "user" });
  });

  it("returns 202 for a filled honeypot", async () => {
    const placeId = await insertPlace(sql);
    expect((await postEntry(write({ ...entry, website: "spam" }), ctx(placeId))).status).toBe(202);
  });

  it("counts votes from two devices on the same IP", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    await postVote(write({ kind: "works" }, { device: DEV_A, ip: "8.8.8.8" }), ctx(entryId));
    const res = await postVote(write({ kind: "works" }, { device: DEV_B, ip: "8.8.8.8" }), ctx(entryId));
    expect(await res.json()).toEqual({ works: 2, broken: 0 });
    expect((await postVote(write({ kind: "meh" }), ctx(entryId))).status).toBe(400);
  });

  it("reports an entry", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    const r = await postReport(write({ reason: "spam" }), ctx(entryId));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hidden: false });
  });

  it("returns 429 when the IP reaches the limit", async () => {
    LIMITS.submit = { limit: 2, windowSeconds: 3600 };
    const placeId = await insertPlace(sql);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await postEntry(write(entry, { ip: "7.7.7.7" }), ctx(placeId))).status);
    expect(statuses).toEqual([201, 201, 429]);
  });
});
