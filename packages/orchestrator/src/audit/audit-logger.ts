import type { Store } from '@soa/store';

export interface AuditEntry {
  ts: number;
  signal_id: string;
  config_path: string;
  old_value?: unknown;
  new_value?: unknown;
  version_before?: string;
  version_after: string;
  action: 'seed' | 'deploy' | 'rollback' | 'reject';
  reason?: string;
}

export interface AuditQueryFilter {
  signal_id?: string;
  config_path?: string;
  action?: AuditEntry['action'];
  since?: number;
}

/**
 * AuditLogger – FR6 / FR7
 *
 * Queryable audit trail for configuration updates and rollbacks.
 * Persists entries to store/logs/orch-audit.jsonl.
 */
export class AuditLogger {
  private readonly store?: Store;
  private readonly logPath: string;
  private readonly inMemoryEntries: AuditEntry[] = [];

  private readonly retentionMs = 90 * 24 * 60 * 60 * 1000;

  constructor(options: { store?: Store; logPath?: string } = {}) {
    this.store = options.store;
    this.logPath = options.logPath ?? 'logs/orch-audit.jsonl';
  }

  async record(entry: AuditEntry): Promise<void> {
    this.inMemoryEntries.push(entry);

    if (this.store) {
      await this.store.append(this.logPath, entry);
    }
  }

  async query(filter: AuditQueryFilter = {}): Promise<AuditEntry[]> {
    let entries = [...this.inMemoryEntries];

    if (this.store && (await this.store.exists(this.logPath))) {
      try {
        const stored = await this.store.readJsonl<AuditEntry>(this.logPath);
        const map = new Map<string, AuditEntry>();

        for (const entry of [...entries, ...stored]) {
          const key = `${entry.ts}_${entry.signal_id}_${entry.version_after}_${entry.action}`;
          map.set(key, entry);
        }

        entries = Array.from(map.values());
      } catch {
        // Fall back to in-memory entries.
      }
    }

    return entries.filter((entry) => {
      if (filter.signal_id && entry.signal_id !== filter.signal_id) {
        return false;
      }

      if (filter.config_path && entry.config_path !== filter.config_path) {
        return false;
      }

      if (filter.action && entry.action !== filter.action) {
        return false;
      }

      if (filter.since !== undefined && entry.ts < filter.since) {
        return false;
      }

      return true;
    });
  }

  /**
   * Removes audit entries older than 90 days.
   *
   * @param now Timestamp used to calculate the retention cutoff.
   *            Supplying it makes unit tests deterministic.
   * @returns Number of entries removed from in-memory storage.
   */
  async prune(now = Date.now()): Promise<number> {
    const cutoff = now - this.retentionMs;

    // Rewrite persistent JSONL storage, if configured.
    if (this.store && (await this.store.exists(this.logPath))) {
      const stored = await this.store.readJsonl<AuditEntry>(this.logPath);

      const retainedStored = stored.filter((entry) => entry.ts >= cutoff);

      // Only rewrite when at least one stored entry has expired.
      if (retainedStored.length !== stored.length) {
        await this.store.delete(this.logPath);

        for (const entry of retainedStored) {
          await this.store.append(this.logPath, entry);
        }
      }
    }

    // Remove expired entries from memory.
    const before = this.inMemoryEntries.length;

    const retainedInMemory = this.inMemoryEntries.filter((entry) => entry.ts >= cutoff);

    this.inMemoryEntries.splice(0, this.inMemoryEntries.length, ...retainedInMemory);

    return before - this.inMemoryEntries.length;
  }

  getEntries(): AuditEntry[] {
    return [...this.inMemoryEntries];
  }
}
