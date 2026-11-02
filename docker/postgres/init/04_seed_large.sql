-- 100k synthetic customer premises spread over a bounding box covering Cary, NC,
-- for performance testing. setseed() makes the generated data reproducible.
SELECT setseed(0.42);

INSERT INTO geoflow.service_locations_large (id, service_tier, status, updated_at, geom)
SELECT
  n,
  (ARRAY['300M', '1G', '2G', '5G'])[1 + floor(random() * 4)::int],
  CASE WHEN random() < 0.9 THEN 'in_service' ELSE 'planned' END::geoflow.asset_status,
  timestamptz '2026-10-01 00:00:00+00' + make_interval(secs => floor(random() * 30 * 86400)),
  ST_SetSRID(ST_MakePoint(-78.90 + random() * 0.16, 35.70 + random() * 0.14), 4326)
FROM generate_series(1, 100000) AS n;

ANALYZE geoflow.service_locations_large;
