# Phase 12: Basemap presets

Status: **Implemented** (2026-11-08). Decisions 1–9 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §5.3 (Phase 12 row, and the provider rules below it), §4.1 (basemap tiles), §2.4 (`BasemapSpec`), §7.

## Goal

Pick a good basemap from a list instead of pasting URLs: hosted vector styles that need no key, the main keyed providers with the user's own key, each with its required attribution, and a dark style that follows Grafana's theme.

Every one of these already works through **Style URL** or **Custom tiles**, with a dark theme URL (Phase 8). What's missing:
- **Finding them.** Users have to know the services, their URL formats and their style names.
- **Attribution.** Custom tiles show the attribution as plain text, but Thunderforest requires working links, and MapTiler's free plan requires its logo.
- **Keys on every request.** A key in a style URL reaches the style JSON only. Stadia Maps' styles point at tiles, fonts and sprites without the key, so they fail outside Stadia's domain authentication.
- **Dark theme.** Each provider has its own dark style, which users have to find and pair by hand.

## Exit criteria

1. **Presets.** **Basemap** lists OpenFreeMap, Stadia Maps, MapTiler and Thunderforest beside the existing options (decision 1). Each offers its styles by name (Design §2).
2. **Dark theme.** Each light style has a default dark style, used while Grafana's theme is dark, and **Dark theme style** can pick another or keep the light one (decision 3). Switching theme switches the style without recreating the map, as in Phase 8.
3. **Keys.** MapTiler and Thunderforest need an **API key**; Stadia Maps takes one optionally. The key goes on every request to the provider's host: style, tiles, fonts and sprites (decision 6). Without a required key, the panel shows no basemap and the options say why, as for an invalid URL now.
4. **Attribution.** Each preset shows its provider's required attribution, with working links, and MapTiler its logo (decision 7).
5. **Saved dashboards unchanged.** OpenStreetMap stays the default. Dashboards with any other basemap kind draw as before, and the stored screenshots match.
6. **Tests.** Unit tests on every preset's URLs, attribution and dark pairing. E2E tests on a dashboard with one panel per provider, with the providers' hosts stubbed, so CI never contacts them (decision 8). They check the requested URLs, the key on nested requests, the attribution and the dark switch.
7. **Checked against the real services.** Each provider's styles load and draw, by hand, in both themes (step 12.1). The README's CSP section lists each provider's hosts, confirmed with `content_security_policy = true`.
8. **Docs.** The README's Basemap section lists the providers, their key and plan rules, and the CSP hosts. `NOTICE` names the providers' terms.

## Out of scope

- **Esri** (decision 1): a §7 entry.
- **Satellite imagery** from any provider: extra attribution per imagery source, and larger tiles. Each provider's satellite style can still be used through **Style URL**.
- **Keys in `secureJsonData`** or from dashboard variables (decision 5).
- **Self-hosted PMTiles** (§7, unchanged).
- **A style picker with previews.** Styles are picked by name.

---

## Starting point

| Already in place | From |
|---|---|
| `BasemapSpec`: `osm`, `raster` (tiles, attribution as plain text, `dimInDark`), `style` (a URL), `none`. | Phases 2, 8 |
| `basemapFromOptions(options, dark)`: options to a spec, with a dark URL in dark theme; invalid settings fall back to `none`. | Phases 2, 8 |
| `setBasemap` replaces the style without recreating the map; the data layers ride along through `transformStyle`. | Phase 2 |
| `CheckedTextEditor`: a text option that says why its value can't be used. | Phase 2 |
| The README's CSP section: only each tile host in `connect-src` is needed, for raster and vector styles. | Phase 9 |
| E2E tests answer tile requests with a local PNG, and custom tiles use a stub host. | Phases 2, 8 |

**Checked while planning** (2026-11-08):

| Provider | Key | Free plan | Format | Hosts | Attribution |
|---|---|---|---|---|---|
| **OpenFreeMap** | None | No limits, commercial use allowed, no SLA, donation-funded. Bulk downloading is limited. | Vector styles: `https://tiles.openfreemap.org/styles/{liberty,bright,positron,dark,fiord}` | `tiles.openfreemap.org` only: style, tiles, fonts, sprites | In the tiles: OpenFreeMap, © OpenMapTiles, OpenStreetMap, linked |
| **Stadia Maps** | Optional: domain authentication for registered sites, `api_key` otherwise; `localhost` works keyless with low limits | 200k credits a month, **no commercial use** | Vector styles: `https://tiles.stadiamaps.com/styles/{alidade_smooth,alidade_smooth_dark,alidade_bright,osm_bright,outdoors,stamen_toner,stamen_toner_dark}.json` | `tiles.stadiamaps.com` only. Nested URLs don't carry the key | In the tiles: © Stadia Maps, © OpenMapTiles, © OpenStreetMap, linked. Stamen styles add © Stamen Design |
| **MapTiler** | Required, `key` | 5k map sessions and 100k requests a month, **non-commercial**, service pauses at the limit, **MapTiler logo required** | Vector styles: `https://api.maptiler.com/maps/{id}/style.json?key=` | `api.maptiler.com` | In the style; the logo isn't |
| **Thunderforest** | Required, `apikey` | 150k tiles a month; its terms permit commercial use | Raster: `https://tile.thunderforest.com/{atlas,transport,transport-dark,landscape,outdoors,neighbourhood,cycle}/{z}/{x}/{y}.png?apikey=` | `tile.thunderforest.com` | Required, with working links to thunderforest.com and openstreetmap.org/copyright |
| **Esri** | Required, as `token` | Free tier with an unclear basemap tile quota; session tokens recommended | Vector styles from `basemapstyles-api.arcgis.com` | Several | "Powered by Esri" plus data sources, which Esri's MapLibre plugin adds |

Still to check in step 12.1, with real keys: MapTiler's style ids and dark variants (its docs give only `streets-v4`), whether MapTiler's nested URLs carry the key, what each style's attribution shows in MapLibre's control, and Grafana's CSP for the MapTiler logo image.

### Changes to the architecture

- **§2.4 `BasemapSpec`:** `raster` and `style` gain `requestParams` (query parameters added to every request to one host) and a trusted HTML `attribution` for presets; a `logo` for MapTiler. Custom tiles' attribution stays plain text.
- **§4.1:** presets, and their hosts.
- **§5.3:** Esri leaves the Phase 12 row for §7 (decision 1); the row says what was delivered.
- **§7:** Esri, and satellite styles.

---

## Design

### 1. Engine (`basemapStyle.ts`, `MapLibreEngine.ts`, `types.ts`)

The engine stays provider-neutral: it learns three generic things, and the panel turns presets into specs.

```ts
type RequestParams = { host: string; params: Record<string, string> };
type BasemapLogo = { href: string; src: string; alt: string };

type BasemapSpec =
  | { kind: 'osm' }
  | { kind: 'raster'; tiles: string[]; attribution: string; maxZoom?: number; dimInDark?: boolean;
      attributionHtml?: boolean; requestParams?: RequestParams; logo?: BasemapLogo }
  | { kind: 'style'; url: string; requestParams?: RequestParams; logo?: BasemapLogo }
  | { kind: 'none' };
```

- **`requestParams`:** MapLibre's `transformRequest`, set at mount, adds the parameters to every request whose host matches, reading the current basemap, so a basemap change needs no new map. Requests to other hosts, including data from other origins, are untouched.
- **`attributionHtml`:** only presets set it, from constant strings in the plugin. Custom tiles keep escaping what a dashboard editor typed.
- **`logo`:** a small link with an image, beside the attribution in the bottom-right corner, shown while the basemap has one. The bottom-left corner holds the warnings and legend.

### 2. Presets (`src/panel/basemapPresets.ts`, new)

A table of providers and styles, the only place their URLs and attributions live:

| Provider | Styles (light) | Dark styles | Default dark |
|---|---|---|---|
| OpenFreeMap | Liberty, Bright, Positron | Dark, Fiord | Dark |
| Stadia Maps | Alidade Smooth, Alidade Bright, OSM Bright, Outdoors, Stamen Toner | Alidade Smooth Dark, Stamen Toner Dark | Alidade Smooth Dark; Toner Dark for Toner |
| MapTiler | Streets, Basic, Bright, Dataviz, Outdoor, Topo (ids from step 12.1) | Their dark variants | The style's own dark variant |
| Thunderforest | Atlas, Transport, Landscape, Outdoors, Neighbourhood, OpenCycleMap | Transport Dark | Transport Dark for Transport; the light style dimmed otherwise |

`basemapFromOptions` resolves a preset to a `style` or `raster` spec, picking the dark style in dark theme. A missing required key gives `none`, as an invalid URL does.

### 3. Options (`options.ts`, `module.ts`)

**Basemap** gains a kind per provider (decision 2). For a provider, three options show:
- **Style:** a select of its light styles, defaulting to the first.
- **Dark theme style:** its dark styles, plus **Same as light**; defaults to the style's pair (decision 3). For Thunderforest, **Same as light** dims the tiles, as now.
- **API key** (MapTiler and Thunderforest required, Stadia Maps optional): a `CheckedTextEditor`, with a description saying the key is visible to dashboard viewers and should be restricted to the Grafana domain (decision 5).

Saved as `basemap.preset`, `basemap.darkPreset` and `basemap.apiKey`, beside the existing fields. No migration.

### 4. Tests

- **Unit:** each preset's URL, attribution, key placement and dark pair; a missing key; `transformRequest` on matching and other hosts; attribution escaping for custom tiles unchanged.
- **E2E** (`13-basemap-presets.json`, `tests/basemap-presets.spec.ts`): one panel per provider. The fixtures route each provider's host to small local style JSONs whose sources point back at the stubbed host, and answer tiles with the local PNG (decision 8). Checks: the style and tile URLs requested, the key on tile, font and sprite requests, the attribution text and links, the MapTiler logo, and the dark style with `?theme=dark`.

### 5. Docs

- **README, Basemap:** a row per provider with its key rule, the plan caveats (free plans of Stadia Maps and MapTiler aren't for commercial use; check each provider's plan), what key visibility means, and each provider's hosts in the CSP section.
- **`NOTICE`:** each provider and a link to its terms, beside OpenStreetMap's.

---

## Steps

Each step is one commit, tested before the next.

### 12.1 Checks against the real services

By hand, with free accounts whose keys stay out of the repository (an untracked `.env` the dev dashboard reads, or typed in the editor):
- MapTiler's style ids and dark variants, and whether its nested URLs carry the key
- Stadia Maps with and without a key, on `localhost`
- every preset's style drawing in both themes, and what its attribution shows
- the hosts each style requests, and the README's CSP with them, including the MapTiler logo image

### 12.2 Engine

Design §1, with unit tests.

### 12.3 Presets and options

Design §2–3, with unit tests.

### 12.4 Dashboard and e2e tests

Design §4.

### 12.5 Docs

- README: Basemap, CSP, the dashboard list
- `NOTICE`
- architecture.md: §2.4, §4.1, §5.3, §7
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| A provider renames a style or changes its URLs. | Ids and URLs are in one table. A broken style shows the basemap error Phase 2 added, and **Style URL** still works. |
| A provider changes its terms. | The README links each provider's terms instead of restating them, apart from the commercial-use caveat. Presets only build URLs: the plan is between the user and the provider. |
| Keys leak through dashboards. | Unavoidable for browser tiles (§5.3). The option and the README say so, and recommend restricting the key to the Grafana domain. |
| `transformRequest` adds the key to requests it shouldn't. | It matches the exact host, and unit tests cover other hosts. |
| The logo image is blocked by a CSP. | Step 12.1 checks Grafana's CSP. If it's blocked, the logo falls back to a text link. |
| CI can't test the real services. | Stubbed hosts in CI, the real services by hand in step 12.1 and in the Outcome. |

---

## Decisions

Accepted as proposed (2026-11-08):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Providers | **OpenFreeMap, Stadia Maps, MapTiler, Thunderforest.** Esri goes to §7: it requires "Powered by Esri" attribution, recommends its own MapLibre plugin (a new bundled dependency), uses session tokens, and its free basemap quota is unclear. | All five, as the architecture listed; or OpenFreeMap alone, the only one without a key or plan limits. |
| 2 | Option model | **A Basemap kind per provider**, with Style, Dark theme style and API key below. One select picks the provider, as now. | One "Preset" kind with a provider select under it: one more level for the same choice. |
| 3 | Dark theme | **Each light style defaults to its provider's matching dark style**, and the user can pick another or **Same as light**. | No dark default: users would have to know which style is dark. |
| 4 | Where presets resolve | **In the panel layer**, into the existing spec kinds. The engine gains three generic features, so it stays provider-neutral (requirement 7). | Preset kinds in the engine: provider knowledge in the layer meant to be replaceable. |
| 5 | API key | **A plain panel option**, as §5.3 decided: it reaches every viewer's browser anyway. The option and README say to restrict it by domain. | `secureJsonData`: panels don't have it, and the key would still be sent to the browser. Dashboard variables: no more secret, more to explain. |
| 6 | Key on nested requests | **Added by `transformRequest`** to every request to the provider's host. Needed for Stadia Maps; harmless where the provider already adds it. | Only on the style URL: Stadia's tiles fail without domain authentication. |
| 7 | MapTiler logo | **Shown while a MapTiler preset is in use**, as an image loaded from MapTiler, linking to maptiler.com. Its free plan requires it, and paid plans allow it. | Bundle the logo: a third-party trademark file in the package. Leave it out: free-plan users would break MapTiler's terms. |
| 8 | Testing the providers | **Stubbed hosts in CI** with local style fixtures; the real services by hand in step 12.1. | Real services in CI: needs keys as CI secrets, counts against quotas, and fails when a provider is down. |
| 9 | Plugin version | **Unchanged (0.2.0).** The next release sets it. No `plugin.json` change, so no Grafana restart. | 0.3.0 for the presets. |

---

## Outcome

Implemented on branch `phase-12` in four commits, steps 12.2 to 12.5. Step 12.1 was checks only, recorded below:
- 553 unit and component tests pass, and 66 e2e tests (plus the login setup), in two full-suite runs in a row. The stored screenshots still match.
- CI: to be filled in from the pull request.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Presets | Met. **Basemap** lists OpenFreeMap, Stadia Maps, MapTiler and Thunderforest, each with its styles by name. |
| 2 | Dark theme | Met. Each light style has a default dark style; **Dark theme style** picks another or **Same as light** (dimmed, for Thunderforest). The theme switch reuses the map, as in Phase 8. |
| 3 | Keys | Met. MapTiler and Thunderforest draw no basemap until a key is entered, and the option says why; Stadia Maps takes one optionally. The key goes on every request to the provider's host. |
| 4 | Attribution | Met. Vector styles bring their providers' linked attribution; Thunderforest's is written in the plugin, with links; MapTiler shows its logo. |
| 5 | Saved dashboards unchanged | Met. OpenStreetMap is still the default, and the stored screenshots match. |
| 6 | Tests | Met. Unit tests on every provider, the key placement and the logo; e2e tests on the 13 Basemap presets dashboard with every provider stubbed. |
| 7 | Checked against the real services | Met, with real MapTiler and Thunderforest keys and Stadia Maps without one, on Grafana 13.2.4 (below). |
| 8 | Docs | Met. README Basemap and CSP, the catalog README, `NOTICE`, `docs/licenses.md`, and the architecture. |

### Checks against the real services (step 12.1)

Every preset was drawn in both themes on a temporary dashboard, first through the existing **Style URL** and **Custom tiles** options, then through the presets once built.

| Provider | Hosts requested | Attribution shown | Keys |
|---|---|---|---|
| OpenFreeMap | `tiles.openfreemap.org` only | OpenFreeMap, © OpenMapTiles, Data from OpenStreetMap, linked | None |
| Stadia Maps | `tiles.stadiamaps.com` only | © Stadia Maps, © OpenMapTiles, © OpenStreetMap, linked; Stamen styles add © Stamen Design | Keyless on `localhost`. Its styles' nested URLs carry no key, so the presets add it |
| MapTiler | `api.maptiler.com` only, the logo included | © MapTiler, © OpenStreetMap contributors, linked | Its styles put the key on tiles and fonts but not sprites, which are public. Through the preset, all 16 requests carry it |
| Thunderforest | `tile.thunderforest.com` only | The preset's, with working links | Without a key, Thunderforest answers with a placeholder tile, not an error, so the options require one |

**MapTiler's style ids:** `streets-v4`, `basic-v2`, `bright-v2`, `dataviz-v4`, `outdoor-v4`, `topo-v4` and `backdrop`, each with a dark variant at `-dark`. Basic and Bright have no v4. The logo comes from the tiles' metadata: `https://api.maptiler.com/resources/logo.svg`.

**CSP:** with `content_security_policy = true` and the four hosts added to `connect-src`, every preset drew in both themes. The MapTiler logo needs nothing more: Grafana's default template has `img-src *`. The only violation was the development build's `livereload.js`, as in Phase 9.

### Differences from the plan

- **Saved options.** The choice is saved as `basemap.preset` (`{ style, dark }`), and keys as one option per provider (`stadiaKey`, `maptilerKey`, `thunderforestKey`) instead of one `apiKey`, so switching provider never sends one provider's key to another.
- **MapTiler's styles** are those step 12.1 found, Backdrop included; the plan left them to that step.
- **The e2e fixtures stub the providers for every test,** not only the new spec, so no test can reach them.
- **Four commits, not five:** step 12.1 changed no files.
- **Grafana's View panel mode** can cover a panel's right edge with its side pane, hiding the attribution and the MapTiler logo alike. That's Grafana's layout; on a dashboard, the logo shows above the attribution.

