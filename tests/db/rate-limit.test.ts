import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { consume } from "@/lib/rate-limit";
import { resetDb, testUrl } from "../helpers/db";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

describe("consume", () => {
  it("allows up to the limit and then refuses", async () => {
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(true);
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(true);
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(false);
  });

  it("counts each IP and each action separately", async () => {
    await consume(sql, "a", "submit", 1, 3600);
    expect(await consume(sql, "b", "submit", 1, 3600)).toBe(true);
    expect(await consume(sql, "a", "vote", 1, 3600)).toBe(true);
  });

  it("forgets events older than the window", async () => {
    await sql`INSERT INTO rate_events (ip_hash, action, created_at) VALUES ('a', 'submit', now() - interval '2 hours')`;
    expect(await consume(sql, "a", "submit", 1, 3600)).toBe(true);
  });

  it("does not record a refused attempt", async () => {
    await consume(sql, "a", "submit", 1, 3600);
    await consume(sql, "a", "submit", 1, 3600);
    const [{ n }] = await sql`SELECT count(*) AS n FROM rate_events WHERE ip_hash = 'a'`;
    expect(n).toBe(1);
  });

  it("lets exactly `limit` parallel requests pass", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(sql, "p", "submit", 3, 3600)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});
