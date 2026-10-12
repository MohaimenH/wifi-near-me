import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import {
  deleteUserPlace, listForReview, listRevisions, purgePassword, restoreEntry, revertTo, revertToPrevious, setStatus,
} from "@/lib/moderation";
import { anonymousGuard } from "@/lib/services/guard";
import { createSubmissionService } from "@/lib/services/submission";
import type { Actor } from "@/lib/types";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const svc = () => createSubmissionService({ sql, guard: anonymousGuard });
const actor = (d: string, ip = "ip-1"): Actor => ({ ipHash: ip, deviceHash: d, userId: null });
const entry = { access_type: "password", steps_text: "Original steps.", label: "Guest" };
const statusOf = async (id: number) => (await sql`SELECT status FROM wifi_entries WHERE id = ${id}`)[0].status;

describe("moderation", () => {
  it("lists hidden and pending entries with report counts, not active ones", async () => {
    const placeId = await insertPlace(sql, { name: "Cafe M" });
    const hidden = await insertEntry(sql, placeId, { status: "hidden" });
    const pending = await insertEntry(sql, placeId, { status: "pending" });
    await insertEntry(sql, placeId, { status: "active" });
    await sql`INSERT INTO reports (wifi_entry_id, device_hash, ip_hash, reason) VALUES (${hidden}, 'd', 'i', 'spam')`;
    const rows = await listForReview(sql);
    expect(rows.map((r) => r.id).sort()).toEqual([hidden, pending].sort());
    expect(rows.find((r) => r.id === hidden)).toMatchObject({ place_name: "Cafe M", reports: 1, status: "hidden" });
  });

  it("approves a pending entry and returns false for an unknown id", async () => {
    const id = await insertEntry(sql, await insertPlace(sql), { status: "pending" });
    expect(await setStatus(sql, id, "active")).toBe(true);
    expect(await statusOf(id)).toBe("active");
    expect(await setStatus(sql, 9999, "hidden")).toBe(false);
  });

  it("restores a hidden entry and clears its reports, so one new report does not hide it again", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    const id = r.entry_id;
    await svc().reportEntry(actor("a", "ip-1"), id, "x");
    await svc().reportEntry(actor("b", "ip-1"), id, "x");
    await svc().reportEntry(actor("c", "ip-2"), id, "x");
    expect(await statusOf(id)).toBe("hidden");
    expect(await restoreEntry(sql, id)).toBe(true);
    expect(await statusOf(id)).toBe("active");
    await svc().reportEntry(actor("d", "ip-3"), id, "x");
    expect(await statusOf(id)).toBe("active");
  });

  it("reverts a bad edit to the previous revision", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    await svc().editEntry(actor("vandal"), r.entry_id, { ...entry, steps_text: "Spam text." });
    expect(await revertToPrevious(sql, r.entry_id)).toBe("reverted");
    const [e] = await sql`SELECT steps_text FROM wifi_entries WHERE id = ${r.entry_id}`;
    expect(e.steps_text).toBe("Original steps.");
    const revs = await listRevisions(sql, r.entry_id);
    expect(revs).toHaveLength(3);
    expect(revs[0]).toMatchObject({ submitter_id: "moderator" });
  });

  it("reverts two bad edits to a chosen revision and refuses a revision of another entry", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    await svc().editEntry(actor("vandal"), r.entry_id, { ...entry, steps_text: "Spam one." });
    await svc().editEntry(actor("vandal"), r.entry_id, { ...entry, steps_text: "Spam two." });
    const first = (await listRevisions(sql, r.entry_id)).at(-1)!;
    expect(await revertTo(sql, r.entry_id, first.id)).toBe("reverted");
    const [e] = await sql`SELECT steps_text FROM wifi_entries WHERE id = ${r.entry_id}`;
    expect(e.steps_text).toBe("Original steps.");
    const revs = await listRevisions(sql, r.entry_id);
    expect(revs).toHaveLength(4);
    expect(revs[0]).toMatchObject({ submitter_id: "moderator" });

    const other = await svc().submitEntry(actor("y"), await insertPlace(sql), entry);
    if (other.ignored) throw new Error("unexpected");
    const otherRev = (await listRevisions(sql, other.entry_id))[0];
    expect(await revertTo(sql, r.entry_id, otherRev.id)).toBe("not_found");
    expect(await revertTo(sql, 9999, first.id)).toBe("not_found");
  });

  it("deletes a user place with its entries, but not an OSM place or an unknown id", async () => {
    const user = await insertPlace(sql, { source: "user", osm_id: null });
    const userEntry = await insertEntry(sql, user);
    const osm = await insertPlace(sql);
    await insertEntry(sql, osm);
    expect(await deleteUserPlace(sql, user)).toBe(true);
    expect(await sql`SELECT 1 FROM places WHERE id = ${user}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM wifi_entries WHERE id = ${userEntry}`).toHaveLength(0);
    expect(await deleteUserPlace(sql, osm)).toBe(false);
    expect(await sql`SELECT 1 FROM places WHERE id = ${osm}`).toHaveLength(1);
    expect(await deleteUserPlace(sql, 9999)).toBe(false);
  });

  it("purges a password from the entry and from every old revision, so a revert cannot bring it back", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), { ...entry, password: "old-secret", password_is_public: true });
    if (r.ignored) throw new Error("unexpected");
    await svc().editEntry(actor("x"), r.entry_id, { ...entry, password: "new-secret" });
    expect(await purgePassword(sql, r.entry_id)).toEqual({ status: "purged", stepsHadPassword: false });
    const [e] = await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${r.entry_id}`;
    expect(e).toMatchObject({ password: null, password_policy: "none" });
    const snapshots = await sql`SELECT snapshot FROM wifi_entry_revisions WHERE wifi_entry_id = ${r.entry_id}`;
    expect(JSON.stringify(snapshots)).not.toContain("secret");
    const revs = await listRevisions(sql, r.entry_id);
    expect(revs[0]).toMatchObject({ submitter_id: "moderator" });
    expect(await revertTo(sql, r.entry_id, revs.at(-1)!.id)).toBe("reverted");
    expect((await sql`SELECT password FROM wifi_entries WHERE id = ${r.entry_id}`)[0].password).toBeNull();
  });

  it("warns when the steps still contain a purged password, and reports not_found for an unknown entry", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), {
      ...entry, steps_text: "The code is CafeGuest2026.", password: "CafeGuest2026",
    });
    if (r.ignored) throw new Error("unexpected");
    expect(await purgePassword(sql, r.entry_id)).toEqual({ status: "purged", stepsHadPassword: true });
    expect(await purgePassword(sql, 9999)).toEqual({ status: "not_found" });
  });

  it("reports no_previous and not_found", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    expect(await revertToPrevious(sql, r.entry_id)).toBe("no_previous");
    expect(await revertToPrevious(sql, 9999)).toBe("not_found");
  });
});
