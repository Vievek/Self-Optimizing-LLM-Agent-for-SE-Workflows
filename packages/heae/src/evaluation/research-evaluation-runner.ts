
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';

import {
  evaluateMultiLabelCases,
  type EvaluationCase,
  type EvaluationSummary,
} from './multi-label-evaluator.js';

const FailureCategorySchema = z.enum([
  'prompt',
  'tool',
  'retrieval',
  'planning',
  'workflow',
]);

const DatasetCaseSchema = z.object({
  id: z.string().trim().min(1),
  traceFile: z.string().trim().min(1),
  expectedCategories: z.array(
    FailureCategorySchema,
  ).superRefine((categories, context) => {
    if (new Set(categories).size !== categories.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate expected category',
      });
    }
  }),
}).strict();

export const ResearchEvaluationManifestSchema =
  z.object({
    datasetName: z.string().trim().min(1),
    datasetVersion: z.string().trim().min(1),
    cases: z.array(DatasetCaseSchema).min(1),
  }).strict().superRefine((manifest, context) => {
    const ids = new Set<string>();

    for (const [index, item] of manifest.cases.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases', index, 'id'],
          message: `Duplicate case ID: ${item.id}`,
        });
      }

      ids.add(item.id);
    }
  });

export type ResearchEvaluationManifest = z.infer<
  typeof ResearchEvaluationManifestSchema
>;

export interface ResearchEvaluationReport {
  datasetName: string;
  datasetVersion: string;
  evaluatedAt: string;
  metrics: EvaluationSummary;
}

/**
 * Only accept relative JSONL paths inside the
 * configured evaluation dataset directory.
 */
function resolveTracePath(
  root: string,
  traceFile: string,
): string {
  if (
    path.isAbsolute(traceFile) ||
    traceFile.includes('\\') ||
    traceFile.split('/').some(
      (part) => part === '..' || part === '.',
    ) ||
    !traceFile.endsWith('.jsonl')
  ) {
    throw new Error(
      `Unsafe trace path: ${traceFile}`,
    );
  }

  const resolved = path.resolve(root, traceFile);
  const relative = path.relative(root, resolved);

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Trace path escapes dataset directory: ${traceFile}`,
    );
  }

  return resolved;
}

/**
 * Verify the actual file location, not just its
 * textual path. This prevents symlink escapes.
 */
async function verifyRealPath(
  root: string,
  traceFile: string,
): Promise<string> {
  const expectedPath = resolveTracePath(root, traceFile);

  const actualPath = await realpath(expectedPath);
  const relative = path.relative(root, actualPath);

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Trace path escapes dataset directory: ${traceFile}`,
    );
  }

  return actualPath;
}

/**
 * Evaluate an explicitly labelled dataset using
 * the existing rule-based multi-label evaluator.
 *
 * No LLM inference and no persistent HEAE history
 * are involved in this research evaluation.
 */
export async function runResearchEvaluation(
  datasetDirectory: string,
  rawManifest: unknown,
): Promise<ResearchEvaluationReport> {
  const manifest =
    ResearchEvaluationManifestSchema.parse(rawManifest);

  const root = await realpath(datasetDirectory);

  const evaluationCases: EvaluationCase[] = [];

  for (const item of manifest.cases) {
    let content: string;

    try {
      const tracePath = await verifyRealPath(
        root,
        item.traceFile,
      );

      content = await readFile(tracePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Unable to read evaluation case "${item.id}": ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
        { cause: error },
      );
    }

    try {
      const spans = parseTraceJsonl(content);
      const graph = buildTraceGraph(spans);

      evaluationCases.push({
        id: item.id,
        graph,
        expectedCategories: item.expectedCategories,
      });
    } catch (error) {
      throw new Error(
        `Invalid trace in evaluation case "${item.id}": ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
        { cause: error },
      );
    }
  }

  return {
    datasetName: manifest.datasetName,
    datasetVersion: manifest.datasetVersion,
    evaluatedAt: new Date().toISOString(),
    metrics: evaluateMultiLabelCases(evaluationCases),
  };
}
