import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { App } from "@/components/App";
import { getSql } from "@/lib/db";
import { parseId } from "@/lib/http";
import { getPlaceDetail } from "@/lib/services/read";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Passwords are never needed here: the link preview shows only the name and the number of networks.
async function load({ params }: Params) {
  const id = parseId((await params).id);
  return id === null ? null : getPlaceDetail(getSql(), id, { exposePasswords: false });
}

export async function generateMetadata(p: Params): Promise<Metadata> {
  const place = await load(p);
  if (!place) return { title: "Place not found – WiFi Near Me" };
  const n = place.entries.length;
  const title = `${place.name} – WiFi Near Me`;
  const description = n > 0
    ? `${n} WiFi ${n > 1 ? "networks" : "network"}, with steps to connect.`
    : "No WiFi info yet. Add how to connect.";
  return { title, description, openGraph: { title, description } };
}

/** A shareable link to one place: the normal app, opened at that place. */
export default async function PlacePage(p: Params) {
  const place = await load(p);
  if (!place) notFound();
  return <App initialPlace={{ id: place.id, lat: place.lat, lng: place.lng }} />;
}
