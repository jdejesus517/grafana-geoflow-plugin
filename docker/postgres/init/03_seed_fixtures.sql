-- Fixture data: a small FICTIONAL fiber optic network in downtown Cary, NC.
--
-- Building footprints and cable routes are hand-drawn approximations. They are not
-- traced from real buildings and do not depict any real operator's infrastructure.
-- Addresses are fictional.
--
-- Topology: the central office feeds backbone cables east through splice cases
-- SC-01..SC-04; distribution and drop cables branch from those splice cases to patch
-- panels inside buildings. Cable endpoints coincide exactly with the patch panel or
-- splice case they connect to. Ids are fixed: e2e tests assert on them.
--
-- Geometry types covered: Polygon (incl. one with a hole), MultiPolygon, LineString,
-- MultiLineString, Point, MultiPoint.

-- Axis-aligned rectangle centered on (cx, cy), half-sizes in degrees.
CREATE FUNCTION pg_temp.box(cx float8, cy float8, dx float8 DEFAULT 0.00025, dy float8 DEFAULT 0.00018)
RETURNS geometry LANGUAGE sql IMMUTABLE AS $$
  SELECT ST_MakeEnvelope(cx - dx, cy - dy, cx + dx, cy + dy, 4326)
$$;

INSERT INTO geoflow.buildings (id, name, building_type, address, floors, status, installed_on, updated_at, geom) VALUES
  (1, 'Cary Central Office',    'central_office', '100 Exchange Pl',     2, 'in_service', '2015-03-02', '2026-10-01 14:00:00+00', pg_temp.box(-78.7880, 35.7880, 0.0003, 0.0002)),
  (2, 'Academy Square Offices', 'commercial',     '210 Academy Sq',      4, 'in_service', '2019-06-17', '2026-10-02 14:00:00+00', pg_temp.box(-78.7815, 35.7885)),
  (3, 'Chatham Street Lofts',   'multi_family',   '305 Loft Row',        5, 'in_service', '2020-09-08', '2026-10-03 14:00:00+00', pg_temp.box(-78.7790, 35.7905)),
  (4, 'Harrison Plaza',         'commercial',     '412 Plaza Ct',        3, 'in_service', '2021-01-25', '2026-10-04 14:00:00+00', pg_temp.box(-78.7760, 35.7860)),
  (5, 'Walnut Commons',         'multi_family',   '520 Commons Way',     3, 'in_service', '2021-11-15', '2026-10-05 14:00:00+00', pg_temp.box(-78.7845, 35.7835)),
  -- Data center with an interior courtyard: a Polygon with one hole.
  (6, 'Triangle Data Hub',      'data_center',    '600 Datacenter Dr',   2, 'in_service', '2022-04-11', '2026-10-06 14:00:00+00',
      ST_Difference(pg_temp.box(-78.7745, 35.7925, 0.0005, 0.0003), pg_temp.box(-78.7745, 35.7925, 0.00012, 0.00009))),
  (7, 'Park Street Retail',     'commercial',     '701 Market Walk',     1, 'in_service', '2023-02-20', '2026-10-07 14:00:00+00', pg_temp.box(-78.7900, 35.7930)),
  (8, 'Kildaire Medical',       'commercial',     '815 Clinic Ln',       3, 'planned',    '2026-12-01', '2026-10-08 14:00:00+00', pg_temp.box(-78.7870, 35.7810)),
  -- Campus of two detached buildings: a MultiPolygon.
  (9, 'Ashworth Campus',        'campus',         '900 Campus Loop',     2, 'planned',    '2027-03-01', '2026-10-09 14:00:00+00',
      ST_Collect(pg_temp.box(-78.7790, 35.7815), pg_temp.box(-78.7778, 35.7806, 0.00015, 0.00012)));

INSERT INTO geoflow.splice_cases (id, name, enclosure_type, mount, splice_capacity, splices_used, status, installed_on, updated_at, geom) VALUES
  (1, 'SC-01', 'dome',   'handhole', 144, 36, 'in_service', '2015-03-02', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7860, 35.7880), 4326)),
  (2, 'SC-02', 'dome',   'pole',      96, 24, 'in_service', '2019-06-17', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7830, 35.7880), 4326)),
  (3, 'SC-03', 'inline', 'vault',    288, 60, 'in_service', '2019-06-17', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7800, 35.7880), 4326)),
  (4, 'SC-04', 'dome',   'handhole', 144, 30, 'in_service', '2021-01-25', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7770, 35.7880), 4326)),
  (5, 'SC-05', 'dome',   'pole',      48, 12, 'in_service', '2023-02-20', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7880, 35.7910), 4326)),
  (6, 'SC-06', 'dome',   'handhole',  48, 18, 'in_service', '2021-11-15', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7845, 35.7855), 4326)),
  (7, 'SC-07', 'inline', 'handhole',  24,  0, 'retired',    '2012-05-30', '2026-10-10 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7815, 35.7860), 4326));

INSERT INTO geoflow.patch_panels (id, name, building_id, rack, port_count, ports_used, status, installed_on, updated_at, geom) VALUES
  (1,  'CO-PP-01',   1, 'R01',        144, 96, 'in_service', '2015-03-02', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7881, 35.78805), 4326)),
  (2,  'CO-PP-02',   1, 'R02',        144, 40, 'in_service', '2023-02-20', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7879, 35.78795), 4326)),
  (3,  'ACAD-PP-01', 2, 'MDF',         24, 18, 'in_service', '2019-06-17', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7815, 35.78845), 4326)),
  (4,  'CHAT-PP-01', 3, 'MDF',         24, 20, 'in_service', '2020-09-08', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7791, 35.7905), 4326)),
  (5,  'HARR-PP-01', 4, 'MDF',         48, 12, 'in_service', '2021-01-25', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7761, 35.7860), 4326)),
  (6,  'WALN-PP-01', 5, 'MDF',         24, 22, 'in_service', '2021-11-15', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7845, 35.7836), 4326)),
  -- Panel group spanning three racks in the data center: a MultiPoint.
  (7,  'TDH-PP-GRP', 6, 'R01-R03',    288, 200, 'in_service', '2022-04-11', '2026-10-11 14:00:00+00',
       ST_GeomFromText('MULTIPOINT((-78.7748 35.7924), (-78.7748 35.7927), (-78.7742 35.7927))', 4326)),
  (8,  'PARK-PP-01', 7, 'MDF',         12,  6, 'in_service', '2023-02-20', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7899, 35.7930), 4326)),
  (9,  'KILD-PP-01', 8, 'MDF',         24,  0, 'planned',    '2026-12-01', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7869, 35.7810), 4326)),
  (10, 'ASH-PP-01',  9, 'Bldg A MDF',  12,  0, 'planned',    '2027-03-01', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7791, 35.7815), 4326)),
  (11, 'ASH-PP-02',  9, 'Bldg B IDF',  12,  0, 'planned',    '2027-03-01', '2026-10-11 14:00:00+00', ST_SetSRID(ST_MakePoint(-78.7778, 35.7806), 4326));

INSERT INTO geoflow.fiber_cables (id, name, cable_type, fiber_count, placement, from_asset, to_asset, status, installed_on, updated_at, geom) VALUES
  -- Backbone: central office east along the main route.
  (1,  'BB-01', 'backbone',     144, 'underground', 'patch_panel:1', 'splice_case:1', 'in_service', '2015-03-02', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7881 35.78805, -78.7875 35.78805, -78.7860 35.7880)', 4326)),
  (2,  'BB-02', 'backbone',     144, 'underground', 'splice_case:1', 'splice_case:2', 'in_service', '2019-06-17', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7860 35.7880, -78.7830 35.7880)', 4326)),
  (3,  'BB-03', 'backbone',     144, 'aerial',      'splice_case:2', 'splice_case:3', 'in_service', '2019-06-17', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7830 35.7880, -78.7800 35.7880)', 4326)),
  -- Aerial span and underground span recorded as separate parts: a MultiLineString.
  (4,  'BB-04', 'backbone',     144, 'mixed',       'splice_case:3', 'splice_case:4', 'in_service', '2021-01-25', '2026-10-12 14:00:00+00',
       ST_GeomFromText('MULTILINESTRING((-78.7800 35.7880, -78.7785 35.7880), (-78.7785 35.7880, -78.7770 35.7880))', 4326)),
  -- Distribution.
  (5,  'DS-01', 'distribution',  48, 'aerial',      'patch_panel:2', 'splice_case:5', 'in_service', '2023-02-20', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7879 35.78795, -78.7879 35.7895, -78.7880 35.7910)', 4326)),
  (6,  'DS-02', 'distribution',  48, 'underground', 'splice_case:1', 'splice_case:6', 'in_service', '2021-11-15', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7860 35.7880, -78.7860 35.7855, -78.7845 35.7855)', 4326)),
  (7,  'DS-03', 'distribution',  48, 'underground', 'splice_case:4', 'patch_panel:7', 'in_service', '2022-04-11', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7770 35.7880, -78.7770 35.7924, -78.7748 35.7924)', 4326)),
  -- Drops to buildings.
  (8,  'DR-01', 'drop',          12, 'aerial',      'splice_case:2', 'patch_panel:3', 'in_service', '2019-06-17', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7830 35.7880, -78.7815 35.7880, -78.7815 35.78845)', 4326)),
  (9,  'DR-02', 'drop',          24, 'aerial',      'splice_case:3', 'patch_panel:4', 'in_service', '2020-09-08', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7800 35.7880, -78.7800 35.7905, -78.7791 35.7905)', 4326)),
  (10, 'DR-03', 'drop',          24, 'underground', 'splice_case:4', 'patch_panel:5', 'in_service', '2021-01-25', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7770 35.7880, -78.7770 35.7860, -78.7761 35.7860)', 4326)),
  (11, 'DR-04', 'drop',          12, 'underground', 'splice_case:6', 'patch_panel:6', 'in_service', '2021-11-15', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7845 35.7855, -78.7845 35.7836)', 4326)),
  (12, 'DR-05', 'drop',          12, 'aerial',      'splice_case:5', 'patch_panel:8', 'in_service', '2023-02-20', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7880 35.7910, -78.7880 35.7930, -78.7899 35.7930)', 4326)),
  (13, 'DR-06', 'drop',          12, 'underground', 'splice_case:6', 'patch_panel:9', 'planned',    '2026-12-01', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7845 35.7855, -78.7855 35.7855, -78.7855 35.7810, -78.7869 35.7810)', 4326)),
  (14, 'DR-07', 'drop',          24, 'underground', 'splice_case:3', 'patch_panel:10', 'planned',   '2027-03-01', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7800 35.7880, -78.7800 35.7815, -78.7791 35.7815)', 4326)),
  (15, 'DR-08', 'drop',          12, 'underground', 'patch_panel:10', 'patch_panel:11', 'planned',  '2027-03-01', '2026-10-12 14:00:00+00',
       ST_GeomFromText('LINESTRING(-78.7791 35.7815, -78.7784 35.7815, -78.7784 35.7806, -78.7778 35.7806)', 4326));

UPDATE geoflow.fiber_cables SET length_m = round(ST_Length(geom::geography)::numeric, 1);

-- Same cables in NAD83 / North Carolina (ftUS), the coordinate system local NC GIS data
-- commonly uses. Querying this without ST_Transform(geom, 4326) yields out-of-range coordinates.
CREATE TABLE geoflow.fiber_cables_stateplane AS
  SELECT id, name, cable_type, fiber_count, placement, status, updated_at,
         ST_Transform(geom, 2264)::geometry(Geometry, 2264) AS geom
  FROM geoflow.fiber_cables;
ALTER TABLE geoflow.fiber_cables_stateplane ADD PRIMARY KEY (id);
CREATE INDEX fiber_cables_stateplane_geom_idx ON geoflow.fiber_cables_stateplane USING gist (geom);

INSERT INTO geoflow.edge_cases (id, name, description, installed_on, updated_at, geom, geojson_text) VALUES
  (1, 'EC-NULL',       'NULL geometry',                                   '2026-01-01', '2026-10-13 14:00:00+00', NULL, NULL),
  (2, 'EC-EMPTY',      'Empty point geometry',                            '2026-01-01', '2026-10-13 14:00:00+00', ST_GeomFromText('POINT EMPTY', 4326), NULL),
  (3, 'EC-COLLECTION', 'GeometryCollection (unsupported type)',           '2026-01-01', '2026-10-13 14:00:00+00',
      ST_GeomFromText('GEOMETRYCOLLECTION(POINT(-78.7820 35.7870), LINESTRING(-78.7825 35.7870, -78.7815 35.7870))', 4326), NULL),
  (4, 'EC-TRUNCATED',  'Valid geometry; geojson_text is truncated JSON',  '2026-01-01', '2026-10-13 14:00:00+00',
      ST_SetSRID(ST_MakePoint(-78.7820, 35.7875), 4326), '{"type":"Point","coordinates":[-78.782,'),
  (5, 'EC-WKT',        'geojson_text holds WKT instead of GeoJSON',       '2026-01-01', '2026-10-13 14:00:00+00',
      NULL, 'POINT(-78.782 35.7875)'),
  (6, 'EC-PROJECTED',  'geojson_text holds Web Mercator metres, not lon/lat', '2026-01-01', '2026-10-13 14:00:00+00',
      NULL, '{"type":"Point","coordinates":[-8769900.0,4271400.0]}');

-- All network assets in one relation: covers all six geometry types for mixed-geometry
-- tests, and asset_type / status are natural split columns for byColumn layer binding.
CREATE VIEW geoflow.network_assets AS
  SELECT 'building' AS asset_type, 'building:' || id AS asset_id, name, status, installed_on, updated_at, geom
    FROM geoflow.buildings
  UNION ALL
  SELECT 'fiber_cable', 'fiber_cable:' || id, name, status, installed_on, updated_at, geom
    FROM geoflow.fiber_cables
  UNION ALL
  SELECT 'splice_case', 'splice_case:' || id, name, status, installed_on, updated_at, geom
    FROM geoflow.splice_cases
  UNION ALL
  SELECT 'patch_panel', 'patch_panel:' || id, name, status, installed_on, updated_at, geom
    FROM geoflow.patch_panels;
