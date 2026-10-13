"use client";

import { useEffect, useRef, useState } from "react";
import { stepsContainPassword } from "@/lib/form-checks";
import { ACCESS_LABEL, CATEGORY_LABEL } from "@/lib/labels";
import { ACCESS_TYPES, CATEGORIES, type AccessType, type Category, type Language } from "@/lib/types";

export interface EntryFormValues {
  placeName: string;
  placeCategory: Category;
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password: string;
  password_is_public: boolean;
  password_clear: boolean;
  website: string;
}

interface Props {
  mode: "entry" | "place" | "edit";
  title: string;
  initial?: Partial<EntryFormValues>;
  onSubmit(v: EntryFormValues): void | Promise<void>;
  onClose(): void;
  error?: string | null;
}

const EMPTY: EntryFormValues = {
  placeName: "", placeCategory: "cafe", label: "", access_type: "open", steps_text: "",
  language: "en", password: "", password_is_public: false, password_clear: false, website: "",
};

const HEADINGS = { entry: "Add WiFi info", place: "Add a missing place", edit: "Edit WiFi info" } as const;

export function EntryForm({ mode, title, initial, onSubmit, onClose, error }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [v, setV] = useState<EntryFormValues>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [pwWarned, setPwWarned] = useState(false);
  const set = <K extends keyof EntryFormValues>(k: K, val: EntryFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const pwInSteps = stepsContainPassword(v.steps_text, v.password);

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => setPwWarned(false), [v.steps_text, v.password]);

  return (
    <dialog ref={dlg} onClose={onClose}>
      <form
        className="dlg"
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pwInSteps && !pwWarned) {
            setPwWarned(true);
            return;
          }
          setBusy(true);
          try { await onSubmit(v); } finally { setBusy(false); }
        }}
      >
        <h2>{HEADINGS[mode]}</h2>
        <p className="hint">{title}</p>

        {mode === "place" && (
          <div className="two">
            <div className="field">
              <label htmlFor="f-pname">Place name</label>
              <input id="f-pname" type="text" maxLength={80} required value={v.placeName} onChange={(e) => set("placeName", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-pcat">Category</label>
              <select id="f-pcat" value={v.placeCategory} onChange={(e) => set("placeCategory", e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="two">
          <div className="field">
            <label htmlFor="f-label">Network label</label>
            <input id="f-label" type="text" maxLength={40} placeholder="Guest, Lobby, Lounge" value={v.label} onChange={(e) => set("label", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-type">How to connect</label>
            <select id="f-type" value={v.access_type} onChange={(e) => set("access_type", e.target.value as AccessType)}>
              {ACCESS_TYPES.map((a) => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-steps">Steps</label>
          <textarea id="f-steps" maxLength={500} required value={v.steps_text} onChange={(e) => set("steps_text", e.target.value)}
            placeholder="Write the steps in simple words. Example: Connect to 'CafeGuest'. Ask the staff for the code." />
          <small>Do not put the password here. Everyone can read the steps. Use the password field.</small>
        </div>

        <div className="two">
          <div className="field">
            <label htmlFor="f-pw">Password (optional)</label>
            <input id="f-pw" type="text" maxLength={64} value={v.password} disabled={v.password_clear}
              onChange={(e) => set("password", e.target.value)} />
            {mode === "edit" && <small>Leave empty to keep the current password.</small>}
          </div>
          <div className="field">
            <label htmlFor="f-lang">Language of steps</label>
            <select id="f-lang" value={v.language} onChange={(e) => set("language", e.target.value as Language)}>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label>
            <input type="checkbox" checked={v.password_is_public} onChange={(e) => set("password_is_public", e.target.checked)} />{" "}
            The place shows this password in public (sign, menu, receipt)
          </label>
          {mode === "edit" && (
            <label>
              <input type="checkbox" checked={v.password_clear} onChange={(e) => set("password_clear", e.target.checked)} />{" "}
              Remove the saved password
            </label>
          )}
          <small>Only share a password that the place shows in public.</small>
        </div>

        {pwInSteps && pwWarned && (
          <div className="warn" role="alert">
            The steps contain the password. Everyone can read the steps. Remove the password from the steps, or press “Save anyway”.
          </div>
        )}

        <div className="hp" aria-hidden="true">
          <label>Website <input type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website", e.target.value)} /></label>
        </div>

        {error && <div className="warn" role="alert">{error}</div>}

        <div className="actions">
          <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Saving…" : pwInSteps && pwWarned ? "Save anyway" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
