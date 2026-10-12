export const ACCESS_TYPES = [
  "open", "password", "portal", "sms", "id_required", "ask_staff", "customers_only", "paid",
] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const CATEGORIES = [
  "airport", "cafe", "restaurant", "hotel", "hostel", "station", "library", "coworking", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const LANGUAGES = ["en", "tr", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

export type PasswordPolicy = "none" | "posted_publicly";
export type EntryStatus = "active" | "pending" | "hidden";

export interface Actor {
  /** sha256(salt|ip). IPv6 is grouped by /64. Used for rate limits and abuse checks. */
  ipHash: string;
  /** sha256(salt|device cookie). One browser. Votes and reports count once per device. */
  deviceHash: string;
  /** Null for anonymous writes. Filled from the session when accounts exist. */
  userId: string | null;
}

export interface PlaceSummary {
  id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  distance_m: number;
  entry_count: number;
}

export interface PublicEntry {
  id: number;
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  has_password: boolean;
  password: string | null;
  password_visible: boolean;
  works: number;
  broken: number;
  last_confirmed_at: string;
}

export interface PlaceDetail {
  id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  source: "osm" | "user";
  entries: PublicEntry[];
}

export interface GeocodeResult {
  name: string;
  kind: string;
  where: string;
  lat: number;
  lng: number;
  zoom: number;
}
