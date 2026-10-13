import type { Sql } from "./db";
import { stepsContainPassword } from "./form-checks";
import { clearRevisionPasswords } from "./repo/revisions";
import type { EntryStatus } from "./types";

/** Moderator operations. Used only by scripts/moderate.ts. Never exposed over HTTP. */

export interface ReviewRow {
  id: number;
  place_name: string;
  label: string;
  status: EntryStatus;
  reports: number;
  updated_at: Date;
}

export async function listForReview(sql: Sql, statuses: EntryStatus[] = ["hidden", "pending"]): Promise<ReviewRow[]> {
  const rows = await sql`
    SELECT e.id, p.name AS place_name, e.label, e.status, e.updated_at,
           (SELECT count(*) FROM reports r WHERE r.wifi_entry_id = e.id) AS reports
    FROM wifi_entries e JOIN places p ON p.id = e.place_id
    WHERE e.status IN ${sql(statuses)}
    ORDER BY e.updated_at DESC
    LIMIT 200`;
  return rows as unknown as ReviewRow[];
}

export async function setStatus(sql: Sql, id: number, status: EntryStatus): Promise<boolean> {
  const rows = await sql`UPDATE wifi_entries SET status = ${status}, updated_at = now() WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** Makes the entry active again and deletes its reports, so old reports cannot hide it again. */
export async function restoreEntry(sql: Sql, id: number): Promise<boolean> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const rows = await tx`UPDATE wifi_entries SET status = 'active', updated_at = now() WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) return false;
    await tx`DELETE FROM reports WHERE wifi_entry_id = ${id}`;
    return true;
  });
}

/** Deletes a place that a user added, with its entries (cascade). Returns false for unknown ids and OSM places. */
export async function deleteUserPlace(sql: Sql, placeId: number): Promise<boolean> {
  const rows = await sql`DELETE FROM places WHERE id = ${placeId} AND source = 'user' RETURNING id`;
  return rows.length > 0;
}

export async function listRevisions(sql: Sql, id: number) {
  const rows = await sql`
    SELECT id, created_at, device_hash, submitter_id, snapshot
    FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id DESC`;
  return rows as unknown as {
    id: number; created_at: Date; device_hash: string | null; submitter_id: string | null; snapshot: Record<string, unknown>;
  }[];
}

interface Snapshot {
  label: string; access_type: string; steps_text: string; language: string;
  password: string | null; password_policy: string;
}

/** Writes a snapshot back to the entry and records that as a new revision by "moderator". Call inside a transaction. */
async function applySnapshot(tx: Sql, id: number, s: Snapshot): Promise<void> {
  await tx`
    UPDATE wifi_entries
    SET label = ${s.label}, access_type = ${s.access_type}, steps_text = ${s.steps_text}, language = ${s.language},
        password = ${s.password}, password_policy = ${s.password_policy}, updated_at = clock_timestamp()
    WHERE id = ${id}`;
  await tx`
    INSERT INTO wifi_entry_revisions (wifi_entry_id, snapshot, submitter_id)
    VALUES (${id}, ${JSON.stringify(s)}::text::jsonb, 'moderator')`;
}

/** Applies the second-newest revision and records that as a new revision by "moderator". */
export async function revertToPrevious(sql: Sql, id: number): Promise<"reverted" | "no_previous" | "not_found"> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const [entry] = await tx`SELECT id FROM wifi_entries WHERE id = ${id} FOR UPDATE`;
    if (!entry) return "not_found" as const;
    const revs = await tx`SELECT snapshot FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id DESC LIMIT 2`;
    if (revs.length < 2) return "no_previous" as const;
    await applySnapshot(tx, id, revs[1].snapshot as Snapshot);
    return "reverted" as const;
  });
}

/**
 * Removes the password from the entry and from every old revision (for takedown requests), and records that
 * as a new revision by "moderator". stepsHadPassword is true when the steps text still contains a removed
 * password: then the moderator must hide the entry or have its steps edited.
 */
export async function purgePassword(
  sql: Sql,
  id: number,
): Promise<{ status: "purged"; stepsHadPassword: boolean } | { status: "not_found" }> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const [e] = await tx`
      SELECT label, access_type, steps_text, language, password FROM wifi_entries WHERE id = ${id} FOR UPDATE`;
    if (!e) return { status: "not_found" as const };
    const old = await tx`
      SELECT DISTINCT snapshot->>'password' AS password FROM wifi_entry_revisions
      WHERE wifi_entry_id = ${id} AND snapshot->>'password' IS NOT NULL`;
    const removed = [e.password as string | null, ...old.map((r) => r.password as string)].filter((p): p is string => !!p);
    const stepsHadPassword = removed.some((p) => stepsContainPassword(e.steps_text as string, p));
    await clearRevisionPasswords(tx, id);
    await applySnapshot(tx, id, {
      label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language,
      password: null, password_policy: "none",
    });
    return { status: "purged" as const, stepsHadPassword };
  });
}

/** Applies one chosen revision of this entry (an id from listRevisions) and records that as a new revision by "moderator". */
export async function revertTo(sql: Sql, entryId: number, revisionId: number): Promise<"reverted" | "not_found"> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const [entry] = await tx`SELECT id FROM wifi_entries WHERE id = ${entryId} FOR UPDATE`;
    if (!entry) return "not_found" as const;
    const [rev] = await tx`
      SELECT snapshot FROM wifi_entry_revisions WHERE id = ${revisionId} AND wifi_entry_id = ${entryId}`;
    if (!rev) return "not_found" as const;
    await applySnapshot(tx, entryId, rev.snapshot as Snapshot);
    return "reverted" as const;
  });
}
