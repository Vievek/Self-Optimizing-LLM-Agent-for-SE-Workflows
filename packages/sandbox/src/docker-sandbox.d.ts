import { SandboxService, WorkspaceId, ExecResult, TestResult } from './types.js';
export declare class DockerSandboxService implements SandboxService {
  createWorkspace(taskId: string, commit: string): Promise<WorkspaceId>;
  exec(
    _ws: WorkspaceId,
    _cmd: string,
    _opts: {
      timeoutMs: number;
    },
  ): Promise<ExecResult>;
  applyPatch(
    _ws: WorkspaceId,
    _patch: string,
  ): Promise<{
    success: boolean;
    error?: string;
  }>;
  runTests(_ws: WorkspaceId, _testIds: string[]): Promise<TestResult>;
  readFile(_ws: WorkspaceId, _path: string): Promise<string>;
  diff(_ws: WorkspaceId, _a: string, _b: string): Promise<string>;
  destroy(_ws: WorkspaceId): Promise<void>;
}
//# sourceMappingURL=docker-sandbox.d.ts.map
