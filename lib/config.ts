import type { EntryStatus } from "./types";

export interface Config {
  exposePasswords: boolean;
  newEntryStatus: EntryStatus;
  reportHideThreshold: number;
  reportHideMinIps: number;
  actorSalt: string;
}

/** The value in .env.example. A known salt makes the IP and device hashes easy to reverse. */
const EXAMPLE_SALT = "change-me-to-a-long-random-string";

export function config(): Config {
  const salt = process.env.ACTOR_SALT ?? "";
  if (process.env.NODE_ENV === "production" && (salt.length < 16 || salt === EXAMPLE_SALT)) {
    throw new Error("ACTOR_SALT must be a long random value (16 or more characters) in production");
  }
  return {
    exposePasswords: process.env.EXPOSE_PASSWORDS === "true",
    newEntryStatus: process.env.NEW_ENTRY_STATUS === "pending" ? "pending" : "active",
    reportHideThreshold: Number(process.env.REPORT_HIDE_THRESHOLD ?? 3) || 3,
    reportHideMinIps: Number(process.env.REPORT_HIDE_MIN_IPS ?? 2) || 2,
    actorSalt: salt,
  };
}
