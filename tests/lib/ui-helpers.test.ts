import { describe, expect, it } from "vitest";
import { directionsUrl } from "@/lib/directions";
import { stepsContainPassword } from "@/lib/form-checks";
import { haversineM } from "@/lib/geo";
import { fmtDist } from "@/lib/labels";
import { timeAgo } from "@/lib/time";

describe("haversineM", () => {
  it("is about 111 km for one degree of longitude at the equator", () => {
    expect(haversineM(0, 0, 0, 1)).toBeGreaterThan(110_000);
    expect(haversineM(0, 0, 0, 1)).toBeLessThan(112_500);
  });
  it("is zero for the same point", () => expect(haversineM(41, 29, 41, 29)).toBe(0));
});

describe("fmtDist", () => {
  it.each([[396, "396 m"], [999.4, "999 m"], [1000, "1.0 km"], [2450, "2.5 km"], [15200, "15 km"]])(
    "%s -> %s", (m, text) => expect(fmtDist(m)).toBe(text),
  );
});

describe("timeAgo", () => {
  const now = Date.parse("2026-06-10T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    [10_000, "just now"], [5 * 60_000, "5 min ago"], [3_600_000, "1 hour ago"], [3 * 3_600_000, "3 hours ago"],
    [30 * 3_600_000, "yesterday"], [4 * 86_400_000, "4 days ago"], [15 * 86_400_000, "2 weeks ago"],
  ])("%s ms -> %s", (ms, text) => expect(timeAgo(ago(ms), now)).toBe(text));
  it("shows a date for old values and handles future or invalid input", () => {
    expect(timeAgo(ago(90 * 86_400_000), now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe("just now");
    expect(timeAgo("not a date", now)).toBe("unknown");
  });
});

describe("directionsUrl", () => {
  it("builds a Google Maps directions link with plain coordinates", () => {
    expect(directionsUrl({ lat: 41.0086, lng: 28.9795 }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=41.008600,28.979500");
  });
});

describe("stepsContainPassword", () => {
  it("detects the password in the steps, ignoring case", () => {
    expect(stepsContainPassword("The code is CafeGuest2026.", "cafeguest2026")).toBe(true);
  });
  it("ignores short or empty passwords and steps without the password", () => {
    expect(stepsContainPassword("Room 123 is upstairs", "123")).toBe(false);
    expect(stepsContainPassword("Ask the staff", "")).toBe(false);
    expect(stepsContainPassword("Ask the staff", "secret-pw")).toBe(false);
  });
});
