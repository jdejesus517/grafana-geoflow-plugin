// Run with `npm run test:build` (Node's test runner; Jest only looks under src/).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type LicensedPackage, licenseProblems } from './licenseCheck.ts';

const ALLOWED = ['MIT', 'ISC', 'BSD-3-Clause'];

function pkg(license: string, texts = ['license text']): LicensedPackage {
  return { name: 'some-package', version: '1.2.3', license, texts };
}

describe('licenseProblems', () => {
  it('passes allowed licenses', () => {
    assert.deepEqual(licenseProblems([pkg('MIT'), pkg('ISC'), pkg('BSD-3-Clause')], ALLOWED), []);
  });

  it('passes an OR expression when either side is allowed', () => {
    assert.deepEqual(licenseProblems([pkg('(MIT OR Apache-2.0)'), pkg('GPL-3.0-only OR MIT')], ALLOWED), []);
  });

  it('passes an AND expression only when both sides are allowed', () => {
    assert.deepEqual(licenseProblems([pkg('MIT AND BSD-3-Clause')], ALLOWED), []);
    assert.deepEqual(licenseProblems([pkg('MIT AND Zlib')], ALLOWED), [
      'some-package@1.2.3: license "MIT AND Zlib" is not on the allow-list.',
    ]);
  });

  it('fails a license that is not allowed', () => {
    assert.deepEqual(licenseProblems([pkg('GPL-3.0-only')], ALLOWED), [
      'some-package@1.2.3: license "GPL-3.0-only" is not on the allow-list.',
    ]);
  });

  it('fails a missing or unknown license', () => {
    assert.deepEqual(licenseProblems([pkg('UNKNOWN'), pkg('SEE LICENSE IN LICENSE.md')], ALLOWED), [
      'some-package@1.2.3: license "UNKNOWN" is not a valid SPDX expression.',
      'some-package@1.2.3: license "SEE LICENSE IN LICENSE.md" is not a valid SPDX expression.',
    ]);
  });

  it('fails a package without license text', () => {
    assert.deepEqual(licenseProblems([pkg('MIT', [])], ALLOWED), [
      'some-package@1.2.3: no license text found to reproduce.',
    ]);
  });

  it('accepts an exception for its exact version only', () => {
    const exceptions = [{ name: 'some-package', version: '1.2.3', reason: 'reviewed' }];
    assert.deepEqual(licenseProblems([pkg('Zlib')], ALLOWED, exceptions), []);
    assert.deepEqual(licenseProblems([{ ...pkg('Zlib'), version: '1.2.4' }], ALLOWED, exceptions), [
      'some-package@1.2.4: license "Zlib" is not on the allow-list.',
    ]);
  });

  it('still needs a license text for an exception', () => {
    const exceptions = [{ name: 'some-package', version: '1.2.3', reason: 'reviewed' }];
    assert.deepEqual(licenseProblems([pkg('Zlib', [])], ALLOWED, exceptions), [
      'some-package@1.2.3: no license text found to reproduce.',
    ]);
  });
});
