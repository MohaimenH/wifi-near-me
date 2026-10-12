import type { Sql } from "@/lib/db";

export const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";

export async function resetDb(sql: Sql): Promise<void> {
  await sql`TRUNCATE rate_events, reports, votes, wifi_entry_revisions, wifi_entries, places RESTART IDENTITY CASCADE`;
}
