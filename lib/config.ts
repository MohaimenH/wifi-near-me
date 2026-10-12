import type { EntryStatus } from "./types";

export interface Config {
  exposePasswords: boolean;
  newEntryStatus: EntryStatus;
  reportHideThreshold: number;
  reportHideMinIps: number;
  actorSalt: string;
}

export function config(): Config {
  const salt = process.env.ACTOR_SALT ?? "";
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("ACTOR_SALT must be set in production");
  }
  return {
    exposePasswords: process.env.EXPOSE_PASSWORDS === "true",
    newEntryStatus: process.env.NEW_ENTRY_STATUS === "pending" ? "pending" : "active",
    reportHideThreshold: Number(process.env.REPORT_HIDE_THRESHOLD ?? 3) || 3,
    reportHideMinIps: Number(process.env.REPORT_HIDE_MIN_IPS ?? 2) || 2,
    actorSalt: salt,
  };
}
