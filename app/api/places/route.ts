import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOriginJson(req);
    const { actor, setCookie } = resolveActor(req);
    const body = (await readJson(req)) as { place?: unknown; entry?: unknown } | null;
    const r = await submissionService().createPlace(actor, body?.place, body?.entry);
    const res = r.ignored ? json({ ignored: true }, 202) : json({ place_id: r.place_id, entry_id: r.entry_id }, 201);
    return withCookie(res, setCookie);
  } catch (e) {
    return handleError(e);
  }
}
