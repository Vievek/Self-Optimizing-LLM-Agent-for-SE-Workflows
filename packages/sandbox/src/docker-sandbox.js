export class DockerSandboxService {
    async createWorkspace(taskId, commit) {
        return `ws-${taskId}-${commit.slice(0, 7)}`;
    }
    async exec(_ws, _cmd, _opts) {
        return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            durationMs: 0,
        };
    }
    async applyPatch(_ws, _patch) {
        return { success: true };
    }
    async runTests(_ws, _testIds) {
        return {
            passed: 0,
            failed: 0,
            errors: 0,
            details: '',
        };
    }
    async readFile(_ws, _path) {
        return '';
    }
    async diff(_ws, _a, _b) {
        return '';
    }
    async destroy(_ws) {
        return;
    }
}
//# sourceMappingURL=docker-sandbox.js.map