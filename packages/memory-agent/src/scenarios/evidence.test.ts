import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMemoryId, OutcomeEvidenceSchema } from '@soa/contracts';
import { PLACEHOLDER_MEMORY_ID, withMemoryId } from './evidence.js';
import { FIXTURES_ROOT } from '../test-utils/fixture-repos.js';

function readEvidence(name: string) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_ROOT, 'evidence', `${name}.json`), 'utf8'));
}

describe('evidence fixtures', () => {
  const memoryId = generateMemoryId();

  it('success.json parses after withMemoryId: resolved, memory used and not implicated', () => {
    const raw = readEvidence('success');
    const evidence = OutcomeEvidenceSchema.parse(withMemoryId(raw, memoryId));
    expect(evidence.outcome.resolved).toBe(true);
    expect(evidence.memory_uses).toEqual([
      expect.objectContaining({ memory_id: memoryId, implicated_in_failure: false }),
    ]);
    // The original is left untouched.
    expect(raw.memory_uses[0].memory_id).toBe(PLACEHOLDER_MEMORY_ID);
  });

  it('blamed.json parses after withMemoryId: unresolved and the memory is implicated', () => {
    const evidence = OutcomeEvidenceSchema.parse(withMemoryId(readEvidence('blamed'), memoryId));
    expect(evidence.outcome.resolved).toBe(false);
    expect(evidence.memory_uses).toEqual([
      expect.objectContaining({ memory_id: memoryId, implicated_in_failure: true }),
    ]);
  });
});
