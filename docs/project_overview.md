# Project: Grafana PostGIS Map Panel

Act as a senior Grafana plugin developer and geospatial software architect.

I want to develop an open-source Grafana panel plugin that renders geographic features stored in PostgreSQL/PostGIS databases.

## Objective

Build a custom Grafana visualization panel that uses Grafana's existing PostgreSQL data source to retrieve spatial data and renders it using MapLibre GL JS.

## Initial technical stack

- Grafana Panel Plugin SDK
- React
- TypeScript
- MapLibre GL JS
- PostgreSQL
- PostGIS
- GeoJSON
- Docker for local development

## Architecture requirements

1. Use Grafana's existing PostgreSQL data source.
2. Do not implement a separate database connection in the initial version.
3. Accept query results containing GeoJSON geometry.
4. Convert Grafana data frames into GeoJSON FeatureCollections.
5. Render Point, MultiPoint, LineString, MultiLineString, Polygon, and MultiPolygon geometries.
6. Support multiple spatial layers.
7. Keep the map rendering engine independent of Grafana-specific code.

## Initial MVP

- Display an interactive basemap.
- Retrieve spatial features from PostgreSQL queries.
- Render points, lines, and polygons.
- Display feature attributes in popups.
- Support basic feature styling.
- Support Grafana panel refresh.

## Development instructions

Before writing implementation code:

1. Propose the application architecture.
2. Identify the major components and their responsibilities.
3. Describe how Grafana data frames will be converted into GeoJSON.
4. Identify potential compatibility and performance issues.
5. Propose a development and testing strategy.

Do not generate the entire application at once.

Develop incrementally, with each feature independently testable.

Use current official Grafana plugin development documentation and follow established Grafana plugin conventions.

Explain architectural decisions and wait for approval before implementing major changes.