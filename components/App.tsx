"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError, fetchNearby, fetchPlace, patchEntry, postEntry, postPlace, postReport, postVote, type EntryBody,
} from "@/lib/client/api";
import type { GeocodeResult, PlaceDetail as PlaceDetailData, PlaceSummary, PublicEntry } from "@/lib/types";
import { EntryForm, type EntryFormValues } from "./EntryForm";
import { MapView } from "./MapView";
import { PlaceDetail } from "./PlaceDetail";
import { PlaceList } from "./PlaceList";
import { SearchBox } from "./SearchBox";

type Filter = "all" | "has" | "none";
type FormState =
  | { mode: "entry"; placeId: number; placeName: string }
  | { mode: "edit"; entryId: number; placeId: number; placeName: string; initial: Partial<EntryFormValues> }
  | { mode: "place"; lat: number; lng: number };

const toEntryBody = (v: EntryFormValues): EntryBody => ({
  label: v.label,
  access_type: v.access_type,
  steps_text: v.steps_text,
  language: v.language,
  password: v.password || undefined,
  password_is_public: v.password_is_public,
  website: v.website || undefined,
});

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Too many tries from your network. Please wait and try again later.";
    if (e.status === 400) return e.issues?.[0]?.message ?? "Please check the form.";
    if (e.status === 404) return "This item no longer exists.";
  }
  return "Something went wrong. Please try again.";
}

const PLACE_PATH = /^\/place\/(\d+)$/;

/** Puts the path in the address bar without a page load, so the user can share a place and Back works. */
function showPath(path: string) {
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
}

/** initialPlace is set on /place/[id]: the app opens at that place. */
export function App({ initialPlace }: { initialPlace?: { id: number; lat: number; lng: number } }) {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [center, setCenter] = useState(
    initialPlace ? { lat: initialPlace.lat, lng: initialPlace.lng } : { lat: 41.0136, lng: 28.9784 },
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<Record<number, "works" | "broken">>({});
  const [reported, setReported] = useState<Record<number, boolean>>({});

  const view = useRef<{ lat: number; lng: number; radius_m: number } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadNearby = useCallback(async () => {
    if (!view.current) return;
    try { setPlaces(await fetchNearby(view.current)); } catch { showToast("Could not load places. Please try again."); }
    finally { setPlacesLoaded(true); }
  }, [showToast]);

  const onMoveEnd = useCallback((v: { lat: number; lng: number; radius_m: number }) => {
    view.current = v;
    setCenter({ lat: v.lat, lng: v.lng });
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(loadNearby, 350);
  }, [loadNearby]);

  /** push=false when the address bar already shows the place (first load, browser Back or Forward). */
  const select = useCallback(async (id: number, fly = true, push = true) => {
    setSelectedId(id);
    try {
      const d = await fetchPlace(id);
      setDetail(d);
      if (push) showPath(`/place/${id}`);
      if (fly) setFlyTo({ lat: d.lat, lng: d.lng, zoom: 15, nonce: Date.now() });
    } catch (e) {
      showToast(messageFor(e));
      setSelectedId(null);
      setDetail(null);
      if (push) showPath("/");
    }
  }, [showToast]);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    showPath("/");
  };

  useEffect(() => {
    if (initialPlace) void select(initialPlace.id, false, false);
    // Only on the first render: initialPlace comes from the page URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const m = PLACE_PATH.exec(window.location.pathname);
      if (m) {
        void select(Number(m[1]), true, false);
      } else {
        setSelectedId(null);
        setDetail(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [select]);

  useEffect(() => () => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const share = async () => {
    if (!detail) return;
    const url = `${window.location.origin}/place/${detail.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${detail.name} – WiFi Near Me`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast("Link copied.");
    } catch (e) {
      // AbortError: the user closed the share menu.
      if ((e as Error).name !== "AbortError") showToast(`Copy this link: ${url}`);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) return showToast("Location is not available in this browser.");
    showToast("Asking for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(p);
        setFlyTo({ ...p, zoom: 14, nonce: Date.now() });
      },
      () => showToast("Location was denied. Search for a city instead."),
      { timeout: 8000 },
    );
  };

  const vote = async (entryId: number, kind: "works" | "broken") => {
    try {
      await postVote(entryId, kind);
      setMyVotes((m) => ({ ...m, [entryId]: kind }));
      if (selectedId !== null) await select(selectedId, false);
    } catch (e) { showToast(messageFor(e)); }
  };

  const report = async (entryId: number) => {
    try {
      const r = await postReport(entryId);
      setReported((m) => ({ ...m, [entryId]: true }));
      showToast(r.hidden ? "Thank you. This entry is now hidden for review." : "Thank you. Your report is saved.");
      if (selectedId !== null) await select(selectedId, false);
      await loadNearby();
    } catch (e) { showToast(messageFor(e)); }
  };

  const startEdit = (e: PublicEntry) => {
    if (!detail) return;
    setFormError(null);
    setForm({
      mode: "edit", entryId: e.id, placeId: detail.id, placeName: detail.name,
      initial: { label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language },
    });
  };

  const submitForm = async (v: EntryFormValues) => {
    if (!form) return;
    setFormError(null);
    try {
      if (form.mode === "place") {
        const r = await postPlace({
          place: { name: v.placeName, category: v.placeCategory, lat: form.lat, lng: form.lng },
          entry: toEntryBody(v),
        });
        setForm(null);
        setPickMode(false);
        await loadNearby();
        if (r.place_id) await select(r.place_id);
      } else if (form.mode === "edit") {
        await patchEntry(form.entryId, { ...toEntryBody(v), password_clear: v.password_clear });
        setForm(null);
        await select(form.placeId, false);
      } else {
        await postEntry(form.placeId, toEntryBody(v));
        setForm(null);
        await loadNearby();
        await select(form.placeId, false);
      }
      showToast("Saved. Thank you for helping other travelers.");
    } catch (e) { setFormError(messageFor(e)); }
  };

  const visible = places.filter((p) => {
    if (filter === "has" && p.entry_count === 0) return false;
    if (filter === "none" && p.entry_count > 0) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
    return true;
  });

  const pickLocation = (r: GeocodeResult) => {
    closeDetail();
    setFlyTo({ lat: r.lat, lng: r.lng, zoom: r.zoom, nonce: Date.now() });
  };

  const formTitle = !form ? "" : form.mode === "place"
    ? "Name the place, then say how to connect to its WiFi."
    : `For: ${form.placeName}`;

  return (
    <div className="app">
      <aside className="side">
        <header>
          <div className="brand"><h1>WiFi Near Me</h1></div>
          <p className="sub">Find places near you and learn how to connect to their WiFi.</p>
          <SearchBox places={places} center={center} onQueryChange={setQuery} onPickLocation={pickLocation} onPickPlace={(id) => select(id)} />
          <div className="row">
            <button className="btn primary" onClick={locate}>Use my location</button>
            <button className="btn" onClick={() => setPickMode(true)}>Add missing place</button>
          </div>
        </header>
        <div className="chips" role="group" aria-label="Filter">
          {(["all", "has", "none"] as const).map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "has" ? "Has WiFi info" : "No WiFi info yet"}
            </button>
          ))}
        </div>
        <div className="scroll">
          {detail && selectedId !== null ? (
            <PlaceDetail
              detail={detail}
              myVotes={myVotes}
              reported={reported}
              onBack={closeDetail}
              onShare={share}
              onAddEntry={() => { setFormError(null); setForm({ mode: "entry", placeId: detail.id, placeName: detail.name }); }}
              onEdit={startEdit}
              onVote={vote}
              onReport={report}
            />
          ) : placesLoaded ? (
            <PlaceList places={visible} onSelect={(id) => select(id)} />
          ) : (
            <div className="empty">Loading places…</div>
          )}
        </div>
        <footer className="attrib">
          Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>
          {" · "}<a href="/terms">Terms</a>{" · "}<a href="/privacy">Privacy</a>
        </footer>
      </aside>

      <main className="map-wrap">
        <MapView
          places={visible}
          selectedId={selectedId}
          userLocation={userLocation}
          flyTo={flyTo}
          pickMode={pickMode}
          start={initialPlace ? { lat: initialPlace.lat, lng: initialPlace.lng, zoom: 15 } : undefined}
          onSelect={(id) => select(id)}
          onMoveEnd={onMoveEnd}
          onPick={(p) => { setFormError(null); setForm({ mode: "place", lat: p.lat, lng: p.lng }); }}
        />
        {pickMode && (
          <div className="mode-banner">
            Click the map to place the new pin <button className="btn small" onClick={() => setPickMode(false)}>Cancel</button>
          </div>
        )}
        <div className="legend" aria-hidden="true">
          <div><i style={{ background: "var(--pin-has)" }} /> Has WiFi info</div>
          <div><i style={{ background: "var(--pin-none)" }} /> No WiFi info yet — add it!</div>
        </div>
      </main>

      {form && (
        <EntryForm
          key={form.mode === "edit" ? `edit-${form.entryId}` : form.mode}
          mode={form.mode}
          title={formTitle}
          initial={form.mode === "edit" ? form.initial : undefined}
          error={formError}
          onSubmit={submitForm}
          onClose={() => { setFormError(null); if (form.mode === "place") setPickMode(false); setForm(null); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
