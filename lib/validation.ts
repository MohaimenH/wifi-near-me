import { z } from "zod";
import { ACCESS_TYPES, CATEGORIES, LANGUAGES } from "./types";

// Postgres cannot store NUL, and a lone surrogate (not well-formed UTF-16) breaks text encoding. Refuse both.
const text = () =>
  z.string().refine((v) => !v.includes("\u0000") && v.isWellFormed(), "Text contains invalid characters");

export const entryInputSchema = z.object({
  label: text().trim().max(40).default("").transform((v) => v || "WiFi"),
  access_type: z.enum(ACCESS_TYPES),
  steps_text: text().trim().min(1, "Steps are required").max(500),
  language: z.enum(LANGUAGES).default("en"),
  password: text().trim().max(64).optional().transform((v) => (v ? v : null)),
  /** The submitter says the venue shows this password in public. */
  password_is_public: z.boolean().default(false),
  /** Honeypot. Real users never fill this hidden field. */
  website: z.string().optional(),
});
export type EntryInput = z.output<typeof entryInputSchema>;

/** Edit: an empty password keeps the stored one. password_clear removes it. */
export const entryEditSchema = entryInputSchema.extend({
  password_clear: z.boolean().default(false),
});
export type EntryEdit = z.output<typeof entryEditSchema>;

export const placeInputSchema = z.object({
  name: text().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type PlaceInput = z.output<typeof placeInputSchema>;

// Query strings arrive as text. An empty string must NOT become 0, so check the text first.
// Only plain decimals: whitespace, hex (0x10), exponents (1e1), and Infinity fail.
const num = (min: number, max: number) =>
  z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number).pipe(z.number().min(min).max(max));

export const nearbyQuerySchema = z.object({
  lat: num(-90, 90),
  lng: num(-180, 180),
  radius_m: num(50, 50000).optional().transform((v) => v ?? 3000),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200))
    .optional().transform((v) => v ?? 100),
});

export const voteKindSchema = z.enum(["works", "broken"]);

export const reportReasonSchema = text().trim().max(200).optional().transform((v) => v || "other");
