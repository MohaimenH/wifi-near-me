import { describe, expect, it } from "vitest";
import { serializeEntry, type EntryRow } from "@/lib/serializers/wifiEntry";

const base: EntryRow = {
  id: 1, place_id: 9, label: "Guest", access_type: "password", steps_text: "Ask staff.",
  language: "en", password: "s3cret-pw", password_policy: "posted_publicly", status: "active",
  works: 3, broken: 1, last_confirmed_at: new Date("2026-01-02T03:04:05Z"),
};

describe("serializeEntry", () => {
  it("hides the password when exposure is off, anywhere in the JSON", () => {
    const out = serializeEntry(base, { exposePasswords: false });
    expect(out).toMatchObject({ password: null, password_visible: false, has_password: true });
    expect(JSON.stringify(out)).not.toContain("s3cret-pw");
  });

  it("shows the password only for posted_publicly when exposure is on", () => {
    expect(serializeEntry(base, { exposePasswords: true }).password).toBe("s3cret-pw");
    const hidden = serializeEntry({ ...base, password_policy: "none" }, { exposePasswords: true });
    expect(hidden.password).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("s3cret-pw");
  });

  it("reports has_password false when there is no password", () => {
    expect(serializeEntry({ ...base, password: null }, { exposePasswords: true }))
      .toMatchObject({ has_password: false, password_visible: false });
  });

  it("does not leak internal fields and formats the date as ISO text", () => {
    const out = serializeEntry(base, { exposePasswords: true }) as unknown as Record<string, unknown>;
    for (const k of ["password_policy", "status", "place_id"]) expect(out).not.toHaveProperty(k);
    expect(out.last_confirmed_at).toBe("2026-01-02T03:04:05.000Z");
  });
});
