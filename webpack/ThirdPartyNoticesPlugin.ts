import fs from 'node:fs';
import path from 'node:path';
import { Compilation, Compiler, NormalModule, WebpackError, sources } from 'webpack';
import { LicenseException, LicensedPackage, licenseProblems } from './licenseCheck';

const NAME = 'ThirdPartyNoticesPlugin';
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
// A "## License" README section, up to the next heading of the same or higher level.
const README_LICENSE_SECTION = /^(#{1,3}) *licen[cs]e\b.*$([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/im;
// The package directory of a bundled file: the last node_modules/<name> or node_modules/@scope/<name>.
const PACKAGE_DIR = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;

interface PackageNotice extends LicensedPackage {
  homepage?: string;
}

interface Options {
  filename: string;
  header: string;
  /**
   * Packages whose published build already inlines their dependencies (MapLibre's dist file
   * does). Webpack sees only the one file, so their production dependency trees are added too.
   */
  prebundled: string[];
  /** Licenses a bundled package may have (SPDX ids). */
  allowedLicenses: string[];
  licenseExceptions: LicenseException[];
}

/**
 * Emits a notices file listing every npm package webpack bundled into the plugin, with its
 * license text. Built from the compiled modules, so it can't drift from what actually ships.
 * Licenses such as BSD-3-Clause (MapLibre) require the notice in binary distributions.
 *
 * It also checks each package against the license policy (licenseCheck.ts). A failure is a
 * build error in production, so the plugin can't be built with it, and a warning in
 * development, so `npm run dev` keeps working while a new dependency is reviewed.
 */
export class ThirdPartyNoticesPlugin {
  constructor(private readonly options: Options) {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      compilation.hooks.processAssets.tap({ name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        const packageDirs = new Set<string>();
        for (const module of compilation.modules) {
          const match = module instanceof NormalModule ? PACKAGE_DIR.exec(module.resource) : null;
          if (match) {
            packageDirs.add(match[1]);
          }
        }

        for (const dir of [...packageDirs]) {
          if (this.options.prebundled.includes(readPackageJson(dir).name)) {
            addDependencies(dir, packageDirs);
          }
        }

        const notices = [...packageDirs].map(readNotice).sort((a, b) => a.name.localeCompare(b.name));
        const report = compiler.options.mode === 'production' ? compilation.errors : compilation.warnings;
        for (const problem of licenseProblems(notices, this.options.allowedLicenses, this.options.licenseExceptions)) {
          report.push(new WebpackError(`${NAME}: ${problem} See docs/licenses.md.`));
        }
        compilation.emitAsset(this.options.filename, new sources.RawSource(format(this.options.header, notices)));
      });
    });
  }
}

function readPackageJson(dir: string) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

/** Adds the production dependencies of the package in `dir`, recursively. Type-only packages are skipped. */
function addDependencies(dir: string, found: Set<string>) {
  for (const name of Object.keys(readPackageJson(dir).dependencies ?? {})) {
    if (name.startsWith('@types/')) {
      continue;
    }
    const depDir = findPackageDir(name, dir);
    if (!found.has(depDir)) {
      found.add(depDir);
      addDependencies(depDir, found);
    }
  }
}

/** Node's lookup: <dir>/node_modules/<name>, then each parent directory's node_modules. */
function findPackageDir(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    if (dir === path.dirname(dir)) {
      throw new Error(`${NAME}: cannot find ${name}, a dependency of ${fromDir}`);
    }
  }
}

function readNotice(dir: string): PackageNotice {
  const pkg = readPackageJson(dir);
  const files = fs.readdirSync(dir).sort();
  const texts = files
    .filter((file) => LICENSE_FILE.test(file))
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim());
  // Some packages (murmurhash-js) keep their license only in the README.
  const readme = files.find((file) => /^readme(\.md)?$/i.test(file));
  if (texts.length === 0 && readme) {
    const section = README_LICENSE_SECTION.exec(fs.readFileSync(path.join(dir, readme), 'utf8'))?.[2].trim();
    if (section) {
      texts.push(section);
    }
  }
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
    homepage: pkg.homepage ?? repository,
    texts,
  };
}

function format(header: string, notices: PackageNotice[]): string {
  const rule = '='.repeat(78);
  const sections = notices.map((n) =>
    [
      rule,
      `${n.name} ${n.version} (${n.license})`,
      ...(n.homepage ? [n.homepage] : []),
      rule,
      '',
      n.texts.length > 0 ? n.texts.join('\n\n') : `This package includes no license file. License: ${n.license}.`,
      '',
    ].join('\n')
  );
  return [header.trim(), '', ...sections].join('\n');
}
