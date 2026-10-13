export type WorkspaceId = string;
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
export interface TestResult {
  passed: number;
  failed: number;
  errors: number;
  details: string;
}
export interface SandboxService {
  createWorkspace(taskId: string, commit: string): Promise<WorkspaceId>;
  exec(
    ws: WorkspaceId,
    cmd: string,
    opts: {
      timeoutMs: number;
    },
  ): Promise<ExecResult>;
  applyPatch(
    ws: WorkspaceId,
    patch: string,
  ): Promise<{
    success: boolean;
    error?: string;
  }>;
  runTests(ws: WorkspaceId, testIds: string[]): Promise<TestResult>;
  readFile(ws: WorkspaceId, path: string): Promise<string>;
  diff(ws: WorkspaceId, a: string, b: string): Promise<string>;
  destroy(ws: WorkspaceId): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map
