import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { listForReview, listRevisions, restoreEntry, revertToPrevious, setStatus } from "@/lib/moderation";
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

  it("reports no_previous and not_found", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    expect(await revertToPrevious(sql, r.entry_id)).toBe("no_previous");
    expect(await revertToPrevious(sql, 9999)).toBe("not_found");
  });
});
