# GeoFlow

GeoFlow is an open-source Grafana panel plugin that renders geographic features stored in PostgreSQL/PostGIS. It reads data through Grafana's built-in PostgreSQL data source and draws it with [MapLibre GL JS](https://maplibre.org/).

> **Status: pre-MVP.** Phase 0 (scaffold and development environment) is complete. The panel currently shows a placeholder listing the data frames it receives; map rendering arrives in later phases. See [docs/architecture.md](docs/architecture.md) for the target design and phase plan.

- Plugin id: `jdejesusio-geoflow-panel`
- Requires Grafana 13.2 or later
- Database: PostgreSQL 16+ with PostGIS 3.x

## Development

### Prerequisites

- Node.js 22 or later (`.nvmrc` pins the recommended version) and npm 10 or later
- Docker Engine with Docker Compose v2.24 or later

### Quick start

```bash
npm install
npm run dev        # build the plugin and rebuild on change (terminal 1)
npm run server     # start Grafana and PostGIS in Docker (terminal 2)
```

Open http://localhost:3000. The **GeoFlow / 00 Smoke** dashboard queries the fixture database through the provisioned **GeoFlow PostGIS** data source.

### Docker environment

The stack is defined in [docker-compose.yaml](docker-compose.yaml), with each service's files in its own directory:

| Directory                            | Contents                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docker/grafana/](docker/grafana/)   | Provisioned data sources and dashboards, and `.env.example` with the data source connection settings. The Grafana image itself comes from the scaffold-managed `.config/`. |
| [docker/postgres/](docker/postgres/) | PostGIS image (`postgis/postgis:16-3.6`), init scripts that seed the fixtures, `verify.sql`, and `.env.example` with database credentials.                                 |

Defaults come from each directory's `.env.example`. To override them, copy it to `.env` in the same directory (git-ignored). The Grafana password `GEOFLOW_PG_PASSWORD` must match the Postgres `GEOFLOW_READER_PASSWORD`. All defaults are for local development only.

PostgreSQL is published on `127.0.0.1:5432` (override with `GEOFLOW_PG_PORT`).

**Fixture data** is a small, fictional fiber optic network in downtown Cary, NC (buildings, fiber cables, splice cases and patch panels), plus edge-case rows and 100k synthetic service locations for performance testing. Building footprints and cable routes are hand-drawn approximations and don't depict real infrastructure. Grafana connects as the read-only `grafana_reader` role.

New or renamed dashboard files under `docker/grafana/provisioning/dashboards/` are loaded when Grafana starts, so run `docker compose restart grafana` after adding one.

The init scripts run only when the data volume is empty. To reset the database to the seed state:

```bash
docker compose down -v && npm run server
```

To check the fixtures:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /verify.sql'
```

### Checks and tests

```bash
npm run typecheck
npm run lint
npm run test:ci          # unit tests (Jest)
npm run build
npm run license:check    # production dependency license gate
npm run e2e              # Playwright end-to-end tests; needs `npm run server` running
npm run bench:adapter    # 100k-row conversion timing (not part of CI)
```

Before the first e2e run, install the browser with `npx playwright install chromium`.

Adapter unit tests use real data frames captured from the dev stack in `src/adapter/__fixtures__/`. After changing the fixture data in `docker/postgres/` or the minimum Grafana version, recapture them with `npm run server` running:

```bash
node scripts/capture-frames.mjs
```

## Documentation

- [Project overview](docs/project_overview.md)
- [Architecture](docs/architecture.md)
- [Phase 0 plan](docs/phase_0.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
