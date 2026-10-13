export class MockLlmProvider {
    async chat(req) {
        return {
            content: 'Mock LLM Response',
            tokensIn: 10,
            tokensOut: 10,
            model: req.model,
            provider: 'mock',
        };
    }
    async embed(texts) {
        return texts.map(() => new Array(1536).fill(0));
    }
}
//# sourceMappingURL=mock-llm.js.map