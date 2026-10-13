import { SandboxService, WorkspaceId, ExecResult, TestResult } from './types.js';

export class DockerSandboxService implements SandboxService {
  async createWorkspace(taskId: string, commit: string): Promise<WorkspaceId> {
    return `ws-${taskId}-${commit.slice(0, 7)}`;
  }

  async exec(_ws: WorkspaceId, _cmd: string, _opts: { timeoutMs: number }): Promise<ExecResult> {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    };
  }

  async applyPatch(
    _ws: WorkspaceId,
    _patch: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  async runTests(_ws: WorkspaceId, _testIds: string[]): Promise<TestResult> {
    return {
      passed: 0,
      failed: 0,
      errors: 0,
      details: '',
    };
  }

  async readFile(_ws: WorkspaceId, _path: string): Promise<string> {
    return '';
  }

  async diff(_ws: WorkspaceId, _a: string, _b: string): Promise<string> {
    return '';
  }

  async destroy(_ws: WorkspaceId): Promise<void> {
    return;
  }
}
