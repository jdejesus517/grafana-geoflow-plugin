# Changelog

## [1.0.0](https://github.com/jdejesus517/grafana-geoflow-plugin/tree/v1.0.0) (2026-11-10)

Initial release. Requires Grafana 13.2 or later, and PostgreSQL with PostGIS through Grafana's PostgreSQL data source.

**Features:**

- Draw PostGIS geometries on a MapLibre GL JS map: points, lines and polygons and their Multi* forms, from GeoJSON text, `json`/`jsonb` columns or GeoJSON Features [\#12](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/12) [\#21](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/21)
- Tooltips on hover, pinned on click, with the field's units, value mappings and data links, and paging through overlapping features [\#22](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/22) [\#24](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/24)
- Styling with Grafana's field options: color, opacity, point size, line width, dash patterns and fill, per query through overrides [\#25](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/25)
- Coloring and sizing by a column's value with thresholds, gradients and value mappings, with a legend [\#26](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/26)
- One layer per query, which you can name, reorder and hide [\#27](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/27), or one per value of a column with Grafana's Partition by values transformation [\#32](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/32)
- Refreshes keep the map's view and a pinned tooltip; Fit to data, once or on every refresh; Use current view to save the view; a dark basemap that follows Grafana's theme [\#28](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/28)
- Basemaps: OpenStreetMap, any XYZ raster tiles or MapLibre style URL, none for air-gapped installs, and presets from OpenFreeMap, Stadia Maps, MapTiler and Thunderforest with your own API key [\#20](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/20) [\#33](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/33)
- Warnings on the map when rows can't be drawn or a column is missing; the map keeps a failed query's last data; a clear message when WebGL is unavailable [\#29](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/29)
- Networks: nodes from one query and the edges between them from another, joined by id and drawn as one line per pair of nodes, set up in the Layers list [\#37](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/37) [\#38](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/38)
- A network line's summary, with totals and ratios of its edges' values, and the list of its edges, with search, sort and each edge's data links [\#39](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/39) [\#40](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/40)
- Network lines colored and sized by their edges' values: a ratio, a sum, a count or a shared category, with a legend [\#49](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/49)
