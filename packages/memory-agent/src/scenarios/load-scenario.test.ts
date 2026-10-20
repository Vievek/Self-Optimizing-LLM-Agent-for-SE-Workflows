import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadScenario } from './load-scenario.js';
import { parseSummaryNote } from '../working-memory/working-memory.js';
import { EVIDENCE_TEST, FIXTURES_ROOT, VALIDATORS_FILE } from '../test-utils/fixture-repos.js';

const SCENARIO = path.join(FIXTURES_ROOT, 'scenarios/username-regex.json');

describe('loadScenario', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-scenario-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('replays the username-regex scenario into a consolidated summary', async () => {
    const summary = await loadScenario(SCENARIO);

    expect(summary).toMatchObject({
      taskId: 'memtest__auth-1',
      repo: 'memtest/auth',
      baseCommit: 'memtest-v1',
      resolved: true,
    });
    expect(summary.notes).toHaveLength(2);

    const [find, fix] = summary.notes.map(parseSummaryNote);
    expect(find).toMatchObject({ outcome: 'success', files: [VALIDATORS_FILE], tests: [] });
    expect(fix).toMatchObject({
      outcome: 'success',
      files: [VALIDATORS_FILE],
      // The failing reproduction run is overwritten by the later passing run.
      tests: [{ id: EVIDENCE_TEST, passed: true }],
    });
    expect(fix!.tried).toHaveLength(3);
  });

  it('rejects a scenario that does not match the schema', async () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ taskId: 't', repo: 'r', baseCommit: 'c', focus: [] }));
    await expect(loadScenario(bad)).rejects.toThrow();
  });
});
