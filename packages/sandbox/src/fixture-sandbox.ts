import fs from 'node:fs';
import path from 'node:path';
import { exec as cpExec } from 'node:child_process';
import { promisify } from 'node:util';
import { SandboxService, WorkspaceId, ExecResult, TestResult } from './types.js';

const pExec = promisify(cpExec);

export interface FixtureSandboxOptions {
  /** Directory where active workspace instances will be created */
  workDirRoot?: string;
  /** Directory where baseline fixtures or template repositories reside */
  fixturesRoot?: string;
  /** Custom test runner function */
  testRunner?: (
    workspaceDir: string,
    testIds: string[],
    execFn: (cmd: string, timeoutMs: number) => Promise<ExecResult>,
  ) => Promise<TestResult>;
}

export class FixtureSandboxService implements SandboxService {
  private readonly workDirRoot: string;
  private readonly fixturesRoot: string;
  private readonly workspaces = new Map<WorkspaceId, string>();
  private readonly customTestRunner?: FixtureSandboxOptions['testRunner'];

  constructor(options: FixtureSandboxOptions = {}) {
    this.workDirRoot = path.resolve(process.cwd(), options.workDirRoot ?? 'scratch/sandboxes');
    this.fixturesRoot = path.resolve(process.cwd(), options.fixturesRoot ?? 'bench/fixtures');
    this.customTestRunner = options.testRunner;
    try {
      fs.mkdirSync(this.workDirRoot, { recursive: true });
    } catch {
      // Ignore directory creation if already exists
    }
  }

  async createWorkspace(taskId: string, commit: string): Promise<WorkspaceId> {
    const cleanTask = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanCommit = commit.slice(0, 7) || 'head';
    const wsId: WorkspaceId = `ws-${cleanTask}-${cleanCommit}-${Date.now()}`;
    const wsDir = path.join(this.workDirRoot, wsId);

    await fs.promises.mkdir(wsDir, { recursive: true });

    // Look for matching fixture template to copy from fixturesRoot
    const [, repoName] = taskId.split('__');
    const candidates = [
      path.join(this.fixturesRoot, taskId),
      repoName ? path.join(this.fixturesRoot, repoName) : '',
      this.fixturesRoot,
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(cand) && cand !== this.fixturesRoot) {
        await fs.promises.cp(cand, wsDir, { recursive: true });
        break;
      }
    }

    // Initialize as a git repository if not already initialized
    if (!fs.existsSync(path.join(wsDir, '.git'))) {
      try {
        await pExec(
          'git init && git config user.name "Sandbox" && git config user.email "sandbox@soa.local"',
          {
            cwd: wsDir,
          },
        );
      } catch {
        // Fallback gracefully if git is unavailable
      }
    }

    this.workspaces.set(wsId, wsDir);
    return wsId;
  }

  private getWsDir(ws: WorkspaceId): string {
    const dir = this.workspaces.get(ws);
    if (!dir || !fs.existsSync(dir)) {
      throw new Error(`Workspace not found or destroyed: ${ws}`);
    }
    return dir;
  }

  async exec(ws: WorkspaceId, cmd: string, opts: { timeoutMs: number }): Promise<ExecResult> {
    const wsDir = this.getWsDir(ws);
    const start = Date.now();

    try {
      const { stdout, stderr } = await pExec(cmd, {
        cwd: wsDir,
        timeout: opts.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: String(stdout),
        stderr: String(stderr),
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: String(execErr.stdout ?? ''),
        stderr: String(execErr.stderr ?? execErr.message ?? ''),
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        durationMs: Date.now() - start,
      };
    }
  }

  async applyPatch(ws: WorkspaceId, patch: string): Promise<{ success: boolean; error?: string }> {
    const wsDir = this.getWsDir(ws);
    const patchPath = path.join(wsDir, `.tmp_patch_${Date.now()}.patch`);

    try {
      await fs.promises.writeFile(patchPath, patch, 'utf8');

      // Try git apply first
      const gitRes = await this.exec(ws, `git apply --whitespace=nowarn ${patchPath}`, {
        timeoutMs: 30000,
      });

      if (gitRes.exitCode === 0) {
        return { success: true };
      }

      // Try fallback patch command if git apply failed
      const patchRes = await this.exec(ws, `patch -p1 < ${patchPath}`, {
        timeoutMs: 30000,
      });

      if (patchRes.exitCode === 0) {
        return { success: true };
      }

      return {
        success: false,
        error: gitRes.stderr || patchRes.stderr || 'Patch application failed',
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (fs.existsSync(patchPath)) {
        await fs.promises.unlink(patchPath).catch(() => {});
      }
    }
  }

  async runTests(ws: WorkspaceId, testIds: string[]): Promise<TestResult> {
    const wsDir = this.getWsDir(ws);

    if (this.customTestRunner) {
      return this.customTestRunner(wsDir, testIds, (cmd, timeoutMs) =>
        this.exec(ws, cmd, { timeoutMs }),
      );
    }

    if (testIds.length === 0) {
      return {
        passed: 0,
        failed: 0,
        errors: 0,
        details: 'No tests specified',
      };
    }

    // Default test runner executes pytest for python repos or node test runner for js repos
    const isPython =
      fs.existsSync(path.join(wsDir, 'pytest.ini')) ||
      fs.existsSync(path.join(wsDir, 'setup.py')) ||
      fs.existsSync(path.join(wsDir, 'pyproject.toml'));

    const cmd = isPython
      ? `python3 -m pytest ${testIds.join(' ')} -q --tb=short`
      : `npm test -- ${testIds.join(' ')}`;

    const res = await this.exec(ws, cmd, { timeoutMs: 60000 });

    const output = res.stdout + '\n' + res.stderr;
    let passed = 0;
    let failed = 0;
    let errors = 0;

    // Parse standard test output patterns (pytest, vitest, mocha, jest)
    const passedMatch = output.match(/(\d+)\s+passed/i);
    const failedMatch = output.match(/(\d+)\s+failed/i);
    const errorMatch = output.match(/(\d+)\s+error/i);

    if (passedMatch?.[1]) passed = parseInt(passedMatch[1], 10);
    if (failedMatch?.[1]) failed = parseInt(failedMatch[1], 10);
    if (errorMatch?.[1]) errors = parseInt(errorMatch[1], 10);

    if (res.exitCode === 0 && passed === 0 && failed === 0 && errors === 0) {
      passed = testIds.length;
    } else if (res.exitCode !== 0 && passed === 0 && failed === 0 && errors === 0) {
      failed = testIds.length;
    }

    return {
      passed,
      failed,
      errors,
      details: output.slice(-2000),
    };
  }

  async readFile(ws: WorkspaceId, filePath: string): Promise<string> {
    const wsDir = this.getWsDir(ws);
    const safePath = path.resolve(wsDir, filePath);
    if (!safePath.startsWith(wsDir)) {
      throw new Error(`Security error: path "${filePath}" resolves outside workspace`);
    }
    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.promises.readFile(safePath, 'utf8');
  }

  async diff(ws: WorkspaceId, a: string, b: string): Promise<string> {
    this.getWsDir(ws);
    const cmd = b ? `git diff ${a} ${b}` : `git diff ${a}`;
    const res = await this.exec(ws, cmd, { timeoutMs: 30000 });
    return res.stdout;
  }

  async destroy(ws: WorkspaceId): Promise<void> {
    const wsDir = this.workspaces.get(ws);
    if (wsDir && fs.existsSync(wsDir)) {
      await fs.promises.rm(wsDir, { recursive: true, force: true });
    }
    this.workspaces.delete(ws);
  }
}
