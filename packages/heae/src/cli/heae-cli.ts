
import {
  getProvider,
  loadModelsConfig,
  type LlmProvider,
} from '@soa/llm';

import { FileStore, type Store } from '@soa/store';

import { readTraceFile } from '../trace-intake.js';
import { evaluateTrace } from '../commands/evaluate-trace.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { KuzuInteractionStore } from '../persistence/kuzu-interaction-store.js';

import type {
  InteractionGraphStore,
} from '../persistence/interaction-graph-store.js';

/**
 * Optional dependencies for testing and integration.
 */
export interface HeaeCliOptions {
  store?: Store;
  graphStore?: InteractionGraphStore;
  provider?: LlmProvider;
  model?: string;
}

/**
 * Standalone HEAE CLI help.
 */
const HELP = [
  'HEAE - Hierarchical Evaluation and Attribution Engine',
  '',
  'Usage:',
  '  heae evaluate <trace.jsonl>',
  '  heae evaluate <trace.jsonl> --judge',
  '  heae evaluate <trace.jsonl> --recover',
  '  heae evaluate <trace.jsonl> --judge --recover',
  '  heae history',
  '  heae history <traceId>',
  '  heae help',
  '',
  'Options:',
  '  --judge     Enable pretrained LLM-as-Judge evaluation.',
  '  --recover   Recover an incomplete Kuzu/FileStore save.',
  '',
  'Storage:',
  '  Reports: .heae/history',
  '  Graphs:  store/graphs/heae.kuzu',
  '',
  'Rule-only evaluation does not require an API token.',
  'The configured Hugging Face provider requires HF_TOKEN.',
  'Recovery never overwrites an existing graph or report.',
].join('\n');

/**
 * Execute a standalone HEAE command.
 *
 * Supported commands:
 *   evaluate <trace.jsonl> [--judge] [--recover]
 *   history [traceId]
 *   help
 */
export async function runHeaeCli(
  args: string[],
  options: HeaeCliOptions = {},
): Promise<string> {
  const [command, ...commandArgs] = args;

  // --------------------------------------------------
  // HELP
  // --------------------------------------------------
  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    return HELP;
  }

  if (command !== 'evaluate' && command !== 'history') {
    throw new Error(
      `Unknown HEAE command: ${command}\n\n${HELP}`,
    );
  }

  // --------------------------------------------------
  // EVALUATE
  // --------------------------------------------------
  if (command === 'evaluate') {
    const [filePath, ...flags] = commandArgs;

    const allowedFlags = new Set([
      '--judge',
      '--recover',
    ]);

    // Reject unknown or repeated flags.
    const validFlags =
      flags.every((flag) => allowedFlags.has(flag)) &&
      new Set(flags).size === flags.length;

    if (
      !filePath ||
      filePath.startsWith('--') ||
      !validFlags
    ) {
      throw new Error(
        'Usage: heae evaluate <trace.jsonl> [--judge] [--recover]',
      );
    }

    const useJudge = flags.includes('--judge');
    const useRecovery = flags.includes('--recover');

    // STEP 1: Read and validate the trace.
    const spans = await readTraceFile(filePath);

    const jsonlContent = spans
      .map((span) => JSON.stringify(span))
      .join('\n');

    // STEP 2: Configure evaluation report storage.
    const store =
      options.store ?? new FileStore('.heae/history');

    // STEP 3: Configure the optional LLM judge.
    let provider: LlmProvider | undefined;
    let model: string | undefined;

    if (useJudge) {
      if (options.provider) {
        // Injected provider for tests and integration.
        provider = options.provider;
        model = options.model ?? 'test-judge';
      } else {
        const config = loadModelsConfig().large;

        const credentialConfigured =
          Boolean(config.apiKey) ||
          Boolean(
            config.apiKeyEnv &&
            process.env[config.apiKeyEnv],
          );

        if (!credentialConfigured) {
          throw new Error(
            `LLM credential not configured: ${
              config.apiKeyEnv ?? 'API key'
            }. Run without --judge for rule-only evaluation.`,
          );
        }

        provider = getProvider('llm');
        model = options.model ?? config.model;
      }
    }

    // STEP 4: Configure the Kuzu interaction graph.
    //
    // Normal terminal execution opens the HEAE-owned
    // database automatically.
    //
    // Tests that inject their own Store remain isolated
    // unless they also supply a graphStore.
    const ownsGraphStore =
      options.store === undefined &&
      options.graphStore === undefined;

    // Recovery requires both persistence destinations.
    // If the caller supplies only a report store,
    // it must also supply a graph store.
    if (useRecovery && options.store && !options.graphStore) {
      throw new Error(
        'Recovery requires both store and graphStore.',
      );
    }

    const graphStore = ownsGraphStore
      ? await KuzuInteractionStore.open(
          'store/graphs/heae.kuzu',
        )
      : options.graphStore;

    try {
      // STEP 5: Evaluate and persist the trace.
      const result = await evaluateTrace(
        jsonlContent,
        {
          store,
          graphStore,
          provider,
          model,
          recovery: useRecovery,
        },
      );

      // STEP 6: Return the structured summary.
      return JSON.stringify(
        result.summary,
        null,
        2,
      );
    } finally {
      // Close only the database opened by this CLI.
      // Never close a store supplied by another caller.
      if (ownsGraphStore) {
        await graphStore?.close();
      }
    }
  }

  // --------------------------------------------------
  // HISTORY
  // --------------------------------------------------
  if (commandArgs.length > 1) {
    throw new Error(
      'Usage: heae history [traceId]',
    );
  }

  const store =
    options.store ?? new FileStore('.heae/history');

  const history = new EvaluationHistory(store);

  const traceId = commandArgs[0];

  // Retrieve one stored evaluation.
  if (traceId) {
    const record = await history.load(traceId);

    if (!record) {
      return `No saved evaluation found for ${traceId}.`;
    }

    return JSON.stringify(
      record,
      null,
      2,
    );
  }

  // List all stored evaluation summaries.
  const records = await history.list();

  if (records.length === 0) {
    return 'No saved HEAE evaluations found.';
  }

  const summary = records.map((record) => ({
    traceId: record.traceId,
    outcome: record.result.ruleReport.outcome,
    judgeStatus: record.result.judgeStatus,
    observations:
      record.result.ruleReport.observations.length,
  }));

  return JSON.stringify(summary, null, 2);
}
