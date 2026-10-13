const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";
if (!new URL(testUrl).pathname.endsWith("_test")) {
  throw new Error(`Refusing to run tests: TEST_DATABASE_URL must name a database ending in _test (got ${testUrl})`);
}
process.env.DATABASE_URL = testUrl;
process.env.ACTOR_SALT = "test-salt";
process.env.EXPOSE_PASSWORDS = "false";
process.env.NEW_ENTRY_STATUS = "active";
process.env.REPORT_HIDE_THRESHOLD = "3";
process.env.REPORT_HIDE_MIN_IPS = "2";
process.env.DB_PREPARE = "true";
process.env.CONTACT_EMAIL = "hello@example.com";
