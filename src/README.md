# GeoFlow

![Grafana 13.2+](https://img.shields.io/badge/Grafana-13.2%2B-F47A20?logo=grafana)
![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)

Draw PostGIS geometries from Grafana's PostgreSQL data source on an interactive map.

GeoFlow is a panel plugin for assets that live in PostgreSQL with PostGIS: networks, sites, service areas, routes. Write a SQL query that returns geometry as GeoJSON, and each query becomes a layer on a [MapLibre GL JS](https://maplibre.org/) map, styled with Grafana's own field options and refreshed with the dashboard. There's no separate tile server, API or data source to run.

## Features

- **Points, lines and polygons**, including their Multi* forms, from GeoJSON text, `json`/`jsonb` columns or whole GeoJSON Features.
- **One layer per query**, which you can name, reorder and hide, or [one per value of a column](https://github.com/jdejesus517/grafana-geoflow-plugin#splitting-a-query-by-value) with Grafana's Partition by values transformation.
- **Styling with Grafana's field options:** colors, opacity, line width and dash patterns, set per query through overrides.
- **Coloring and sizing by value** with thresholds, gradients and value mappings, as in Grafana's other panels, with a legend.
- **Networks** from two queries: sites as points, and the links between them as rows naming their two ends, with no geometry. Every link between two sites is drawn as one line, with a summary of their totals and ratios, a searchable list of the links, and colors and widths from their values.
- **Tooltips** with every column, formatted with the field's unit, value mappings and data links. Click to pin one, and page through overlapping features.
- **Basemaps:** OpenStreetMap; presets from OpenFreeMap, Stadia Maps, MapTiler and Thunderforest, picked by name, with a dark style that follows Grafana's theme; any XYZ raster tile server or MapLibre style URL; or none for air-gapped installs.
- **Refreshes keep your place:** the map keeps its view, and a pinned tooltip follows its feature. A refresh that returns the same data costs almost nothing.
- **Warnings on the map** when rows can't be drawn or a column is missing, so lost data doesn't go unnoticed.

## Requirements

- Grafana 13.2 or later
- PostgreSQL with PostGIS 3, through Grafana's built-in PostgreSQL data source
- A browser with WebGL2 (all current desktop and mobile browsers)

## Getting started

1. Install GeoFlow from **Administration → Plugins and data → Plugins** in Grafana, or with the Grafana CLI:

   ```bash
   grafana cli plugins install jdejesusio-geoflow-panel
   ```

2. Add a panel to a dashboard and pick the **GeoFlow** visualization.
3. Select your PostgreSQL data source, set the query's **Format** to **Table**, and return the geometry as GeoJSON in WGS84:

   ```sql
   SELECT
     id,
     name,
     status,
     ST_AsGeoJSON(ST_Transform(geom, 4326), 6) AS geometry
   FROM assets
   ORDER BY id
   ```

The map fits itself to the data. Hover a feature to see its columns, and click to pin the tooltip.

**Query tips:**

- `ST_Transform(geom, 4326)` is needed unless the data is already in WGS84. Rows in another coordinate system are skipped, with a warning.
- Precision `6` (about 0.1 m) roughly halves the size of the result.
- A unique `id` column lets a pinned tooltip follow its feature through refreshes.
- `ORDER BY` keeps refreshes cheap: rows that come back in the same order aren't drawn again.
- Any Grafana macro or dashboard variable works, such as `WHERE $__timeFilter(updated_at)`.

## Styling

Style the map under **Standard options** and **Map style** in the panel's field options. To style one query, add a **Fields returned by query** override.

To color or size features by a column, set **Color by** or **Size by** under **Map style**, then set the colors on that column with thresholds, a color scheme or value mappings. A feature then has the color a table cell would give its value.

## Networks

Return the nodes as points with an `id` column, and the edges as rows naming the ids they join:

```sql
SELECT site_id AS id, name, ST_AsGeoJSON(geom, 6) AS geometry FROM sites ORDER BY site_id;
SELECT trunk_id, a_site, z_site, capacity_gbps FROM trunks ORDER BY trunk_id;
```

In the panel editor's **Layers** list, set the first query's **Role** to **Nodes** and the second's to **Edges**. GeoFlow finds the from and to columns by name (`source` and `target`, `a_site` and `z_site`, and similar), or you can pick them. The [full documentation](https://github.com/jdejesus517/grafana-geoflow-plugin#networks) walks through styling a network by its links' values.

## Basemaps

OpenStreetMap is the default. Its tile servers are for light use under the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/). For dashboards with many viewers, pick a preset, or use your own tile server through **Custom tiles** or **Style URL**.

**Presets:** OpenFreeMap needs no key. Stadia Maps, MapTiler and Thunderforest use your own API key, which is saved in the dashboard and reaches every viewer's browser, so restrict it to your Grafana's domain. Each preset follows Grafana's theme with a matching dark style. The free plans of Stadia Maps and MapTiler are for non-commercial use.

If Grafana's Content Security Policy is enabled, add each tile host to `connect-src`. The [full documentation](https://github.com/jdejesus517/grafana-geoflow-plugin#content-security-policy) has the exact settings.

## Sizing

GeoFlow draws every row in the browser. With a GPU, up to 100,000 features per panel work well: 100,000 points take 2 to 3 seconds to draw, and panning stays smooth. A network of 100,000 links between 12,500 sites draws in under 2 seconds. Beyond that, filter in the query, or simplify detailed polygons with `ST_SimplifyPreserveTopology`. Turn on **Show data summary** to see each query's result, including when the browser is drawing without a GPU.

## Limitations

- Map panels may not appear in PNG exports and reports, because Grafana's image renderer may lack WebGL2.
- GeometryCollections and raw PostGIS geometry (WKB) aren't drawn. Select `ST_AsGeoJSON(geom)` instead.
- Geometries crossing the antimeridian (±180°) may draw across the map.
- Network lines are straight on the map, and each panel draws one network: one Nodes and one Edges query, not split with Partition by values.

## Documentation

The [full documentation](https://github.com/jdejesus517/grafana-geoflow-plugin#readme) covers every option: layers, networks, tooltips, styling, coloring by value, basemaps, view settings, warnings and sizing.

## Feedback and contributing

Report bugs and ask for features in [GitHub issues](https://github.com/jdejesus517/grafana-geoflow-plugin/issues). Contributions are welcome: see the [repository](https://github.com/jdejesus517/grafana-geoflow-plugin) for how to build and test the plugin.

## License

GeoFlow is licensed under the [Apache License 2.0](https://github.com/jdejesus517/grafana-geoflow-plugin/blob/main/LICENSE). It bundles MapLibre GL JS and its dependencies, whose licenses are included with the plugin. The default basemap's map data is © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
