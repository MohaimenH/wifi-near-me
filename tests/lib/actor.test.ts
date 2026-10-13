import { describe, expect, it } from "vitest";
import { DEVICE_COOKIE, hashWithSalt, ipGroupKey, ipKey, readCookie, resolveActor } from "@/lib/actor";

const req = (headers: Record<string, string> = {}) => new Request("http://x/", { headers });
const GOOD_ID = "A".repeat(43);

describe("ipKey", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:bbbb:cccc:dddd:eeee", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["[2001:db8:1:2::9]", "2001:db8:1:2::/64"],
  ])("%s -> %s", (ip, key) => expect(ipKey(ip)).toBe(key));
});

describe("ipGroupKey", () => {
  it.each([
    ["1.2.3.4", "1.2.3.0/24"],
    ["::ffff:1.2.3.99", "1.2.3.0/24"],
    ["2001:db8:1:2::1", "2001:db8:1::/48"],
    ["2001:0db8:0001:ffff:1:2:3:4", "2001:db8:1::/48"],
    ["::1", "0:0:0::/48"],
    ["unknown", "unknown"],
  ])("%s -> %s", (ip, key) => expect(ipGroupKey(ip)).toBe(key));
});

describe("readCookie", () => {
  it("finds a cookie among others and returns null when missing or malformed", () => {
    expect(readCookie(req({ cookie: `a=1; ${DEVICE_COOKIE}=xyz; b=2` }), DEVICE_COOKIE)).toBe("xyz");
    expect(readCookie(req({ cookie: "a=1" }), DEVICE_COOKIE)).toBeNull();
    expect(readCookie(req({ cookie: `${DEVICE_COOKIE}=%E0%A4%A` }), DEVICE_COOKIE)).toBeNull();
    expect(readCookie(req(), DEVICE_COOKIE)).toBeNull();
  });
});

describe("resolveActor", () => {
  it("creates a device cookie when there is none", () => {
    const { actor, setCookie } = resolveActor(req({ "x-forwarded-for": "9.9.9.9" }));
    expect(setCookie).toMatch(new RegExp(`^${DEVICE_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`));
    expect(actor.userId).toBeNull();
    expect(actor.ipHash).toBe(hashWithSalt("ip", "9.9.9.9", "test-salt"));
  });

  it("reuses a valid cookie and replaces an invalid one", () => {
    const a = resolveActor(req({ cookie: `${DEVICE_COOKIE}=${GOOD_ID}`, "x-forwarded-for": "1.1.1.1" }));
    const b = resolveActor(req({ cookie: `${DEVICE_COOKIE}=${GOOD_ID}`, "x-forwarded-for": "2.2.2.2" }));
    expect(a.setCookie).toBeNull();
    expect(a.actor.deviceHash).toBe(b.actor.deviceHash);
    expect(a.actor.ipHash).not.toBe(b.actor.ipHash);
    expect(resolveActor(req({ cookie: `${DEVICE_COOKIE}=short` })).setCookie).not.toBeNull();
  });

  it("gives two devices on one IP the same ipHash but different deviceHash", () => {
    const one = resolveActor(req({ "x-forwarded-for": "5.5.5.5" })).actor;
    const two = resolveActor(req({ "x-forwarded-for": "5.5.5.5" })).actor;
    expect(one.ipHash).toBe(two.ipHash);
    expect(one.deviceHash).not.toBe(two.deviceHash);
  });

  it("groups IPv6 addresses in the same /64 and never stores the raw IP", () => {
    const a = resolveActor(req({ "x-forwarded-for": "2001:db8:1:2::1" })).actor;
    const b = resolveActor(req({ "x-forwarded-for": "2001:db8:1:2::ffff" })).actor;
    expect(a.ipHash).toBe(b.ipHash);
    expect(a.ipHash).not.toContain("2001");
  });

  it("gives two IPs in one network group the same ipGroupHash but different ipHash", () => {
    const a = resolveActor(req({ "x-forwarded-for": "5.6.7.8" })).actor;
    const b = resolveActor(req({ "x-forwarded-for": "5.6.7.200" })).actor;
    expect(a.ipGroupHash).toBe(hashWithSalt("ipgroup", "5.6.7.0/24", "test-salt"));
    expect(a.ipGroupHash).toBe(b.ipGroupHash);
    expect(a.ipHash).not.toBe(b.ipHash);
  });
});
