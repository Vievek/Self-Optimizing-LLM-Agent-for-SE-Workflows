export class MockExecCore {
    async runTask(taskId) {
        return {
            spans: [],
            output: `Mock executed task ${taskId}`,
        };
    }
}
//# sourceMappingURL=mock-exec-core.js.map