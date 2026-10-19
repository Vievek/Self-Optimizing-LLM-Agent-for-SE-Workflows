
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  ExecutionTraceSource,
} from './execution-trace-source.js';

const RUN_ID = 'run_20261019T0900_baseline_01';
const TASK_ID = 'django__django-11099';

describe('HEAE Execution Trace Source', () => {
  let directory: string;
  let tracesDirectory: string;
  let source: ExecutionTraceSource;

  async function writeFixture(
    modify?: (span: Record<string, unknown>) => void,
  ): Promise<string> {
    const fixture = await readFile(
      'packages/heae/fixtures/tool-error.jsonl',
      'utf8',
    );

    const content = fixture
      .trim()
      .split('\n')
      .map((line) => {
        const span = JSON.parse(line) as Record<
          string,
          unknown
        >;

        if (span.name === 'task') {
          const attributes = span.attributes as Record<
            string,
            unknown
          >;

          attributes.run_id = RUN_ID;
          attributes.task_id = TASK_ID;
        }

        modify?.(span);

        return JSON.stringify(span);
      })
      .join('\n');

    const filePath = source.resolvePath(
      RUN_ID,
      TASK_ID,
    );

    await mkdir(path.dirname(filePath), {
      recursive: true,
    });

    await writeFile(filePath, content, 'utf8');

    return filePath;
  }

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(tmpdir(), 'heae-trace-source-'),
    );

    tracesDirectory = path.join(
      directory,
      'traces',
    );

    source = new ExecutionTraceSource({
      tracesDirectory,
    });
  });

  afterEach(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  it('resolves the architecture-defined trace path', () => {
    expect(source.resolvePath(RUN_ID, TASK_ID))
      .toBe(
        path.join(
          tracesDirectory,
          RUN_ID,
          `${TASK_ID}.jsonl`,
        ),
      );
  });

  it('reads a valid execution trace', async () => {
    await writeFixture();

    const spans = await source.read(
      RUN_ID,
      TASK_ID,
    );

    expect(spans.length).toBeGreaterThan(0);

    expect(
      spans.some((span) => span.name === 'task'),
    ).toBe(true);
  });

  it('rejects invalid run IDs', () => {
    expect(() =>
      source.resolvePath('../outside', TASK_ID),
    ).toThrow('Invalid run ID');
  });

  it('rejects task path traversal', () => {
    expect(() =>
      source.resolvePath(RUN_ID, '../outside'),
    ).toThrow('Invalid task ID');

    expect(() =>
      source.resolvePath(RUN_ID, 'folder/task'),
    ).toThrow('Invalid task ID');
  });

  it('reports missing execution traces', async () => {
    await expect(
      source.read(RUN_ID, TASK_ID),
    ).rejects.toThrow(
      'Execution trace not available',
    );
  });

  it('rejects mismatched task identity', async () => {
    await writeFixture((span) => {
      if (span.name === 'task') {
        const attributes = span.attributes as Record<
          string,
          unknown
        >;

        attributes.task_id = 'another-task';
      }
    });

    await expect(
      source.read(RUN_ID, TASK_ID),
    ).rejects.toThrow(
      'Task identity mismatch',
    );
  });

  it('rejects traces without a task span', async () => {
    const filePath = await writeFixture();

    const content = await readFile(
      filePath,
      'utf8',
    );

    const filtered = content
      .split('\n')
      .filter(
        (line) =>
          (JSON.parse(line) as { name: string })
            .name !== 'task',
      )
      .join('\n');

    await writeFile(
      filePath,
      filtered,
      'utf8',
    );

    await expect(
      source.read(RUN_ID, TASK_ID),
    ).rejects.toThrow(
      'Trace is missing a task span',
    );
  });

  it('rejects a symlink escaping the trace root', async () => {
    const outsideFile = path.join(
      directory,
      'outside.jsonl',
    );

    const fixture = await readFile(
      'packages/heae/fixtures/tool-error.jsonl',
      'utf8',
    );

    await writeFile(
      outsideFile,
      fixture,
      'utf8',
    );

    const targetPath = source.resolvePath(
      RUN_ID,
      TASK_ID,
    );

    await mkdir(path.dirname(targetPath), {
      recursive: true,
    });

    await symlink(outsideFile, targetPath);

    await expect(
      source.read(RUN_ID, TASK_ID),
    ).rejects.toThrow(
      'path escapes the trace directory',
    );
  });
});
