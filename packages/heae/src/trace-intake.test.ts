
import { describe, expect, it } from 'vitest';
import {
  parseTraceJsonl,
  readTraceFile,
  TraceIntakeError,
} from './trace-intake.js';

const validTaskSpan = {
  schema_version: '1.0',
  span_id: '0123456789abcdef',
  trace_id: '0123456789abcdef0123456789abcdef',
  parent_span_id: null,
  name: 'task',
  start_ts: '2026-10-18T10:00:00.000Z',
  end_ts: '2026-10-18T10:01:00.000Z',
  status: 'ok',
  attributes: {
    run_id: 'run_test_01',
    task_id: 'test_task_01',
    condition: 'baseline',
    config_version: 'cfg_0001',
    repo: 'example/repository',
  },
  links: [],
};

describe('HEAE Trace Intake', () => {
  it('accepts a valid typed task span', () => {
    const spans = parseTraceJsonl(
      JSON.stringify(validTaskSpan),
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('task');
    expect(spans[0]?.span_id).toBe(
      '0123456789abcdef',
    );
  });

  it('accepts multiple valid JSONL records', () => {
    const secondSpan = {
      ...validTaskSpan,
      span_id: 'abcdef0123456789',
      parent_span_id: validTaskSpan.span_id,
    };

    const content = [
      JSON.stringify(validTaskSpan),
      JSON.stringify(secondSpan),
    ].join('\n');

    expect(parseTraceJsonl(content)).toHaveLength(2);
  });

  it('rejects malformed JSON with line number', () => {
    const content =
      JSON.stringify(validTaskSpan) + '\n{invalid json}';

    expect(() => parseTraceJsonl(content)).toThrow(
      'Invalid JSON at line 2',
    );
  });

  it('rejects invalid span attributes', () => {
    const invalidSpan = {
      ...validTaskSpan,
      attributes: {
        ...validTaskSpan.attributes,
        condition: 'invalid_condition',
      },
    };

    expect(() =>
      parseTraceJsonl(JSON.stringify(invalidSpan)),
    ).toThrow('Invalid trace span at line 1');
  });

  it('rejects an empty trace', () => {
    expect(() => parseTraceJsonl(' \n ')).toThrow(
      'Trace file contains no valid spans',
    );
  });

  it('skips blank lines', () => {
    const content =
      '\n' + JSON.stringify(validTaskSpan) + '\n\n';

    expect(parseTraceJsonl(content)).toHaveLength(1);
  });

  it('reports missing files clearly', async () => {
    await expect(
      readTraceFile('/nonexistent/heae-trace.jsonl'),
    ).rejects.toBeInstanceOf(TraceIntakeError);
  });
});
