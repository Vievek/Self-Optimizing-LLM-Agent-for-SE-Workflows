import { describe, it, expect } from 'vitest';
import { MockLlmProvider } from './mock-llm.js';

describe('MockLlmProvider with Canned Responses', () => {
  it('returns canned answers when matching substrings', async () => {
    const mock = new MockLlmProvider();
    mock.registerCanned('identify failure', 'Failure classified as prompt misalignment');
    mock.registerCanned('generate patch', 'def fix(): return True');

    const res1 = await mock.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'Please identify failure in trace' }],
    });
    expect(res1.content).toBe('Failure classified as prompt misalignment');

    const res2 = await mock.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'Now generate patch for this file' }],
    });
    expect(res2.content).toBe('def fix(): return True');

    const fallback = await mock.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'Unknown question' }],
    });
    expect(fallback.content).toBe('Mock LLM Response');
  });

  it('supports regex and predicate matching', async () => {
    const mock = new MockLlmProvider();
    mock.registerCanned(/error\s*code\s*404/i, 'Resource not found response');
    mock.registerCanned((req) => req.messages.some((m) => m.role === 'system'), 'System response');

    const res1 = await mock.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'We received Error Code 404 from server' }],
    });
    expect(res1.content).toBe('Resource not found response');

    const res2 = await mock.chat({
      model: 'mock',
      messages: [{ role: 'system', content: 'You are an agent' }],
    });
    expect(res2.content).toBe('System response');
  });

  it('records request history and allows clearing', async () => {
    const mock = new MockLlmProvider();
    await mock.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(mock.recordedRequests.length).toBe(1);
    expect(mock.recordedRequests[0]?.messages[0]?.content).toBe('ping');

    mock.clearHistory();
    expect(mock.recordedRequests.length).toBe(0);
  });

  it('generates deterministic mock embeddings', async () => {
    const mock = new MockLlmProvider();
    const vecs = await mock.embed(['hello', 'world']);
    expect(vecs.length).toBe(2);
    expect(vecs[0]?.length).toBe(1536);
    expect(vecs[1]?.length).toBe(1536);
  });
});
