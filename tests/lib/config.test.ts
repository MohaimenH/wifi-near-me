import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";

afterEach(() => vi.unstubAllEnvs());

describe("config abuse defaults", () => {
  it("needs 3 network groups to auto-hide and allows 5 votes or reports per IP per entry when unset", () => {
    vi.stubEnv("REPORT_HIDE_MIN_IPS", undefined);
    vi.stubEnv("PER_IP_ENTRY_CAP", undefined);
    expect(config()).toMatchObject({ reportHideMinIps: 3, perIpEntryCap: 5 });
  });

  it("reads PER_IP_ENTRY_CAP from the environment", () => {
    vi.stubEnv("PER_IP_ENTRY_CAP", "8");
    expect(config().perIpEntryCap).toBe(8);
  });
});

describe("config ACTOR_SALT", () => {
  it("refuses the example placeholder and a short salt in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACTOR_SALT", "change-me-to-a-long-random-string");
    expect(() => config()).toThrow(/ACTOR_SALT/);
    vi.stubEnv("ACTOR_SALT", "a".repeat(15));
    expect(() => config()).toThrow(/ACTOR_SALT/);
  });

  it("accepts a 32-character salt in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACTOR_SALT", "k3".repeat(16));
    expect(() => config()).not.toThrow();
  });

  it("accepts an empty salt outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ACTOR_SALT", "");
    expect(() => config()).not.toThrow();
  });
});
