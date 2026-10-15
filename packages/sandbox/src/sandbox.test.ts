import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FixtureSandboxService, WorkspaceId } from './index.js';

describe('FixtureSandboxService Tests', () => {
  const sandbox = new FixtureSandboxService({
    workDirRoot: 'scratch/test-sandboxes',
  });
  const activeWorkspaces: WorkspaceId[] = [];

  afterEach(async () => {
    for (const ws of activeWorkspaces) {
      await sandbox.destroy(ws).catch(() => {});
    }
    activeWorkspaces.length = 0;
  });

  it('creates workspace, executes command, and reads file', async () => {
    const ws = await sandbox.createWorkspace('django__django-11099', 'fb8b75e');
    activeWorkspaces.push(ws);

    expect(ws).toContain('django__django-11099');

    // Execute shell command to create a file
    const res = await sandbox.exec(ws, 'echo "Hello Sandbox" > test.txt', { timeoutMs: 5000 });
    expect(res.exitCode).toBe(0);

    // Read file via readFile API
    const content = await sandbox.readFile(ws, 'test.txt');
    expect(content.trim()).toBe('Hello Sandbox');
  });

  it('applies a unified patch to workspace files', async () => {
    const ws = await sandbox.createWorkspace('test-patch-task', '1234567');
    activeWorkspaces.push(ws);

    // Create an initial file and commit it
    await sandbox.exec(
      ws,
      'echo "initial code" > app.py && git add app.py && git commit -m "initial"',
      { timeoutMs: 10000 },
    );

    // Create unified patch that updates app.py
    const patch = `diff --git a/app.py b/app.py
--- a/app.py
+++ b/app.py
@@ -1 +1 @@
-initial code
+patched code
`;

    const patchRes = await sandbox.applyPatch(ws, patch);
    expect(patchRes.success).toBe(true);

    const updated = await sandbox.readFile(ws, 'app.py');
    expect(updated.trim()).toBe('patched code');
  });

  it('runs tests with custom test runner', async () => {
    const customSandbox = new FixtureSandboxService({
      workDirRoot: 'scratch/test-sandboxes-custom',
      testRunner: async (_wsDir, testIds) => {
        return {
          passed: testIds.length,
          failed: 0,
          errors: 0,
          details: 'All tests passed',
        };
      },
    });

    const ws = await customSandbox.createWorkspace('test-runner-task', 'abcdef0');
    activeWorkspaces.push(ws);

    const testRes = await customSandbox.runTests(ws, ['test_auth', 'test_login']);
    expect(testRes.passed).toBe(2);
    expect(testRes.failed).toBe(0);
    expect(testRes.details).toBe('All tests passed');

    await customSandbox.destroy(ws);
  });

  it('destroys workspace completely', async () => {
    const ws = await sandbox.createWorkspace('destroy-task', '0000000');
    const wsDir = path.resolve(process.cwd(), 'scratch/test-sandboxes', ws);
    expect(fs.existsSync(wsDir)).toBe(true);

    await sandbox.destroy(ws);
    expect(fs.existsSync(wsDir)).toBe(false);
  });
});
