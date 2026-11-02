#!/bin/sh
# Read-only role that Grafana's PostgreSQL data source connects as. Dashboard users can
# run arbitrary SQL through the data source, so it gets SELECT on the geoflow schema only.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v reader_password="${GEOFLOW_READER_PASSWORD:?GEOFLOW_READER_PASSWORD must be set}" <<'EOSQL'
CREATE ROLE grafana_reader LOGIN PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE :"DBNAME" TO grafana_reader;
GRANT USAGE ON SCHEMA geoflow TO grafana_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA geoflow TO grafana_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA geoflow GRANT SELECT ON TABLES TO grafana_reader;
EOSQL
