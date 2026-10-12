import { describe, expect, it } from "vitest";
import {
  entryEditSchema, entryInputSchema, nearbyQuerySchema, placeInputSchema, reportReasonSchema, voteKindSchema,
} from "@/lib/validation";

describe("entryInputSchema", () => {
  const ok = { access_type: "password", steps_text: "Ask the staff." };

  it("accepts a minimal entry and fills defaults", () => {
    expect(entryInputSchema.parse(ok)).toMatchObject({
      label: "WiFi", language: "en", password: null, password_is_public: false,
    });
  });

  it("rejects steps that are only spaces", () => {
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "    " }).success).toBe(false);
  });

  it("rejects 501 characters and accepts 500", () => {
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "a".repeat(501) }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "a".repeat(500) }).success).toBe(true);
  });

  it("keeps script text as plain text and keeps Turkish letters", () => {
    expect(entryInputSchema.parse({ ...ok, steps_text: "<script>x</script> Şifre: çay" }).steps_text)
      .toBe("<script>x</script> Şifre: çay");
  });

  it("rejects an unknown access type", () => {
    expect(entryInputSchema.safeParse({ ...ok, access_type: "magic" }).success).toBe(false);
  });

  it("turns an empty password into null and trims a password", () => {
    expect(entryInputSchema.parse({ ...ok, password: "   " }).password).toBeNull();
    expect(entryInputSchema.parse({ ...ok, password: " abc " }).password).toBe("abc");
  });
});

describe("entryEditSchema", () => {
  it("defaults password_clear to false and accepts true", () => {
    const base = { access_type: "open", steps_text: "Open network." };
    expect(entryEditSchema.parse(base).password_clear).toBe(false);
    expect(entryEditSchema.parse({ ...base, password_clear: true }).password_clear).toBe(true);
  });
});

describe("placeInputSchema", () => {
  const ok = { name: "Cafe", category: "cafe", lat: 41, lng: 29 };
  it("accepts a valid place", () => expect(placeInputSchema.safeParse(ok).success).toBe(true));
  it("rejects out-of-range and NaN coordinates", () => {
    expect(placeInputSchema.safeParse({ ...ok, lat: 91 }).success).toBe(false);
    expect(placeInputSchema.safeParse({ ...ok, lng: -181 }).success).toBe(false);
    expect(placeInputSchema.safeParse({ ...ok, lat: Number.NaN }).success).toBe(false);
  });
  it("rejects an empty or whitespace name", () => {
    expect(placeInputSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
  });
});

describe("nearbyQuerySchema", () => {
  it("parses strings and applies defaults", () => {
    expect(nearbyQuerySchema.parse({ lat: "41.01", lng: "28.97" }))
      .toEqual({ lat: 41.01, lng: 28.97, radius_m: 3000, limit: 100 });
  });
  it("rejects missing, empty, non-numeric and out-of-range values", () => {
    for (const bad of [
      { lng: "28" }, { lat: "", lng: "28" }, { lat: "abc", lng: "28" }, { lat: "95", lng: "28" },
      { lat: "41", lng: "28", radius_m: "999999999" }, { lat: "41", lng: "28", radius_m: "-5" },
      { lat: "41", lng: "28", limit: "0" }, { lat: "Infinity", lng: "28" },
    ]) {
      expect(nearbyQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("vote and report schemas", () => {
  it("accepts only works or broken", () => {
    expect(voteKindSchema.safeParse("works").success).toBe(true);
    expect(voteKindSchema.safeParse("meh").success).toBe(false);
  });
  it("defaults the reason and limits its length", () => {
    expect(reportReasonSchema.parse(undefined)).toBe("other");
    expect(reportReasonSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});
