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

  constructor(options: { store?: Store; logPath?: string } = {}) {
    this.store = options.store;
    this.logPath = options.logPath ?? 'store/logs/orch-audit.jsonl';
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
        for (const e of [...entries, ...stored]) {
          const key = `${e.ts}_${e.signal_id}_${e.version_after}_${e.action}`;
          map.set(key, e);
        }
        entries = Array.from(map.values());
      } catch {
        // Fall back to inMemoryEntries
      }
    }

    return entries.filter((e) => {
      if (filter.signal_id && e.signal_id !== filter.signal_id) return false;
      if (filter.config_path && e.config_path !== filter.config_path) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.since && e.ts < filter.since) return false;
      return true;
    });
  }

  getEntries(): AuditEntry[] {
    return [...this.inMemoryEntries];
  }
}
