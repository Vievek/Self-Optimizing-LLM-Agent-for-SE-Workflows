export class MockOrchestrator {
    async optimize(signal, currentConfig) {
        return {
            ...currentConfig,
            updated_at: signal.timestamp,
        };
    }
}
//# sourceMappingURL=mock-orchestrator.js.map