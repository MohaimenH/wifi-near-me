# WiFi Near Me Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real WiFi Near Me web app: a map of places, crowdsourced WiFi connection instructions with edits and revisions, anonymous submissions with abuse control, a moderation tool, legal pages, and OpenStreetMap seed data.

**Architecture:** One Next.js (App Router, TypeScript) app. Route handlers are thin. All reads of WiFi entries go through one serializer (`lib/serializers/wifiEntry.ts`) that controls password exposure. All user writes go through one submission service (`lib/services/submission.ts`) that calls a `Guard` (the future sign-in hook), applies per-IP rate limits, counts votes and reports per device, and writes revision rows. Moderator writes go through `lib/moderation.ts`, used only by a command-line tool. Data lives in Postgres with PostGIS, accessed with plain SQL through `postgres` (postgres.js).

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.9, Postgres 16 + PostGIS 3.4 (Docker locally, Supabase in production), postgres.js 3.4, zod 4, MapLibre GL JS 4.7.1, Vitest 3.2, tsx 4. Node 22.

**Spec:** `docs/superpowers/specs/2026-10-12-wifi-near-me-design.md`. The approved demo `demo/index.html` and `demo/mock-data.js` is the reference for UI behavior and CSS.

**Plan revision 2 (after audit):** pinned versions; Row Level Security; same-origin JSON check on writes; anonymous device cookie (votes and reports per device, rate limits per IP, IPv6 grouped by /64); edit flow with revisions; moderation CLI; terms and privacy pages; password hint and warning; geocoder rate limit and cache; atomic rate limiter; test database guard; OpenStreetMap attribution in the UI; unused values removed (`ask_staff` policy, `disputed` status); `country_code` filled on import; commits per task.

## Global Constraints

- Install exactly these major versions: `next@15.5`, `react@19`, `react-dom@19`, `maplibre-gl@4.7.1`, `postgres@3.4`, `zod@4`, `typescript@5.9`, `vitest@3.2`, `tsx@4`, `dotenv@16`, `@types/node@22`, `@types/react@19`, `@types/react-dom@19`. Do NOT install TypeScript 7 (it has no JavaScript API, which Next.js 15 needs) or Vitest 5.
- TypeScript `strict: true`. No explicit `any` in `lib/` except the single `Sql` type alias in `lib/db.ts`.
- The public OpenStreetMap tile server is NEVER used. The map style URL comes only from `NEXT_PUBLIC_TILE_STYLE_URL`. If it is not set, the map shows a setup message.
- The sidebar always shows "Place data © OpenStreetMap contributors" with a link to `https://www.openstreetmap.org/copyright`.
- A password value reaches an HTTP response ONLY through `serializeEntry` in `lib/serializers/wifiEntry.ts`. No other file may return `wifi_entries.password` to a client.
- Every app table has Row Level Security enabled with no policies. The app connects as the table owner, so it is not affected. This blocks Supabase's automatic REST API.
- Every user write (new entry, edit, new place, vote, report) goes through `createSubmissionService` in `lib/services/submission.ts`. Route handlers must not run `INSERT`, `UPDATE`, or `DELETE`. Moderator writes go through `lib/moderation.ts` and are never exposed over HTTP.
- Every write route calls `assertSameOriginJson(req)` first. It requires `content-type: application/json` and rejects cross-site requests.
- Identity: rate limits use `actor.ipHash` (IPv6 grouped by /64). Votes and reports are counted once per `actor.deviceHash` (cookie `wnm_device`). An entry is auto-hidden only when reports come from at least `REPORT_HIDE_THRESHOLD` devices AND at least `REPORT_HIDE_MIN_IPS` IP hashes.
- `wifi_entries.submitter_id` is nullable `text`. Anonymous writes store `NULL`. Edits never change `submitter_id`.
- New entries and edits write a row to `wifi_entry_revisions` with the full new content.
- Access types (exact values): `open`, `password`, `portal`, `sms`, `id_required`, `ask_staff`, `customers_only`, `paid`.
- Categories (exact values): `airport`, `cafe`, `restaurant`, `hotel`, `hostel`, `station`, `library`, `coworking`, `other`.
- Entry status values: `active`, `pending`, `hidden`. Only `active` entries are shown, counted, voted on, reported, or edited.
- Password policy values: `none`, `posted_publicly`.
- Geocoder calls are made from the server (`/api/geocode`), never from the browser.
- Tests run only against a database whose name ends in `_test`.
- Git: commit at the end of each task with the message shown, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never force-push. Never post PR comments or reviews.
- Text in the UI is plain and simple English. User text is rendered as text by React (never `dangerouslySetInnerHTML`).

## Review Focus

Failure modes the spec implies that are easy to miss. Each has a test in the task named in brackets.

1. A stored password leaks through a path other than the serializer: the whole entry object in JSON, an error body, or Supabase's REST API. Expected: the password appears nowhere unless `EXPOSE_PASSWORDS=true` and the policy is `posted_publicly`; a non-owner database role sees no rows. [Tasks 2, 3, 7]
2. A hostile website makes its visitors' browsers send votes, reports, or entries. Expected: requests without `application/json`, with a foreign `Origin`, or with `sec-fetch-site: cross-site` get 415 or 403 and change nothing. [Task 7]
3. Many travelers share one IP (airport, hotel, mobile carrier). Expected: two devices on one IP both count as votes. Three devices on ONE IP do not hide an entry. Limits are per IP and generous. [Tasks 5, 6, 7]
4. Parallel requests from one IP try to pass the rate limit. Expected: exactly `limit` succeed. [Task 5]
5. An edit is sent with an empty password field (the client never knows the stored password). Expected: the stored password stays. Only `password_clear: true` removes it. [Task 6]
6. `GET /api/places/nearby` gets a missing, empty, `abc`, out-of-range, or huge-radius value. Expected: 400, never 500, never a full-table scan. An empty string must not become latitude 0. [Tasks 3, 7]
7. The same OpenStreetMap place is imported twice, appears twice in one file, or has a name with Turkish letters, quotes, or an apostrophe. Expected: one row, no corruption, existing WiFi entries kept. [Task 8]
8. The geocoder is slow, down, or used heavily from one IP. Expected: 502 or 429 with an empty `results` list, and the UI still works with places on the map. [Task 9]
9. Invalid input reaches a write. Expected: 400 and the rate-limit quota is not used. [Task 6]

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts   project setup
docker-compose.yml, .env.example, .gitignore, README.md
db/migrations/001_init.sql                 schema + Row Level Security
scripts/migrate.ts                         migration runner (also used by tests)
scripts/import-osm.ts                      CLI: Overpass JSON file -> places
scripts/overpass/istanbul.overpassql       Overpass query for the first import
scripts/moderate.ts                        CLI: list, approve, hide, restore, history, revert
lib/config.ts                              env-based settings
lib/db.ts                                  postgres.js client, Sql type
lib/types.ts                               shared constants and types
lib/validation.ts                          zod schemas
lib/errors.ts                              error classes mapped to HTTP codes
lib/http.ts                                json(), handleError(), readJson(), parseId(), assertSameOriginJson(), withCookie()
lib/actor.ts                               IP key, device cookie, resolveActor()
lib/rate-limit.ts                          atomic DB-backed rate limiter
lib/geo.ts                                 haversine
lib/osm.ts                                 Overpass parsing and import
lib/geocode.ts                             Photon normalizer + in-memory cache
lib/moderation.ts                          moderator operations
lib/serializers/wifiEntry.ts               password exposure rule
lib/repo/places.ts                         read queries
lib/services/guard.ts                      Guard interface + anonymousGuard
lib/services/submission.ts                 all user writes
lib/services/read.ts                       getPlaceDetail
lib/services/index.ts                      wiring for route handlers
lib/labels.ts, lib/time.ts, lib/directions.ts, lib/form-checks.ts   UI helpers
lib/client/api.ts                          browser fetch wrappers
app/layout.tsx, app/page.tsx, app/globals.css
app/terms/page.tsx, app/privacy/page.tsx
app/api/places/nearby/route.ts             GET
app/api/places/route.ts                    POST (new place + first entry)
app/api/places/[id]/route.ts               GET
app/api/places/[id]/entries/route.ts       POST
app/api/entries/[id]/route.ts              PATCH (edit)
app/api/entries/[id]/vote/route.ts         POST
app/api/entries/[id]/report/route.ts       POST
app/api/geocode/route.ts                   GET
components/App.tsx, MapView.tsx, SearchBox.tsx, PlaceList.tsx, PlaceDetail.tsx, EntryForm.tsx
tests/global-setup.ts, tests/setup-env.ts, tests/helpers/db.ts, tests/helpers/factories.ts
tests/db/*.test.ts, tests/lib/*.test.ts, tests/api/*.test.ts
```

Note: the spec listed `app/api/entries/route.ts` and `app/api/votes/route.ts`. This plan uses nested routes because they are clearer. The behavior is the same.

---

### Task 1: Project scaffold, Docker database, environment, first commit

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `test`, `typecheck`, `db:up`, `db:migrate`, `import:osm`, `moderate`. A Postgres+PostGIS container on `localhost:54329` (user `wifi`, password `wifi`, database `wifi`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "wifi-near-me",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:up": "docker compose up -d db",
    "db:migrate": "tsx scripts/migrate.ts",
    "import:osm": "tsx scripts/import-osm.ts",
    "moderate": "tsx scripts/moderate.ts"
  }
}
```

- [ ] **Step 2: Install pinned dependencies**

Run:
```bash
cd /home/mohaimen/Desktop/Playground/wifi-near-me
npm install next@15.5 react@19 react-dom@19 maplibre-gl@4.7.1 postgres@3.4 zod@4
npm install -D typescript@5.9 @types/node@22 @types/react@19 @types/react-dom@19 vitest@3.2 tsx@4 dotenv@16
npx tsc --version
```
Expected: installs without errors. `tsc --version` prints `Version 5.9.x`.

- [ ] **Step 3: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "demo"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`.gitignore`:
```
node_modules
.next
.env
.env.local
data/
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:
```
DATABASE_URL=postgres://wifi:wifi@localhost:54329/wifi
TEST_DATABASE_URL=postgres://wifi:wifi@localhost:54329/wifi_test
# Set to "false" when DATABASE_URL points to a transaction pooler (Supabase pooler, PgBouncer).
DB_PREPARE=true
ACTOR_SALT=change-me-to-a-long-random-string
EXPOSE_PASSWORDS=false
NEW_ENTRY_STATUS=active
REPORT_HIDE_THRESHOLD=3
REPORT_HIDE_MIN_IPS=2
PHOTON_URL=https://photon.komoot.io
CONTACT_EMAIL=
# A MapLibre style JSON URL from a tile provider. Do NOT use the public OpenStreetMap tile server.
# NEXT_PUBLIC_ values are fixed at build time: change it, then rebuild.
NEXT_PUBLIC_TILE_STYLE_URL=
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: wifi
      POSTGRES_PASSWORD: wifi
      POSTGRES_DB: wifi
    ports:
      - "54329:5432"
    volumes:
      - dbdata:/var/lib/postgresql/data
volumes:
  dbdata: {}
```

`app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WiFi Near Me",
  description: "Find places near you and learn how to connect to their WiFi.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (temporary, replaced in Task 13):
```tsx
export default function Page() {
  return <main style={{ padding: 24 }}>WiFi Near Me: setup in progress</main>;
}
```

`app/globals.css` (temporary, replaced in Task 11):
```css
body { margin: 0; font-family: system-ui, sans-serif; }
```

- [ ] **Step 4: Create `.env` and start the database**

Run:
```bash
cp .env.example .env
npm run db:up
docker compose ps
```
Expected: service `db` is `running`.

- [ ] **Step 5: Verify the scaffold**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed. The build route table includes `/`.

- [ ] **Step 6: First commit (includes the existing `demo/` and `docs/`)**

```bash
git add -A
git status --short
git commit -m "chore: scaffold Next.js app, local PostGIS database, and pinned tooling" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` shows no `node_modules/`, `.next/`, or `.env`. The commit succeeds.

---

### Task 2: Database schema, Row Level Security, migration runner, test harness

**Files:**
- Create: `db/migrations/001_init.sql`, `lib/db.ts`, `lib/types.ts`, `scripts/migrate.ts`, `vitest.config.ts`, `tests/global-setup.ts`, `tests/setup-env.ts`, `tests/helpers/db.ts`, `tests/helpers/factories.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `lib/types.ts`: constants `ACCESS_TYPES`, `CATEGORIES`, `LANGUAGES`; types `AccessType`, `Category`, `Language`, `PasswordPolicy`, `EntryStatus`, `Actor`, `PlaceSummary`, `PublicEntry`, `PlaceDetail`, `GeocodeResult`.
  - `lib/db.ts`: `type Sql`, `createSql(url: string): Sql`, `getSql(): Sql`.
  - `scripts/migrate.ts`: `migrate(url: string, dir?: string): Promise<void>`.
  - `tests/helpers/db.ts`: `testUrl: string`, `resetDb(sql: Sql): Promise<void>`.
  - `tests/helpers/factories.ts`: `insertPlace(sql, opts?): Promise<number>`, `insertEntry(sql, placeId, opts?): Promise<number>`.

- [ ] **Step 1: Write shared types**

`lib/types.ts`:
```ts
export const ACCESS_TYPES = [
  "open", "password", "portal", "sms", "id_required", "ask_staff", "customers_only", "paid",
] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const CATEGORIES = [
  "airport", "cafe", "restaurant", "hotel", "hostel", "station", "library", "coworking", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const LANGUAGES = ["en", "tr", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

export type PasswordPolicy = "none" | "posted_publicly";
export type EntryStatus = "active" | "pending" | "hidden";

export interface Actor {
  /** sha256(salt|ip). IPv6 is grouped by /64. Used for rate limits and abuse checks. */
  ipHash: string;
  /** sha256(salt|device cookie). One browser. Votes and reports count once per device. */
  deviceHash: string;
  /** Null for anonymous writes. Filled from the session when accounts exist. */
  userId: string | null;
}

export interface PlaceSummary {
  id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  distance_m: number;
  entry_count: number;
}

export interface PublicEntry {
  id: number;
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  has_password: boolean;
  password: string | null;
  password_visible: boolean;
  works: number;
  broken: number;
  last_confirmed_at: string;
}

export interface PlaceDetail {
  id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  source: "osm" | "user";
  entries: PublicEntry[];
}

export interface GeocodeResult {
  name: string;
  kind: string;
  where: string;
  lat: number;
  lng: number;
  zoom: number;
}
```

- [ ] **Step 2: Write the schema**

`db/migrations/001_init.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE places (
  id           bigserial PRIMARY KEY,
  osm_type     text,
  osm_id       bigint,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category     text NOT NULL CHECK (category IN
                 ('airport','cafe','restaurant','hotel','hostel','station','library','coworking','other')),
  geom         geography(Point, 4326) NOT NULL,
  country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
  source       text NOT NULL DEFAULT 'osm' CHECK (source IN ('osm','user')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (osm_type, osm_id)
);
CREATE INDEX places_geom_gix ON places USING gist (geom);

CREATE TABLE wifi_entries (
  id              bigserial PRIMARY KEY,
  place_id        bigint NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  label           text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  access_type     text NOT NULL CHECK (access_type IN
                    ('open','password','portal','sms','id_required','ask_staff','customers_only','paid')),
  steps_text      text NOT NULL CHECK (char_length(steps_text) BETWEEN 1 AND 500),
  language        text NOT NULL DEFAULT 'en' CHECK (language IN ('en','tr','other')),
  password        text,
  password_policy text NOT NULL DEFAULT 'none' CHECK (password_policy IN ('none','posted_publicly')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','hidden')),
  submitter_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wifi_entries_place_status_idx ON wifi_entries (place_id, status);

CREATE TABLE wifi_entry_revisions (
  id            bigserial PRIMARY KEY,
  wifi_entry_id bigint NOT NULL REFERENCES wifi_entries(id) ON DELETE CASCADE,
  snapshot      jsonb NOT NULL,
  submitter_id  text,
  device_hash   text,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wifi_entry_revisions_entry_idx ON wifi_entry_revisions (wifi_entry_id, id);

CREATE TABLE votes (
  id            bigserial PRIMARY KEY,
  wifi_entry_id bigint NOT NULL REFERENCES wifi_entries(id) ON DELETE CASCADE,
  device_hash   text NOT NULL,
  ip_hash       text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('works','broken')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wifi_entry_id, device_hash)
);

CREATE TABLE reports (
  id            bigserial PRIMARY KEY,
  wifi_entry_id bigint NOT NULL REFERENCES wifi_entries(id) ON DELETE CASCADE,
  device_hash   text NOT NULL,
  ip_hash       text NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wifi_entry_id, device_hash)
);

CREATE TABLE rate_events (
  id         bigserial PRIMARY KEY,
  ip_hash    text NOT NULL,
  action     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_events_lookup_idx ON rate_events (ip_hash, action, created_at);

-- Supabase exposes the public schema through its REST API. RLS with no policies blocks
-- every role except the table owner (the app's connection), so passwords stay behind the serializer.
ALTER TABLE schema_migrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE places               ENABLE ROW LEVEL SECURITY;
ALTER TABLE wifi_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wifi_entry_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_events          ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Write the database client**

`lib/db.ts`:
```ts
import postgres from "postgres";
import type { Sql as PgSql } from "postgres";

// postgres.js returns bigint columns (bigserial ids, count(*)) as strings by default.
// Ids stay far below 2^53, so numbers are safe and JSON friendly.
const bigintAsNumber = {
  to: 20,
  from: [20],
  serialize: (x: number) => x.toString(),
  parse: (x: string) => Number(x),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = PgSql<any>;

export function createSql(url: string): Sql {
  return postgres(url, {
    max: 5,
    idle_timeout: 10,
    onnotice: () => {},
    // Transaction poolers (Supabase pooler, PgBouncer) need prepared statements off.
    prepare: process.env.DB_PREPARE !== "false",
    types: { bigint: bigintAsNumber },
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __wifiSql: Sql | undefined;
}

/** One shared client per server process (survives hot reload in dev). */
export function getSql(): Sql {
  if (!globalThis.__wifiSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__wifiSql = createSql(url);
  }
  return globalThis.__wifiSql;
}
```

- [ ] **Step 4: Write the migration runner**

`scripts/migrate.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export async function migrate(url: string, dir = path.join(process.cwd(), "db/migrations")): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const done = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      console.log("applied", file);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { config } = await import("dotenv");
  config();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await migrate(url);
  console.log("migrations done");
}
```

- [ ] **Step 5: Write the test harness**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});
```

`tests/setup-env.ts`:
```ts
const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";
if (!new URL(testUrl).pathname.endsWith("_test")) {
  throw new Error(`Refusing to run tests: TEST_DATABASE_URL must name a database ending in _test (got ${testUrl})`);
}
process.env.DATABASE_URL = testUrl;
process.env.ACTOR_SALT = "test-salt";
process.env.EXPOSE_PASSWORDS = "false";
process.env.NEW_ENTRY_STATUS = "active";
process.env.REPORT_HIDE_THRESHOLD = "3";
process.env.REPORT_HIDE_MIN_IPS = "2";
process.env.DB_PREPARE = "true";
process.env.CONTACT_EMAIL = "hello@example.com";
```

`tests/global-setup.ts`:
```ts
import postgres from "postgres";
import { migrate } from "../scripts/migrate";

export default async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";
  const u = new URL(testUrl);
  const dbName = u.pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the name must end in _test`);
  }
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  await migrate(testUrl);
}
```

`tests/helpers/db.ts`:
```ts
import type { Sql } from "@/lib/db";

export const testUrl = process.env.TEST_DATABASE_URL ?? "postgres://wifi:wifi@localhost:54329/wifi_test";

export async function resetDb(sql: Sql): Promise<void> {
  await sql`TRUNCATE rate_events, reports, votes, wifi_entry_revisions, wifi_entries, places RESTART IDENTITY CASCADE`;
}
```

`tests/helpers/factories.ts`:
```ts
import type { Sql } from "@/lib/db";

export async function insertPlace(
  sql: Sql,
  o: Partial<{ name: string; lat: number; lng: number; category: string; source: "osm" | "user"; osm_id: number | null }> = {},
): Promise<number> {
  const { name = "Test Cafe", lat = 41.0086, lng = 28.9795, category = "cafe", source = "osm" } = o;
  const osmId = o.osm_id === undefined ? Math.floor(Math.random() * 1e12) : o.osm_id;
  const osmType = osmId === null ? null : "node";
  const [row] = await sql`
    INSERT INTO places (osm_type, osm_id, name, category, geom, source)
    VALUES (${osmType}, ${osmId}, ${name}, ${category},
            ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography, ${source})
    RETURNING id`;
  return row.id as number;
}

export async function insertEntry(
  sql: Sql,
  placeId: number,
  o: Partial<{
    label: string; access_type: string; steps_text: string; password: string | null;
    password_policy: string; status: string;
  }> = {},
): Promise<number> {
  const {
    label = "Guest", access_type = "password", steps_text = "Ask the staff.",
    password = null, password_policy = "none", status = "active",
  } = o;
  const [row] = await sql`
    INSERT INTO wifi_entries (place_id, label, access_type, steps_text, password, password_policy, status)
    VALUES (${placeId}, ${label}, ${access_type}, ${steps_text}, ${password}, ${password_policy}, ${status})
    RETURNING id`;
  return row.id as number;
}
```

- [ ] **Step 6: Write the failing schema test**

`tests/db/schema.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql, type Sql } from "@/lib/db";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const APP_TABLES = ["schema_migrations", "places", "wifi_entries", "wifi_entry_revisions", "votes", "reports", "rate_events"];

describe("schema", () => {
  it("has PostGIS and all tables", async () => {
    const [{ v }] = await sql`SELECT PostGIS_Version() AS v`;
    expect(v).toBeTruthy();
    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of APP_TABLES) expect(names).toContain(t);
  });

  it("enables row level security on every app table", async () => {
    const rows = await sql`SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname IN ${sql(APP_TABLES)}`;
    expect(rows).toHaveLength(APP_TABLES.length);
    for (const r of rows) expect(r.relrowsecurity).toBe(true);
  });

  it("hides rows from a role that is not the owner, even with SELECT granted", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "secret" });
    await sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN CREATE ROLE rls_probe; END IF; END $$`;
    await sql`GRANT SELECT ON wifi_entries TO rls_probe`;
    const seen = await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as Sql;
      await tx`SET LOCAL ROLE rls_probe`;
      const [{ n }] = await tx`SELECT count(*) AS n FROM wifi_entries`;
      return n as number;
    });
    expect(seen).toBe(0);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(1);
  });

  it("rejects a duplicate OSM place but allows many user places without an OSM id", async () => {
    await insertPlace(sql, { osm_id: 5 });
    await expect(insertPlace(sql, { osm_id: 5 })).rejects.toThrow(/duplicate key/);
    await insertPlace(sql, { osm_id: null, source: "user", name: "U1" });
    await insertPlace(sql, { osm_id: null, source: "user", name: "U2" });
    const [{ n }] = await sql`SELECT count(*) AS n FROM places WHERE osm_id IS NULL`;
    expect(n).toBe(2);
  });

  it("finds a place inside a radius with ST_DWithin", async () => {
    await insertPlace(sql, { name: "Near", lat: 41.0086, lng: 28.9795 });
    await insertPlace(sql, { name: "Far", lat: 36.8841, lng: 30.7056 });
    const rows = await sql`
      SELECT name FROM places
      WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(28.98::float8, 41.01::float8), 4326)::geography, 3000)`;
    expect(rows.map((r) => r.name)).toEqual(["Near"]);
  });

  it("rejects bad values through check constraints", async () => {
    const placeId = await insertPlace(sql);
    await expect(insertEntry(sql, placeId, { access_type: "magic" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { steps_text: "" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { status: "disputed" })).rejects.toThrow(/check constraint/);
    await expect(insertEntry(sql, placeId, { password_policy: "ask_staff" })).rejects.toThrow(/check constraint/);
  });

  it("allows one vote per device per entry", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd1', 'i1', 'works')`;
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd2', 'i1', 'works')`;
    await expect(
      sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES (${entryId}, 'd1', 'i9', 'broken')`,
    ).rejects.toThrow(/duplicate key/);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: the global setup creates `wifi_test`, applies `001_init.sql`, and all 7 tests PASS. A connection error means the container is not running: run `npm run db:up` and retry.

- [ ] **Step 8: Apply the migration to the dev database**

Run: `npm run db:migrate`
Expected: `applied 001_init.sql` then `migrations done`. A second run prints only `migrations done`.

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both pass.

```bash
git add -A
git commit -m "feat(db): schema with PostGIS, row level security, and test harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Validation and the password serializer

**Files:**
- Create: `lib/validation.ts`, `lib/serializers/wifiEntry.ts`
- Test: `tests/lib/validation.test.ts`, `tests/lib/serializer.test.ts`

**Interfaces:**
- Consumes: `lib/types.ts`.
- Produces:
  - zod schemas `entryInputSchema`, `entryEditSchema` (adds `password_clear`), `placeInputSchema`, `nearbyQuerySchema`, `voteKindSchema`, `reportReasonSchema`.
  - Types `EntryInput = z.output<typeof entryInputSchema>`, `EntryEdit = z.output<typeof entryEditSchema>`, `PlaceInput = z.output<typeof placeInputSchema>`.
  - `EntryRow` interface and `serializeEntry(row: EntryRow, opts: { exposePasswords: boolean }): PublicEntry`.

- [ ] **Step 1: Write the failing validation tests**

`tests/lib/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  entryEditSchema, entryInputSchema, nearbyQuerySchema, placeInputSchema, reportReasonSchema, voteKindSchema,
} from "@/lib/validation";

describe("entryInputSchema", () => {
  const ok = { access_type: "password", steps_text: "Ask the staff." };

  it("accepts a minimal entry and fills defaults", () => {
    expect(entryInputSchema.parse(ok)).toMatchObject({
      label: "WiFi", language: "en", password: null, password_is_public: false,
    });
  });

  it("rejects steps that are only spaces", () => {
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "    " }).success).toBe(false);
  });

  it("rejects 501 characters and accepts 500", () => {
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "a".repeat(501) }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...ok, steps_text: "a".repeat(500) }).success).toBe(true);
  });

  it("keeps script text as plain text and keeps Turkish letters", () => {
    expect(entryInputSchema.parse({ ...ok, steps_text: "<script>x</script> Şifre: çay" }).steps_text)
      .toBe("<script>x</script> Şifre: çay");
  });

  it("rejects an unknown access type", () => {
    expect(entryInputSchema.safeParse({ ...ok, access_type: "magic" }).success).toBe(false);
  });

  it("turns an empty password into null and trims a password", () => {
    expect(entryInputSchema.parse({ ...ok, password: "   " }).password).toBeNull();
    expect(entryInputSchema.parse({ ...ok, password: " abc " }).password).toBe("abc");
  });
});

describe("entryEditSchema", () => {
  it("defaults password_clear to false and accepts true", () => {
    const base = { access_type: "open", steps_text: "Open network." };
    expect(entryEditSchema.parse(base).password_clear).toBe(false);
    expect(entryEditSchema.parse({ ...base, password_clear: true }).password_clear).toBe(true);
  });
});

describe("placeInputSchema", () => {
  const ok = { name: "Cafe", category: "cafe", lat: 41, lng: 29 };
  it("accepts a valid place", () => expect(placeInputSchema.safeParse(ok).success).toBe(true));
  it("rejects out-of-range and NaN coordinates", () => {
    expect(placeInputSchema.safeParse({ ...ok, lat: 91 }).success).toBe(false);
    expect(placeInputSchema.safeParse({ ...ok, lng: -181 }).success).toBe(false);
    expect(placeInputSchema.safeParse({ ...ok, lat: Number.NaN }).success).toBe(false);
  });
  it("rejects an empty or whitespace name", () => {
    expect(placeInputSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
  });
});

describe("nearbyQuerySchema", () => {
  it("parses strings and applies defaults", () => {
    expect(nearbyQuerySchema.parse({ lat: "41.01", lng: "28.97" }))
      .toEqual({ lat: 41.01, lng: 28.97, radius_m: 3000, limit: 100 });
  });
  it("rejects missing, empty, non-numeric and out-of-range values", () => {
    for (const bad of [
      { lng: "28" }, { lat: "", lng: "28" }, { lat: "abc", lng: "28" }, { lat: "95", lng: "28" },
      { lat: "41", lng: "28", radius_m: "999999999" }, { lat: "41", lng: "28", radius_m: "-5" },
      { lat: "41", lng: "28", limit: "0" }, { lat: "Infinity", lng: "28" },
    ]) {
      expect(nearbyQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("vote and report schemas", () => {
  it("accepts only works or broken", () => {
    expect(voteKindSchema.safeParse("works").success).toBe(true);
    expect(voteKindSchema.safeParse("meh").success).toBe(false);
  });
  it("defaults the reason and limits its length", () => {
    expect(reportReasonSchema.parse(undefined)).toBe("other");
    expect(reportReasonSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/validation.test.ts`
Expected: FAIL, cannot resolve `@/lib/validation`.

- [ ] **Step 3: Implement validation**

`lib/validation.ts`:
```ts
import { z } from "zod";
import { ACCESS_TYPES, CATEGORIES, LANGUAGES } from "./types";

export const entryInputSchema = z.object({
  label: z.string().trim().max(40).default("").transform((v) => v || "WiFi"),
  access_type: z.enum(ACCESS_TYPES),
  steps_text: z.string().trim().min(1, "Steps are required").max(500),
  language: z.enum(LANGUAGES).default("en"),
  password: z.string().trim().max(64).optional().transform((v) => (v ? v : null)),
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
  name: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type PlaceInput = z.output<typeof placeInputSchema>;

// Query strings arrive as text. An empty string must NOT become 0, so check the text first.
const num = (min: number, max: number) =>
  z.string().min(1).transform(Number).pipe(z.number().min(min).max(max));

export const nearbyQuerySchema = z.object({
  lat: num(-90, 90),
  lng: num(-180, 180),
  radius_m: num(50, 50000).optional().transform((v) => v ?? 3000),
  limit: z.string().min(1).transform(Number).pipe(z.number().int().min(1).max(200))
    .optional().transform((v) => v ?? 100),
});

export const voteKindSchema = z.enum(["works", "broken"]);

export const reportReasonSchema = z.string().trim().max(200).optional().transform((v) => v || "other");
```

- [ ] **Step 4: Run validation tests**

Run: `npx vitest run tests/lib/validation.test.ts`
Expected: all PASS.

- [ ] **Step 5: Write the failing serializer tests**

`tests/lib/serializer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { serializeEntry, type EntryRow } from "@/lib/serializers/wifiEntry";

const base: EntryRow = {
  id: 1, place_id: 9, label: "Guest", access_type: "password", steps_text: "Ask staff.",
  language: "en", password: "s3cret-pw", password_policy: "posted_publicly", status: "active",
  works: 3, broken: 1, last_confirmed_at: new Date("2026-01-02T03:04:05Z"),
};

describe("serializeEntry", () => {
  it("hides the password when exposure is off, anywhere in the JSON", () => {
    const out = serializeEntry(base, { exposePasswords: false });
    expect(out).toMatchObject({ password: null, password_visible: false, has_password: true });
    expect(JSON.stringify(out)).not.toContain("s3cret-pw");
  });

  it("shows the password only for posted_publicly when exposure is on", () => {
    expect(serializeEntry(base, { exposePasswords: true }).password).toBe("s3cret-pw");
    const hidden = serializeEntry({ ...base, password_policy: "none" }, { exposePasswords: true });
    expect(hidden.password).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("s3cret-pw");
  });

  it("reports has_password false when there is no password", () => {
    expect(serializeEntry({ ...base, password: null }, { exposePasswords: true }))
      .toMatchObject({ has_password: false, password_visible: false });
  });

  it("does not leak internal fields and formats the date as ISO text", () => {
    const out = serializeEntry(base, { exposePasswords: true }) as unknown as Record<string, unknown>;
    for (const k of ["password_policy", "status", "place_id"]) expect(out).not.toHaveProperty(k);
    expect(out.last_confirmed_at).toBe("2026-01-02T03:04:05.000Z");
  });
});
```

- [ ] **Step 6: Run to confirm failure**

Run: `npx vitest run tests/lib/serializer.test.ts`
Expected: FAIL, cannot resolve `@/lib/serializers/wifiEntry`.

- [ ] **Step 7: Implement the serializer**

`lib/serializers/wifiEntry.ts`:
```ts
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
```

- [ ] **Step 8: Run, verify, commit**

Run: `npx vitest run tests/lib && npx tsc --noEmit`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: input validation and password serializer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Read repository (nearby and place detail)

**Files:**
- Create: `lib/config.ts`, `lib/repo/places.ts`, `lib/services/read.ts`
- Test: `tests/db/places-repo.test.ts`

**Interfaces:**
- Consumes: `Sql`, `serializeEntry`, `EntryRow`, factories.
- Produces:
  - `config(): Config` where `Config = { exposePasswords: boolean; newEntryStatus: EntryStatus; reportHideThreshold: number; reportHideMinIps: number; actorSalt: string }`.
  - `findNearby(sql: Sql, q: { lat: number; lng: number; radius_m: number; limit: number }): Promise<PlaceSummary[]>`
  - `getPlaceRow(sql: Sql, id: number): Promise<{ id: number; name: string; category: Category; lat: number; lng: number; source: "osm" | "user" } | null>`
  - `listEntryRows(sql: Sql, placeId: number): Promise<EntryRow[]>`
  - `getPlaceDetail(sql: Sql, id: number, opts: { exposePasswords: boolean }): Promise<PlaceDetail | null>`

- [ ] **Step 1: Write the failing tests**

`tests/db/places-repo.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { findNearby, getPlaceRow, listEntryRows } from "@/lib/repo/places";
import { getPlaceDetail } from "@/lib/services/read";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

describe("findNearby", () => {
  it("returns places inside the radius, nearest first, with entry counts", async () => {
    const near = await insertPlace(sql, { name: "Near", lat: 41.0086, lng: 28.9795 });
    const mid = await insertPlace(sql, { name: "Mid", lat: 41.0150, lng: 28.9795 });
    await insertPlace(sql, { name: "Far", lat: 36.8841, lng: 30.7056 });
    await insertEntry(sql, near);
    const rows = await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 3000, limit: 100 });
    expect(rows.map((r) => r.name)).toEqual(["Near", "Mid"]);
    expect(rows[0]).toMatchObject({ id: near, entry_count: 1, category: "cafe" });
    expect(rows[1]).toMatchObject({ id: mid, entry_count: 0 });
    expect(rows[0].distance_m).toBeLessThan(rows[1].distance_m);
    expect(rows[0].lat).toBeCloseTo(41.0086, 4);
    expect(rows[0].lng).toBeCloseTo(28.9795, 4);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) await insertPlace(sql, { name: `P${i}`, lat: 41.0086 + i * 0.001 });
    expect(await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 5000, limit: 2 })).toHaveLength(2);
  });

  it("counts only active entries", async () => {
    const id = await insertPlace(sql);
    await insertEntry(sql, id, { status: "active" });
    await insertEntry(sql, id, { status: "hidden" });
    await insertEntry(sql, id, { status: "pending" });
    const [row] = await findNearby(sql, { lat: 41.0086, lng: 28.9795, radius_m: 500, limit: 10 });
    expect(row.entry_count).toBe(1);
  });
});

describe("place detail", () => {
  it("returns null for an unknown id", async () => {
    expect(await getPlaceRow(sql, 12345)).toBeNull();
    expect(await getPlaceDetail(sql, 12345, { exposePasswords: false })).toBeNull();
  });

  it("lists active entries with vote counts", async () => {
    const placeId = await insertPlace(sql, { name: "Hagia Cafe" });
    const entryId = await insertEntry(sql, placeId, { label: "Guest" });
    await insertEntry(sql, placeId, { label: "Hidden one", status: "hidden" });
    await sql`INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind) VALUES
      (${entryId}, 'a', 'i', 'works'), (${entryId}, 'b', 'i', 'works'), (${entryId}, 'c', 'i', 'broken')`;
    const rows = await listEntryRows(sql, placeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: entryId, works: 2, broken: 1 });
  });

  it("never returns the password when exposure is off", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "topsecret-1", password_policy: "posted_publicly" });
    expect(JSON.stringify(await getPlaceDetail(sql, placeId, { exposePasswords: false }))).not.toContain("topsecret-1");
    const on = await getPlaceDetail(sql, placeId, { exposePasswords: true });
    expect(on?.entries[0].password).toBe("topsecret-1");
    expect(on).toMatchObject({ id: placeId, source: "osm" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/db/places-repo.test.ts`
Expected: FAIL, cannot resolve `@/lib/repo/places`.

- [ ] **Step 3: Implement config**

`lib/config.ts`:
```ts
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
```

- [ ] **Step 4: Implement the repository and read service**

`lib/repo/places.ts`:
```ts
import type { Sql } from "@/lib/db";
import type { EntryRow } from "@/lib/serializers/wifiEntry";
import type { Category, PlaceSummary } from "@/lib/types";

export async function findNearby(
  sql: Sql,
  q: { lat: number; lng: number; radius_m: number; limit: number },
): Promise<PlaceSummary[]> {
  const rows = await sql`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${q.lng}::float8, ${q.lat}::float8), 4326)::geography AS g
    )
    SELECT p.id, p.name, p.category,
           ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
           ST_Distance(p.geom, o.g) AS distance_m,
           (SELECT count(*) FROM wifi_entries e WHERE e.place_id = p.id AND e.status = 'active') AS entry_count
    FROM places p, origin o
    WHERE ST_DWithin(p.geom, o.g, ${q.radius_m}::float8)
    ORDER BY distance_m
    LIMIT ${q.limit}`;
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category, lat: r.lat, lng: r.lng,
    distance_m: r.distance_m, entry_count: r.entry_count,
  })) as PlaceSummary[];
}

export async function getPlaceRow(sql: Sql, id: number) {
  const [row] = await sql`
    SELECT id, name, category, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, source
    FROM places WHERE id = ${id}`;
  if (!row) return null;
  return row as { id: number; name: string; category: Category; lat: number; lng: number; source: "osm" | "user" };
}

/** Active entries only. Its rows go to clients ONLY through serializeEntry. */
export async function listEntryRows(sql: Sql, placeId: number): Promise<EntryRow[]> {
  const rows = await sql`
    SELECT e.id, e.place_id, e.label, e.access_type, e.steps_text, e.language,
           e.password, e.password_policy, e.status,
           (SELECT count(*) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'works') AS works,
           (SELECT count(*) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'broken') AS broken,
           GREATEST(
             e.updated_at,
             COALESCE((SELECT max(v.created_at) FROM votes v WHERE v.wifi_entry_id = e.id AND v.kind = 'works'), e.updated_at)
           ) AS last_confirmed_at
    FROM wifi_entries e
    WHERE e.place_id = ${placeId} AND e.status = 'active'
    ORDER BY e.created_at, e.id`;
  return rows as unknown as EntryRow[];
}
```

`lib/services/read.ts`:
```ts
import type { Sql } from "@/lib/db";
import { getPlaceRow, listEntryRows } from "@/lib/repo/places";
import { serializeEntry } from "@/lib/serializers/wifiEntry";
import type { PlaceDetail } from "@/lib/types";

export async function getPlaceDetail(
  sql: Sql,
  id: number,
  opts: { exposePasswords: boolean },
): Promise<PlaceDetail | null> {
  const place = await getPlaceRow(sql, id);
  if (!place) return null;
  const rows = await listEntryRows(sql, id);
  return { ...place, entries: rows.map((r) => serializeEntry(r, opts)) };
}
```

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run tests/db/places-repo.test.ts && npx tsc --noEmit`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: nearby and place detail queries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Actor identity (IP key, device cookie) and atomic rate limiter

**Files:**
- Create: `lib/errors.ts`, `lib/actor.ts`, `lib/rate-limit.ts`
- Test: `tests/lib/actor.test.ts`, `tests/db/rate-limit.test.ts`

**Interfaces:**
- Consumes: `config()`, `Actor`, `Sql`.
- Produces:
  - `lib/errors.ts`: `RateLimitedError`, `NotFoundError`, `BadJsonError`, `UnsupportedMediaTypeError`, `CrossSiteError` (all extend `Error`).
  - `lib/actor.ts`: `DEVICE_COOKIE = "wnm_device"`, `ipKey(ip: string): string`, `clientIp(req: Request): string`, `readCookie(req: Request, name: string): string | null`, `hashWithSalt(kind: "ip" | "device", value: string, salt: string): string`, `resolveActor(req: Request): { actor: Actor; setCookie: string | null }`.
  - `lib/rate-limit.ts`: `interface Limit`, `type Limits` with keys `submit | edit | create_place | vote | report | geocode`, mutable `LIMITS: Limits`, `consume(sql: Sql, ipHash: string, action: keyof Limits, limit: number, windowSeconds: number): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

`tests/lib/actor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEVICE_COOKIE, hashWithSalt, ipKey, readCookie, resolveActor } from "@/lib/actor";

const req = (headers: Record<string, string> = {}) => new Request("http://x/", { headers });
const GOOD_ID = "A".repeat(43);

describe("ipKey", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:bbbb:cccc:dddd:eeee", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["[2001:db8:1:2::9]", "2001:db8:1:2::/64"],
  ])("%s -> %s", (ip, key) => expect(ipKey(ip)).toBe(key));
});

describe("readCookie", () => {
  it("finds a cookie among others and returns null when missing or malformed", () => {
    expect(readCookie(req({ cookie: `a=1; ${DEVICE_COOKIE}=xyz; b=2` }), DEVICE_COOKIE)).toBe("xyz");
    expect(readCookie(req({ cookie: "a=1" }), DEVICE_COOKIE)).toBeNull();
    expect(readCookie(req({ cookie: `${DEVICE_COOKIE}=%E0%A4%A` }), DEVICE_COOKIE)).toBeNull();
    expect(readCookie(req(), DEVICE_COOKIE)).toBeNull();
  });
});

describe("resolveActor", () => {
  it("creates a device cookie when there is none", () => {
    const { actor, setCookie } = resolveActor(req({ "x-forwarded-for": "9.9.9.9" }));
    expect(setCookie).toMatch(new RegExp(`^${DEVICE_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`));
    expect(actor.userId).toBeNull();
    expect(actor.ipHash).toBe(hashWithSalt("ip", "9.9.9.9", "test-salt"));
  });

  it("reuses a valid cookie and replaces an invalid one", () => {
    const a = resolveActor(req({ cookie: `${DEVICE_COOKIE}=${GOOD_ID}`, "x-forwarded-for": "1.1.1.1" }));
    const b = resolveActor(req({ cookie: `${DEVICE_COOKIE}=${GOOD_ID}`, "x-forwarded-for": "2.2.2.2" }));
    expect(a.setCookie).toBeNull();
    expect(a.actor.deviceHash).toBe(b.actor.deviceHash);
    expect(a.actor.ipHash).not.toBe(b.actor.ipHash);
    expect(resolveActor(req({ cookie: `${DEVICE_COOKIE}=short` })).setCookie).not.toBeNull();
  });

  it("gives two devices on one IP the same ipHash but different deviceHash", () => {
    const one = resolveActor(req({ "x-forwarded-for": "5.5.5.5" })).actor;
    const two = resolveActor(req({ "x-forwarded-for": "5.5.5.5" })).actor;
    expect(one.ipHash).toBe(two.ipHash);
    expect(one.deviceHash).not.toBe(two.deviceHash);
  });

  it("groups IPv6 addresses in the same /64 and never stores the raw IP", () => {
    const a = resolveActor(req({ "x-forwarded-for": "2001:db8:1:2::1" })).actor;
    const b = resolveActor(req({ "x-forwarded-for": "2001:db8:1:2::ffff" })).actor;
    expect(a.ipHash).toBe(b.ipHash);
    expect(a.ipHash).not.toContain("2001");
  });
});
```

`tests/db/rate-limit.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { consume } from "@/lib/rate-limit";
import { resetDb, testUrl } from "../helpers/db";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

describe("consume", () => {
  it("allows up to the limit and then refuses", async () => {
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(true);
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(true);
    expect(await consume(sql, "a", "submit", 2, 3600)).toBe(false);
  });

  it("counts each IP and each action separately", async () => {
    await consume(sql, "a", "submit", 1, 3600);
    expect(await consume(sql, "b", "submit", 1, 3600)).toBe(true);
    expect(await consume(sql, "a", "vote", 1, 3600)).toBe(true);
  });

  it("forgets events older than the window", async () => {
    await sql`INSERT INTO rate_events (ip_hash, action, created_at) VALUES ('a', 'submit', now() - interval '2 hours')`;
    expect(await consume(sql, "a", "submit", 1, 3600)).toBe(true);
  });

  it("does not record a refused attempt", async () => {
    await consume(sql, "a", "submit", 1, 3600);
    await consume(sql, "a", "submit", 1, 3600);
    const [{ n }] = await sql`SELECT count(*) AS n FROM rate_events WHERE ip_hash = 'a'`;
    expect(n).toBe(1);
  });

  it("lets exactly `limit` parallel requests pass", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(sql, "p", "submit", 3, 3600)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/actor.test.ts tests/db/rate-limit.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`lib/errors.ts`:
```ts
export class RateLimitedError extends Error {
  constructor() { super("rate_limited"); this.name = "RateLimitedError"; }
}
export class NotFoundError extends Error {
  constructor() { super("not_found"); this.name = "NotFoundError"; }
}
export class BadJsonError extends Error {
  constructor() { super("invalid_json"); this.name = "BadJsonError"; }
}
export class UnsupportedMediaTypeError extends Error {
  constructor() { super("unsupported_media_type"); this.name = "UnsupportedMediaTypeError"; }
}
export class CrossSiteError extends Error {
  constructor() { super("cross_site"); this.name = "CrossSiteError"; }
}
```

`lib/actor.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import type { Actor } from "./types";

export const DEVICE_COOKIE = "wnm_device";
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function hashWithSalt(kind: "ip" | "device", value: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${kind}|${value}`).digest("hex");
}

/** IPv4 stays as is. IPv6 is grouped by its /64 prefix, because one device can rotate inside a /64. */
export function ipKey(ip: string): string {
  let v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (v.startsWith("::ffff:") && v.includes(".")) v = v.slice(7);
  if (!v.includes(":")) return v;
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = v.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/**
 * First address in x-forwarded-for. On Vercel the platform sets this header and drops client values.
 * Behind any other proxy, confirm that the proxy overwrites it, or clients can choose their own IP.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown";
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Anonymous identity. ipHash is for rate limits. deviceHash counts votes and reports once per browser.
 * When accounts exist, fill userId here from the session.
 */
export function resolveActor(req: Request): { actor: Actor; setCookie: string | null } {
  const salt = config().actorSalt;
  let deviceId = readCookie(req, DEVICE_COOKIE);
  let setCookie: string | null = null;
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    deviceId = randomBytes(32).toString("base64url");
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    setCookie = `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  }
  return {
    actor: {
      ipHash: hashWithSalt("ip", ipKey(clientIp(req)), salt),
      deviceHash: hashWithSalt("device", deviceId, salt),
      userId: null,
    },
    setCookie,
  };
}
```

`lib/rate-limit.ts`:
```ts
import type { Sql } from "./db";

export interface Limit { limit: number; windowSeconds: number }
export type Limits = Record<"submit" | "edit" | "create_place" | "vote" | "report" | "geocode", Limit>;

/**
 * Per IP. Limits are generous because many travelers share one IP at airports, hotels, and on mobile networks.
 * Tests may replace entries in this object and must restore them.
 */
export const LIMITS: Limits = {
  submit: { limit: 30, windowSeconds: 3600 },
  edit: { limit: 30, windowSeconds: 3600 },
  create_place: { limit: 15, windowSeconds: 3600 },
  vote: { limit: 300, windowSeconds: 3600 },
  report: { limit: 30, windowSeconds: 3600 },
  geocode: { limit: 600, windowSeconds: 3600 },
};

/** Returns true and records the event if the IP is under the limit. Returns false otherwise. */
export async function consume(
  sql: Sql,
  ipHash: string,
  action: keyof Limits,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (Math.random() < 0.02) await sql`DELETE FROM rate_events WHERE created_at < now() - interval '1 day'`;
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    // One lock per IP and action, so parallel requests cannot all pass the count check.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${ipHash}|${action}`}))`;
    const [{ n }] = await tx`
      SELECT count(*) AS n FROM rate_events
      WHERE ip_hash = ${ipHash} AND action = ${action}
        AND created_at > now() - (${windowSeconds}::int * interval '1 second')`;
    if ((n as number) >= limit) return false;
    await tx`INSERT INTO rate_events (ip_hash, action) VALUES (${ipHash}, ${action})`;
    return true;
  });
}
```

- [ ] **Step 4: Run, verify, commit**

Run: `npx vitest run tests/lib/actor.test.ts tests/db/rate-limit.test.ts && npx tsc --noEmit`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: anonymous device identity, IPv6-aware IP key, atomic rate limiter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Submission service (all user writes, including edits)

**Files:**
- Create: `lib/services/guard.ts`, `lib/services/submission.ts`
- Test: `tests/db/submission.test.ts`

**Interfaces:**
- Consumes: `Sql`, `Config`/`config()`, schemas from Task 3, `consume`/`LIMITS`/`Limits`, errors, `Actor`, `PasswordPolicy`.
- Produces:
  - `lib/services/guard.ts`: `type WriteAction = "submit_entry" | "edit_entry" | "create_place" | "vote" | "report"`; `interface Guard { authorize(actor: Actor, action: WriteAction): void | Promise<void> }`; `anonymousGuard: Guard`.
  - `lib/services/submission.ts`: `createSubmissionService(deps: { sql: Sql; guard: Guard; cfg?: Config; limits?: Limits })` returning:
    - `submitEntry(actor, placeId: number, raw: unknown): Promise<{ ignored: true } | { ignored: false; entry_id: number }>`
    - `editEntry(actor, entryId: number, raw: unknown): Promise<{ ignored: true } | { ignored: false; entry_id: number }>`
    - `createPlace(actor, rawPlace: unknown, rawEntry: unknown): Promise<{ ignored: true } | { ignored: false; place_id: number; entry_id: number }>`
    - `castVote(actor, entryId: number, rawKind: unknown): Promise<{ works: number; broken: number }>`
    - `reportEntry(actor, entryId: number, rawReason: unknown): Promise<{ hidden: boolean }>`
  - `type SubmissionService`. Throws `ZodError`, `RateLimitedError`, `NotFoundError`.

- [ ] **Step 1: Write the failing tests**

`tests/db/submission.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { config } from "@/lib/config";
import { createSql } from "@/lib/db";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { LIMITS } from "@/lib/rate-limit";
import { anonymousGuard, type Guard } from "@/lib/services/guard";
import { createSubmissionService } from "@/lib/services/submission";
import type { Actor } from "@/lib/types";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const svc = () => createSubmissionService({ sql, guard: anonymousGuard });
const actor = (device = "dev-1", ip = "ip-1"): Actor => ({ ipHash: ip, deviceHash: device, userId: null });
const entry = { access_type: "password", steps_text: "Ask the staff.", label: "Guest" };
const tight = (key: keyof typeof LIMITS, limit: number) =>
  createSubmissionService({ sql, guard: anonymousGuard, limits: { ...LIMITS, [key]: { limit, windowSeconds: 3600 } } });

describe("submitEntry", () => {
  it("creates an entry and a revision row with a null submitter", async () => {
    const placeId = await insertPlace(sql);
    const r = await svc().submitEntry(actor(), placeId, { ...entry, password: "abc", password_is_public: true });
    expect(r.ignored).toBe(false);
    const [e] = await sql`SELECT * FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e).toMatchObject({ label: "Guest", status: "active", password: "abc", password_policy: "posted_publicly", submitter_id: null });
    const revs = await sql`SELECT snapshot, device_hash, ip_hash FROM wifi_entry_revisions WHERE wifi_entry_id = ${e.id}`;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ device_hash: "dev-1", ip_hash: "ip-1" });
    expect(revs[0].snapshot.steps_text).toBe("Ask the staff.");
  });

  it("keeps a password private when the submitter does not say it is public", async () => {
    const placeId = await insertPlace(sql);
    await svc().submitEntry(actor(), placeId, { ...entry, password: "abc" });
    const [e] = await sql`SELECT password_policy FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.password_policy).toBe("none");
  });

  it("uses the configured status for new entries", async () => {
    const placeId = await insertPlace(sql);
    const s = createSubmissionService({ sql, guard: anonymousGuard, cfg: { ...config(), newEntryStatus: "pending" } });
    await s.submitEntry(actor(), placeId, entry);
    const [e] = await sql`SELECT status FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.status).toBe("pending");
  });

  it("rejects bad input without using up the rate limit", async () => {
    const placeId = await insertPlace(sql);
    const s = tight("submit", 1);
    await expect(s.submitEntry(actor(), placeId, { ...entry, steps_text: "   " })).rejects.toBeInstanceOf(ZodError);
    await expect(s.submitEntry(actor(), placeId, { ...entry, steps_text: "a".repeat(501) })).rejects.toBeInstanceOf(ZodError);
    await expect(s.submitEntry(actor(), placeId, entry)).resolves.toMatchObject({ ignored: false });
  });

  it("stores script text as plain text", async () => {
    const placeId = await insertPlace(sql);
    await svc().submitEntry(actor(), placeId, { ...entry, steps_text: "<script>alert(1)</script>" });
    const [e] = await sql`SELECT steps_text FROM wifi_entries WHERE place_id = ${placeId}`;
    expect(e.steps_text).toBe("<script>alert(1)</script>");
  });

  it("silently ignores a filled honeypot and writes nothing", async () => {
    const placeId = await insertPlace(sql);
    expect(await svc().submitEntry(actor(), placeId, { ...entry, website: "http://spam" })).toEqual({ ignored: true });
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(0);
  });

  it("throws NotFoundError for an unknown place", async () => {
    await expect(svc().submitEntry(actor(), 9999, entry)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("limits per IP, not per device", async () => {
    const placeId = await insertPlace(sql);
    const s = tight("submit", 2);
    await s.submitEntry(actor("d1", "same-ip"), placeId, entry);
    await s.submitEntry(actor("d2", "same-ip"), placeId, entry);
    await expect(s.submitEntry(actor("d3", "same-ip"), placeId, entry)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(s.submitEntry(actor("d3", "other-ip"), placeId, entry)).resolves.toMatchObject({ ignored: false });
  });

  it("calls the guard first, and a refusing guard blocks the write", async () => {
    const placeId = await insertPlace(sql);
    const calls: string[] = [];
    const guard: Guard = { authorize: (_a, action) => { calls.push(action); throw new Error("sign in required"); } };
    await expect(createSubmissionService({ sql, guard }).submitEntry(actor(), placeId, entry)).rejects.toThrow("sign in required");
    expect(calls).toEqual(["submit_entry"]);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries`;
    expect(n).toBe(0);
  });
});

describe("editEntry", () => {
  async function created(extra: Record<string, unknown> = {}) {
    const placeId = await insertPlace(sql);
    const r = await svc().submitEntry(actor(), placeId, { ...entry, ...extra });
    if (r.ignored) throw new Error("unexpected");
    return r.entry_id;
  }

  it("updates the content and writes a second revision with the editor's hashes", async () => {
    const id = await created();
    await svc().editEntry(actor("editor-dev", "editor-ip"), id, { access_type: "open", steps_text: "Open now.", label: "Free" });
    const [e] = await sql`SELECT label, access_type, steps_text, submitter_id, updated_at > created_at AS moved FROM wifi_entries WHERE id = ${id}`;
    expect(e).toMatchObject({ label: "Free", access_type: "open", steps_text: "Open now.", submitter_id: null, moved: true });
    const revs = await sql`SELECT snapshot, device_hash FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id`;
    expect(revs).toHaveLength(2);
    expect(revs[1]).toMatchObject({ device_hash: "editor-dev" });
    expect(revs[1].snapshot.steps_text).toBe("Open now.");
  });

  it("keeps the stored password when the edit sends no password", async () => {
    const id = await created({ password: "keep-me", password_is_public: true });
    await svc().editEntry(actor(), id, { ...entry, steps_text: "New steps." });
    const [e] = await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`;
    expect(e).toMatchObject({ password: "keep-me", password_policy: "posted_publicly" });
  });

  it("replaces the password when a new one is sent, and removes it with password_clear", async () => {
    const id = await created({ password: "old" });
    await svc().editEntry(actor(), id, { ...entry, password: "new", password_is_public: true });
    expect((await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`)[0])
      .toMatchObject({ password: "new", password_policy: "posted_publicly" });
    await svc().editEntry(actor(), id, { ...entry, password_clear: true });
    expect((await sql`SELECT password, password_policy FROM wifi_entries WHERE id = ${id}`)[0])
      .toMatchObject({ password: null, password_policy: "none" });
  });

  it("refuses unknown and hidden entries and writes no revision", async () => {
    const placeId = await insertPlace(sql);
    const hiddenId = await insertEntry(sql, placeId, { status: "hidden" });
    await expect(svc().editEntry(actor(), 9999, entry)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().editEntry(actor(), hiddenId, entry)).rejects.toBeInstanceOf(NotFoundError);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entry_revisions`;
    expect(n).toBe(0);
  });

  it("validates input, honors the honeypot, and passes edit_entry to the guard", async () => {
    const id = await created();
    await expect(svc().editEntry(actor(), id, { ...entry, steps_text: " " })).rejects.toBeInstanceOf(ZodError);
    expect(await svc().editEntry(actor(), id, { ...entry, website: "x" })).toEqual({ ignored: true });
    const calls: string[] = [];
    const guard: Guard = { authorize: (_a, action) => { calls.push(action); } };
    await createSubmissionService({ sql, guard }).editEntry(actor(), id, entry);
    expect(calls).toEqual(["edit_entry"]);
  });
});

describe("createPlace", () => {
  const place = { name: "New Cafe", category: "cafe", lat: 41.02, lng: 28.97 };

  it("creates a user place with its first entry in one step", async () => {
    const r = await svc().createPlace(actor(), place, entry);
    if (r.ignored) throw new Error("should not be ignored");
    const [p] = await sql`SELECT name, source, osm_id, ST_Y(geom::geometry) AS lat FROM places WHERE id = ${r.place_id}`;
    expect(p).toMatchObject({ name: "New Cafe", source: "user", osm_id: null });
    expect(p.lat).toBeCloseTo(41.02, 5);
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries WHERE place_id = ${r.place_id}`;
    expect(n).toBe(1);
  });

  it("creates nothing when the entry is invalid", async () => {
    await expect(svc().createPlace(actor(), place, { ...entry, steps_text: "" })).rejects.toBeInstanceOf(ZodError);
    const [{ n }] = await sql`SELECT count(*) AS n FROM places`;
    expect(n).toBe(0);
  });

  it("ignores a filled honeypot", async () => {
    expect(await svc().createPlace(actor(), place, { ...entry, website: "x" })).toEqual({ ignored: true });
  });
});

describe("castVote", () => {
  it("counts one vote per device, lets the device change it, and counts two devices on one IP", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    expect(await svc().castVote(actor("a", "ip"), entryId, "works")).toEqual({ works: 1, broken: 0 });
    expect(await svc().castVote(actor("a", "ip"), entryId, "works")).toEqual({ works: 1, broken: 0 });
    expect(await svc().castVote(actor("a", "ip"), entryId, "broken")).toEqual({ works: 0, broken: 1 });
    expect(await svc().castVote(actor("b", "ip"), entryId, "works")).toEqual({ works: 1, broken: 1 });
  });

  it("rejects an unknown kind and an unknown or hidden entry", async () => {
    const placeId = await insertPlace(sql);
    const entryId = await insertEntry(sql, placeId);
    const hiddenId = await insertEntry(sql, placeId, { status: "hidden" });
    await expect(svc().castVote(actor(), entryId, "meh")).rejects.toBeInstanceOf(ZodError);
    await expect(svc().castVote(actor(), 9999, "works")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().castVote(actor(), hiddenId, "works")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reportEntry", () => {
  const status = async (id: number) => (await sql`SELECT status FROM wifi_entries WHERE id = ${id}`)[0].status;

  it("counts one report per device", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    for (let i = 0; i < 5; i++) await svc().reportEntry(actor("same", "ip-1"), id, "spam");
    expect(await status(id)).toBe("active");
    const [{ n }] = await sql`SELECT count(*) AS n FROM reports WHERE wifi_entry_id = ${id}`;
    expect(n).toBe(1);
  });

  it("does not hide when all reporting devices share one IP", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    for (const d of ["a", "b", "c", "d"]) await svc().reportEntry(actor(d, "airport-ip"), id, "wrong");
    expect(await status(id)).toBe("active");
  });

  it("hides when enough devices from at least two IPs report", async () => {
    const id = await insertEntry(sql, await insertPlace(sql));
    expect(await svc().reportEntry(actor("a", "ip-1"), id, "wrong")).toEqual({ hidden: false });
    expect(await svc().reportEntry(actor("b", "ip-1"), id, "wrong")).toEqual({ hidden: false });
    expect(await svc().reportEntry(actor("c", "ip-2"), id, "wrong")).toEqual({ hidden: true });
    expect(await status(id)).toBe("hidden");
  });

  it("throws NotFoundError for an unknown entry", async () => {
    await expect(svc().reportEntry(actor(), 9999, "x")).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/db/submission.test.ts`
Expected: FAIL, cannot resolve `@/lib/services/guard`.

- [ ] **Step 3: Implement the guard**

`lib/services/guard.ts`:
```ts
import type { Actor } from "@/lib/types";

export type WriteAction = "submit_entry" | "edit_entry" | "create_place" | "vote" | "report";

/**
 * The future guard point. Every user write calls authorize() first.
 * To require sign-in or roles later, change the Guard in lib/services/index.ts. Throw to refuse.
 */
export interface Guard {
  authorize(actor: Actor, action: WriteAction): void | Promise<void>;
}

/** Today everyone may write. Rate limits still apply. */
export const anonymousGuard: Guard = {
  authorize() {},
};
```

- [ ] **Step 4: Implement the service**

`lib/services/submission.ts`:
```ts
import { config, type Config } from "@/lib/config";
import type { Sql } from "@/lib/db";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { consume, LIMITS, type Limits } from "@/lib/rate-limit";
import type { AccessType, Actor, EntryStatus, Language, PasswordPolicy } from "@/lib/types";
import {
  entryEditSchema, entryInputSchema, placeInputSchema, reportReasonSchema, voteKindSchema, type EntryInput,
} from "@/lib/validation";
import type { Guard } from "./guard";

interface Deps {
  sql: Sql;
  guard: Guard;
  cfg?: Config;
  limits?: Limits;
}

interface Content {
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password: string | null;
  password_policy: PasswordPolicy;
}

export function createSubmissionService(deps: Deps) {
  const { sql, guard } = deps;
  const cfg = deps.cfg ?? config();
  const limits = deps.limits ?? LIMITS;

  async function limit(actor: Actor, action: keyof Limits): Promise<void> {
    const l = limits[action];
    if (!(await consume(sql, actor.ipHash, action, l.limit, l.windowSeconds))) throw new RateLimitedError();
  }

  async function writeRevision(tx: Sql, entryId: number, c: Content, actor: Actor): Promise<void> {
    await tx`
      INSERT INTO wifi_entry_revisions (wifi_entry_id, snapshot, submitter_id, device_hash, ip_hash)
      VALUES (${entryId}, ${JSON.stringify(c)}::text::jsonb, ${actor.userId}, ${actor.deviceHash}, ${actor.ipHash})`;
  }

  async function insertEntry(tx: Sql, placeId: number, e: EntryInput, actor: Actor, status: EntryStatus): Promise<number> {
    const c: Content = {
      label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language,
      password: e.password, password_policy: e.password && e.password_is_public ? "posted_publicly" : "none",
    };
    const [row] = await tx`
      INSERT INTO wifi_entries
        (place_id, label, access_type, steps_text, language, password, password_policy, status, submitter_id)
      VALUES
        (${placeId}, ${c.label}, ${c.access_type}, ${c.steps_text}, ${c.language}, ${c.password}, ${c.password_policy}, ${status}, ${actor.userId})
      RETURNING id`;
    await writeRevision(tx, row.id as number, c, actor);
    return row.id as number;
  }

  async function activeEntryExists(entryId: number): Promise<boolean> {
    return (await sql`SELECT 1 FROM wifi_entries WHERE id = ${entryId} AND status = 'active'`).length > 0;
  }

  return {
    async submitEntry(actor: Actor, placeId: number, raw: unknown) {
      await guard.authorize(actor, "submit_entry");
      const e = entryInputSchema.parse(raw);
      if (e.website) return { ignored: true as const };
      await limit(actor, "submit");
      if ((await sql`SELECT 1 FROM places WHERE id = ${placeId}`).length === 0) throw new NotFoundError();
      const entryId = await sql.begin((tx) => insertEntry(tx as unknown as Sql, placeId, e, actor, cfg.newEntryStatus));
      return { ignored: false as const, entry_id: entryId };
    },

    async editEntry(actor: Actor, entryId: number, raw: unknown) {
      await guard.authorize(actor, "edit_entry");
      const e = entryEditSchema.parse(raw);
      if (e.website) return { ignored: true as const };
      await limit(actor, "edit");
      await sql.begin(async (tx0) => {
        const tx = tx0 as unknown as Sql;
        const [cur] = await tx`
          SELECT password, password_policy FROM wifi_entries WHERE id = ${entryId} AND status = 'active' FOR UPDATE`;
        if (!cur) throw new NotFoundError();
        let password: string | null = cur.password;
        let policy: PasswordPolicy = cur.password_policy;
        if (e.password_clear) {
          password = null;
          policy = "none";
        } else if (e.password) {
          password = e.password;
          policy = e.password_is_public ? "posted_publicly" : "none";
        }
        const c: Content = {
          label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language,
          password, password_policy: policy,
        };
        await tx`
          UPDATE wifi_entries
          SET label = ${c.label}, access_type = ${c.access_type}, steps_text = ${c.steps_text},
              language = ${c.language}, password = ${c.password}, password_policy = ${c.password_policy},
              updated_at = clock_timestamp()
          WHERE id = ${entryId}`;
        await writeRevision(tx, entryId, c, actor);
      });
      return { ignored: false as const, entry_id: entryId };
    },

    async createPlace(actor: Actor, rawPlace: unknown, rawEntry: unknown) {
      await guard.authorize(actor, "create_place");
      const p = placeInputSchema.parse(rawPlace);
      const e = entryInputSchema.parse(rawEntry);
      if (e.website) return { ignored: true as const };
      await limit(actor, "create_place");
      return sql.begin(async (tx0) => {
        const tx = tx0 as unknown as Sql;
        const [row] = await tx`
          INSERT INTO places (name, category, geom, source)
          VALUES (${p.name}, ${p.category},
                  ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326)::geography, 'user')
          RETURNING id`;
        const entryId = await insertEntry(tx, row.id as number, e, actor, cfg.newEntryStatus);
        return { ignored: false as const, place_id: row.id as number, entry_id: entryId };
      });
    },

    async castVote(actor: Actor, entryId: number, rawKind: unknown) {
      await guard.authorize(actor, "vote");
      const kind = voteKindSchema.parse(rawKind);
      await limit(actor, "vote");
      if (!(await activeEntryExists(entryId))) throw new NotFoundError();
      await sql`
        INSERT INTO votes (wifi_entry_id, device_hash, ip_hash, kind)
        VALUES (${entryId}, ${actor.deviceHash}, ${actor.ipHash}, ${kind})
        ON CONFLICT (wifi_entry_id, device_hash)
        DO UPDATE SET kind = EXCLUDED.kind, ip_hash = EXCLUDED.ip_hash, created_at = now()`;
      const [c] = await sql`
        SELECT count(*) FILTER (WHERE kind = 'works') AS works, count(*) FILTER (WHERE kind = 'broken') AS broken
        FROM votes WHERE wifi_entry_id = ${entryId}`;
      return { works: c.works as number, broken: c.broken as number };
    },

    async reportEntry(actor: Actor, entryId: number, rawReason: unknown) {
      await guard.authorize(actor, "report");
      const reason = reportReasonSchema.parse(rawReason);
      await limit(actor, "report");
      if (!(await activeEntryExists(entryId))) throw new NotFoundError();
      await sql`
        INSERT INTO reports (wifi_entry_id, device_hash, ip_hash, reason)
        VALUES (${entryId}, ${actor.deviceHash}, ${actor.ipHash}, ${reason})
        ON CONFLICT (wifi_entry_id, device_hash) DO NOTHING`;
      const [{ devices, ips }] = await sql`
        SELECT count(DISTINCT device_hash) AS devices, count(DISTINCT ip_hash) AS ips
        FROM reports WHERE wifi_entry_id = ${entryId}`;
      const hide = (devices as number) >= cfg.reportHideThreshold && (ips as number) >= cfg.reportHideMinIps;
      if (hide) {
        await sql`UPDATE wifi_entries SET status = 'hidden', updated_at = now() WHERE id = ${entryId} AND status = 'active'`;
      }
      return { hidden: hide };
    },
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;
```

Note: the edit uses `clock_timestamp()` so `updated_at` is later than `created_at` even inside one test transaction. `now()` would return the transaction start time.

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run tests/db/submission.test.ts && npx tsc --noEmit`
Expected: all PASS. Keep the `as unknown as Sql` casts on transaction handles: postgres.js transaction types differ slightly from `Sql`.

```bash
git add -A
git commit -m "feat: submission service with edits, device-based votes and reports, and guard hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: HTTP helpers and API routes

**Files:**
- Create: `lib/http.ts`, `lib/services/index.ts`, `app/api/places/nearby/route.ts`, `app/api/places/route.ts`, `app/api/places/[id]/route.ts`, `app/api/places/[id]/entries/route.ts`, `app/api/entries/[id]/route.ts`, `app/api/entries/[id]/vote/route.ts`, `app/api/entries/[id]/report/route.ts`
- Test: `tests/api/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 to 6.
- Produces:
  - `lib/http.ts`: `json(data, status?, headers?)`, `handleError(e)`, `readJson(req)`, `parseId(raw)`, `assertSameOriginJson(req)`, `withCookie(res, setCookie)`.
  - `lib/services/index.ts`: `submissionService(): SubmissionService`.
  - HTTP:
    - `GET /api/places/nearby?lat&lng&radius_m&limit` -> `200 { places }`
    - `GET /api/places/:id` -> `200 PlaceDetail` | `404`
    - `POST /api/places` body `{ place, entry }` -> `201 { place_id, entry_id }` | `202 { ignored: true }`
    - `POST /api/places/:id/entries` body = entry -> `201 { entry_id }`
    - `PATCH /api/entries/:id` body = entry edit -> `200 { entry_id }`
    - `POST /api/entries/:id/vote` body `{ kind }` -> `200 { works, broken }`
    - `POST /api/entries/:id/report` body `{ reason? }` -> `200 { hidden }`
    - Errors: `400 invalid_input | invalid_json`, `403 cross_site`, `404 not_found`, `415 unsupported_media_type`, `429 rate_limited`, `500 server_error`.
    - Write responses set the `wnm_device` cookie when the request had none.

- [ ] **Step 1: Write the failing route tests**

`tests/api/routes.test.ts`:
```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchEntry } from "@/app/api/entries/[id]/route";
import { POST as postReport } from "@/app/api/entries/[id]/report/route";
import { POST as postVote } from "@/app/api/entries/[id]/vote/route";
import { POST as postEntry } from "@/app/api/places/[id]/entries/route";
import { GET as getPlace } from "@/app/api/places/[id]/route";
import { GET as getNearby } from "@/app/api/places/nearby/route";
import { POST as postPlace } from "@/app/api/places/route";
import { getSql } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { resetDb } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = getSql();
const savedSubmit = { ...LIMITS.submit };
afterAll(() => sql.end());
beforeEach(async () => {
  await resetDb(sql);
  process.env.EXPOSE_PASSWORDS = "false";
});
afterEach(() => { LIMITS.submit = { ...savedSubmit }; });

const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const DEV_A = "a".repeat(43);
const DEV_B = "b".repeat(43);
function write(body: unknown, o: { ip?: string; device?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? "1.1.1.1", ...o.headers };
  if (o.device) headers.cookie = `wnm_device=${o.device}`;
  return new Request("http://x/api", { method: o.method ?? "POST", headers, body: JSON.stringify(body) });
}
const entry = { access_type: "password", steps_text: "Ask the staff.", label: "Guest" };
const get = (id: number | string) => getPlace(new Request("http://x"), ctx(id));

describe("GET /api/places/nearby", () => {
  it("returns places near a point", async () => {
    await insertPlace(sql, { name: "Near" });
    const res = await getNearby(new Request("http://x/api/places/nearby?lat=41.0086&lng=28.9795&radius_m=1000"));
    expect(res.status).toBe(200);
    expect((await res.json()).places.map((p: { name: string }) => p.name)).toEqual(["Near"]);
  });

  it.each([
    ["missing lat", "lng=28"], ["empty lat", "lat=&lng=28"], ["text lat", "lat=abc&lng=28"],
    ["lat out of range", "lat=95&lng=28"], ["huge radius", "lat=41&lng=28&radius_m=999999999"],
    ["negative radius", "lat=41&lng=28&radius_m=-1"],
  ])("returns 400 for %s", async (_name, qs) => {
    const res = await getNearby(new Request(`http://x/api/places/nearby?${qs}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });
});

describe("GET /api/places/:id", () => {
  it("returns 404 for unknown and bad ids", async () => {
    for (const id of [999, "abc", "-4", "1.5"]) expect((await get(id)).status).toBe(404);
  });

  it("does not leak a password unless exposure is on and the policy allows it", async () => {
    const placeId = await insertPlace(sql);
    await insertEntry(sql, placeId, { password: "leak-test-pw", password_policy: "posted_publicly" });
    await insertEntry(sql, placeId, { password: "private-pw", password_policy: "none" });
    expect(await (await get(placeId)).text()).not.toContain("leak-test-pw");
    process.env.EXPOSE_PASSWORDS = "true";
    const text = await (await get(placeId)).text();
    expect(text).toContain("leak-test-pw");
    expect(text).not.toContain("private-pw");
  });
});

describe("same-origin JSON check", () => {
  it("refuses a write without a JSON content type", async () => {
    const placeId = await insertPlace(sql);
    const req = new Request("http://x/api", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(entry) });
    expect((await postEntry(req, ctx(placeId))).status).toBe(415);
  });

  it("refuses a foreign Origin and sec-fetch-site cross-site, and writes nothing", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    expect((await postReport(write({}, { headers: { origin: "https://evil.example" } }), ctx(entryId))).status).toBe(403);
    expect((await postReport(write({}, { headers: { "sec-fetch-site": "cross-site" } }), ctx(entryId))).status).toBe(403);
    const [{ n }] = await sql`SELECT count(*) AS n FROM reports`;
    expect(n).toBe(0);
  });

  it("accepts a same-origin request", async () => {
    const placeId = await insertPlace(sql);
    expect((await postEntry(write(entry, { headers: { origin: "http://x" } }), ctx(placeId))).status).toBe(201);
  });
});

describe("write routes", () => {
  it("creates an entry, sets the device cookie, and shows the entry in the detail", async () => {
    const placeId = await insertPlace(sql);
    const res = await postEntry(write(entry), ctx(placeId));
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/^wnm_device=/);
    expect((await postEntry(write(entry, { device: DEV_A }), ctx(placeId))).headers.get("set-cookie")).toBeNull();
    const detail = await (await get(placeId)).json();
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0]).toMatchObject({ label: "Guest", access_type: "password" });
  });

  it("returns 400 for invalid JSON and invalid input, and 404 for an unknown place", async () => {
    const placeId = await insertPlace(sql);
    const bad = new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect((await postEntry(bad, ctx(placeId))).status).toBe(400);
    const res = await postEntry(write({ ...entry, steps_text: " " }), ctx(placeId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect((await postEntry(write(entry), ctx(999))).status).toBe(404);
  });

  it("edits an entry with PATCH", async () => {
    const placeId = await insertPlace(sql);
    const { entry_id } = await (await postEntry(write(entry), ctx(placeId))).json();
    const res = await patchEntry(write({ ...entry, steps_text: "Updated steps." }, { method: "PATCH" }), ctx(entry_id));
    expect(res.status).toBe(200);
    expect((await (await get(placeId)).json()).entries[0].steps_text).toBe("Updated steps.");
  });

  it("creates a new place with its first entry", async () => {
    const res = await postPlace(write({ place: { name: "Cafe X", category: "cafe", lat: 41.02, lng: 28.97 }, entry }));
    expect(res.status).toBe(201);
    const { place_id } = await res.json();
    expect(await (await get(place_id)).json()).toMatchObject({ name: "Cafe X", source: "user" });
  });

  it("returns 202 for a filled honeypot", async () => {
    const placeId = await insertPlace(sql);
    expect((await postEntry(write({ ...entry, website: "spam" }), ctx(placeId))).status).toBe(202);
  });

  it("counts votes from two devices on the same IP", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    await postVote(write({ kind: "works" }, { device: DEV_A, ip: "8.8.8.8" }), ctx(entryId));
    const res = await postVote(write({ kind: "works" }, { device: DEV_B, ip: "8.8.8.8" }), ctx(entryId));
    expect(await res.json()).toEqual({ works: 2, broken: 0 });
    expect((await postVote(write({ kind: "meh" }), ctx(entryId))).status).toBe(400);
  });

  it("reports an entry", async () => {
    const entryId = await insertEntry(sql, await insertPlace(sql));
    const r = await postReport(write({ reason: "spam" }), ctx(entryId));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hidden: false });
  });

  it("returns 429 when the IP reaches the limit", async () => {
    LIMITS.submit = { limit: 2, windowSeconds: 3600 };
    const placeId = await insertPlace(sql);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await postEntry(write(entry, { ip: "7.7.7.7" }), ctx(placeId))).status);
    expect(statuses).toEqual([201, 201, 429]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/api/routes.test.ts`
Expected: FAIL, route modules not found.

- [ ] **Step 3: Implement the HTTP helpers and service wiring**

`lib/http.ts`:
```ts
import { ZodError } from "zod";
import {
  BadJsonError, CrossSiteError, NotFoundError, RateLimitedError, UnsupportedMediaTypeError,
} from "./errors";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function handleError(e: unknown): Response {
  if (e instanceof ZodError) {
    return json(
      { error: "invalid_input", issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) },
      400,
    );
  }
  if (e instanceof BadJsonError) return json({ error: "invalid_json" }, 400);
  if (e instanceof UnsupportedMediaTypeError) return json({ error: "unsupported_media_type" }, 415);
  if (e instanceof CrossSiteError) return json({ error: "cross_site" }, 403);
  if (e instanceof RateLimitedError) return json({ error: "rate_limited" }, 429, { "retry-after": "3600" });
  if (e instanceof NotFoundError) return json({ error: "not_found" }, 404);
  console.error(e);
  return json({ error: "server_error" }, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadJsonError();
  }
}

/** Parses a path id. Returns null unless it is a positive integer. */
export function parseId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/**
 * Blocks cross-site writes. A JSON content type forces a CORS preflight, which this app never allows.
 * Origin and sec-fetch-site catch the rest.
 */
export function assertSameOriginJson(req: Request): void {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new UnsupportedMediaTypeError();
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new CrossSiteError();
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) throw new CrossSiteError();
  }
}

export function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("set-cookie", setCookie);
  return res;
}
```

`lib/services/index.ts`:
```ts
import { getSql } from "@/lib/db";
import { anonymousGuard } from "./guard";
import { createSubmissionService } from "./submission";

/** To require sign-in later, replace anonymousGuard here. */
export function submissionService() {
  return createSubmissionService({ sql: getSql(), guard: anonymousGuard });
}
```

- [ ] **Step 4: Implement the routes**

`app/api/places/nearby/route.ts`:
```ts
import { getSql } from "@/lib/db";
import { handleError, json } from "@/lib/http";
import { findNearby } from "@/lib/repo/places";
import { nearbyQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = nearbyQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return json({ places: await findNearby(getSql(), q) });
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/places/[id]/route.ts`:
```ts
import { config } from "@/lib/config";
import { getSql } from "@/lib/db";
import { handleError, json, parseId } from "@/lib/http";
import { getPlaceDetail } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const detail = await getPlaceDetail(getSql(), id, { exposePasswords: config().exposePasswords });
    return detail ? json(detail) : json({ error: "not_found" }, 404);
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/places/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOriginJson(req);
    const { actor, setCookie } = resolveActor(req);
    const body = (await readJson(req)) as { place?: unknown; entry?: unknown } | null;
    const r = await submissionService().createPlace(actor, body?.place, body?.entry);
    const res = r.ignored ? json({ ignored: true }, 202) : json({ place_id: r.place_id, entry_id: r.entry_id }, 201);
    return withCookie(res, setCookie);
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/places/[id]/entries/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const r = await submissionService().submitEntry(actor, id, await readJson(req));
    return withCookie(r.ignored ? json({ ignored: true }, 202) : json({ entry_id: r.entry_id }, 201), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/entries/[id]/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const r = await submissionService().editEntry(actor, id, await readJson(req));
    return withCookie(r.ignored ? json({ ignored: true }, 202) : json({ entry_id: r.entry_id }), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/entries/[id]/vote/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const body = (await readJson(req)) as { kind?: unknown } | null;
    return withCookie(json(await submissionService().castVote(actor, id, body?.kind)), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
```

`app/api/entries/[id]/report/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { assertSameOriginJson, handleError, json, parseId, readJson, withCookie } from "@/lib/http";
import { submissionService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginJson(req);
    const id = parseId((await ctx.params).id);
    if (id === null) return json({ error: "not_found" }, 404);
    const { actor, setCookie } = resolveActor(req);
    const body = (await readJson(req)) as { reason?: unknown } | null;
    return withCookie(json(await submissionService().reportEntry(actor, id, body?.reason)), setCookie);
  } catch (e) {
    return handleError(e);
  }
}
```

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run tests/api/routes.test.ts && npx tsc --noEmit && npm run build`
Expected: all pass. The build route table lists the 7 API routes.

```bash
git add -A
git commit -m "feat(api): read and write routes with same-origin check and device cookie" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: OpenStreetMap import

**Files:**
- Create: `lib/osm.ts`, `scripts/import-osm.ts`, `scripts/overpass/istanbul.overpassql`
- Test: `tests/lib/osm.test.ts`, `tests/db/import-osm.test.ts`

**Interfaces:**
- Consumes: `Sql`, `Category`.
- Produces:
  - `type PlaceSeed = { osm_type: "node" | "way" | "relation"; osm_id: number; name: string; category: Category; lat: number; lng: number; country_code?: string | null }`
  - `categoryFor(tags: Record<string, string>): Category | null`
  - `parseOverpass(json: unknown): PlaceSeed[]` (skips elements without name, coordinates, or known category; removes duplicates)
  - `importPlaces(sql: Sql, seeds: PlaceSeed[]): Promise<number>` (idempotent upsert; never deletes; keeps an existing `country_code` when the new one is null)
  - CLI: `npm run import:osm -- <file.json> [COUNTRY_CODE]`

- [ ] **Step 1: Write the failing tests**

`tests/lib/osm.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { categoryFor, parseOverpass } from "@/lib/osm";

describe("categoryFor", () => {
  it.each([
    [{ amenity: "cafe" }, "cafe"], [{ amenity: "bar" }, "restaurant"], [{ amenity: "restaurant" }, "restaurant"],
    [{ amenity: "library" }, "library"], [{ amenity: "coworking_space" }, "coworking"],
    [{ tourism: "hotel" }, "hotel"], [{ tourism: "guest_house" }, "hotel"], [{ tourism: "hostel" }, "hostel"],
    [{ aeroway: "aerodrome" }, "airport"], [{ railway: "station" }, "station"],
  ])("maps %j to %s", (tags, expected) => {
    expect(categoryFor(tags as Record<string, string>)).toBe(expected);
  });
  it("returns null for unknown tags", () => {
    expect(categoryFor({ amenity: "bench" })).toBeNull();
    expect(categoryFor({})).toBeNull();
  });
});

describe("parseOverpass", () => {
  const file = {
    elements: [
      { type: "node", id: 1, lat: 41.0, lon: 29.0, tags: { name: "Çay Bahçesi's \"Best\"", amenity: "cafe" } },
      { type: "way", id: 2, center: { lat: 41.1, lon: 29.1 }, tags: { name: "Hotel Ay", tourism: "hotel" } },
      { type: "node", id: 3, lat: 41.2, lon: 29.2, tags: { amenity: "cafe" } },
      { type: "node", id: 4, lat: 41.3, lon: 29.3, tags: { name: "Bench", amenity: "bench" } },
      { type: "way", id: 5, tags: { name: "No coords", amenity: "cafe" } },
      { type: "node", id: 1, lat: 41.0, lon: 29.0, tags: { name: "Duplicate of 1", amenity: "cafe" } },
      { type: "node", id: 6, lat: 41.4, lon: 29.4, tags: { name: "   ", amenity: "cafe" } },
    ],
  };

  it("keeps valid places, uses way centers, and keeps special characters", () => {
    const seeds = parseOverpass(file);
    expect(seeds.map((s) => s.osm_id)).toEqual([1, 2]);
    expect(seeds[0]).toMatchObject({ osm_type: "node", name: "Çay Bahçesi's \"Best\"", category: "cafe", lat: 41.0, lng: 29.0 });
    expect(seeds[1]).toMatchObject({ osm_type: "way", lat: 41.1, lng: 29.1, category: "hotel" });
  });

  it("returns an empty list for bad input", () => {
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({})).toEqual([]);
    expect(parseOverpass({ elements: "no" })).toEqual([]);
  });
});
```

`tests/db/import-osm.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { importPlaces, type PlaceSeed } from "@/lib/osm";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const seeds: PlaceSeed[] = [
  { osm_type: "node", osm_id: 1, name: "Çay Bahçesi's \"Best\"", category: "cafe", lat: 41.0, lng: 29.0, country_code: "TR" },
  { osm_type: "way", osm_id: 2, name: "Hotel Ay", category: "hotel", lat: 41.1, lng: 29.1, country_code: "TR" },
];

describe("importPlaces", () => {
  it("inserts places, keeps special characters, and stores the country", async () => {
    expect(await importPlaces(sql, seeds)).toBe(2);
    const rows = await sql`SELECT name, source, country_code, ST_Y(geom::geometry) AS lat FROM places ORDER BY osm_id`;
    expect(rows[0]).toMatchObject({ name: "Çay Bahçesi's \"Best\"", source: "osm", country_code: "TR" });
    expect(rows[0].lat).toBeCloseTo(41.0, 6);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await importPlaces(sql, seeds);
    await importPlaces(sql, seeds);
    const [{ n }] = await sql`SELECT count(*) AS n FROM places`;
    expect(n).toBe(2);
  });

  it("updates a changed name, keeps WiFi entries, and keeps the country when the new value is null", async () => {
    await importPlaces(sql, seeds);
    const [p] = await sql`SELECT id FROM places WHERE osm_id = 2`;
    await insertEntry(sql, p.id);
    await importPlaces(sql, [{ ...seeds[1], name: "Hotel Ay Yeni", country_code: null }]);
    const [after] = await sql`SELECT name, country_code FROM places WHERE osm_id = 2`;
    expect(after).toMatchObject({ name: "Hotel Ay Yeni", country_code: "TR" });
    const [{ n }] = await sql`SELECT count(*) AS n FROM wifi_entries WHERE place_id = ${p.id}`;
    expect(n).toBe(1);
  });

  it("does nothing for an empty list", async () => {
    expect(await importPlaces(sql, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/osm.test.ts tests/db/import-osm.test.ts`
Expected: FAIL, cannot resolve `@/lib/osm`.

- [ ] **Step 3: Implement**

`lib/osm.ts`:
```ts
import type { Sql } from "./db";
import type { Category } from "./types";

export interface PlaceSeed {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  country_code?: string | null;
}

export function categoryFor(tags: Record<string, string>): Category | null {
  switch (tags.amenity) {
    case "cafe": return "cafe";
    case "restaurant":
    case "bar": return "restaurant";
    case "library": return "library";
    case "coworking_space": return "coworking";
  }
  switch (tags.tourism) {
    case "hotel":
    case "guest_house": return "hotel";
    case "hostel": return "hostel";
  }
  if (tags.aeroway === "aerodrome") return "airport";
  if (tags.railway === "station") return "station";
  return null;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Reads the JSON that the Overpass API returns for `out center tags;`. */
export function parseOverpass(json: unknown): PlaceSeed[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const out: PlaceSeed[] = [];
  for (const el of elements as OverpassElement[]) {
    if (el.type !== "node" && el.type !== "way" && el.type !== "relation") continue;
    if (typeof el.id !== "number") continue;
    const tags = el.tags ?? {};
    const name = (tags.name ?? "").trim();
    const category = categoryFor(tags);
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || !category || typeof lat !== "number" || typeof lng !== "number") continue;
    const key = `${el.type}:${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ osm_type: el.type, osm_id: el.id, name: name.slice(0, 200), category, lat, lng });
  }
  return out;
}

/** Idempotent upsert keyed by (osm_type, osm_id). Never deletes. Returns rows written. */
export async function importPlaces(sql: Sql, seeds: PlaceSeed[]): Promise<number> {
  if (seeds.length === 0) return 0;
  // JSON goes in as text, then is cast, so postgres.js does not encode it twice.
  const rows = await sql`
    INSERT INTO places (osm_type, osm_id, name, category, geom, country_code, source)
    SELECT t.osm_type, t.osm_id, t.name, t.category,
           ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)::geography, t.country_code, 'osm'
    FROM jsonb_to_recordset(${JSON.stringify(seeds)}::text::jsonb)
         AS t(osm_type text, osm_id bigint, name text, category text, lat float8, lng float8, country_code text)
    ON CONFLICT (osm_type, osm_id)
    DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, geom = EXCLUDED.geom,
                  country_code = COALESCE(EXCLUDED.country_code, places.country_code)
    RETURNING id`;
  return rows.length;
}
```

`scripts/import-osm.ts`:
```ts
import fs from "node:fs";
import { config } from "dotenv";
import { createSql } from "../lib/db";
import { importPlaces, parseOverpass } from "../lib/osm";

config();

const [file, countryArg] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run import:osm -- data/istanbul.json [TR]");
  process.exit(1);
}
const country = countryArg ? countryArg.toUpperCase() : null;
if (country && !/^[A-Z]{2}$/.test(country)) {
  console.error("COUNTRY_CODE must be two letters, for example TR");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const seeds = parseOverpass(JSON.parse(fs.readFileSync(file, "utf8"))).map((s) => ({ ...s, country_code: country }));
console.log(`parsed ${seeds.length} places from ${file}`);

const sql = createSql(url);
try {
  let written = 0;
  for (let i = 0; i < seeds.length; i += 1000) written += await importPlaces(sql, seeds.slice(i, i + 1000));
  console.log(`wrote ${written} places`);
} finally {
  await sql.end();
}
```

`scripts/overpass/istanbul.overpassql`:
```
[out:json][timeout:180];
(
  nwr["amenity"~"^(cafe|restaurant|bar|library|coworking_space)$"]["name"](40.80,28.55,41.30,29.45);
  nwr["tourism"~"^(hotel|hostel|guest_house)$"]["name"](40.80,28.55,41.30,29.45);
  nwr["aeroway"="aerodrome"]["name"](40.80,28.55,41.30,29.45);
  nwr["railway"="station"]["name"](40.80,28.55,41.30,29.45);
);
out center tags;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/osm.test.ts tests/db/import-osm.test.ts`
Expected: all PASS. If the `::text::jsonb` cast fails with a JSON error, the JSON was encoded twice: confirm the parameter is a plain string and the cast is exactly `::text::jsonb`.

- [ ] **Step 5: Run a real import into the dev database**

Run:
```bash
mkdir -p data
curl -sS -A "wifi-near-me-dev" --data-urlencode data@scripts/overpass/istanbul.overpassql https://overpass-api.de/api/interpreter -o data/istanbul.json
npm run import:osm -- data/istanbul.json TR
npm run import:osm -- data/istanbul.json TR
docker compose exec db psql -U wifi -d wifi -c "select count(*), count(*) filter (where country_code = 'TR') from places"
```
Expected: `parsed N places` with N in the thousands, then `wrote N places`, twice. Both counts in the final query equal N. If Overpass answers with an error or timeout, wait one minute and retry. For all of Turkey later, use many small bounding boxes or a Geofabrik extract, never one huge query.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: pass. (`data/` is in `.gitignore`.)

```bash
git add -A
git commit -m "feat: OpenStreetMap import with idempotent upsert and country code" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Geocoder proxy with rate limit and cache

**Files:**
- Create: `lib/geocode.ts`, `app/api/geocode/route.ts`
- Test: `tests/lib/geocode.test.ts`, `tests/api/geocode.test.ts`

**Interfaces:**
- Consumes: `GeocodeResult`, `resolveActor`, `consume`, `LIMITS`, `getSql`, `json`.
- Produces:
  - `normalizePhoton(json: unknown): GeocodeResult[]` (maps type and zoom, removes duplicates, max 6)
  - `cacheGet(key: string, now?: number): GeocodeResult[] | null`, `cacheSet(key: string, results: GeocodeResult[], now?: number): void`, `cacheClear(): void` (10 minute TTL, max 500 keys)
  - `GET /api/geocode?q=&lat=&lng=` -> `200 { results }`; `400` if `q` is under 2 or over 100 characters; `429 { results: [], error: "rate_limited" }`; `502 { results: [], error: "geocoder_unavailable" }` on failure or after 5 seconds. Cache hits skip the rate limit and the upstream call.

- [ ] **Step 1: Write the failing tests**

`tests/lib/geocode.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { cacheClear, cacheGet, cacheSet, normalizePhoton } from "@/lib/geocode";

const feature = (props: Record<string, unknown>, coords: [number, number] = [28.98, 41.03]) => ({
  geometry: { coordinates: coords },
  properties: props,
});

describe("normalizePhoton", () => {
  it("maps place types, builds the area text, and returns lat/lng", () => {
    const out = normalizePhoton({
      features: [
        feature({ name: "Taksim", osm_key: "railway", osm_value: "station", district: "Gümüşsuyu", state: "Istanbul", country: "Turkey" }),
        feature({ name: "Istanbul", osm_key: "place", osm_value: "city", state: "Istanbul", country: "Turkey" }),
        feature({ name: "Istanbul Airport", osm_key: "aeroway", osm_value: "aerodrome", country: "Turkey" }),
      ],
    });
    expect(out[0]).toMatchObject({ name: "Taksim", kind: "Station", where: "Gümüşsuyu, Istanbul, Turkey", lat: 41.03, lng: 28.98, zoom: 16 });
    expect(out[1]).toMatchObject({ kind: "City", zoom: 11.5, where: "Istanbul, Turkey" });
    expect(out[2]).toMatchObject({ kind: "Airport", zoom: 14 });
  });

  it("removes exact duplicates and limits to 6", () => {
    const f = feature({ name: "Taksim", osm_key: "railway", osm_value: "station", state: "Istanbul", country: "Turkey" });
    expect(normalizePhoton({ features: [f, f, f] })).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => feature({ name: `P${i}`, osm_key: "place", osm_value: "town" }));
    expect(normalizePhoton({ features: many })).toHaveLength(6);
  });

  it("skips features without coordinates and tolerates bad input", () => {
    expect(normalizePhoton({ features: [{ properties: { name: "X" } }] })).toEqual([]);
    expect(normalizePhoton(null)).toEqual([]);
    expect(normalizePhoton({})).toEqual([]);
  });
});

describe("geocode cache", () => {
  beforeEach(() => cacheClear());
  const r = [{ name: "A", kind: "City", where: "", lat: 1, lng: 2, zoom: 11 }];

  it("returns a stored value until it expires", () => {
    cacheSet("k", r, 1_000);
    expect(cacheGet("k", 1_000 + 60_000)).toEqual(r);
    expect(cacheGet("k", 1_000 + 11 * 60_000)).toBeNull();
  });

  it("keeps at most 500 keys", () => {
    for (let i = 0; i < 501; i++) cacheSet(`k${i}`, r, 1_000);
    expect(cacheGet("k0", 1_000)).toBeNull();
    expect(cacheGet("k500", 1_000)).toEqual(r);
  });
});
```

`tests/api/geocode.test.ts`:
```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/geocode/route";
import { getSql } from "@/lib/db";
import { cacheClear } from "@/lib/geocode";
import { LIMITS } from "@/lib/rate-limit";
import { resetDb } from "../helpers/db";

const sql = getSql();
const saved = { ...LIMITS.geocode };
afterAll(() => sql.end());
beforeEach(async () => { await resetDb(sql); cacheClear(); });
afterEach(() => { vi.unstubAllGlobals(); LIMITS.geocode = { ...saved }; });

const photon = { features: [{ geometry: { coordinates: [28.98, 41.03] }, properties: { name: "Taksim", osm_key: "place", osm_value: "quarter", state: "Istanbul", country: "Turkey" } }] };
const ok = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify(photon), { status: 200 }));
const call = (qs: string, ip = "3.3.3.3") => GET(new Request(`http://x/api/geocode?${qs}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/geocode", () => {
  it("returns normalized results and sends a rounded location bias", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("q=taksim&lat=41.0123&lng=28.9876");
    expect(res.status).toBe(200);
    expect((await res.json()).results[0]).toMatchObject({ name: "Taksim", kind: "District" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("q=taksim");
    expect(url).toContain("lat=41.0");
    expect(url).toContain("lon=29.0");
  });

  it("serves a repeated query from the cache", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    await call("q=taksim&lat=41&lng=29");
    await call("q=TAKSIM&lat=41.01&lng=29.01");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a missing, short, or long query", async () => {
    for (const qs of ["", "q=a", `q=${"a".repeat(101)}`]) expect((await call(qs)).status).toBe(400);
  });

  it("returns 429 when one IP searches too much", async () => {
    vi.stubGlobal("fetch", ok());
    LIMITS.geocode = { limit: 1, windowSeconds: 3600 };
    expect((await call("q=first")).status).toBe(200);
    const res = await call("q=second");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ results: [], error: "rate_limited" });
  });

  it("returns 502 with an empty list when the service fails or answers with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const res = await call("q=taksim");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ results: [], error: "geocoder_unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    expect((await call("q=other")).status).toBe(502);
  });

  it("does not send bad lat/lng values upstream", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    await call("q=taksim&lat=abc&lng=999");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain("lat=");
    expect(url).not.toContain("lon=");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/geocode.test.ts tests/api/geocode.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`lib/geocode.ts`:
```ts
import type { GeocodeResult } from "./types";

interface PhotonProps {
  name?: string; street?: string; osm_key?: string; osm_value?: string;
  district?: string; city?: string; state?: string; country?: string;
}

function kindFor(p: PhotonProps): { label: string; zoom: number } {
  const k = p.osm_key, v = p.osm_value;
  if (k === "aeroway") return { label: "Airport", zoom: 14 };
  if (k === "railway" || k === "public_transport") return { label: "Station", zoom: 16 };
  if (k === "place") {
    if (v === "city") return { label: "City", zoom: 11.5 };
    if (v === "town") return { label: "Town", zoom: 12.5 };
    if (v === "village") return { label: "Village", zoom: 13.5 };
    if (v === "suburb" || v === "quarter" || v === "neighbourhood" || v === "district") return { label: "District", zoom: 14 };
    if (v === "country" || v === "state" || v === "region") return { label: "Region", zoom: 6 };
    return { label: "Place", zoom: 14 };
  }
  if (k === "tourism") return { label: v === "hotel" || v === "hostel" ? "Hotel" : "Attraction", zoom: 16 };
  if (k === "amenity") return { label: String(v ?? "place").replace(/_/g, " "), zoom: 16 };
  if (k === "highway") return { label: "Street", zoom: 16 };
  return { label: String(v ?? k ?? "place").replace(/_/g, " "), zoom: 15 };
}

interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: PhotonProps }

export function normalizePhoton(json: unknown): GeocodeResult[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: GeocodeResult[] = [];
  for (const f of features as PhotonFeature[]) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const kind = kindFor(p);
    const where = [p.district || p.city, p.state, p.country]
      .filter((x): x is string => !!x)
      .filter((x, i, a) => a.indexOf(x) === i)
      .join(", ");
    const name = p.name || p.street || "Unnamed";
    const key = `${name}|${kind.label}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind: kind.label, where, lat: c[1], lng: c[0], zoom: kind.zoom });
    if (out.length === 6) break;
  }
  return out;
}

// Small per-instance cache. It cuts repeated upstream calls; it is not shared between server instances.
const TTL_MS = 10 * 60_000;
const MAX_KEYS = 500;
const cache = new Map<string, { at: number; results: GeocodeResult[] }>();

export function cacheGet(key: string, now = Date.now()): GeocodeResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

export function cacheSet(key: string, results: GeocodeResult[], now = Date.now()): void {
  if (!cache.has(key) && cache.size >= MAX_KEYS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, results });
}

export function cacheClear(): void {
  cache.clear();
}
```

`app/api/geocode/route.ts`:
```ts
import { resolveActor } from "@/lib/actor";
import { getSql } from "@/lib/db";
import { cacheGet, cacheSet, normalizePhoton } from "@/lib/geocode";
import { json } from "@/lib/http";
import { consume, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Rounds to 0.1 degree (about 10 km): enough for a location bias, and good for cache hits. */
function roundedCoord(raw: string | null, min: number, max: number): string | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n.toFixed(1) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 100) return json({ error: "invalid_input" }, 400);
  const lat = roundedCoord(url.searchParams.get("lat"), -90, 90);
  const lng = roundedCoord(url.searchParams.get("lng"), -180, 180);
  const bias = lat && lng ? { lat, lng } : null;

  const key = `${q.toLowerCase()}|${bias ? `${bias.lat},${bias.lng}` : ""}`;
  const cached = cacheGet(key);
  if (cached) return json({ results: cached }, 200, { "cache-control": "public, max-age=300" });

  const { actor } = resolveActor(req);
  const l = LIMITS.geocode;
  if (!(await consume(getSql(), actor.ipHash, "geocode", l.limit, l.windowSeconds))) {
    return json({ results: [], error: "rate_limited" }, 429);
  }

  const upstream = new URL("/api/", process.env.PHOTON_URL ?? "https://photon.komoot.io");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", "8");
  upstream.searchParams.set("lang", "en");
  if (bias) {
    upstream.searchParams.set("lat", bias.lat);
    upstream.searchParams.set("lon", bias.lng);
  }
  try {
    const r = await fetch(upstream, { headers: { "user-agent": "wifi-near-me/0.1" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`geocoder status ${r.status}`);
    const results = normalizePhoton(await r.json());
    cacheSet(key, results);
    return json({ results }, 200, { "cache-control": "public, max-age=300" });
  } catch {
    return json({ results: [], error: "geocoder_unavailable" }, 502);
  }
}
```

- [ ] **Step 4: Run, verify, commit**

Run: `npx vitest run tests/lib/geocode.test.ts tests/api/geocode.test.ts && npx tsc --noEmit`
Expected: all PASS.

```bash
git add -A
git commit -m "feat(api): geocoder proxy with per-IP limit and cache" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Moderation library and command-line tool

**Files:**
- Create: `lib/moderation.ts`, `scripts/moderate.ts`
- Test: `tests/db/moderation.test.ts`

**Interfaces:**
- Consumes: `Sql`, `EntryStatus`, `createSubmissionService` (tests only).
- Produces:
  - `interface ReviewRow { id: number; place_name: string; label: string; status: EntryStatus; reports: number; updated_at: Date }`
  - `listForReview(sql: Sql, statuses?: EntryStatus[]): Promise<ReviewRow[]>` (default `["hidden", "pending"]`, newest first, max 200)
  - `setStatus(sql: Sql, id: number, status: EntryStatus): Promise<boolean>` (false if the entry does not exist)
  - `restoreEntry(sql: Sql, id: number): Promise<boolean>` (status `active` and deletes its reports, in one transaction)
  - `listRevisions(sql: Sql, id: number): Promise<{ id: number; created_at: Date; device_hash: string | null; submitter_id: string | null; snapshot: Record<string, unknown> }[]>`
  - `revertToPrevious(sql: Sql, id: number): Promise<"reverted" | "no_previous" | "not_found">` (applies the second-newest revision and writes a new revision with `submitter_id = 'moderator'`)
  - CLI: `npm run moderate -- list [status...] | approve <id> | hide <id> | restore <id> | history <id> | revert <id>`

- [ ] **Step 1: Write the failing tests**

`tests/db/moderation.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "@/lib/db";
import { listForReview, listRevisions, restoreEntry, revertToPrevious, setStatus } from "@/lib/moderation";
import { anonymousGuard } from "@/lib/services/guard";
import { createSubmissionService } from "@/lib/services/submission";
import type { Actor } from "@/lib/types";
import { resetDb, testUrl } from "../helpers/db";
import { insertEntry, insertPlace } from "../helpers/factories";

const sql = createSql(testUrl);
afterAll(() => sql.end());
beforeEach(() => resetDb(sql));

const svc = () => createSubmissionService({ sql, guard: anonymousGuard });
const actor = (d: string, ip = "ip-1"): Actor => ({ ipHash: ip, deviceHash: d, userId: null });
const entry = { access_type: "password", steps_text: "Original steps.", label: "Guest" };
const statusOf = async (id: number) => (await sql`SELECT status FROM wifi_entries WHERE id = ${id}`)[0].status;

describe("moderation", () => {
  it("lists hidden and pending entries with report counts, not active ones", async () => {
    const placeId = await insertPlace(sql, { name: "Cafe M" });
    const hidden = await insertEntry(sql, placeId, { status: "hidden" });
    const pending = await insertEntry(sql, placeId, { status: "pending" });
    await insertEntry(sql, placeId, { status: "active" });
    await sql`INSERT INTO reports (wifi_entry_id, device_hash, ip_hash, reason) VALUES (${hidden}, 'd', 'i', 'spam')`;
    const rows = await listForReview(sql);
    expect(rows.map((r) => r.id).sort()).toEqual([hidden, pending].sort());
    expect(rows.find((r) => r.id === hidden)).toMatchObject({ place_name: "Cafe M", reports: 1, status: "hidden" });
  });

  it("approves a pending entry and returns false for an unknown id", async () => {
    const id = await insertEntry(sql, await insertPlace(sql), { status: "pending" });
    expect(await setStatus(sql, id, "active")).toBe(true);
    expect(await statusOf(id)).toBe("active");
    expect(await setStatus(sql, 9999, "hidden")).toBe(false);
  });

  it("restores a hidden entry and clears its reports, so one new report does not hide it again", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    const id = r.entry_id;
    await svc().reportEntry(actor("a", "ip-1"), id, "x");
    await svc().reportEntry(actor("b", "ip-1"), id, "x");
    await svc().reportEntry(actor("c", "ip-2"), id, "x");
    expect(await statusOf(id)).toBe("hidden");
    expect(await restoreEntry(sql, id)).toBe(true);
    expect(await statusOf(id)).toBe("active");
    await svc().reportEntry(actor("d", "ip-3"), id, "x");
    expect(await statusOf(id)).toBe("active");
  });

  it("reverts a bad edit to the previous revision", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    await svc().editEntry(actor("vandal"), r.entry_id, { ...entry, steps_text: "Spam text." });
    expect(await revertToPrevious(sql, r.entry_id)).toBe("reverted");
    const [e] = await sql`SELECT steps_text FROM wifi_entries WHERE id = ${r.entry_id}`;
    expect(e.steps_text).toBe("Original steps.");
    const revs = await listRevisions(sql, r.entry_id);
    expect(revs).toHaveLength(3);
    expect(revs[0]).toMatchObject({ submitter_id: "moderator" });
  });

  it("reports no_previous and not_found", async () => {
    const r = await svc().submitEntry(actor("x"), await insertPlace(sql), entry);
    if (r.ignored) throw new Error("unexpected");
    expect(await revertToPrevious(sql, r.entry_id)).toBe("no_previous");
    expect(await revertToPrevious(sql, 9999)).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/db/moderation.test.ts`
Expected: FAIL, cannot resolve `@/lib/moderation`.

- [ ] **Step 3: Implement the library**

`lib/moderation.ts`:
```ts
import type { Sql } from "./db";
import type { EntryStatus } from "./types";

/** Moderator operations. Used only by scripts/moderate.ts. Never exposed over HTTP. */

export interface ReviewRow {
  id: number;
  place_name: string;
  label: string;
  status: EntryStatus;
  reports: number;
  updated_at: Date;
}

export async function listForReview(sql: Sql, statuses: EntryStatus[] = ["hidden", "pending"]): Promise<ReviewRow[]> {
  const rows = await sql`
    SELECT e.id, p.name AS place_name, e.label, e.status, e.updated_at,
           (SELECT count(*) FROM reports r WHERE r.wifi_entry_id = e.id) AS reports
    FROM wifi_entries e JOIN places p ON p.id = e.place_id
    WHERE e.status IN ${sql(statuses)}
    ORDER BY e.updated_at DESC
    LIMIT 200`;
  return rows as unknown as ReviewRow[];
}

export async function setStatus(sql: Sql, id: number, status: EntryStatus): Promise<boolean> {
  const rows = await sql`UPDATE wifi_entries SET status = ${status}, updated_at = now() WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** Makes the entry active again and deletes its reports, so old reports cannot hide it again. */
export async function restoreEntry(sql: Sql, id: number): Promise<boolean> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const rows = await tx`UPDATE wifi_entries SET status = 'active', updated_at = now() WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) return false;
    await tx`DELETE FROM reports WHERE wifi_entry_id = ${id}`;
    return true;
  });
}

export async function listRevisions(sql: Sql, id: number) {
  const rows = await sql`
    SELECT id, created_at, device_hash, submitter_id, snapshot
    FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id DESC`;
  return rows as unknown as {
    id: number; created_at: Date; device_hash: string | null; submitter_id: string | null; snapshot: Record<string, unknown>;
  }[];
}

/** Applies the second-newest revision and records that as a new revision by "moderator". */
export async function revertToPrevious(sql: Sql, id: number): Promise<"reverted" | "no_previous" | "not_found"> {
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Sql;
    const [entry] = await tx`SELECT id FROM wifi_entries WHERE id = ${id} FOR UPDATE`;
    if (!entry) return "not_found" as const;
    const revs = await tx`SELECT snapshot FROM wifi_entry_revisions WHERE wifi_entry_id = ${id} ORDER BY id DESC LIMIT 2`;
    if (revs.length < 2) return "no_previous" as const;
    const s = revs[1].snapshot as {
      label: string; access_type: string; steps_text: string; language: string;
      password: string | null; password_policy: string;
    };
    await tx`
      UPDATE wifi_entries
      SET label = ${s.label}, access_type = ${s.access_type}, steps_text = ${s.steps_text}, language = ${s.language},
          password = ${s.password}, password_policy = ${s.password_policy}, updated_at = clock_timestamp()
      WHERE id = ${id}`;
    await tx`
      INSERT INTO wifi_entry_revisions (wifi_entry_id, snapshot, submitter_id)
      VALUES (${id}, ${JSON.stringify(s)}::text::jsonb, 'moderator')`;
    return "reverted" as const;
  });
}
```

- [ ] **Step 4: Implement the CLI**

`scripts/moderate.ts`:
```ts
import { config } from "dotenv";
import { createSql } from "../lib/db";
import { listForReview, listRevisions, restoreEntry, revertToPrevious, setStatus } from "../lib/moderation";
import type { EntryStatus } from "../lib/types";

config();

const USAGE = `Usage:
  npm run moderate -- list [hidden|pending|active ...]
  npm run moderate -- approve <entryId>     set status to active
  npm run moderate -- hide <entryId>        set status to hidden
  npm run moderate -- restore <entryId>     set active and delete its reports
  npm run moderate -- history <entryId>     show revisions (passwords masked)
  npm run moderate -- revert <entryId>      go back to the previous revision`;

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = createSql(url);

function idArg(): number {
  const id = Number(args[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(USAGE);
    process.exit(1);
  }
  return id;
}

try {
  switch (cmd) {
    case "list": {
      const statuses = (args.length ? args : ["hidden", "pending"]) as EntryStatus[];
      console.table(await listForReview(sql, statuses));
      break;
    }
    case "approve":
      console.log((await setStatus(sql, idArg(), "active")) ? "approved" : "not found");
      break;
    case "hide":
      console.log((await setStatus(sql, idArg(), "hidden")) ? "hidden" : "not found");
      break;
    case "restore":
      console.log((await restoreEntry(sql, idArg())) ? "restored" : "not found");
      break;
    case "history":
      for (const r of await listRevisions(sql, idArg())) {
        const snap = { ...r.snapshot, password: r.snapshot.password ? "(set)" : null };
        console.log(r.id, r.created_at.toISOString(), r.submitter_id ?? r.device_hash?.slice(0, 8) ?? "-", JSON.stringify(snap));
      }
      break;
    case "revert":
      console.log(await revertToPrevious(sql, idArg()));
      break;
    default:
      console.error(USAGE);
      process.exitCode = 1;
  }
} finally {
  await sql.end();
}
```

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run tests/db/moderation.test.ts && npx tsc --noEmit && npm run moderate -- list`
Expected: tests PASS. The CLI prints an empty table (or rows) against the dev database without errors.

```bash
git add -A
git commit -m "feat: moderation library and CLI (list, approve, hide, restore, history, revert)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: UI foundation (CSS, helpers, API client)

**Files:**
- Create: `app/globals.css` (from the demo, plus new rules), `lib/geo.ts`, `lib/labels.ts`, `lib/time.ts`, `lib/directions.ts`, `lib/form-checks.ts`, `lib/client/api.ts`
- Test: `tests/lib/ui-helpers.test.ts`

**Interfaces:**
- Consumes: shared types.
- Produces:
  - `haversineM(aLat, aLng, bLat, bLng): number` (meters)
  - `ACCESS_LABEL`, `CATEGORY_LABEL`, `fmtDist(m: number): string`
  - `timeAgo(iso: string, now?: number): string`
  - `directionsUrl(p: { lat: number; lng: number }): string`
  - `stepsContainPassword(steps: string, password: string): boolean`
  - `lib/client/api.ts`: `ApiError` (`status`, `code`, `issues?`), `type EntryBody`, `type EntryEditBody = EntryBody & { password_clear: boolean }`, `fetchNearby`, `fetchPlace`, `postEntry`, `patchEntry(entryId: number, body: EntryEditBody)`, `postPlace`, `postVote`, `postReport`, `fetchGeocode`.

- [ ] **Step 1: Build the CSS from the demo**

Run:
```bash
python3 -I - <<'EOF'
import re
s = open("demo/index.html", encoding="utf-8").read()
css = re.search(r"<style>(.*?)</style>", s, re.S).group(1).strip()
extra = """
/* Added for the real app */
.attrib { padding: 8px 16px 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
.attrib a { color: inherit; }
.warn { background: #fff3d6; color: #7a4a00; padding: 8px 10px; border-radius: 8px; font-size: 13px; margin-top: 10px; }
.card .edit { margin-left: auto; }
.page { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; line-height: 1.6; }
.page h1 { font-size: 24px; } .page h2 { font-size: 18px; margin-top: 28px; }
"""
open("app/globals.css", "w", encoding="utf-8").write(css + "\n" + extra)
EOF
grep -c "\.app {" app/globals.css && grep -c "\.attrib" app/globals.css
```
Expected: prints `1` then a number of 1 or more.

- [ ] **Step 2: Write the failing tests**

`tests/lib/ui-helpers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { directionsUrl } from "@/lib/directions";
import { stepsContainPassword } from "@/lib/form-checks";
import { haversineM } from "@/lib/geo";
import { fmtDist } from "@/lib/labels";
import { timeAgo } from "@/lib/time";

describe("haversineM", () => {
  it("is about 111 km for one degree of longitude at the equator", () => {
    expect(haversineM(0, 0, 0, 1)).toBeGreaterThan(110_000);
    expect(haversineM(0, 0, 0, 1)).toBeLessThan(112_500);
  });
  it("is zero for the same point", () => expect(haversineM(41, 29, 41, 29)).toBe(0));
});

describe("fmtDist", () => {
  it.each([[396, "396 m"], [999.4, "999 m"], [1000, "1.0 km"], [2450, "2.5 km"], [15200, "15 km"]])(
    "%s -> %s", (m, text) => expect(fmtDist(m)).toBe(text),
  );
});

describe("timeAgo", () => {
  const now = Date.parse("2026-06-10T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    [10_000, "just now"], [5 * 60_000, "5 min ago"], [3_600_000, "1 hour ago"], [3 * 3_600_000, "3 hours ago"],
    [30 * 3_600_000, "yesterday"], [4 * 86_400_000, "4 days ago"], [15 * 86_400_000, "2 weeks ago"],
  ])("%s ms -> %s", (ms, text) => expect(timeAgo(ago(ms), now)).toBe(text));
  it("shows a date for old values and handles future or invalid input", () => {
    expect(timeAgo(ago(90 * 86_400_000), now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe("just now");
    expect(timeAgo("not a date", now)).toBe("unknown");
  });
});

describe("directionsUrl", () => {
  it("builds a Google Maps directions link with plain coordinates", () => {
    expect(directionsUrl({ lat: 41.0086, lng: 28.9795 }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=41.008600,28.979500");
  });
});

describe("stepsContainPassword", () => {
  it("detects the password in the steps, ignoring case", () => {
    expect(stepsContainPassword("The code is CafeGuest2026.", "cafeguest2026")).toBe(true);
  });
  it("ignores short or empty passwords and steps without the password", () => {
    expect(stepsContainPassword("Room 123 is upstairs", "123")).toBe(false);
    expect(stepsContainPassword("Ask the staff", "")).toBe(false);
    expect(stepsContainPassword("Ask the staff", "secret-pw")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/lib/ui-helpers.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the helpers**

`lib/geo.ts`:
```ts
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
```

`lib/labels.ts`:
```ts
import type { AccessType, Category } from "./types";

export const ACCESS_LABEL: Record<AccessType, string> = {
  open: "Open", password: "Password", portal: "Login page", sms: "SMS code",
  id_required: "ID / room no.", ask_staff: "Ask staff", customers_only: "Customers only", paid: "Paid",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  airport: "Airport", cafe: "Cafe", restaurant: "Restaurant", hotel: "Hotel", hostel: "Hostel",
  station: "Station", library: "Library", coworking: "Coworking", other: "Place",
};

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
```

`lib/time.ts`:
```ts
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  const days = Math.floor(s / 86400);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(t).toISOString().slice(0, 10);
}
```

`lib/directions.ts`:
```ts
/** Public Google Maps URL format. No API key, no billing. Coordinates only, so the route goes to the pin. */
export function directionsUrl(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}
```

`lib/form-checks.ts`:
```ts
/** True when the steps text contains the password. Passwords under 4 characters are ignored to avoid false alarms. */
export function stepsContainPassword(steps: string, password: string): boolean {
  const p = password.trim().toLowerCase();
  if (p.length < 4) return false;
  return steps.toLowerCase().includes(p);
}
```

`lib/client/api.ts`:
```ts
import type { AccessType, Category, GeocodeResult, Language, PlaceDetail, PlaceSummary } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  code: string;
  issues?: { path: string; message: string }[];
  constructor(status: number, code: string, issues?: { path: string; message: string }[]) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
  if (!res.ok) throw new ApiError(res.status, body.error ?? "server_error", body.issues);
  return body as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface EntryBody {
  label: string;
  access_type: AccessType;
  steps_text: string;
  language: Language;
  password?: string;
  password_is_public: boolean;
  website?: string;
}
export type EntryEditBody = EntryBody & { password_clear: boolean };

export async function fetchNearby(v: { lat: number; lng: number; radius_m: number }, signal?: AbortSignal): Promise<PlaceSummary[]> {
  const qs = new URLSearchParams({ lat: String(v.lat), lng: String(v.lng), radius_m: String(Math.round(v.radius_m)) });
  return (await request<{ places: PlaceSummary[] }>(`/api/places/nearby?${qs}`, { signal })).places;
}

export const fetchPlace = (id: number, signal?: AbortSignal) => request<PlaceDetail>(`/api/places/${id}`, { signal });

export const postEntry = (placeId: number, body: EntryBody) =>
  request<{ entry_id?: number; ignored?: boolean }>(`/api/places/${placeId}/entries`, jsonInit("POST", body));

export const patchEntry = (entryId: number, body: EntryEditBody) =>
  request<{ entry_id?: number; ignored?: boolean }>(`/api/entries/${entryId}`, jsonInit("PATCH", body));

export const postPlace = (body: { place: { name: string; category: Category; lat: number; lng: number }; entry: EntryBody }) =>
  request<{ place_id?: number; entry_id?: number; ignored?: boolean }>("/api/places", jsonInit("POST", body));

export const postVote = (entryId: number, kind: "works" | "broken") =>
  request<{ works: number; broken: number }>(`/api/entries/${entryId}/vote`, jsonInit("POST", { kind }));

export const postReport = (entryId: number, reason?: string) =>
  request<{ hidden: boolean }>(`/api/entries/${entryId}/report`, jsonInit("POST", { reason }));

export async function fetchGeocode(q: string, center: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const qs = new URLSearchParams({ q, lat: String(center.lat), lng: String(center.lng) });
  return (await request<{ results: GeocodeResult[] }>(`/api/geocode?${qs}`, { signal })).results;
}
```

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run tests/lib/ui-helpers.test.ts && npx tsc --noEmit`
Expected: all PASS.

```bash
git add -A
git commit -m "feat(ui): styles from the demo, UI helpers, and API client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Map, search box, and place list components

**Files:**
- Create: `components/MapView.tsx`, `components/SearchBox.tsx`, `components/PlaceList.tsx`

**Interfaces:**
- Consumes: `PlaceSummary`, `GeocodeResult`, `fetchGeocode`, `haversineM`, `CATEGORY_LABEL`, `fmtDist`.
- Produces:
  - `MapView` props: `{ places: PlaceSummary[]; selectedId: number | null; userLocation: {lat:number;lng:number} | null; flyTo: {lat:number;lng:number;zoom:number;nonce:number} | null; pickMode: boolean; onSelect(id: number): void; onMoveEnd(v: {lat:number;lng:number;radius_m:number}): void; onPick(p: {lat:number;lng:number}): void }`
  - `SearchBox` props: `{ places: PlaceSummary[]; center: {lat:number;lng:number}; onQueryChange(q: string): void; onPickLocation(r: GeocodeResult): void; onPickPlace(id: number): void }`
  - `PlaceList` props: `{ places: PlaceSummary[]; onSelect(id: number): void }`

These are browser components. The project has no browser test runner, so Task 15 checks them by hand. (MapLibre 4.7.1 was verified to load in Node without a browser, so server rendering of this component is safe.)

- [ ] **Step 1: Write `MapView`**

`components/MapView.tsx`:
```tsx
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
    const emit = () => {
      const c = map.getCenter();
      const ne = map.getBounds().getNorthEast();
      const radius = Math.min(50000, Math.max(50, haversineM(c.lat, c.lng, ne.lat, ne.lng)));
      latest.current.onMoveEnd({ lat: c.lat, lng: c.lng, radius_m: radius });
    };
    map.on("load", emit);
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
```

- [ ] **Step 2: Write `PlaceList`**

`components/PlaceList.tsx`:
```tsx
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
```

- [ ] **Step 3: Write `SearchBox`**

`components/SearchBox.tsx`:
```tsx
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
```

- [ ] **Step 4: Typecheck, run tests, commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: pass.

```bash
git add -A
git commit -m "feat(ui): map, search box, and place list components" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Place detail, entry form (add, edit, password warning), app shell

**Files:**
- Create: `components/PlaceDetail.tsx`, `components/EntryForm.tsx`, `components/App.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: Tasks 11 and 12.
- Produces:
  - `PlaceDetail` props: `{ detail: PlaceDetailData; onBack(): void; onAddEntry(): void; onEdit(entry: PublicEntry): void; onVote(entryId: number, kind: "works" | "broken"): void; onReport(entryId: number): void; myVotes: Record<number, "works" | "broken">; reported: Record<number, boolean> }`. Import the type as `PlaceDetail as PlaceDetailData` to avoid a name clash.
  - `EntryForm` props: `{ mode: "entry" | "place" | "edit"; title: string; initial?: Partial<EntryFormValues>; onSubmit(v: EntryFormValues): void | Promise<void>; onClose(): void }` and `type EntryFormValues = { placeName: string; placeCategory: Category; label: string; access_type: AccessType; steps_text: string; language: Language; password: string; password_is_public: boolean; password_clear: boolean; website: string }`.

- [ ] **Step 1: Write `PlaceDetail`**

`components/PlaceDetail.tsx`:
```tsx
import { directionsUrl } from "@/lib/directions";
import { ACCESS_LABEL, CATEGORY_LABEL } from "@/lib/labels";
import { timeAgo } from "@/lib/time";
import type { PlaceDetail as PlaceDetailData, PublicEntry } from "@/lib/types";

interface Props {
  detail: PlaceDetailData;
  onBack(): void;
  onAddEntry(): void;
  onEdit(entry: PublicEntry): void;
  onVote(entryId: number, kind: "works" | "broken"): void;
  onReport(entryId: number): void;
  myVotes: Record<number, "works" | "broken">;
  reported: Record<number, boolean>;
}

export function PlaceDetail({ detail, onBack, onAddEntry, onEdit, onVote, onReport, myVotes, reported }: Props) {
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
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `EntryForm`**

`components/EntryForm.tsx`:
```tsx
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
}

const EMPTY: EntryFormValues = {
  placeName: "", placeCategory: "cafe", label: "", access_type: "open", steps_text: "",
  language: "en", password: "", password_is_public: false, password_clear: false, website: "",
};

const HEADINGS = { entry: "Add WiFi info", place: "Add a missing place", edit: "Edit WiFi info" } as const;

export function EntryForm({ mode, title, initial, onSubmit, onClose }: Props) {
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
```

- [ ] **Step 3: Write the app shell**

`components/App.tsx`:
```tsx
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

export function App() {
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [center, setCenter] = useState({ lat: 41.0136, lng: 28.9784 });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom: number; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
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
  }, [showToast]);

  const onMoveEnd = useCallback((v: { lat: number; lng: number; radius_m: number }) => {
    view.current = v;
    setCenter({ lat: v.lat, lng: v.lng });
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(loadNearby, 350);
  }, [loadNearby]);

  const select = useCallback(async (id: number, fly = true) => {
    setSelectedId(id);
    try {
      const d = await fetchPlace(id);
      setDetail(d);
      if (fly) setFlyTo({ lat: d.lat, lng: d.lng, zoom: 15, nonce: Date.now() });
    } catch (e) {
      showToast(messageFor(e));
      setSelectedId(null);
      setDetail(null);
    }
  }, [showToast]);

  useEffect(() => () => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

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
    setForm({
      mode: "edit", entryId: e.id, placeId: detail.id, placeName: detail.name,
      initial: { label: e.label, access_type: e.access_type, steps_text: e.steps_text, language: e.language },
    });
  };

  const submitForm = async (v: EntryFormValues) => {
    if (!form) return;
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
    } catch (e) { showToast(messageFor(e)); }
  };

  const visible = places.filter((p) => {
    if (filter === "has" && p.entry_count === 0) return false;
    if (filter === "none" && p.entry_count > 0) return false;
    if (query && !p.name.toLowerCase().includes(query)) return false;
    return true;
  });

  const pickLocation = (r: GeocodeResult) => {
    setSelectedId(null);
    setDetail(null);
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
              onBack={() => { setSelectedId(null); setDetail(null); }}
              onAddEntry={() => setForm({ mode: "entry", placeId: detail.id, placeName: detail.name })}
              onEdit={startEdit}
              onVote={vote}
              onReport={report}
            />
          ) : (
            <PlaceList places={visible} onSelect={(id) => select(id)} />
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
          onSelect={(id) => select(id)}
          onMoveEnd={onMoveEnd}
          onPick={(p) => setForm({ mode: "place", lat: p.lat, lng: p.lng })}
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
          onSubmit={submitForm}
          onClose={() => { if (form.mode === "place") setPickMode(false); setForm(null); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Replace the page**

`app/page.tsx`:
```tsx
import { App } from "@/components/App";

export default function Page() {
  return <App />;
}
```

- [ ] **Step 5: Typecheck, build, test, commit**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: all pass. A name clash for `PlaceDetail` means a file imports the type without the `PlaceDetailData` alias.

```bash
git add -A
git commit -m "feat(ui): place detail with edit, entry form with password warning, app shell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Terms and privacy pages

**Files:**
- Create: `app/terms/page.tsx`, `app/privacy/page.tsx`
- Test: `tests/lib/legal-pages.test.ts`

**Interfaces:**
- Consumes: env `CONTACT_EMAIL`.
- Produces: routes `/terms` and `/privacy`, linked from the sidebar footer (Task 13).

The text is a plain starting point, NOT legal advice. Tell the user to have it reviewed before launch (Turkey: KVKK; EU visitors: GDPR).

- [ ] **Step 1: Write the failing test**

`tests/lib/legal-pages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

describe("legal pages", () => {
  it("privacy page names the device cookie, IP hashing, third parties, and the contact", () => {
    const html = renderToStaticMarkup(PrivacyPage());
    for (const text of ["wnm_device", "hash", "OpenStreetMap", "Google Maps", "hello@example.com"]) {
      expect(html).toContain(text);
    }
  });

  it("terms page states the password rule and the takedown contact", () => {
    const html = renderToStaticMarkup(TermsPage());
    expect(html).toContain("shows it in public");
    expect(html).toContain("hello@example.com");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/legal-pages.test.ts`
Expected: FAIL, cannot resolve `@/app/privacy/page`.

- [ ] **Step 3: Write the pages**

`app/terms/page.tsx`:
```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms – WiFi Near Me" };

export default function TermsPage() {
  const contact = process.env.CONTACT_EMAIL || "(contact address not set)";
  return (
    <main className="page">
      <p><a href="/">← Back to the map</a></p>
      <h1>Terms of use</h1>
      <p>WiFi Near Me is a free map. Travelers share how to connect to WiFi at public places.</p>

      <h2>What you may share</h2>
      <ul>
        <li>Steps to connect, such as “ask the staff” or “open the login page”.</li>
        <li>A password ONLY if the place shows it in public, for example on a sign, a menu, or a receipt.</li>
        <li>Do not share private passwords, personal data, insults, advertising, or illegal content.</li>
      </ul>

      <h2>No guarantee</h2>
      <p>Information comes from users and can be old or wrong. Use it at your own risk. Public WiFi can be unsafe: do not send private data on networks you do not trust.</p>

      <h2>Removal</h2>
      <p>We can edit, hide, or remove any entry. If you own or manage a place and want an entry changed or removed, write to {contact}.</p>
    </main>
  );
}
```

`app/privacy/page.tsx`:
```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy – WiFi Near Me" };

export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL || "(contact address not set)";
  return (
    <main className="page">
      <p><a href="/">← Back to the map</a></p>
      <h1>Privacy</h1>
      <p>We collect as little as possible. You do not need an account.</p>

      <h2>What we store</h2>
      <ul>
        <li>The WiFi information that you submit, and its edit history.</li>
        <li>A cookie named <code>wnm_device</code> with a random ID. It makes sure that each browser counts once for votes and reports. It does not track you on other sites.</li>
        <li>A one-way hash of your IP address. We use it to stop spam and abuse. We do not store your IP address itself.</li>
      </ul>

      <h2>What we do not store</h2>
      <p>Your location stays in your browser. To find places, the browser sends the center of the map, not your exact position, and we do not save it.</p>

      <h2>How long we keep data</h2>
      <p>Rate-limit records are deleted after one day. Votes, reports, and entries stay while the entry exists.</p>

      <h2>Other services</h2>
      <ul>
        <li>Map tiles come from our map tile provider. Place data comes from OpenStreetMap.</li>
        <li>Place search uses a geocoding service. Our server sends it your search text.</li>
        <li>The “Directions in Google Maps” button opens Google Maps. Google gets data only after you click it.</li>
        <li>The site runs on Vercel and stores data with Supabase.</li>
      </ul>

      <h2>Contact</h2>
      <p>For questions, or to ask us to delete data, write to {contact}.</p>
    </main>
  );
}
```

- [ ] **Step 4: Run, build, commit**

Run: `npx vitest run tests/lib/legal-pages.test.ts && npx tsc --noEmit && npm run build`
Expected: all pass. The build route table lists `/terms` and `/privacy`. If Vitest cannot parse the JSX in the page files (an error like "Unexpected token '<'"), run `npm install -D @vitejs/plugin-react@4`, add `plugins: [react()]` to `vitest.config.ts`, and remove the `esbuild` line.

```bash
git add -A
git commit -m "feat: terms of use and privacy pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: End-to-end check, README, and deployment notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Get a tile style URL for development**

Choose a tile provider with a free tier and create a key. Put the full MapLibre style JSON URL in `.env` as `NEXT_PUBLIC_TILE_STYLE_URL`. Check the provider's free-tier limits and attribution terms first. Never use `tile.openstreetmap.org`. Set `CONTACT_EMAIL` too.

- [ ] **Step 2: Run the app**

Run:
```bash
npm run db:up
npm run db:migrate
npm run dev
```
Expected: the server starts on `http://localhost:3000`. The map shows Istanbul with the imported places (Task 8, Step 5) as grey pins.

- [ ] **Step 3: Manual end-to-end checklist**

Walk through each item in the browser. Record each result.

- [ ] Map loads, pins appear, and the list is sorted by distance. Moving the map reloads the list.
- [ ] The sidebar footer shows "Place data © OpenStreetMap contributors", "Terms", and "Privacy". Both pages open.
- [ ] Search "taksim": the Locations group shows live results with type labels. Picking one moves the map.
- [ ] A grey pin opens a detail that says "nobody has added WiFi info yet".
- [ ] "+ Add WiFi info" with only spaces in Steps: the save is refused with a message.
- [ ] Type a password AND put the same password in Steps: the warning appears and the button says "Save anyway". Remove it from Steps: the warning goes away.
- [ ] Save a valid entry with a password and the public checkbox. Open `http://localhost:3000/api/places/<id>` in a new tab: the JSON does NOT contain the password (default `EXPOSE_PASSWORDS=false`).
- [ ] Set `EXPOSE_PASSWORDS=true`, restart, reload: the password shows for the entry with the public checkbox only.
- [ ] Press "Edit" on the entry, change the steps, leave the password empty, save: the steps change and the password is kept (check with `npm run moderate -- history <entryId>`, which masks it as "(set)").
- [ ] Vote "Works" twice: the count stays 1. Switch to "Not working": works 0, broken 1.
- [ ] In a private window (new device cookie), vote "Works" on the same entry: works goes up by 1.
- [ ] `curl -X POST -H "content-type: application/json" -H "origin: https://evil.example" -d '{}' http://localhost:3000/api/entries/<id>/report` returns 403.
- [ ] `npm run moderate -- hide <id>`: the entry disappears from the UI. `npm run moderate -- restore <id>`: it comes back.
- [ ] "Add missing place": click the map, fill the form, save. The new pin appears and opens.
- [ ] "Directions in Google Maps" opens a route in a new tab.
- [ ] Put `<script>alert(1)</script>` in Steps: it shows as plain text, with no alert.
- [ ] Phone width (dev tools, 390 px): map on top, list below, form usable, footer visible.
- [ ] With the network turned off in dev tools, type in search: a note says live search is not available. The page still works.

- [ ] **Step 4: Write `README.md`**

```markdown
# WiFi Near Me

Crowdsourced map of how to connect to WiFi in cafes, hotels, airports, and more.

## Run locally
1. `cp .env.example .env`. Set `NEXT_PUBLIC_TILE_STYLE_URL` (a tile provider style URL, not the public OSM server) and `CONTACT_EMAIL`.
2. `npm install`
3. `npm run db:up && npm run db:migrate`
4. Import places: fetch with the Overpass query in `scripts/overpass/istanbul.overpassql`, then `npm run import:osm -- data/istanbul.json TR`.
5. `npm run dev`

`NEXT_PUBLIC_*` values are fixed at build time. After you change one, rebuild.

## Tests
`npm test`. It needs the Docker database (`npm run db:up`). Tests refuse to run against a database whose name does not end in `_test`.

## Moderation
`npm run moderate -- list` shows hidden and pending entries. Other commands: `approve`, `hide`, `restore`, `history`, `revert` (each takes an entry id).
To review every new entry before it shows, set `NEW_ENTRY_STATUS=pending` and approve entries with the tool.

## Abuse controls
- Rate limits are per IP (IPv6 grouped by /64) and generous, because travelers share IPs at airports and hotels.
- Votes and reports count once per browser (cookie `wnm_device`).
- An entry is hidden automatically only after reports from `REPORT_HIDE_THRESHOLD` browsers on at least `REPORT_HIDE_MIN_IPS` different IPs.
- Writes require a same-origin JSON request.
- IP detection trusts `x-forwarded-for`. Vercel sets this header itself. Behind another proxy, confirm that the proxy overwrites it.

## Production (Vercel + Supabase)
- Create a Supabase project. Enable PostGIS in the dashboard, then run `npm run db:migrate` with the production `DATABASE_URL`. The migration enables Row Level Security on every table, which blocks Supabase's automatic REST API. Keep it on.
- Use the Supabase transaction pooler connection string for `DATABASE_URL` and set `DB_PREPARE=false`.
- Set on Vercel: `DATABASE_URL`, `DB_PREPARE`, `ACTOR_SALT` (long random value, required in production), `EXPOSE_PASSWORDS`, `NEW_ENTRY_STATUS`, `REPORT_HIDE_THRESHOLD`, `REPORT_HIDE_MIN_IPS`, `PHOTON_URL`, `CONTACT_EMAIL`, `NEXT_PUBLIC_TILE_STYLE_URL`.
- Geocoder: the public Photon server has no guaranteed capacity. If search gets throttled, self-host Photon or use a paid geocoder and change `PHOTON_URL` (the response format must match Photon, or `lib/geocode.ts` must be adapted).

## Where the rules live
- Password exposure: `lib/serializers/wifiEntry.ts`
- All user writes and the future sign-in check: `lib/services/submission.ts`, `lib/services/guard.ts`
- Moderator writes: `lib/moderation.ts`
- Cross-site protection: `assertSameOriginJson` in `lib/http.ts`
```

- [ ] **Step 5: Run the full verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 6: Open items to confirm before launch (not code)**

These were not verified during research. Check each one and record the answer in the README:
1. Does Supabase PostGIS install into the `extensions` schema, and do the `ST_*` calls work without a schema prefix? If not, set the database `search_path` to include `extensions`.
2. Free-tier limits and attribution rules of the chosen tile provider.
3. Usage rules of the public Photon server, or the paid geocoder chosen instead.
4. Whether the Vercel plan allows enough database connections with the pooler string.
5. Legal review of `/terms` and `/privacy` (KVKK for Turkey, GDPR for EU visitors), including whether the `wnm_device` cookie needs a notice or consent banner.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "docs: README with setup, moderation, abuse controls, and deployment notes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git remote -v
```
If `git remote -v` shows a remote, run `git push -u origin main`. If it shows nothing, tell the user that there is no remote to push to. Never force-push.

Report the checklist results to the user.

---

## Self-Review Notes

- **Spec coverage:** map and search (Tasks 9, 12, 13); OSM seed as empty pins (Task 8); password as a record field controlled by the backend (Tasks 3, 4, 7); anonymous with future-proofing: nullable `submitter_id`, one `Guard`, `status`, revisions (Tasks 2, 6); `editEntry` with revisions (Tasks 6, 7, 13); abuse control: per-IP limits, device-based votes and reports, honeypot, length limits, auto-hide with an IP floor, same-origin check (Tasks 3, 5, 6, 7); moderation (Task 10); votes and reports (Task 6); add missing place (Tasks 6, 13); directions button (Tasks 11, 13); server-side geocoder with limit and cache (Task 9); legal pages and takedown contact (Task 14); Supabase and Vercel notes (Task 15).
- **Deliberately not covered:** full Turkish translation of the interface (follow-up plan); a real production deployment (Task 15 writes notes only); automated browser tests for the React components (manual checklist in Task 15); merging user-added places with later OSM imports; removing places that closed in OSM.
- **Changes from the spec:** the `disputed` status and the `ask_staff` password policy were removed because no flow used them. Vote counts show reliability instead. Add them back with a migration if a flow needs them.
- **Types:** `Sql`, `Actor` (`ipHash`, `deviceHash`, `userId`), `EntryRow`, `PublicEntry`, `PlaceSummary`, `PlaceDetail`, `GeocodeResult`, `EntryBody`, `EntryEditBody`, `EntryFormValues`, `Limits`, `ReviewRow` are each defined once and used with the same names later.
- **Known risks covered by tests:** postgres.js transaction casts (`as unknown as Sql`), the `::text::jsonb` pattern (Tasks 6, 8, 10), `sql(array)` in `IN` lists (Tasks 2, 10), advisory-lock rate limiting under parallel load (Task 5), and `clock_timestamp()` for `updated_at` on edits (Task 6).
