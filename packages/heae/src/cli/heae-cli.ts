
import { FileStore, type Store } from '@soa/store';

import { readTraceFile } from '../trace-intake.js';
import { evaluateTrace } from '../commands/evaluate-trace.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';

export interface HeaeCliOptions {
  store?: Store;
}

const HELP = [
  'HEAE - Hierarchical Evaluation and Attribution Engine',
  '',
  'Usage:',
  '  heae evaluate <trace.jsonl>',
  '  heae history',
  '  heae history <traceId>',
  '  heae help',
  '',
  'Evaluation history is stored in .heae/history by default.',
  'LLM judging is unavailable unless a model is configured.',
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
    const [filePath, ...extraArgs] = commandArgs;

    if (!filePath || extraArgs.length > 0) {
      throw new Error(
        'Usage: heae evaluate <trace.jsonl>',
      );
    }

    // Parse and validate the file before executing the
    // evaluation workflow.
    const spans = await readTraceFile(filePath);

    const jsonlContent = spans
      .map((span) => JSON.stringify(span))
      .join('\n');

    const store =
      options.store ?? new FileStore('.heae/history');

    const result = await evaluateTrace(
      jsonlContent,
      { store },
    );

    return JSON.stringify(result.summary, null, 2);
  }

  if (commandArgs.length > 1) {
    throw new Error(
      'Usage: heae history [traceId]',
    );
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
