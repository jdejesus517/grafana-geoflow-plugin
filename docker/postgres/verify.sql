-- Sanity checks for the seeded fixtures. Run with:
--   docker compose exec postgres psql -U geoflow_admin -d geoflow -f /verify.sql
-- (or pipe this file into psql). Every "ok" column should be true.

SELECT 'buildings' AS relation, count(*) AS rows, count(*) = 9 AS ok FROM geoflow.buildings
UNION ALL SELECT 'patch_panels', count(*), count(*) = 11 FROM geoflow.patch_panels
UNION ALL SELECT 'splice_cases', count(*), count(*) = 7 FROM geoflow.splice_cases
UNION ALL SELECT 'fiber_cables', count(*), count(*) = 15 FROM geoflow.fiber_cables
UNION ALL SELECT 'fiber_cables_stateplane', count(*), count(*) = 15 FROM geoflow.fiber_cables_stateplane
UNION ALL SELECT 'edge_cases', count(*), count(*) = 6 FROM geoflow.edge_cases
UNION ALL SELECT 'network_assets', count(*), count(*) = 42 FROM geoflow.network_assets
UNION ALL SELECT 'service_locations_large', count(*), count(*) = 100000 FROM geoflow.service_locations_large;

-- All six GeoJSON geometry types are present in network_assets.
SELECT GeometryType(geom) AS geometry_type, count(*) FROM geoflow.network_assets GROUP BY 1 ORDER BY 1;

-- The data center footprint has exactly one interior ring (courtyard).
SELECT name, ST_NumInteriorRings(geom) = 1 AS ok FROM geoflow.buildings WHERE id = 6;

-- Every cable endpoint coincides with the asset named in from_asset / to_asset.
WITH endpoints AS (
  SELECT c.name, e.which, e.asset, e.pt
  FROM geoflow.fiber_cables c,
  LATERAL (VALUES
    ('from', c.from_asset, ST_StartPoint(ST_GeometryN(c.geom, 1))),
    ('to',   c.to_asset,   ST_EndPoint(ST_GeometryN(c.geom, ST_NumGeometries(c.geom))))
  ) AS e(which, asset, pt)
),
assets AS (
  SELECT 'splice_case:' || id AS asset, geom FROM geoflow.splice_cases
  UNION ALL
  SELECT 'patch_panel:' || id, geom FROM geoflow.patch_panels
)
SELECT count(*) AS endpoints, count(*) FILTER (WHERE ST_Intersects(e.pt, a.geom)) AS matched,
       count(*) = count(*) FILTER (WHERE ST_Intersects(e.pt, a.geom)) AS ok
FROM endpoints e LEFT JOIN assets a USING (asset);

-- Every patch panel lies inside its building.
SELECT count(*) FILTER (WHERE NOT ST_Within(p.geom, b.geom)) = 0 AS panels_inside_buildings_ok
FROM geoflow.patch_panels p JOIN geoflow.buildings b ON b.id = p.building_id;

-- The read-only role can read but not write.
SELECT has_table_privilege('grafana_reader', 'geoflow.buildings', 'SELECT') AS reader_select_ok,
       NOT has_table_privilege('grafana_reader', 'geoflow.buildings', 'INSERT') AS reader_no_insert_ok;
