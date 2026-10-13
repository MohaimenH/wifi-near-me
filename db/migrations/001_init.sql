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
