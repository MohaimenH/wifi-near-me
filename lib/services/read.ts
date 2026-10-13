import type { Sql } from "@/lib/db";
import { getPlaceRow, listEntryRows } from "@/lib/repo/places";
import { serializeEntry } from "@/lib/serializers/wifiEntry";
import type { PlaceDetail } from "@/lib/types";

export async function getPlaceDetail(
  sql: Sql,
  id: number,
  opts: { exposePasswords: boolean },
): Promise<PlaceDetail | null> {
  const place = await getPlaceRow(sql, id);
  if (!place) return null;
  const rows = await listEntryRows(sql, id);
  return { ...place, entries: rows.map((r) => serializeEntry(r, opts)) };
}
