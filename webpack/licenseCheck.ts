import satisfies from 'spdx-satisfies';

/** A bundled package, as the notices plugin reads it. */
export interface LicensedPackage {
  name: string;
  version: string;
  /** The package.json license field: an SPDX expression, or 'UNKNOWN' when there's none. */
  license: string;
  /** License texts found in the package. */
  texts: string[];
}

/** A package reviewed and accepted although its license isn't on the allow-list (docs/licenses.md). */
export interface LicenseException {
  name: string;
  version: string;
  reason: string;
}

/**
 * One message per bundled package that fails the license policy (docs/phase_10.md, Design §1):
 * a license expression the allow-list doesn't satisfy, one that isn't valid SPDX, or no license
 * text to reproduce. `(MIT OR Apache-2.0)` passes when either side is allowed, `MIT AND
 * BSD-3-Clause` only when both are. Exceptions match by name and version, so an update is
 * reviewed again; they still need a license text.
 */
export function licenseProblems(
  packages: LicensedPackage[],
  allowed: string[],
  exceptions: LicenseException[] = []
): string[] {
  return packages.flatMap((pkg) => {
    const id = `${pkg.name}@${pkg.version}`;
    const problems: string[] = [];
    const excepted = exceptions.some(({ name, version }) => name === pkg.name && version === pkg.version);
    if (!excepted) {
      let ok: boolean | undefined;
      try {
        ok = satisfies(pkg.license, allowed);
      } catch {
        problems.push(`${id}: license "${pkg.license}" is not a valid SPDX expression.`);
      }
      if (ok === false) {
        problems.push(`${id}: license "${pkg.license}" is not on the allow-list.`);
      }
    }
    if (pkg.texts.length === 0) {
      problems.push(`${id}: no license text found to reproduce.`);
    }
    return problems;
  });
}
