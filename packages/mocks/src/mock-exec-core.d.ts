import { TraceSpan } from '@soa/contracts';
export declare class MockExecCore {
  runTask(taskId: string): Promise<{
    spans: TraceSpan[];
    output: string;
  }>;
}
//# sourceMappingURL=mock-exec-core.d.ts.map
