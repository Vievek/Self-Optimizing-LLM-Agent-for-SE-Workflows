import { TraceSpan } from '@soa/contracts';

export class MockExecCore {
  async runTask(taskId: string): Promise<{ spans: TraceSpan[]; output: string }> {
    return {
      spans: [],
      output: `Mock executed task ${taskId}`,
    };
  }
}
