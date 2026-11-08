-- GeoFlow network fixtures (docs/node-edge/phase_1.md, Design §7): a small, fictional backbone
-- of sites and the trunks between them, for node-edge maps.
--
-- Site ids are integers and trunk ends are text, as often happens between tables: GeoFlow
-- matches them as text (docs/node-edge/architecture.md, decision 13). The tables hold only good
-- rows; dashboards add problem rows in their own SQL, so other queries don't have to filter them.
-- Runs after 05_reader_role.sh, whose default privileges let grafana_reader read these tables.

CREATE TABLE geoflow.sites (
  site_id  integer PRIMARY KEY,
  name     text NOT NULL,
  kind     text NOT NULL,                -- core | aggregation | edge
  geom     geometry(Point, 4326) NOT NULL
);

CREATE TABLE geoflow.trunks (
  trunk_id          text PRIMARY KEY,
  a_site            text NOT NULL,       -- a site_id, as text
  z_site            text NOT NULL,
  medium            text NOT NULL,       -- fiber | microwave
  capacity_gbps     numeric NOT NULL,
  utilization_gbps  numeric NOT NULL
);

INSERT INTO geoflow.sites (site_id, name, kind, geom) VALUES
  (1, 'CARY-CORE',     'core',        ST_SetSRID(ST_MakePoint(-78.7811, 35.7915), 4326)),
  (2, 'CARY-NORTH',    'aggregation', ST_SetSRID(ST_MakePoint(-78.7900, 35.8090), 4326)),
  (3, 'MORRISVILLE',   'edge',        ST_SetSRID(ST_MakePoint(-78.8253, 35.8235), 4326)),
  (4, 'APEX',          'aggregation', ST_SetSRID(ST_MakePoint(-78.8503, 35.7327), 4326)),
  (5, 'RALEIGH-WEST',  'edge',        ST_SetSRID(ST_MakePoint(-78.7130, 35.7930), 4326)),
  (6, 'RALEIGH-CORE',  'core',        ST_SetSRID(ST_MakePoint(-78.6382, 35.7796), 4326)),
  (7, 'GARNER',        'edge',        ST_SetSRID(ST_MakePoint(-78.6142, 35.7113), 4326)),
  (8, 'HOLLY-SPRINGS', 'edge',        ST_SetSRID(ST_MakePoint(-78.8336, 35.6513), 4326));

-- 14 trunks over 6 pairs. CARY-CORE and RALEIGH-CORE share four, in both directions;
-- RALEIGH-WEST has none, which is fine for a node.
INSERT INTO geoflow.trunks (trunk_id, a_site, z_site, medium, capacity_gbps, utilization_gbps) VALUES
  ('TRK-001', '1', '6', 'fiber',     100, 62),
  ('TRK-002', '6', '1', 'fiber',     100, 71),
  ('TRK-003', '1', '6', 'fiber',      10,  9.2),
  ('TRK-004', '6', '1', 'microwave',   1,  0.4),
  ('TRK-005', '1', '2', 'fiber',      10,  3.1),
  ('TRK-006', '2', '1', 'fiber',      10,  2.7),
  ('TRK-007', '2', '3', 'fiber',      10,  5.5),
  ('TRK-008', '1', '4', 'fiber',      40, 12),
  ('TRK-009', '4', '1', 'fiber',      40, 30),
  ('TRK-010', '1', '4', 'microwave',   1,  0.9),
  ('TRK-011', '6', '7', 'fiber',      10,  8.8),
  ('TRK-012', '7', '6', 'fiber',      10,  4.2),
  ('TRK-013', '6', '7', 'fiber',      10,  6.0),
  ('TRK-014', '4', '8', 'microwave',   1,  0.3);
