// GeoFlow's license policy for what the plugin ships (docs/architecture.md §5.4, docs/licenses.md).
import type { LicenseException } from './licenseCheck';

/** Licenses a bundled package may have without review (Phase 10, decision 3). */
export const ALLOWED_LICENSES = ['Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'CC0-1.0'];

/**
 * Packages reviewed and accepted under another license, by name and exact version, each with a
 * row in docs/licenses.md.
 */
export const LICENSE_EXCEPTIONS: LicenseException[] = [];

/** The top of THIRD_PARTY_NOTICES.txt. */
export const NOTICES_HEADER = `GeoFlow bundles the third-party packages listed below. Each is distributed under
its own license, reproduced here. GeoFlow itself is licensed under the Apache
License, Version 2.0 (see LICENSE).

Map data shown by the default basemap is © OpenStreetMap contributors, available
under the Open Database License: https://www.openstreetmap.org/copyright`;
