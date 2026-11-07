# Phase 10: License review

Status: **Implemented** (2026-11-07). Decisions 1–8 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §5.4 (license compliance), §5.3 (Phase 10 row), §2 (MapLibre packaging: license notices), §6 (License decision).

## Goal

Confirm that GeoFlow can be distributed under Apache-2.0 with everything it ships, write down why, and make the build fail when that stops being true.

Much of the Phase 10 row is already in place. A license check over production dependencies runs in CI (Phase 0), the build writes `THIRD_PARTY_NOTICES.txt` from the modules webpack bundled (Phase 2), and `NOTICE` lists MapLibre and the OpenStreetMap attribution. What's left:
- **The review itself.** No document records what ships, under which license, and what each license asks of us.
- **A gate on what ships.** The CI check scans 476 packages, all but 27 of them from Grafana's own packages, which Grafana provides at runtime and GeoFlow never ships. To pass, its allow-list has grown five licenses beyond §5.4's list, plus an exclusion, all for packages that aren't in the plugin. Meanwhile, nothing checks the licenses of the packages that are.
- **`NOTICE` in the package.** It's in the repository, but the build doesn't copy it into `dist/`, so the plugin archive leaves it out, along with the map data attribution it carries.
- **The logo.** `img/logo.svg` is still the create-plugin scaffold's logo, drawn in Grafana's colors.

## Exit criteria

1. **Report.** `docs/licenses.md` lists every package in the built plugin with its version, license and what the license requires, and says how each requirement is met. It also covers the packages Grafana provides at runtime, the development tooling, the Docker dev stack, the fixture data, the map data and the logo. It concludes whether Apache-2.0 stands.
2. **Gate on what ships.** A production build fails when a bundled package's license isn't on the allow-list (decision 3), or when no license text can be found for it, and names the package. SPDX expressions are read properly: `(MIT OR Apache-2.0)` passes if one side is allowed, `MIT AND BSD-3-Clause` only if both are.
3. **Gate tested.** Tests cover an allowed license, `OR` and `AND` expressions, a disallowed license, a missing or unknown license and a package without license text, and run in CI. A build with a disallowed license, tried by hand, fails, and the result is recorded in this document.
4. **`NOTICE` in the package.** `dist/` contains `NOTICE`, and `npm run check:dist` requires it alongside `LICENSE` and `THIRD_PARTY_NOTICES.txt`.
5. **Logo.** The plugin ships an original logo at the same path, so `plugin.json` doesn't change.
6. **Nothing else changes.** `module.js` and the chunks are byte-identical to a build before the phase (`THIRD_PARTY_NOTICES.txt` aside, if its header changes). The stored screenshots still match. Unit and e2e tests pass locally and in CI.

## Out of scope

- **Legal advice.** The review is an engineering check against the licenses' plain terms, not a lawyer's opinion.
- **Trademark clearance of the name GeoFlow.** Microsoft used "GeoFlow" as a 2013 codename for Excel's 3D Maps. A search before a catalog submission is worth doing but isn't a license question.
- **An SBOM** (CycloneDX or SPDX document). Grafana's catalog doesn't ask for one, and `THIRD_PARTY_NOTICES.txt` already lists what ships.
- **Basemap service terms** beyond OpenStreetMap's tile policy, already in `NOTICE` (Phase 12 adds the other providers).
- **Signing and publishing a release.**

---

## Starting point

| Already in place | From |
|---|---|
| `npm run license:check`: `license-checker-rseidelsohn --production` with an allow-list, in CI before the build. | Phase 0 |
| `LICENSE` (Apache-2.0), copied into `dist/` by the scaffold. | Phase 0 |
| `NOTICE` in the repository: MapLibre, the style-loader and css-loader helpers, Grafana packages not redistributed, OpenStreetMap data and tile policy. | Phase 2 |
| `webpack/ThirdPartyNoticesPlugin.ts`: writes `THIRD_PARTY_NOTICES.txt` from the bundled modules, adding MapLibre's dependency tree because its dist file inlines it. Warns when a package has no license file. | Phase 2 |
| `npm run check:dist`: every file in `dist/` against an allow-list; `module.js`, `plugin.json`, `LICENSE` and `THIRD_PARTY_NOTICES.txt` required. `NOTICE` is allowed but not required, and isn't there. | Phase 2 |
| The README's License section, pointing at `LICENSE` and `NOTICE`. | Phase 0 |

**Checked while planning:**

- **What ships: 27 packages**, all under MIT, ISC, BSD-2-Clause, BSD-3-Clause, or `(MIT OR Apache-2.0)` (`@maplibre/mlt`). They are MapLibre and its dependency tree, plus style-loader and css-loader's runtime helpers. Every one has a license text in `THIRD_PARTY_NOTICES.txt`.
- **MapLibre's `LICENSE.txt` carries notices for code it contains**: Mapbox GL JS up to v1.13 (BSD-3-Clause), glfx.js (MIT) and d3 (BSD-3-Clause). It's reproduced whole in `THIRD_PARTY_NOTICES.txt`.
- **A few listed packages may not ship.** Adding MapLibre's whole dependency tree also brings in its style spec's command-line dependencies, such as `minimist`. Listing a package that doesn't ship is harmless; leaving out one that does isn't (decision 6).
- **Grafana's packages are provided at runtime.** `@grafana/*` (Apache-2.0), React and React DOM (MIT) and Emotion (MIT) are webpack externals and don't appear in the bundle.
- **The current CI check's allow-list** adds Unlicense, BlueOak-1.0.0, Python-2.0, Public Domain and Zlib to §5.4's list, and excludes `get-document`, whose package has no license field. All of these come through `@grafana/ui` (or `@grafana/data`) and none ship.
- **Development tooling** (not distributed) includes CC-BY-4.0 (`caniuse-lite`'s browser data), CC-BY-3.0 (SPDX data files) and `(Apache-2.0 OR MPL-1.1)`. None of it is a concern for tools that aren't redistributed.
- **The Docker dev stack** pulls Grafana Enterprise and `postgis/postgis` images (Grafana: AGPL-3.0 for the open-source edition; PostGIS: GPL-2.0). The repository only names them in Compose and Dockerfiles; it doesn't redistribute them. A plugin talks to Grafana through the Apache-2.0 `@grafana/*` packages.
- **Fixture data is GeoFlow's own:** a fictional network, hand-drawn, and 100k generated points. The e2e tests stub map tiles with a local `tests/fixtures/tile.png`, so the stored screenshots contain no OpenStreetMap tiles.
- **`dist/LICENSE.txt`** is the scaffold's extracted license comments (only MapLibre's banner). It's produced by `.config/`, which this project doesn't change, and it duplicates what `THIRD_PARTY_NOTICES.txt` says.
- **The `.config/` scaffold files** come from `@grafana/create-plugin` (Apache-2.0). They're build tooling and don't ship.
- **Grafana's publishing guidance** asks for a `LICENSE` in the archive and recommends logos, and says nothing further about dependency licenses.

### Changes to the architecture

- **§5.4:** the gate checks what ships, in the build, rather than scanning production dependencies (decisions 1 and 2). The allow-list is §5.4's (decision 3). The review's findings are in `docs/licenses.md`.
- **§5 (CI line):** the license check runs as part of the build.
- **§6:** License becomes "Apache-2.0, confirmed by the Phase 10 review".
- **§2 (MapLibre packaging, license notices):** the notices plugin also checks licenses.

---

## Design

### 1. The gate (`webpack/licenseCheck.ts`, new; `ThirdPartyNoticesPlugin`)

`ThirdPartyNoticesPlugin` already knows exactly what ships. A pure function, `licenseProblems(notices, allowed, exceptions)`, returns one message per package that fails:
- its license expression isn't satisfied by the allow-list (`spdx-satisfies`, decision 4), or isn't valid SPDX
- no license text was found (today a warning)

The plugin adds these as webpack **errors** in production builds, so `npm run build` fails, and as warnings in development, so `npm run dev` keeps working while a new dependency is reviewed. A package that's reviewed and accepted outside the allow-list goes in `exceptions`, by name and version, with a reason, and gets a row in `docs/licenses.md` (decision 3).

The allow-list, exceptions and header move out of `webpack.config.ts` into `webpack/licenses.ts`, so the policy sits in one place.

### 2. Retiring the dependency scan

`npm run license:check`, its CI step and the `license-checker-rseidelsohn` dev dependency go (decision 2). CI's existing build step is now the gate.

### 3. Tests

Jest only looks under `src/`, and its config is in `.config/`. The build helpers get Node's own test runner instead: `webpack/licenseCheck.test.ts`, run by `npm run test:build` (`node --test webpack/`). Node 26 runs TypeScript directly. CI runs it next to the unit tests.

### 4. `NOTICE` in the package

`webpack.config.ts` adds a `copy-webpack-plugin` pattern for `NOTICE` (it's already a scaffold dependency). `check:dist` requires it.

### 5. Logo

A new `src/img/logo.svg`, drawn for GeoFlow, replaces the scaffold's (decision 5). It stays a plain SVG at the same path, readable at the catalog's small size and on light and dark backgrounds.

### 6. The report (`docs/licenses.md`, new)

- **Conclusion:** Apache-2.0 stands, and why.
- **Shipped packages:** a table of the 27, with version, license and requirement (keep the copyright notice and license text; for BSD-3-Clause, no endorsement), and how it's met (`THIRD_PARTY_NOTICES.txt` in the package).
- **Provided by Grafana:** `@grafana/*`, React, Emotion.
- **Not distributed:** development tooling, the Docker images, `.config/`.
- **GeoFlow's own content:** fixture data, test tile, screenshots, logo.
- **Map data:** ODbL attribution, shown on the map and in `NOTICE`.
- **How it's kept true:** the build gate, and adding an exception.

The table is written at review time and dated; the build's `THIRD_PARTY_NOTICES.txt` is the current list (decision 7).

---

## Steps

Each step is one commit, tested before the next.

### 10.1 Review

Check each shipped package's license field against its license text, look for `NOTICE` files in bundled Apache-2.0 packages, and compare MapLibre's dist file with its declared dependencies. Write `docs/licenses.md`.

### 10.2 License gate

Design §1–3: `licenseCheck.ts` and its tests, `webpack/licenses.ts`, the plugin change, `test:build`, the CI change, removing `license:check`. Try a disallowed license by hand and record the result.

### 10.3 `NOTICE` and the logo

Design §4–5, and `check:dist`.

### 10.4 Docs

- README: the License section and the `npm` scripts
- `NOTICE`: anything the review finds missing
- architecture.md: §2, §5, §5.4, §6
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| The gate misses a package that ships, for example one MapLibre inlines without declaring it. | Step 10.1 compares MapLibre's dist with its dependencies. The gate reads what webpack bundled, which is the most direct source there is. |
| A dependency update fails the build over a license change. | That's the purpose. The error names the package, and an exception with a reason is a one-line change. |
| Dropping the dependency scan loses coverage. | It only covered packages that don't ship, and its allow-list had been widened to pass. Packages Grafana provides are Grafana's to license. |
| `node --test` with TypeScript depends on Node's type stripping. | Node 26 (`.nvmrc`) supports it without flags. The test uses only erasable TypeScript syntax. |
| The new logo is worse than the scaffold's. | It's shown for approval before it's committed. |

---

## Decisions

Accepted as proposed (2026-11-07):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | What the gate checks | **What ships**, from the modules webpack bundled, in the notices plugin. 27 packages, exactly what the license obligations are about. | The production dependency tree, as now: 476 packages, 449 of them Grafana's. |
| 2 | The dependency scan | **Remove it.** The build gate covers everything that ships. | Keep it as an advisory report: noise from packages GeoFlow doesn't ship, and a dev dependency to maintain. |
| 3 | Allow-list | **§5.4's list:** Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0. Anything else is reviewed and added as a named exception with a reason. | Keep the widened list: it was widened for packages that don't ship. |
| 4 | Reading SPDX expressions | **`spdx-satisfies`** as a direct dev dependency (MIT, already installed through the license checker). | A hand-written parser: small, but `OR`, `AND`, parentheses and `+` are easy to get subtly wrong. |
| 5 | Logo | **Replace it** with an original GeoFlow logo. The scaffold's is Grafana-styled and would make a catalog listing look like Grafana's own. | Keep it until publishing: the review should cover what ships, and it's cheap now. |
| 6 | Over-listing MapLibre's tree | **Keep listing its whole production tree.** An extra notice is harmless. | List only what its dist inlines: needs re-checking MapLibre's build on every upgrade. |
| 7 | `docs/licenses.md`'s package table | **Written by hand at review time, dated.** The build's notices file is the current list. | Generated by the build into `docs/`: a second generated copy that has to be kept in sync. |
| 8 | Plugin version | **Unchanged (0.2.0).** No user-facing change; the next release sets the version. No `plugin.json` change, so no Grafana restart. | 0.2.1 for the new logo and `NOTICE`. |

---

## Outcome

Implemented on branch `phase-10` in four commits, one per step:
- 520 unit and component tests and 8 build tool tests pass, and 58 e2e tests (plus the login setup), in two full-suite runs in a row. The stored screenshots still match.
- CI: to be filled in from the pull request.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Report | Met. [licenses.md](licenses.md): Apache-2.0 stands. |
| 2 | Gate on what ships | Met. The production build fails on a bundled package outside the allow-list, with an invalid license expression or without license text, and names it. |
| 3 | Gate tested | Met. 8 tests (`npm run test:build`, in CI). By hand: with BSD-2-Clause and BSD-3-Clause removed from the allow-list, `npm run build` exits 1 with an error for each of the five BSD packages (`maplibre-gl`, `pbf`, `@mapbox/vector-tile`, `@mapbox/tiny-sdf`, `@mapbox/unitbezier`); a development build lists the same as warnings and completes. |
| 4 | `NOTICE` in the package | Met. `check:dist` requires it. |
| 5 | Logo | Met, with two files instead of one (below). |
| 6 | Nothing else changes | Met. Before the logo and `NOTICE`, `dist/` was byte-identical to the build before the phase, `THIRD_PARTY_NOTICES.txt` included. After them, only `NOTICE`, the logos and `plugin.json` differ. |

### Differences from the plan

- **Two logos, and a `plugin.json` change.** The logo was drawn to the user's brief: a folded map with great-circle arcs between locations, a large orange pin, and the name below. The name can't be read at the panel picker's 24–32 px, so the small logo (`img/logo.svg`) is the map alone and the large one (`img/logo-large.svg`) adds the name. `plugin.json`'s `logos.large` points at the new file, so **Grafana needs a restart**, against criterion 5 and decision 8. The version stays 0.2.0.
- **Package counts.** The plan counted 27 packages in the notices file; there are 26. Of those, 19 ship (MapLibre's source maps show 17 in its build, plus the two webpack helpers), and 7 are listed only because the whole tree of MapLibre's dependencies is added (decision 6).
- **`spdx-satisfies` 6.0.0, pinned exactly.** 6.0.1 was published the day of the change. 6.0.0 dates from January 2025.
- **The smoke e2e test** failed in two of the first five full-suite runs: the first check after the dashboard loads used the default 5 s timeout, under load. It now waits like the other specs (`DRAWN`). It passed 45 runs in a row alone, and the plugin's code didn't change, so the flake predates this phase.
- **The README's script list** changed with the gate (step 10.2) rather than in step 10.4.
- **`test:build` takes a file pattern, and the minimum Node version is 22.18.** `node --test webpack/` works on Node 26 but not 22, which needs a pattern (`'webpack/**/*.test.ts'`). Running TypeScript without a flag arrived in 22.18. The build, unit tests, typecheck and lint were checked on 22.18 too. CI runs Node 26 (`.nvmrc`) only.

### Review findings

- **Two declared licenses differ from the license files:** `@maplibre/geojson-vt` declares ISC and ships MIT text, and `@maplibre/maplibre-gl-style-spec` declares ISC and ships BSD-3-Clause text. Both are permissive, and the notices reproduce the files.
- **`@maplibre/geojson-vt` inlines `kdbush`,** a declared dependency, so it's covered. Nothing else among the bundled packages inlines other modules.
- **No bundled package has a `NOTICE` file.**
- **`NOTICE` needed no changes** beyond shipping it.
- **All the code is by one author** (plus Dependabot's version bumps), so the license is the author's choice alone.

