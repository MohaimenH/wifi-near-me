import type { AccessType, EntryStatus, Language, PasswordPolicy, PublicEntry } from "@/lib/types";

/** Row shape read from the database. Never send this shape to a client. */
export interface EntryRow {
  id: number;
  place_id: number;
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password: string | null;
  password_policy: PasswordPolicy;
  status: EntryStatus;
  works: number;
  broken: number;
  last_confirmed_at: Date | string;
}

/**
 * The ONE place that decides if a password leaves the server.
 * Visible only when the server allows it AND the submitter said the venue shows it in public.
 */
export function serializeEntry(row: EntryRow, opts: { exposePasswords: boolean }): PublicEntry {
  const visible = opts.exposePasswords && !!row.password && row.password_policy === "posted_publicly";
  return {
    id: row.id,
    label: row.label,
    access_type: row.access_type,
    steps_text: row.steps_text,
    language: row.language,
    has_password: !!row.password,
    password: visible ? row.password : null,
    password_visible: visible,
    works: row.works,
    broken: row.broken,
    last_confirmed_at: new Date(row.last_confirmed_at).toISOString(),
  };
}
