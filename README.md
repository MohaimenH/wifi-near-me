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

## Open items before launch (not verified)
These items were not verified. Check each one before launch and write the answer here.
1. **Supabase PostGIS schema.** Open (not verified). Does PostGIS install into the `extensions` schema, and do the `ST_*` calls work without a schema prefix? If not, set the database `search_path` to include `extensions`.
2. **Tile provider terms.** Open (not verified). Free-tier limits and attribution rules of the chosen tile provider. Choose a provider and set a real `NEXT_PUBLIC_TILE_STYLE_URL` before launch.
3. **Geocoder terms.** Open (not verified). Usage rules of the public Photon server, or of the paid geocoder chosen instead.
4. **Database connections.** Open (not verified). Does the Vercel plan allow enough database connections with the pooler string?
5. **Legal review.** Open (not verified). Legal review of `/terms` and `/privacy` (KVKK for Turkey, GDPR for EU visitors), including whether the `wnm_device` cookie needs a notice or consent banner. Set a real `CONTACT_EMAIL` (the takedown contact) before launch.
