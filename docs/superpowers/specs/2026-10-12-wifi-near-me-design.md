# WiFi Near Me: Design and Build Plan

## Context

Travelers (example: a visitor in Turkey) cannot easily learn how to connect to WiFi at cafes, hotels, and airports. Existing apps (WiFi Map, Instabridge) are mobile apps with paywalls, ads, and passwords only. They give no connection steps (portal login, SMS code, "ask staff").

This project is a free, crowdsourced web app. A user shares a location or types a place name, sees a map of nearby places, and learns how to connect at each one.

**Value:** connection instructions + free + travel focus.
**Not a goal:** exact network scanning, wardriving data, or a router database. Data is per place, not per router.

## Decisions (agreed with user)

| Topic | Decision |
|---|---|
| Main view | Map. Search by place name or "use my location". |
| Seed data | Import places from OpenStreetMap (OSM) as empty pins. Users add WiFi info. Users can also add a missing place. |
| Passwords | Stored as a normal field in each record. One serializer function in the backend decides if the field is sent in a response. Default: hidden until a policy says otherwise. |
| Accounts | Anonymous submissions at first. Design must allow sign-up, guarded edits, and moderation later. |
| Stack | Next.js (TypeScript), Postgres + PostGIS (Supabase), MapLibre GL JS |
| Hosting | Managed: Vercel + Supabase |
| Data model | Two relational tables with all seeded places now. Keep `osm_id` so a move to "lazy places" (only store places that have WiFi data) is possible later. |
| Cost target | About $0 per month for prototype. About $25 to $80 per month at early growth (estimates, verify on pricing pages). |

## Architecture

```
Browser (Next.js pages + MapLibre)
   |  search / nearby / place detail / submit / vote / report
Next.js server routes (API)
   |  all writes go through ONE submission service (the future guard point)
   |  all reads go through ONE serializer (controls password exposure)
Supabase Postgres + PostGIS
   places, wifi_entries, wifi_entry_revisions, votes, reports
External: map tile provider (not the public OSM server), geocoder, OSM import script
```

## Data model

```
places                id, osm_type, osm_id (unique), name, category, geom (geography point, GiST index),
                      country_code, source ('osm' | 'user'), created_at
wifi_entries          id, place_id -> places, label (example: "Guest", "Lobby"),
                      access_type (open | password | portal | sms | id_required | ask_staff | customers_only | paid),
                      steps_text, language, password (nullable), password_policy,
                      status (active | pending | hidden | disputed),
                      submitter_id (nullable, future users table), created_at, updated_at
wifi_entry_revisions  id, wifi_entry_id, snapshot (jsonb), submitter_id (nullable), created_at
votes                 id, wifi_entry_id, kind (works | broken), actor_hash, created_at
reports               id, wifi_entry_id, reason, actor_hash, created_at
```

Rules:
- `actor_hash` = hash of IP + salt (anonymous now; can be replaced by user id later).
- Edits write a revision row. Vandalism can be reverted.
- New entries start `active` now. Moderation later changes the default to `pending` with one config change.
- Index: GiST on `places.geom`; btree on `wifi_entries.place_id`; unique on (`osm_type`, `osm_id`).

## Future-proofing for accounts and guarded edits

1. `submitter_id` is nullable today. Adding a `users` table later needs no migration of old rows.
2. One `submitEntry`, `editEntry`, and `vote` service layer. Today it checks only the rate limit. Later it checks session, role, or review status. No page changes.
3. `status` field supports moderation queue later.
4. Revisions support edit history and rollback.

## User flows

1. **Find:** Open site -> "Use my location" or type a place -> map centers there -> pins within the viewport. Pin color: has WiFi info / no info yet. List panel shows nearest places.
2. **View place:** Name, category, list of WiFi entries (access type, steps, last confirmed, works/broken votes). Password shown only if the serializer allows it.
3. **Add info:** On an empty pin, "Add WiFi info". Form: label, access type, steps, optional password, language.
4. **Add missing place:** Drop a pin, enter name and category, then add WiFi info.
5. **Confirm / report:** "Still works", "Not working", "Report".

## OSM seed import

- Script `scripts/import-osm.ts` (or `osm2pgsql` with a style file). Input: Geofabrik extract for one country (start with Turkey).
- Categories: `amenity=cafe|restaurant|bar|library|coworking_space`, `tourism=hotel|hostel|guest_house`, `aeroway=aerodrome|terminal`, `railway=station`.
- Idempotent: upsert by (`osm_type`, `osm_id`). Never delete rows that have WiFi entries.
- Show "© OpenStreetMap contributors" on the map. Public OSM tile server is NOT used.

## Abuse control (anonymous phase)

- Rate limit per `actor_hash` on submit, vote, and report.
- Honeypot form field. Length limits and text sanitizing on `steps_text`.
- Auto-hide an entry when reports pass a threshold.

## Critical files (to be created; project directory is empty)

- `app/page.tsx`, `app/place/[id]/page.tsx`: map and detail UI
- `components/Map.tsx`: MapLibre wrapper (tile URL from env var, never hardcoded)
- `app/api/places/nearby/route.ts`, `app/api/entries/route.ts`, `app/api/votes/route.ts`, `app/api/reports/route.ts`
- `lib/services/submission.ts`: single write guard
- `lib/serializers/wifiEntry.ts`: single place that controls password exposure
- `db/migrations/*.sql`: schema above, PostGIS extension
- `scripts/import-osm.ts`: seed import

## Step 0: Demo with mock data (build this first, before anything else)

The user wants to see the idea before the full build. Scope of the demo:

- One static page: `/home/mohaimen/Desktop/Playground/wifi-near-me/demo/index.html`. No backend, no database, no build step. It opens in a browser with a double click, or with a simple local file server.
- Map: MapLibre GL JS from a CDN (pinned version) with a free OSM-based raster style for the demo only. Attribution "© OpenStreetMap contributors" is visible.
- Mock data: a JavaScript array in `demo/mock-data.js` with about 25 to 40 places in Istanbul and Antalya (airports, hotels, cafes, a train station). Mix of: places with several WiFi entries (open, password, portal, SMS, ask staff), and empty pins ("No info yet"). Mock passwords are fake. Data shape matches the real data model above, so the real build can reuse it.
- Features shown: search box (matches mock place names and city names), "Use my location" button (falls back to Istanbul if denied), pin colors (has info / no info), nearby list sorted by distance, place detail panel with WiFi entries, access-type badges, works/broken vote buttons, report button, "Add WiFi info" form, and "Add missing place" by clicking the map. Submissions are saved in memory or `localStorage` only and are marked as demo.
- Password demo: a toggle labeled "Backend allows passwords" shows how the serializer controls exposure. Default is hidden.
- Mobile layout works at phone width.
- Out of scope for the demo: real API, real OSM import, rate limits, accounts.
- Verification: open the page, run a search, click pins, vote, add an entry, toggle the password switch. Check the browser console for errors and check the phone-width layout.

**Status: DONE and APPROVED by the user.** Files: `demo/index.html`, `demo/mock-data.js`.

Changes made after first review (carry these into the real build):
- Grey pin wording: "No WiFi info yet — add it!" (legend, list, filter chip, empty place text).
- Search: live suggestions from the Photon geocoder (debounce 300 ms, min 2 characters, abort old requests, bias to map center, de-duplicate, label with place type, fall back to local places on error). Real build: call the geocoder from a server route, not from the browser. Check provider free-tier limits before launch.
- Place detail has a "Directions in Google Maps" link: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`. No API key, no billing, no backend change. Opens in a new tab with `rel="noopener noreferrer"`.
- List and pins render at once and do not wait for map tiles.
- Demo UI behavior is the reference for the real UI (layout, flows, access types, form fields).

## Build order

1. Scaffold Next.js, Supabase project, PostGIS, migrations.
2. Import OSM places for one city, then Turkey.
3. Map view + nearby query + search.
4. Place detail + read serializer (password hidden by default).
5. Submission service + form + rate limit.
6. Votes, reports, auto-hide.
7. Add missing place flow.
8. Polish for mobile, language support (Turkish and English), deploy.

## Verification

- Unit tests: serializer never returns `password` unless policy allows; submission service enforces rate limit; revision row written on edit.
- Integration test: nearby query returns places inside radius and orders by distance (test on seeded Istanbul data).
- Import test: running the import twice makes no duplicates and keeps existing WiFi entries.
- Manual end-to-end: run locally, share location, see pins, add an entry to an empty pin, confirm it appears, confirm password hidden in API response, vote and report.
- Mobile check: test map and form on a phone-sized viewport.

## Open items to verify before launch

- Current free-tier limits of the chosen tile provider and geocoder (not confirmed in research).
- Supabase PostGIS availability and plan limits on the official pricing page.
- Legal text: terms of use that tell users to share only passwords the venue shows publicly; takedown contact for venue owners.
