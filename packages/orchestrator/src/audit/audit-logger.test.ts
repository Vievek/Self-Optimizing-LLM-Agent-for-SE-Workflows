import { describe, it, expect, vi } from 'vitest';
import type { Store } from '@soa/store';
import { AuditLogger, type AuditEntry } from './audit-logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;

function createEntry(ts: number, signalId: string): AuditEntry {
  return {
    ts,
    signal_id: signalId,
    config_path: 'retrieval.top_k',
    version_after: `cfg_${signalId}`,
    action: 'deploy',
  };
}

describe('AuditLogger.prune', () => {
  it('removes entries older than 90 days from memory', async () => {
    const logger = new AuditLogger();

    await logger.record(createEntry(NOW - 91 * DAY_MS, 'old'));
    await logger.record(createEntry(NOW - 90 * DAY_MS, 'cutoff'));
    await logger.record(createEntry(NOW - 10 * DAY_MS, 'recent'));

    const removed = await logger.prune(NOW);

    expect(removed).toBe(1);
    expect(logger.getEntries().map((entry) => entry.signal_id)).toEqual(['cutoff', 'recent']);
  });

  it('returns zero when no entries need pruning', async () => {
    const logger = new AuditLogger();

    await logger.record(createEntry(NOW - 30 * DAY_MS, 'recent'));

    expect(await logger.prune(NOW)).toBe(0);
    expect(logger.getEntries()).toHaveLength(1);
  });

  it('returns zero for an empty audit log', async () => {
    const logger = new AuditLogger();

    expect(await logger.prune(NOW)).toBe(0);
  });

  it('removes expired entries from persistent JSONL storage', async () => {
    let storedEntries: AuditEntry[] = [
      createEntry(NOW - 91 * DAY_MS, 'old'),
      createEntry(NOW - 90 * DAY_MS, 'cutoff'),
      createEntry(NOW - 10 * DAY_MS, 'recent'),
    ];

    const store = {
      exists: vi.fn(async () => true),
      readJsonl: vi.fn(async () => [...storedEntries]),
      delete: vi.fn(async () => {
        storedEntries = [];
      }),
      append: vi.fn(async (_path: string, entry: AuditEntry) => {
        storedEntries.push(entry);
      }),
    } as unknown as Store;

    const logger = new AuditLogger({ store });

    const removed = await logger.prune(NOW);

    expect(removed).toBe(0);
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(storedEntries.map((entry) => entry.signal_id)).toEqual(['cutoff', 'recent']);
  });
});
