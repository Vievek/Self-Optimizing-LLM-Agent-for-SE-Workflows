import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSandboxService, type FixtureSandboxOptions } from '@soa/sandbox';
import { normalizeCode } from '../verify/snippet-check.js';

/** packages/memory-agent/fixtures, resolved from this file (src/dev or dist/dev) so cwd does not matter. */
export const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures',
);
export const FIXTURE_REPOS = path.join(FIXTURES_ROOT, 'repos');
export const STALE_SET_FILE = path.join(FIXTURES_ROOT, 'stale-set/cases.json');

export const VALIDATORS_FILE = 'auth/validators.py';
export const FIXED_REGEX_LINE = "regex = r'^[\\w.@+-]+\\Z'";
export const EVIDENCE_TEST = 'tests/test_validators.py::test_rejects_trailing_newline';

/** A test function containing this comment fails under the fake runner (and really fails in pytest). */
export const SIMULATED_FAILURE = '# simulated-failure';

type TestRunner = NonNullable<FixtureSandboxOptions['testRunner']>;
type Outcome = 'passed' | 'failed' | 'error';

/**
 * Returns the source of a top-level `def name(...)` in a python file, or undefined if absent.
 * The body runs until the next non-empty line indented no deeper than the def.
 */
export function findTestFunction(source: string, name: string): string | undefined {
  const lines = source.split(/\r?\n/);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`).test(l));
  if (start < 0) return undefined;
  const indent = lines[start]!.search(/\S/);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    end++;
  }
  return lines.slice(start, end).join('\n');
}

function runOne(workspaceDir: string, testId: string, validatorFixed: boolean): Outcome {
  const [file = '', func] = testId.split('::');
  const testFile = path.join(workspaceDir, file);
  if (!fs.existsSync(testFile)) return 'error';
  const source = fs.readFileSync(testFile, 'utf8');
  const body = func ? findTestFunction(source, func) : source;
  if (body === undefined) return 'error';
  if (body.includes(SIMULATED_FAILURE)) return 'failed';
  return validatorFixed ? 'passed' : 'failed';
}

/**
 * Stands in for pytest so CI needs no python. Per test id:
 * - test file or function missing -> error (pytest: collection error / "not found")
 * - auth/validators.py missing -> error (pytest: the import fails during collection)
 * - function contains "# simulated-failure" -> failed
 * - otherwise passes only if validators.py still contains the fixed regex.
 * That matches real pytest on v1, v3, v4 and v5. For v2 it reports a failure, though real pytest
 * passes there because the rewritten validator also rejects the newline. The verifier never reaches
 * the tests at v2 since the snippet is already gone, so the answer is stale either way.
 */
export const fakeValidatorTestRunner: TestRunner = async (workspaceDir, testIds) => {
  const validators = path.join(workspaceDir, VALIDATORS_FILE);
  const counts = { passed: 0, failed: 0, errors: 0 };
  if (!fs.existsSync(validators)) {
    counts.errors = testIds.length;
    return { ...counts, details: `ImportError: ${VALIDATORS_FILE} missing` };
  }
  const fixed = normalizeCode(fs.readFileSync(validators, 'utf8')).includes(FIXED_REGEX_LINE);
  const notes: string[] = [];
  for (const id of testIds) {
    const outcome = runOne(workspaceDir, id, fixed);
    if (outcome === 'passed') counts.passed++;
    else if (outcome === 'failed') counts.failed++;
    else counts.errors++;
    if (outcome !== 'passed') notes.push(`${outcome === 'error' ? 'ERROR' : 'FAILED'} ${id}`);
  }
  const summary = `${counts.passed} passed, ${counts.failed} failed, ${counts.errors} errors`;
  return { ...counts, details: [...notes, summary].join('\n') };
};

/** True when `python3 -m pytest` works on this machine. */
export function isPytestAvailable(): boolean {
  try {
    execSync('python3 -m pytest --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface FixtureSandbox {
  sandbox: FixtureSandboxService;
  workDirRoot: string;
  cleanup: () => void;
}

export interface FixtureSandboxSetup {
  /** Use fakeValidatorTestRunner instead of the sandbox's default (pytest) runner. */
  fakeTests?: boolean;
  /** Where workspaces are created. Defaults to a fresh temp directory. */
  workDirRoot?: string;
}

/** A FixtureSandboxService over the memtest repos; commit "memtest-vN" maps to fixtures/repos/memtest-vN. */
export function makeFixtureSandbox(setup: FixtureSandboxSetup = {}): FixtureSandbox {
  const workDirRoot = setup.workDirRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memtest-'));
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
