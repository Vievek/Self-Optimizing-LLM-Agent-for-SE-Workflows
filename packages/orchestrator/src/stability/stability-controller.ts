export interface MetricRecord {
  taskIndex: number;
  success: boolean;
  version: string;
}

/**
 * StabilityController – Stability controls
 *
 * Enforces stability invariants:
 * - At most one config mutation per signal group (group_id).
 * - Tracks metric history over a sliding window to trigger regression rollback.
 */
export class StabilityController {
  private readonly processedGroups = new Set<string>();
  private readonly metricHistory: MetricRecord[] = [];

  canProcessGroup(groupId: string): boolean {
    return !this.processedGroups.has(groupId);
  }

  recordGroupProcessed(groupId: string): void {
    this.processedGroups.add(groupId);
  }

  recordMetric(taskIndex: number, success: boolean, version: string): void {
    this.metricHistory.push({ taskIndex, success, version });
  }

  /**
   * Checks whether the current window indicates a regression
   * (e.g. failure rate spiked after an update).
   */
  shouldRollback(windowSize: number = 5): boolean {
    if (this.metricHistory.length < windowSize) {
      return false;
    }
    const recent = this.metricHistory.slice(-windowSize);
    const failureCount = recent.filter((m) => !m.success).length;
    // If 80%+ of recent tasks in window failed, trigger regression recovery
    return failureCount / windowSize >= 0.8;
  }

  reset(): void {
    this.processedGroups.clear();
    this.metricHistory.length = 0;
  }
}
