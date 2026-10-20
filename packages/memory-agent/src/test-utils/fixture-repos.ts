import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSandboxService, type FixtureSandboxOptions } from '@soa/sandbox';
import { normalizeCode } from '../verify/snippet-check.js';

/** packages/memory-agent/fixtures, resolved from this file so cwd does not matter. */
export const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures',
);
export const FIXTURE_REPOS = path.join(FIXTURES_ROOT, 'repos');

export const VALIDATORS_FILE = 'auth/validators.py';
export const FIXED_REGEX_LINE = "regex = r'^[\\w.@+-]+\\Z'";
export const EVIDENCE_TEST = 'tests/test_validators.py::test_rejects_trailing_newline';

type TestRunner = NonNullable<FixtureSandboxOptions['testRunner']>;

/**
 * Stands in for pytest so CI needs no python: a test passes only if auth/validators.py exists
 * and still contains the fixed regex. That gives v1 = pass and v3 = error (in pytest the import
 * fails during collection). For v2 it reports a failure, though real pytest passes there because
 * the rewritten validator also rejects the newline. The verifier never reaches the tests at v2
 * since the snippet is already gone, so the answer is stale either way.
 */
export const fakeValidatorTestRunner: TestRunner = async (workspaceDir, testIds) => {
  const file = path.join(workspaceDir, VALIDATORS_FILE);
  const n = testIds.length;
  if (!fs.existsSync(file)) {
    return { passed: 0, failed: 0, errors: n, details: `ImportError: ${VALIDATORS_FILE} missing` };
  }
  const fixed = normalizeCode(fs.readFileSync(file, 'utf8')).includes(FIXED_REGEX_LINE);
  return fixed
    ? { passed: n, failed: 0, errors: 0, details: `${n} passed` }
    : { passed: 0, failed: n, errors: 0, details: `${n} failed` };
};

export interface FixtureSandbox {
  sandbox: FixtureSandboxService;
  workDirRoot: string;
  cleanup: () => void;
}

export interface FixtureSandboxSetup {
  /** Use fakeValidatorTestRunner instead of the sandbox's default (pytest) runner. */
  fakeTests?: boolean;
}

/** A FixtureSandboxService over the memtest repos, with workspaces in a fresh temp directory. */
export function makeFixtureSandbox(setup: FixtureSandboxSetup = {}): FixtureSandbox {
  const workDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memtest-'));
  const sandbox = new FixtureSandboxService({
    fixturesRoot: FIXTURE_REPOS,
    workDirRoot,
    testRunner: setup.fakeTests ? fakeValidatorTestRunner : undefined,
  });
  return {
    sandbox,
    workDirRoot,
    cleanup: () => fs.rmSync(workDirRoot, { recursive: true, force: true }),
  };
}
