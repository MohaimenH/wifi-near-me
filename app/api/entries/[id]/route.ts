import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const r = await submissionService().editEntry(actor, id, await readJson(req));
    return withCookie(r.ignored ? json({ ignored: true }, 202) : json({ entry_id: r.entry_id }), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
