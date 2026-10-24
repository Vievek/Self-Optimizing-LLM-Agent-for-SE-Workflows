import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EvaluationHistory, type StoredEvaluation } from '@soa/heae';
import { FileStore } from '@soa/store';

export interface HeaeDataReader {
  list(): Promise<StoredEvaluation[]>;
}

// Resolve the project root using this module's location.
// Works from both src/ and dist/ layouts.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '../../../../..');

export const HEAE_HISTORY_DIRECTORY = path.join(
  repositoryRoot,
  '.heae',
  'history',
);

/** Read-only access to persisted HEAE evaluations for the TUI. */
export class HeaeDataSource implements HeaeDataReader {
  private readonly history: EvaluationHistory;

  constructor(store = new FileStore(HEAE_HISTORY_DIRECTORY)) {
    this.history = new EvaluationHistory(store);
  }

  async list(): Promise<StoredEvaluation[]> {
    const evaluations = await this.history.list();

    return evaluations.sort((left, right) =>
      left.traceId.localeCompare(right.traceId),
    );
  }
}