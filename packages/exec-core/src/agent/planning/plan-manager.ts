import { PlanningConfig, PlanSpanAttributesSchema } from '@soa/contracts';
import { SubTask, PlanState, PlanSpanAttributes } from '../types.js';
import { DEFAULT_PLANNING_CONFIG } from './plan-generator.js';

export class PlanManager {
  private readonly config: PlanningConfig;
  private readonly taskId: string;
  private subtasks: SubTask[];
  private activeStepIndex: number;
  private replanCount: number;
  private replanReason: string | null;

  constructor(taskId: string, initialSubtasks: SubTask[], config?: Partial<PlanningConfig>) {
    this.taskId = taskId;
    this.subtasks = [...initialSubtasks];
    this.activeStepIndex = 0;
    this.replanCount = 0;
    this.replanReason = null;
    this.config = {
      ...DEFAULT_PLANNING_CONFIG,
      ...config,
    };

    const first = this.subtasks[0];
    if (first && first.status === 'pending') {
      first.status = 'in_progress';
    }
  }

  /**
   * Returns current snapshot of the plan state.
   */
  getState(): PlanState {
    return {
      taskId: this.taskId,
      subtasks: [...this.subtasks],
      activeStepIndex: this.activeStepIndex,
      replanCount: this.replanCount,
      replanReason: this.replanReason,
    };
  }

  /**
   * Retrieves the currently active subtask.
   */
  getActiveSubtask(): SubTask | undefined {
    return this.subtasks[this.activeStepIndex];
  }

  /**
   * Retrieves the current 0-based active step index.
   */
  getActiveStepIndex(): number {
    return this.activeStepIndex;
  }

  /**
   * Marks the current active subtask as completed and advances the plan to the next step.
   */
  markActiveCompleted(): SubTask | undefined {
    const current = this.getActiveSubtask();
    if (!current) return undefined;

    current.status = 'completed';
    this.replanReason = null;

    this.activeStepIndex += 1;
    const next = this.getActiveSubtask();
    if (next && next.status === 'pending') {
      next.status = 'in_progress';
    }

    return current;
  }

  /**
   * Marks current active subtask as failed and records error details and retry count.
   */
  markActiveFailed(error: string): SubTask | undefined {
    const current = this.getActiveSubtask();
    if (!current) return undefined;

    current.status = 'failed';
    current.lastError = error;
    current.retryCount += 1;
    if (current.features) {
      current.features.prior_failures = current.retryCount;
    }

    return current;
  }

  /**
   * Checks whether the active plan can backtrack to an earlier step
   * based on the configured backtrack_depth.
   */
  canBacktrack(): boolean {
    return this.activeStepIndex > 0 && this.activeStepIndex <= this.config.backtrack_depth;
  }

  /**
   * Rolls back execution to a previous step (or steps) within backtrack_depth.
   */
  backtrack(reason: string, targetStepIndex?: number): SubTask | undefined {
    if (!this.canBacktrack()) {
      throw new Error(
        `Cannot backtrack: activeStepIndex (${this.activeStepIndex}) exceeds allowed backtrack_depth (${this.config.backtrack_depth}) or is at root.`,
      );
    }

    const minAllowedStep = Math.max(0, this.activeStepIndex - this.config.backtrack_depth);
    const destStep =
      typeof targetStepIndex === 'number'
        ? Math.max(minAllowedStep, Math.min(targetStepIndex, this.activeStepIndex - 1))
        : this.activeStepIndex - 1;

    // Reset subsequent steps back to pending
    for (let i = destStep; i < this.subtasks.length; i++) {
      const step = this.subtasks[i];
      if (step) {
        step.status = i === destStep ? 'in_progress' : 'pending';
      }
    }

    this.activeStepIndex = destStep;
    this.replanCount += 1;
    this.replanReason = reason;

    return this.getActiveSubtask();
  }

  /**
   * Replaces pending subtasks from the current step onwards with new subtasks.
   */
  replan(newSubtasks: SubTask[], reason: string): void {
    const retained = this.subtasks.slice(0, this.activeStepIndex);

    // Adjust step indices of the new subtasks
    const adjustedNew = newSubtasks.map((st, idx) => ({
      ...st,
      stepIndex: this.activeStepIndex + idx,
      status: idx === 0 ? ('in_progress' as const) : ('pending' as const),
    }));

    this.subtasks = [...retained, ...adjustedNew];
    this.replanCount += 1;
    this.replanReason = reason;
  }

  /**
   * True if all subtasks in the plan are marked as completed.
   */
  isCompleted(): boolean {
    return (
      this.subtasks.length > 0 &&
      this.activeStepIndex >= this.subtasks.length &&
      this.subtasks.every((st) => st.status === 'completed')
    );
  }

  /**
   * True if active subtask is failed and cannot backtrack.
   */
  isFailed(): boolean {
    const active = this.getActiveSubtask();
    return Boolean(active && active.status === 'failed' && !this.canBacktrack());
  }

  /**
   * Emits contract-compliant PlanSpanAttributesSchema telemetry for tracing.
   */
  getPlanSpanAttributes(): PlanSpanAttributes {
    return PlanSpanAttributesSchema.parse({
      step_index: this.activeStepIndex,
      replan_reason: this.replanReason,
    });
  }

  /**
   * Summary progress statistics.
   */
  getProgress(): {
    total: number;
    completed: number;
    failed: number;
    activeIndex: number;
    replanCount: number;
  } {
    const completed = this.subtasks.filter((st) => st.status === 'completed').length;
    const failed = this.subtasks.filter((st) => st.status === 'failed').length;

    return {
      total: this.subtasks.length,
      completed,
      failed,
      activeIndex: this.activeStepIndex,
      replanCount: this.replanCount,
    };
  }
}
