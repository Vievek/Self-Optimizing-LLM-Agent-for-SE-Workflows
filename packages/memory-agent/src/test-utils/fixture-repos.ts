// The fixture sandbox lives in src/dev so the CLI can use it; re-exported here for the tests.
export {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  FIXTURE_REPOS,
  FIXTURES_ROOT,
  STALE_SET_FILE,
  VALIDATORS_FILE,
  fakeValidatorTestRunner,
  isPytestAvailable,
  makeFixtureSandbox,
} from '../dev/fixture-sandbox.js';
export type { FixtureSandbox, FixtureSandboxSetup } from '../dev/fixture-sandbox.js';
