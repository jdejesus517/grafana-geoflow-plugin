-- GeoFlow fixture schema: a small, fictional fiber optic network.
-- Geometries are stored in WGS84 (EPSG:4326) unless noted. Each table constrains
-- the geometry types it accepts so fixtures exercise specific GeoJSON types.

CREATE SCHEMA IF NOT EXISTS geoflow;

CREATE TYPE geoflow.asset_status AS ENUM ('in_service', 'planned', 'retired');

CREATE TABLE geoflow.buildings (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  building_type text NOT NULL,          -- central_office | commercial | multi_family | data_center | campus
  address       text NOT NULL,          -- fictional
  floors        integer NOT NULL,
  status        geoflow.asset_status NOT NULL DEFAULT 'in_service',
  installed_on  date NOT NULL,
  updated_at    timestamptz NOT NULL,
  geom          geometry(Geometry, 4326) NOT NULL
    CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON'))
);

CREATE TABLE geoflow.patch_panels (
  id              integer PRIMARY KEY,
  name            text NOT NULL,
  building_id     integer NOT NULL REFERENCES geoflow.buildings (id),
  rack            text NOT NULL,
  port_count      integer NOT NULL CHECK (port_count > 0),
  ports_used      integer NOT NULL CHECK (ports_used >= 0),
  utilization_pct numeric(5, 1) GENERATED ALWAYS AS (round(100.0 * ports_used / port_count, 1)) STORED,
  status          geoflow.asset_status NOT NULL DEFAULT 'in_service',
  installed_on    date NOT NULL,
  updated_at      timestamptz NOT NULL,
  geom            geometry(Geometry, 4326) NOT NULL
    CHECK (GeometryType(geom) IN ('POINT', 'MULTIPOINT')),
  CHECK (ports_used <= port_count)
);

CREATE TABLE geoflow.splice_cases (
  id              integer PRIMARY KEY,
  name            text NOT NULL,
  enclosure_type  text NOT NULL,        -- dome | inline
  mount           text NOT NULL,        -- pole | handhole | vault
  splice_capacity integer NOT NULL,
  splices_used    integer NOT NULL,
  status          geoflow.asset_status NOT NULL DEFAULT 'in_service',
  installed_on    date NOT NULL,
  updated_at      timestamptz NOT NULL,
  geom            geometry(Point, 4326) NOT NULL
);

CREATE TABLE geoflow.fiber_cables (
  id           integer PRIMARY KEY,
  name         text NOT NULL,
  cable_type   text NOT NULL,           -- backbone | distribution | drop
  fiber_count  integer NOT NULL,
  placement    text NOT NULL,           -- aerial | underground | mixed
  from_asset   text NOT NULL,           -- e.g. 'patch_panel:1', 'splice_case:2'
  to_asset     text NOT NULL,
  length_m     numeric(10, 1),          -- filled from the geometry after insert
  status       geoflow.asset_status NOT NULL DEFAULT 'in_service',
  installed_on date NOT NULL,
  updated_at   timestamptz NOT NULL,
  geom         geometry(Geometry, 4326) NOT NULL
    CHECK (GeometryType(geom) IN ('LINESTRING', 'MULTILINESTRING'))
);

-- Rows that the panel should skip and report as warnings.
CREATE TABLE geoflow.edge_cases (
  id           integer PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL,
  status       geoflow.asset_status NOT NULL DEFAULT 'in_service',
  installed_on date NOT NULL,
  updated_at   timestamptz NOT NULL,
  geom         geometry(Geometry, 4326),  -- nullable on purpose
  geojson_text text                       -- raw text, possibly malformed GeoJSON
);

-- Synthetic customer premises for performance testing (filled by 04_seed_large.sql).
CREATE TABLE geoflow.service_locations_large (
  id           integer PRIMARY KEY,
  service_tier text NOT NULL,
  status       geoflow.asset_status NOT NULL,
  updated_at   timestamptz NOT NULL,
  geom         geometry(Point, 4326) NOT NULL
);

CREATE INDEX buildings_geom_idx ON geoflow.buildings USING gist (geom);
CREATE INDEX patch_panels_geom_idx ON geoflow.patch_panels USING gist (geom);
CREATE INDEX splice_cases_geom_idx ON geoflow.splice_cases USING gist (geom);
CREATE INDEX fiber_cables_geom_idx ON geoflow.fiber_cables USING gist (geom);
CREATE INDEX edge_cases_geom_idx ON geoflow.edge_cases USING gist (geom);
CREATE INDEX service_locations_large_geom_idx ON geoflow.service_locations_large USING gist (geom);
