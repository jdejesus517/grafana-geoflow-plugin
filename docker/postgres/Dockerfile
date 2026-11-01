# GeoFlow development database: PostgreSQL 16 + PostGIS 3.6 with seeded fixtures.
# For local development and e2e tests only.
FROM postgis/postgis:16-3.6

# Scripts in this directory run once, on first start with an empty data volume.
COPY init/ /docker-entrypoint-initdb.d/
COPY verify.sql /verify.sql
