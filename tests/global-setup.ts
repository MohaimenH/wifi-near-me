import postgres from "postgres";
import { migrate } from "../scripts/migrate";

export default async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";
  const u = new URL(testUrl);
  const dbName = u.pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the name must end in _test`);
  }
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  await migrate(testUrl);
}
