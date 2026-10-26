import { OptimizationSignalSchema, type OptimizationSignal } from '@soa/contracts';
import type { Store } from '@soa/store';

export interface IntakeResult {
  valid: OptimizationSignal[];
  dropped: Array<{ signalId?: string; raw: unknown; reason: string }>;
}

/**
 * SignalIntake – FR1
 *
 * Reads incoming signals from store/events/ or direct input,
 * validates against OptimizationSignalSchema, and drops invalid signals
 * with a logged rejection reason.
 */
export class SignalIntake {
  private readonly store?: Store;
  private readonly eventsPath: string;

  constructor(options: { store?: Store; eventsPath?: string } = {}) {
    this.store = options.store;
    this.eventsPath = options.eventsPath ?? 'events/optimization_signals.jsonl';
  }

  processBatch(items: unknown[]): IntakeResult {
    const valid: OptimizationSignal[] = [];
    const dropped: Array<{ signalId?: string; raw: unknown; reason: string }> = [];

    for (const item of items) {
      const parsed = OptimizationSignalSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        const signalId =
          item && typeof item === 'object' && 'signal_id' in item
            ? String((item as { signal_id: unknown }).signal_id)
            : undefined;
        dropped.push({
          signalId,
          raw: item,
          reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
    }

    return { valid, dropped };
  }

  async readFromStore(): Promise<IntakeResult> {
    if (!this.store || !(await this.store.exists(this.eventsPath))) {
      return { valid: [], dropped: [] };
    }

    const rawRecords = await this.store.readJsonl<unknown>(this.eventsPath);
    return this.processBatch(rawRecords);
  }
}
