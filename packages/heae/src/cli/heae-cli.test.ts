
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';

import { runHeaeCli } from './heae-cli.js';

const toolFixture =
  'packages/heae/fixtures/tool-error.jsonl';

const successFixture =
  'fixtures/traces/success.jsonl';

const toolTraceId =
  '0123456789abcdef0123456789abcdef';

describe('HEAE standalone CLI', () => {
  it('displays help', async () => {
    const output = await runHeaeCli(['help']);

    expect(output).toContain('heae evaluate');
    expect(output).toContain('heae history');
  });

  it('evaluates a trace and saves the result', async () => {
    const store = new MemoryStore();

    const output = await runHeaeCli(
      ['evaluate', toolFixture],
      { store },
    );

    const result = JSON.parse(output) as {
      traceId: string;
      observationCount: number;
      saved: boolean;
    };

    expect(result.traceId).toBe(toolTraceId);
    expect(result.observationCount).toBe(1);
    expect(result.saved).toBe(true);

    expect(
      await store.exists(
        `heae/evaluations/${toolTraceId}.json`,
      ),
    ).toBe(true);
  });

  it('lists previously saved evaluations', async () => {
    const store = new MemoryStore();

    await runHeaeCli(
      ['evaluate', toolFixture],
      { store },
    );

    const output = await runHeaeCli(
      ['history'],
      { store },
    );

    const records = JSON.parse(output) as Array<{
      traceId: string;
      outcome: string;
    }>;

    expect(records).toHaveLength(1);
    expect(records[0]?.traceId).toBe(toolTraceId);
    expect(records[0]?.outcome).toBe('fail');
  });

  it('retrieves a saved evaluation by trace ID', async () => {
    const store = new MemoryStore();

    await runHeaeCli(
      ['evaluate', toolFixture],
      { store },
    );

    const output = await runHeaeCli(
      ['history', toolTraceId],
      { store },
    );

    const record = JSON.parse(output) as {
      traceId: string;
      schemaVersion: string;
    };

    expect(record.traceId).toBe(toolTraceId);
    expect(record.schemaVersion).toBe('1.0');
  });

  it('reports when no evaluation is saved', async () => {
    const output = await runHeaeCli(
      ['history'],
      { store: new MemoryStore() },
    );

    expect(output).toContain(
      'No saved HEAE evaluations',
    );
  });

  it('rejects missing trace paths', async () => {
    await expect(
      runHeaeCli(
        ['evaluate'],
        { store: new MemoryStore() },
      ),
    ).rejects.toThrow(
      'Usage: heae evaluate',
    );
  });

  it('rejects unknown commands', async () => {
    await expect(
      runHeaeCli(['unknown']),
    ).rejects.toThrow(
      'Unknown HEAE command',
    );
  });

  it('rejects malformed trace files', async () => {
    await expect(
      runHeaeCli(
        ['evaluate', 'does-not-exist.jsonl'],
        { store: new MemoryStore() },
      ),
    ).rejects.toThrow(
      'Unable to read trace file',
    );
  });

  it('preserves the clean trace outcome', async () => {
    const store = new MemoryStore();

    const output = await runHeaeCli(
      ['evaluate', successFixture],
      { store },
    );

    const result = JSON.parse(output) as {
      observationCount: number;
      judgeStatus: string;
      saved: boolean;
    };

    expect(result.observationCount).toBe(0);
    expect(result.judgeStatus).toBe('skipped');
    expect(result.saved).toBe(true);
  });
});
