import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config headers", () => {
  it("blocks framing on every path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === "/(.*)");
    expect(all?.headers).toEqual(expect.arrayContaining([
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
    ]));
  });
});
