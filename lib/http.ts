import { ZodError } from "zod";
import {
  BadJsonError, CrossSiteError, NotFoundError, RateLimitedError, UnsupportedMediaTypeError,
} from "./errors";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function handleError(e: unknown): Response {
  if (e instanceof ZodError) {
    return json(
      { error: "invalid_input", issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) },
      400,
    );
  }
  if (e instanceof BadJsonError) return json({ error: "invalid_json" }, 400);
  if (e instanceof UnsupportedMediaTypeError) return json({ error: "unsupported_media_type" }, 415);
  if (e instanceof CrossSiteError) return json({ error: "cross_site" }, 403);
  if (e instanceof RateLimitedError) return json({ error: "rate_limited" }, 429, { "retry-after": "3600" });
  if (e instanceof NotFoundError) return json({ error: "not_found" }, 404);
  console.error(e);
  return json({ error: "server_error" }, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadJsonError();
  }
}

/** Parses a path id. Returns null unless it is a positive integer. */
export function parseId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/**
 * Blocks cross-site writes. A JSON content type forces a CORS preflight, which this app never allows.
 * Origin and sec-fetch-site catch the rest.
 */
export function assertSameOriginJson(req: Request): void {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new UnsupportedMediaTypeError();
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new CrossSiteError();
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) throw new CrossSiteError();
  }
}

export function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("set-cookie", setCookie);
  return res;
}
