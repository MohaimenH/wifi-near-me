import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import type { Actor } from "./types";

export const DEVICE_COOKIE = "wnm_device";
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function hashWithSalt(kind: "ip" | "ipgroup" | "device", value: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${kind}|${value}`).digest("hex");
}

/** IPv4 text as is, or the IPv6 groups without leading zeros ("::" expanded). */
function parseIp(ip: string): { v4: string } | { v6: string[] } {
  let v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (v.startsWith("::ffff:") && v.includes(".")) v = v.slice(7);
  if (!v.includes(":")) return { v4: v };
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = v.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return { v6: groups.map((g) => g.replace(/^0+(?=.)/, "")) };
}

/** IPv4 stays as is. IPv6 is grouped by its /64 prefix, because one device can rotate inside a /64. */
export function ipKey(ip: string): string {
  const p = parseIp(ip);
  return "v4" in p ? p.v4 : p.v6.slice(0, 4).join(":") + "::/64";
}

/** The network an address belongs to: IPv4 /24, IPv6 /48. One person can get many addresses inside it. */
export function ipGroupKey(ip: string): string {
  const p = parseIp(ip);
  if ("v6" in p) return p.v6.slice(0, 3).join(":") + "::/48";
  const octets = p.v4.split(".");
  return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : p.v4;
}

/**
 * First address in x-forwarded-for. On Vercel the platform sets this header and drops client values.
 * Behind any other proxy, confirm that the proxy overwrites it, or clients can choose their own IP.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown";
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Anonymous identity. ipHash is for rate limits. ipGroupHash counts networks for auto-hide.
 * deviceHash counts votes and reports once per browser.
 * When accounts exist, fill userId here from the session.
 */
export function resolveActor(req: Request): { actor: Actor; setCookie: string | null } {
  const salt = config().actorSalt;
  let deviceId = readCookie(req, DEVICE_COOKIE);
  let setCookie: string | null = null;
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    deviceId = randomBytes(32).toString("base64url");
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    setCookie = `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  }
  const ip = clientIp(req);
  return {
    actor: {
      ipHash: hashWithSalt("ip", ipKey(ip), salt),
      ipGroupHash: hashWithSalt("ipgroup", ipGroupKey(ip), salt),
      deviceHash: hashWithSalt("device", deviceId, salt),
      userId: null,
    },
    setCookie,
  };
}
