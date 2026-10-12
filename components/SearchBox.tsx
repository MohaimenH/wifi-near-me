"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchGeocode } from "@/lib/client/api";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { GeocodeResult, PlaceSummary } from "@/lib/types";

interface Props {
  places: PlaceSummary[];
  center: { lat: number; lng: number };
  onQueryChange(q: string): void;
  onPickLocation(r: GeocodeResult): void;
  onPickPlace(id: number): void;
}

export function SearchBox({ places, center, onQueryChange, onPickLocation, onPickPlace }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error" | "limited">("idle");
  const wrap = useRef<HTMLDivElement>(null);
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setLive([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setLive(await fetchGeocode(text, centerRef.current, ctl.signal));
        setStatus("ok");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setLive([]);
        setStatus(e instanceof ApiError && e.status === 429 ? "limited" : "error");
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const text = q.trim().toLowerCase();
  const local = text ? places.filter((p) => p.name.toLowerCase().includes(text)).slice(0, 4) : [];

  return (
    <div className="search" ref={wrap}>
      <input
        type="search"
        value={q}
        placeholder="Search a city or place (try: Istanbul, airport, library)"
        aria-label="Search a city or place"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          onQueryChange(e.target.value.trim().toLowerCase());
        }}
      />
      {open && text.length >= 2 && (
        <div className="suggest">
          {live.length > 0 && <div className="sg-head">Locations</div>}
          {live.map((r, i) => (
            <button key={`l${i}`} onClick={() => { setOpen(false); setQ(r.name); onQueryChange(""); onPickLocation(r); }}>
              📍 {r.name} <small>{r.kind}{r.where ? ` · ${r.where}` : ""}</small>
            </button>
          ))}
          {local.length > 0 && <div className="sg-head">Places on the map</div>}
          {local.map((p) => (
            <button key={`p${p.id}`} onClick={() => { setOpen(false); setQ(p.name); onQueryChange(""); onPickPlace(p.id); }}>
              {p.name} <small>{CATEGORY_LABEL[p.category]} · {p.entry_count > 0 ? "has WiFi info" : "no WiFi info yet"}</small>
            </button>
          ))}
          {status === "loading" && live.length === 0 && <div className="sg-note">Searching locations…</div>}
          {status === "error" && <div className="sg-note">Live location search is not available now. Showing places on the map only.</div>}
          {status === "limited" && <div className="sg-note">Too many searches from your network. Please wait a few minutes.</div>}
          {status === "ok" && live.length === 0 && local.length === 0 && <div className="sg-note">No results.</div>}
        </div>
      )}
    </div>
  );
}
