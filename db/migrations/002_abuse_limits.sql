-- Network group of the reporter (IPv4 /24, IPv6 /48). Auto-hide counts distinct groups, so many
-- addresses from one network count once. Older rows have NULL and fall back to ip_hash.
ALTER TABLE reports ADD COLUMN ip_group_hash text;

-- The per-IP cap counts rows by entry and IP.
CREATE INDEX votes_entry_ip_idx ON votes (wifi_entry_id, ip_hash);
CREATE INDEX reports_entry_ip_idx ON reports (wifi_entry_id, ip_hash);
