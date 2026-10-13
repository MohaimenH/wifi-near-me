import postgres from "postgres";
import type { Sql as PgSql } from "postgres";

// postgres.js returns bigint columns (bigserial ids, count(*)) as strings by default.
// Ids stay far below 2^53, so numbers are safe and JSON friendly.
const bigintAsNumber = {
  to: 20,
  from: [20],
  serialize: (x: number) => x.toString(),
  parse: (x: string) => Number(x),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = PgSql<any>;

export function createSql(url: string): Sql {
  return postgres(url, {
    max: 5,
    idle_timeout: 10,
    onnotice: () => {},
    // Transaction poolers (Supabase pooler, PgBouncer) need prepared statements off.
    prepare: process.env.DB_PREPARE !== "false",
    types: { bigint: bigintAsNumber },
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __wifiSql: Sql | undefined;
}

/** One shared client per server process (survives hot reload in dev). */
export function getSql(): Sql {
  if (!globalThis.__wifiSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__wifiSql = createSql(url);
  }
  return globalThis.__wifiSql;
}
