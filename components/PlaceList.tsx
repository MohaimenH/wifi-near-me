import { CATEGORY_LABEL, fmtDist } from "@/lib/labels";
import type { PlaceSummary } from "@/lib/types";

export function PlaceList({ places, onSelect }: { places: PlaceSummary[]; onSelect(id: number): void }) {
  if (places.length === 0) {
    return <div className="empty">No places here. Move the map, try another search, or add a missing place.</div>;
  }
  return (
    <div className="list">
      {places.map((p) => (
        <button key={p.id} className="item" onClick={() => onSelect(p.id)}>
          <span className={"dot" + (p.entry_count > 0 ? " has" : "")} />
          <span>
            <span className="name">{p.name}</span>
            <br />
            <span className="meta">
              {CATEGORY_LABEL[p.category] ?? "Place"} ·{" "}
              {p.entry_count > 0 ? `${p.entry_count} WiFi ${p.entry_count > 1 ? "networks" : "network"}` : "No WiFi info yet"}
            </span>
          </span>
          <span className="dist">{fmtDist(p.distance_m)}</span>
        </button>
      ))}
    </div>
  );
}
