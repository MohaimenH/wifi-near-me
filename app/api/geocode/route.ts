import { resolveActor } from "@/lib/actor";
import { getSql } from "@/lib/db";
import { cacheGet, cacheSet, normalizePhoton } from "@/lib/geocode";
import { json } from "@/lib/http";
import { consume, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Rounds to 0.1 degree (about 10 km): enough for a location bias, and good for cache hits. */
function roundedCoord(raw: string | null, min: number, max: number): string | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n.toFixed(1) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 100) return json({ error: "invalid_input" }, 400);
  const lat = roundedCoord(url.searchParams.get("lat"), -90, 90);
  const lng = roundedCoord(url.searchParams.get("lng"), -180, 180);
  const bias = lat && lng ? { lat, lng } : null;

  const key = `${q.toLowerCase()}|${bias ? `${bias.lat},${bias.lng}` : ""}`;
  const cached = cacheGet(key);
  if (cached) return json({ results: cached }, 200, { "cache-control": "public, max-age=300" });

  // A database or config failure here still gives the UI an empty list, not a 500.
  try {
    const { actor } = resolveActor(req);
    const l = LIMITS.geocode;
    if (!(await consume(getSql(), actor.ipHash, "geocode", l.limit, l.windowSeconds))) {
      return json({ results: [], error: "rate_limited" }, 429);
    }
  } catch {
    return json({ results: [], error: "geocoder_unavailable" }, 502);
  }

  const upstream = new URL("/api/", process.env.PHOTON_URL ?? "https://photon.komoot.io");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", "8");
  upstream.searchParams.set("lang", "en");
  if (bias) {
    upstream.searchParams.set("lat", bias.lat);
    upstream.searchParams.set("lon", bias.lng);
  }
  try {
    const r = await fetch(upstream, { headers: { "user-agent": "wifi-near-me/0.1" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`geocoder status ${r.status}`);
    const results = normalizePhoton(await r.json());
    cacheSet(key, results);
    return json({ results }, 200, { "cache-control": "public, max-age=300" });
  } catch {
    return json({ results: [], error: "geocoder_unavailable" }, 502);
  }
}
