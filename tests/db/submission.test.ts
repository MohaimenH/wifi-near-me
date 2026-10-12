import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { config } from "@/lib/config";
import { createSql } from "@/lib/db";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { LIMITS } from "@/lib/rate-limit";
import { anonymousGuard, type Guard } from "@/lib/services/guard";
import { createSubmissionService } from "@/lib/services/submission";
import type { Actor } from "@/lib/types";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const svc = () => createSubmissionService({ sql, guard: anonymousGuard });
const actor = (device = "dev-1", ip = "ip-1"): Actor => ({ ipHash: ip, deviceHash: device, userId: null });
const entry = { access_type: "password", steps_text: "Ask the staff.", label: "Guest" };
const tight = (key: keyof typeof LIMITS, limit: number) =>
  createSubmissionService({ sql, guard: anonymousGuard, limits: { ...LIMITS, [key]: { limit, windowSeconds: 3600 } } });

describe("submitEntry", () => {
  it("creates an entry and a revision row with a null submitter", async () => {
    const placeId = await insertPlace(sql);
    const r = await svc().submitEntry(actor(), placeId, { ...entry, password: "abc", password_is_public: true });
    expect(r.ignored).toBe(false);
    const [e] = await sql`SELECT * FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e).toMatchObject({ label: "Guest", status: "active", password: "abc", password_policy: "posted_publicly", submitter_id: null });
    const revs = await sql`SELECT snapshot, device_hash, ip_hash FROM wifi_entry_revisions WHERE wifi_entry_id = ${e.id}`;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ device_hash: "dev-1", ip_hash: "ip-1" });
    expect(revs[0].snapshot.steps_text).toBe("Ask the staff.");
  });

  it("keeps a password private when the submitter does not say it is public", async () => {
    const placeId = await insertPlace(sql);
    await svc().submitEntry(actor(), placeId, { ...entry, password: "abc" });
    const [e] = await sql`SELECT password_policy FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.password_policy).toBe("none");
  });

  it("uses the configured status for new entries", async () => {
    const placeId = await insertPlace(sql);
    const s = createSubmissionService({ sql, guard: anonymousGuard, cfg: { ...config(), newEntryStatus: "pending" } });
    await s.submitEntry(actor(), placeId, entry);
    const [e] = await sql`SELECT status FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.status).toBe("pending");
  });

  it("rejects bad input without using up the rate limit", async () => {
    const placeId = await insertPlace(sql);
    const s = tight("submit", 1);
    await expect(s.submitEntry(actor(), placeId, { ...entry, steps_text: "   " })).rejects.toBeInstanceOf(ZodError);
    await expect(s.submitEntry(actor(), placeId, { ...entry, steps_text: "a".repeat(501) })).rejects.toBeInstanceOf(ZodError);
    await expect(s.submitEntry(actor(), placeId, entry)).resolves.toMatchObject({ ignored: false });
  });

  it("stores script text as plain text", async () => {
    const placeId = await insertPlace(sql);
    await svc().submitEntry(actor(), placeId, { ...entry, steps_text: "<script>alert(1)</script>" });
    const [e] = await sql`SELECT steps_text FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.steps_text).toBe("<script>alert(1)</script>");
  });

  it("silently ignores a filled honeypot and writes nothing", async () => {
    const placeId = await insertPlace(sql);
    expect(await svc().submitEntry(actor(), placeId, { ...entry, website: "http://spam" })).toEqual({ ignored: true });
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(0);
  });

  it("throws NotFoundError for an unknown place", async () => {
    await expect(svc().submitEntry(actor(), 9999, entry)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("limits per IP, not per device", async () => {
    const placeId = await insertPlace(sql);
    const s = tight("submit", 2);
    await s.submitEntry(actor("d1", "same-ip"), placeId, entry);
    await s.submitEntry(actor("d2", "same-ip"), placeId, entry);
    await expect(s.submitEntry(actor("d3", "same-ip"), placeId, entry)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(s.submitEntry(actor("d3", "other-ip"), placeId, entry)).resolves.toMatchObject({ ignored: false });
  });

  it("calls the guard first, and a refusing guard blocks the write", async () => {
    const placeId = await insertPlace(sql);
    const calls: string[] = [];
    const guard: Guard = { authorize: (_a, action) => { calls.push(action); throw new Error("sign in required"); } };
    await expect(createSubmissionService({ sql, guard }).submitEntry(actor(), placeId, entry)).rejects.toThrow("sign in required");
    expect(calls).toEqual(["submit_entry"]);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(0);
  });
});

describe("editEntry", () => {
  async function created(extra: Record<string, unknown> = {}) {
    const placeId = await insertPlace(sql);
    const r = await svc().submitEntry(actor(), placeId, { ...entry, ...extra });
    if (r.ignored) throw new Error("unexpected");
    return r.entry_id;
  }

  it("updates the content and writes a second revision with the editor's hashes", async () => {
    const id = await created();
    await svc().editEntry(actor("editor-dev", "editor-ip"), id, { access_type: "open", steps_text: "Open now.", label: "Free" });
    const [e] = await sql`SELECT label, access_type, steps_text, submitter_id, updated_at > created_at AS moved FROM wifi_entries WHERE id = ${id}`;
    expect(e).toMatchObject({ label: "Free", access_type: "open", steps_text: "Open now.", submitter_id: null, moved: true });
    const revs = await sql`SELECT snapshot, device_hash FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id`;
    expect(revs).toHaveLength(2);
    expect(revs[1]).toMatchObject({ device_hash: "editor-dev" });
    expect(revs[1].snapshot.steps_text).toBe("Open now.");
  });

  it("keeps the stored password when the edit sends no password", async () => {
    const id = await created({ password: "keep-me", password_is_public: true });
    await svc().editEntry(actor(), id, { ...entry, steps_text: "New steps." });
    const [e] = await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`;
    expect(e).toMatchObject({ password: "keep-me", password_policy: "posted_publicly" });
  });

  it("keeps a private password private when an edit sends an empty password marked public", async () => {
    const id = await created({ password: "secret" });
    await svc().editEntry(actor(), id, { ...entry, password: "", password_is_public: true });
    const [e] = await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`;
    expect(e).toMatchObject({ password: "secret", password_policy: "none" });
  });

  it("replaces the password when a new one is sent, and removes it with password_clear", async () => {
    const id = await created({ password: "old" });
    await svc().editEntry(actor(), id, { ...entry, password: "new", password_is_public: true });
    expect((await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`)[0])
      .toMatchObject({ password: "new", password_policy: "posted_publicly" });
    await svc().editEntry(actor(), id, { ...entry, password_clear: true });
    expect((await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`)[0])
      .toMatchObject({ password: null, password_policy: "none" });
  });

  it("refuses unknown and hidden entries and writes no revision", async () => {
    const placeId = await insertPlace(sql);
    const hiddenId = await insertEntry(sql, placeId, { status: "hidden" });
    await expect(svc().editEntry(actor(), 9999, entry)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().editEntry(actor(), hiddenId, entry)).rejects.toBeInstanceOf(NotFoundError);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entry_revisions`;
    expect(n).toBe(0);
  });

  it("validates input, honors the honeypot, and passes edit_entry to the guard", async () => {
    const id = await created();
    await expect(svc().editEntry(actor(), id, { ...entry, steps_text: " " })).rejects.toBeInstanceOf(ZodError);
    expect(await svc().editEntry(actor(), id, { ...entry, website: "x" })).toEqual({ ignored: true });
    const calls: string[] = [];
    const guard: Guard = { authorize: (_a, action) => { calls.push(action); } };
    await createSubmissionService({ sql, guard }).editEntry(actor(), id, entry);
    expect(calls).toEqual(["edit_entry"]);
  });
});

describe("createPlace", () => {
  const place = { name: "New Cafe", category: "cafe", lat: 41.02, lng: 28.97 };

  it("creates a user place with its first entry in one step", async () => {
    const r = await svc().createPlace(actor(), place, entry);
    if (r.ignored) throw new Error("should not be ignored");
    const [p] = await sql`SELECT name, source, osm_id, ST_Y(geom::geometry) AS lat FROM places WHERE id = ${r.place_id}`;
    expect(p).toMatchObject({ name: "New Cafe", source: "user", osm_id: null });
    expect(p.lat).toBeCloseTo(41.02, 5);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries WHERE place_id = ${r.place_id}`;
    expect(n).toBe(1);
  });

  it("creates nothing when the entry is invalid", async () => {
    await expect(svc().createPlace(actor(), place, { ...entry, steps_text: "" })).rejects.toBeInstanceOf(ZodError);
    const [{ n }] = await sql`SELECT count(*) AS n FROM places`;
    expect(n).toBe(0);
  });

  it("ignores a filled honeypot", async () => {
    expect(await svc().createPlace(actor(), place, { ...entry, website: "x" })).toEqual({ ignored: true });
  });
});

describe("castVote", () => {
  it("counts one vote per device, lets the device change it, and counts two devices on one IP", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    expect(await svc().castVote(actor("a", "ip"), entryId, "works")).toEqual({ works: 1, broken: 0 });
    expect(await svc().castVote(actor("a", "ip"), entryId, "works")).toEqual({ works: 1, broken: 0 });
    expect(await svc().castVote(actor("a", "ip"), entryId, "broken")).toEqual({ works: 0, broken: 1 });
    expect(await svc().castVote(actor("b", "ip"), entryId, "works")).toEqual({ works: 1, broken: 1 });
  });

  it("rejects an unknown kind and an unknown or hidden entry", async () => {
    const placeId = await insertPlace(sql);
    const entryId = await insertEntry(sql, placeId);
    const hiddenId = await insertEntry(sql, placeId, { status: "hidden" });
    await expect(svc().castVote(actor(), entryId, "meh")).rejects.toBeInstanceOf(ZodError);
    await expect(svc().castVote(actor(), 9999, "works")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().castVote(actor(), hiddenId, "works")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reportEntry", () => {
  const status = async (id: number) => (await sql`SELECT status FROM wifi_entries WHERE id = ${id}`)[0].status;

  it("counts one report per device", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    for (let i = 0; i < 5; i++) await svc().reportEntry(actor("same", "ip-1"), id, "spam");
    expect(await status(id)).toBe("active");
    const [{ n }] = await sql`SELECT count(*) AS n FROM reports WHERE wifi_entry_id = ${id}`;
    expect(n).toBe(1);
  });

  it("does not hide when all reporting devices share one IP", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    for (const d of ["a", "b", "c", "d"]) await svc().reportEntry(actor(d, "airport-ip"), id, "wrong");
    expect(await status(id)).toBe("active");
  });

  it("hides when enough devices from at least two IPs report", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    expect(await svc().reportEntry(actor("a", "ip-1"), id, "wrong")).toEqual({ hidden: false });
    expect(await svc().reportEntry(actor("b", "ip-1"), id, "wrong")).toEqual({ hidden: false });
    expect(await svc().reportEntry(actor("c", "ip-2"), id, "wrong")).toEqual({ hidden: true });
    expect(await status(id)).toBe("hidden");
  });

  it("throws NotFoundError for an unknown entry", async () => {
    await expect(svc().reportEntry(actor(), 9999, "x")).rejects.toBeInstanceOf(NotFoundError);
  });
});
