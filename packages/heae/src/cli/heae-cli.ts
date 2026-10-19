
import {
  getProvider,
  loadModelsConfig,
  type LlmProvider,
} from '@soa/llm';

import { FileStore, type Store } from '@soa/store';

import { readTraceFile } from '../trace-intake.js';
import { evaluateTrace } from '../commands/evaluate-trace.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';

export interface HeaeCliOptions {
  store?: Store;

  // Test and integration injection points.
  // The default provider is only selected for --judge.
  provider?: LlmProvider;
  model?: string;
}

const HELP = [
  'HEAE - Hierarchical Evaluation and Attribution Engine',
  '',
  'Usage:',
  '  heae evaluate <trace.jsonl>',
  '  heae evaluate <trace.jsonl> --judge',
  '  heae history',
  '  heae history <traceId>',
  '  heae help',
  '',
  'Evaluation history is stored in .heae/history by default.',
  'Rule-only evaluation does not require an API token.',
  '--judge uses the configured large LLM tier.',
  'The default Hugging Face provider requires HF_TOKEN.',
].join('\n');

export async function runHeaeCli(
  args: string[],
  options: HeaeCliOptions = {},
): Promise<string> {
  const [command, ...commandArgs] = args;

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

  if (command === 'evaluate') {
    const [filePath, ...flags] = commandArgs;

    const validFlags =
      flags.length === 0 ||
      (flags.length === 1 && flags[0] === '--judge');

    if (!filePath || filePath.startsWith('--') || !validFlags) {
      throw new Error(
        'Usage: heae evaluate <trace.jsonl> [--judge]',
      );
    }

    const useJudge = flags.includes('--judge');

    // Validate the trace before attempting evaluation.
    const spans = await readTraceFile(filePath);

    const jsonlContent = spans
      .map((span) => JSON.stringify(span))
      .join('\n');

    const store =
      options.store ?? new FileStore('.heae/history');

    let provider: LlmProvider | undefined;
    let model: string | undefined;

    if (useJudge) {
      if (options.provider) {
        // Allows deterministic, offline mock testing.
        provider = options.provider;
        model = options.model ?? 'test-judge';
      } else {
        const config = loadModelsConfig().large;

        // Check credentials before creating a remote request.
        const credentialConfigured =
          Boolean(config.apiKey) ||
          (
            Boolean(config.apiKeyEnv) &&
            Boolean(
              config.apiKeyEnv &&
              process.env[config.apiKeyEnv],
            )
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

    const result = await evaluateTrace(
      jsonlContent,
      {
        store,
        provider,
        model,
      },
    );

    return JSON.stringify(result.summary, null, 2);
  }

  if (commandArgs.length > 1) {
    throw new Error('Usage: heae history [traceId]');
  }

  const store =
    options.store ?? new FileStore('.heae/history');

  const history = new EvaluationHistory(store);
  const traceId = commandArgs[0];

  if (traceId) {
    const record = await history.load(traceId);

    if (!record) {
      return `No saved evaluation found for ${traceId}.`;
    }

    return JSON.stringify(record, null, 2);
  }

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
