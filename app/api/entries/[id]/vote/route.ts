import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const body = (await readJson(req)) as { kind?: unknown } | null;
    return withCookie(json(await submissionService().castVote(actor, id, body?.kind)), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
