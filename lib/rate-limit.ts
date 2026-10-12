import type { Sql } from "./db";

export interface Limit { limit: number; windowSeconds: number }
export type Limits = Record<"submit" | "edit" | "create_place" | "vote" | "report" | "geocode", Limit>;

/**
 * Per IP. Limits are generous because many travelers share one IP at airports, hotels, and on mobile networks.
 * Tests may replace entries in this object and must restore them.
 */
export const LIMITS: Limits = {
  submit: { limit: 30, windowSeconds: 3600 },
  edit: { limit: 30, windowSeconds: 3600 },
  create_place: { limit: 15, windowSeconds: 3600 },
  vote: { limit: 300, windowSeconds: 3600 },
  report: { limit: 30, windowSeconds: 3600 },
  geocode: { limit: 600, windowSeconds: 3600 },
};

/** Returns true and records the event if the IP is under the limit. Returns false otherwise. */
export async function consume(
  sql: Sql,
  ipHash: string,
  action: keyof Limits,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (Math.random() < 0.02) await sql`DELETE FROM rate_events WHERE created_at < now() - interval '1 day'`;
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    // One lock per IP and action, so parallel requests cannot all pass the count check.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${ipHash}|${action}`}))`;
    const [{ n }] = await tx`
      SELECT count(*) AS n FROM rate_events
      WHERE ip_hash = ${ipHash} AND action = ${action}
        AND created_at > now() - (${windowSeconds}::int * interval '1 second')`;
    if ((n as number) >= limit) return false;
    await tx`INSERT INTO rate_events (ip_hash, action) VALUES (${ipHash}, ${action})`;
    return true;
  });
}
