import type { Sql } from "@/lib/db";

/** Removes the password from every stored revision of an entry, so no revert can bring it back. Call inside a transaction. */
export async function clearRevisionPasswords(tx: Sql, entryId: number): Promise<void> {
  await tx`
    UPDATE wifi_entry_revisions
    SET snapshot = snapshot || '{"password": null, "password_policy": "none"}'::jsonb
    WHERE wifi_entry_id = ${entryId}`;
}
