"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { haversineM } from "@/lib/geo";
import type { PlaceSummary } from "@/lib/types";

export interface MapViewProps {
  places: PlaceSummary[];
  selectedId: number | null;
  userLocation: { lat: number; lng: number } | null;
  flyTo: { lat: number; lng: number; zoom: number; nonce: number } | null;
  pickMode: boolean;
  onSelect(id: number): void;
  onMoveEnd(v: { lat: number; lng: number; radius_m: number }): void;
  onPick(p: { lat: number; lng: number }): void;
}

const START = { lat: 41.0136, lng: 28.9784, zoom: 11.5 };

export function MapView(props: MapViewProps) {
  const styleUrl = process.env.NEXT_PUBLIC_TILE_STYLE_URL;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const me = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!box.current || !styleUrl) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: styleUrl,
      center: [START.lng, START.lat],
      zoom: START.zoom,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // wrap() keeps lng in -180..180 after a pan across the antimeridian.
    const emit = () => {
      const c = map.getCenter().wrap();
      const ne = map.getBounds().getNorthEast();
      const radius = Math.min(50000, Math.max(50, haversineM(c.lat, c.lng, ne.lat, ne.lng)));
      latest.current.onMoveEnd({ lat: c.lat, lng: c.lng, radius_m: radius });
    };
    // Camera and bounds exist before tiles, so the list and pins load at once.
    // "load" waits for all first tiles, so it is not used.
    emit();
    map.on("moveend", emit);
    map.on("click", (e) => {
      if (latest.current.pickMode) latest.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  // Without a map style there is no map, but the list still loads for the start area.
  useEffect(() => {
    if (!styleUrl) latest.current.onMoveEnd({ lat: START.lat, lng: START.lng, radius_m: 3000 });
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = props.places.map((p) => {
      const el = document.createElement("div");
      el.className = "pin" + (p.entry_count > 0 ? " has" : "") + (p.id === props.selectedId ? " sel" : "");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", p.name);
      el.tabIndex = 0;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); latest.current.onSelect(p.id); });
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") latest.current.onSelect(p.id); });
      return new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [-4, -4] })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
    });
  }, [props.places, props.selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.flyTo) return;
    map.flyTo({ center: [props.flyTo.lng, props.flyTo.lat], zoom: props.flyTo.zoom, speed: 1.4 });
  }, [props.flyTo?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    me.current?.remove();
    me.current = null;
    if (props.userLocation) {
      const el = document.createElement("div");
      el.className = "me";
      me.current = new maplibregl.Marker({ element: el }).setLngLat([props.userLocation.lng, props.userLocation.lat]).addTo(map);
    }
  }, [props.userLocation]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = props.pickMode ? "crosshair" : "";
  }, [props.pickMode]);

  if (!styleUrl) {
    return (
      <div className="empty" style={{ padding: 32 }}>
        Map style is not set. Add NEXT_PUBLIC_TILE_STYLE_URL to your .env file and rebuild. Use a tile provider, not the public OpenStreetMap server.
      </div>
    );
  }
  return <div ref={box} style={{ position: "absolute", inset: 0 }} aria-label="Map of places" />;
}
