export class MockHeae {
    async evaluateAndAttribute(evidence, _spans) {
        return [
            {
                schema_version: '1.0',
                signal_id: `sig-${Date.now()}`,
                trace_id: evidence.trace_id,
                failure_category: 'tool',
                attributed_span_ids: [],
                confidence: 0.9,
                timestamp: new Date().toISOString(),
                metadata: {},
            },
        ];
    }
}
//# sourceMappingURL=mock-heae.js.map