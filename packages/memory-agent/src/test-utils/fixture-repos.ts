import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSandboxService } from '@soa/sandbox';

/** packages/memory-agent/fixtures/repos, resolved from this file so cwd does not matter. */
export const FIXTURE_REPOS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/repos',
);

export interface FixtureSandbox {
  sandbox: FixtureSandboxService;
  workDirRoot: string;
  cleanup: () => void;
}

/** A FixtureSandboxService over the memtest repos, with workspaces in a fresh temp directory. */
export function makeFixtureSandbox(): FixtureSandbox {
  const workDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memtest-'));
  const sandbox = new FixtureSandboxService({ fixturesRoot: FIXTURE_REPOS, workDirRoot });
  return {
    sandbox,
    workDirRoot,
    cleanup: () => fs.rmSync(workDirRoot, { recursive: true, force: true }),
  };
}
