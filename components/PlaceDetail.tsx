import { directionsUrl } from "@/lib/directions";
import { ACCESS_LABEL, CATEGORY_LABEL } from "@/lib/labels";
import { timeAgo } from "@/lib/time";
import type { PlaceDetail as PlaceDetailData, PublicEntry } from "@/lib/types";

interface Props {
  detail: PlaceDetailData;
  onBack(): void;
  onShare(): void;
  onAddEntry(): void;
  onEdit(entry: PublicEntry): void;
  onVote(entryId: number, kind: "works" | "broken"): void;
  onReport(entryId: number): void;
  myVotes: Record<number, "works" | "broken">;
  reported: Record<number, boolean>;
}

export function PlaceDetail({ detail, onBack, onShare, onAddEntry, onEdit, onVote, onReport, myVotes, reported }: Props) {
  return (
    <div className="detail">
      <button className="btn small back" onClick={onBack}>← All places</button>
      <h2>{detail.name}</h2>
      <div className="meta">
        {CATEGORY_LABEL[detail.category] ?? "Place"} · {detail.source === "osm" ? "from OpenStreetMap" : "added by a traveler"}
      </div>

      {detail.entries.length === 0 && (
        <div className="nodata">
          This place is on the map, but nobody has added WiFi info yet.
          <br />
          Be the first to add how to connect.
        </div>
      )}

      {detail.entries.map((e) => (
        <div className="card" key={e.id}>
          <h3>
            {e.label} <span className={`badge ${e.access_type}`}>{ACCESS_LABEL[e.access_type]}</span>
            <button className="btn small edit" onClick={() => onEdit(e)}>Edit</button>
          </h3>
          <div className="steps">{e.steps_text}</div>
          {e.password_visible && (
            <div className="pw">
              Password: <code>{e.password}</code>
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(e.password ?? "")}>Copy</button>
            </div>
          )}
          {!e.password_visible && e.has_password && (
            <div className="pw hidden-pw">A password exists, but it is not shown here. Check the steps above or ask the staff.</div>
          )}
          <div className="votes">
            <button className={"btn small" + (myVotes[e.id] === "works" ? " on" : "")} onClick={() => onVote(e.id, "works")}>
              ✓ Works ({e.works})
            </button>
            <button className={"btn small bad" + (myVotes[e.id] === "broken" ? " on bad" : "")} onClick={() => onVote(e.id, "broken")}>
              ✗ Not working ({e.broken})
            </button>
            <button className="btn small" disabled={!!reported[e.id]} onClick={() => onReport(e.id)}>
              {reported[e.id] ? "Reported" : "Report"}
            </button>
            <span>Checked {timeAgo(e.last_confirmed_at)}</span>
          </div>
        </div>
      ))}

      <div className="row">
        <button className="btn primary" onClick={onAddEntry}>+ Add WiFi info</button>
        <a className="btn" target="_blank" rel="noopener noreferrer" href={directionsUrl(detail)}>Directions in Google Maps ↗</a>
        <button className="btn" onClick={onShare}>Share link</button>
      </div>
    </div>
  );
}
