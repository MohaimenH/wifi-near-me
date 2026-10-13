import type { AccessType, Category, GeocodeResult, Language, PlaceDetail, PlaceSummary } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  code: string;
  issues?: { path: string; message: string }[];
  constructor(status: number, code: string, issues?: { path: string; message: string }[]) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let body: { error?: string; issues?: { path: string; message: string }[] };
  try {
    body = await res.json();
  } catch (e) {
    // An abort is not a bad answer. The caller ignores it.
    if ((e as Error | null)?.name === "AbortError") throw e;
    // An OK answer that is not JSON (for example a proxy page) must not look like success.
    if (res.ok) throw new ApiError(res.status, "bad_response");
    body = {};
  }
  if (!res.ok) throw new ApiError(res.status, body.error ?? "server_error", body.issues);
  return body as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface EntryBody {
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password?: string;
  password_is_public: boolean;
  website?: string;
}
export type EntryEditBody = EntryBody & { password_clear: boolean };

/** lat and lng are rounded to 3 decimals (about 100 m), so the server never gets the exact position. */
export async function fetchNearby(v: { lat: number; lng: number; radius_m: number }, signal?: AbortSignal): Promise<PlaceSummary[]> {
  const qs = new URLSearchParams({ lat: v.lat.toFixed(3), lng: v.lng.toFixed(3), radius_m: String(Math.round(v.radius_m)) });
  return (await request<{ places: PlaceSummary[] }>(`/api/places/nearby?${qs}`, { signal })).places;
}

export const fetchPlace = (id: number, signal?: AbortSignal) => request<PlaceDetail>(`/api/places/${id}`, { signal });

export const postEntry = (placeId: number, body: EntryBody) =>
  request<{ entry_id?: number; ignored?: boolean }>(`/api/places/${placeId}/entries`, jsonInit("POST", body));

export const patchEntry = (entryId: number, body: EntryEditBody) =>
  request<{ entry_id?: number; ignored?: boolean }>(`/api/entries/${entryId}`, jsonInit("PATCH", body));

export const postPlace = (body: { place: { name: string; category: Category; lat: number; lng: number }; entry: EntryBody }) =>
  request<{ place_id?: number; entry_id?: number; ignored?: boolean }>("/api/places", jsonInit("POST", body));

export const postVote = (entryId: number, kind: "works" | "broken") =>
  request<{ works: number; broken: number }>(`/api/entries/${entryId}/vote`, jsonInit("POST", { kind }));

export const postReport = (entryId: number, reason?: string) =>
  request<{ hidden: boolean }>(`/api/entries/${entryId}/report`, jsonInit("POST", { reason }));

export async function fetchGeocode(q: string, center: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const qs = new URLSearchParams({ q, lat: String(center.lat), lng: String(center.lng) });
  return (await request<{ results: GeocodeResult[] }>(`/api/geocode?${qs}`, { signal })).results;
}
