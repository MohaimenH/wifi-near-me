import { config } from "@/lib/config";
import { getSql } from "@/lib/db";
import { handleError, json, parseId } from "@/lib/http";
import { getPlaceDetail } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const detail = await getPlaceDetail(getSql(), id, { exposePasswords: config().exposePasswords });
    return detail ? json(detail) : json({ error: "not_found" }, 404);
  } catch (e) {
    return handleError(e);
  }
}
