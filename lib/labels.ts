import type { AccessType, Category } from "./types";

export const ACCESS_LABEL: Record<AccessType, string> = {
  open: "Open", password: "Password", portal: "Login page", sms: "SMS code",
  id_required: "ID / room no.", ask_staff: "Ask staff", customers_only: "Customers only", paid: "Paid",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  airport: "Airport", cafe: "Cafe", restaurant: "Restaurant", hotel: "Hotel", hostel: "Hostel",
  station: "Station", library: "Library", coworking: "Coworking", other: "Place",
};

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
