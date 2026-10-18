
import { readFile } from 'node:fs/promises';
import {
  TypedTraceSpanSchema,
  type TypedTraceSpan,
} from '@soa/contracts';

export class TraceIntakeError extends Error {
  constructor(
    message: string,
    public readonly lineNumber?: number,
  ) {
    super(message);
    this.name = 'TraceIntakeError';
  }
}

export function parseTraceJsonl(content: string): TypedTraceSpan[] {
  const spans: TypedTraceSpan[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    let record: unknown;

    try {
      record = JSON.parse(line) as unknown;
    } catch {
      throw new TraceIntakeError(
        `Invalid JSON at line ${lineNumber}`,
        lineNumber,
      );
    }

    const result = TypedTraceSpanSchema.safeParse(record);

    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      throw new TraceIntakeError(
        `Invalid trace span at line ${lineNumber}: ${details}`,
        lineNumber,
      );
    }

    spans.push(result.data);
  }

  if (spans.length === 0) {
    throw new TraceIntakeError('Trace file contains no valid spans');
  }

  return spans;
}

export async function readTraceFile(
  filePath: string,
): Promise<TypedTraceSpan[]> {
  let content: string;

  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);

    throw new TraceIntakeError(
      `Unable to read trace file "${filePath}": ${reason}`,
    );
  }

  return parseTraceJsonl(content);
}
