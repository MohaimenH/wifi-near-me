import { getSql } from "@/lib/db";
import { handleError, json } from "@/lib/http";
import { findNearby } from "@/lib/repo/places";
import { nearbyQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = nearbyQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json({ places: await findNearby(getSql(), q) });
  } catch (e) {
    return handleError(e);
  }
}
