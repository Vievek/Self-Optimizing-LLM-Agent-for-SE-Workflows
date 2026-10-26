import {
  FullAgentConfigSchema,
  OptimizationSignalSchema,
  CONFIG_SCHEMA_VERSION,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  type FullAgentConfig,
  type OptimizationSignal,
} from '@soa/contracts';
import type { AuditEntry } from '@soa/orchestrator';
import { renderRecordTable } from '../../components/record-table.js';
import {
  renderContractCheckPanel,
  type ContractCheckResult,
} from '../../components/contract-check-panel.js';

export interface SignalQueueItem {
  signal: OptimizationSignal;
  status: string;
}

export function renderSignalQueue(items: SignalQueueItem[]): string {
  return renderRecordTable(
    ['Signal ID', 'Axis', 'Confidence', 'Status'],
    items.map(({ signal, status }) => [
      signal.signal_id,
      signal.target.axis,
      signal.confidence.toFixed(2),
      status,
    ]),
    'Signal Queue',
  );
}

export function renderDroppedSignals(
  dropped: Array<{ signalId?: string; reason: string }>,
): string {
  return renderRecordTable(
    ['Signal ID', 'Status', 'Reason'],
    dropped.map((entry) => [entry.signalId ?? '(unknown)', 'rejected', entry.reason]),
    'Rejected Signals',
  );
}

export function renderCandidateView(result: {
  signalId: string;
  configPath: string;
  oldValue?: unknown;
  newValue?: unknown;
  valid: boolean;
  reason?: string;
  version?: string;
}): string {
  return renderRecordTable(
    ['Signal ID', 'Config Path', 'Old Value', 'New Value', 'Validation', 'Version / Reason'],
    [
      [
        result.signalId,
        result.configPath,
        JSON.stringify(result.oldValue ?? null),
        JSON.stringify(result.newValue ?? null),
        result.valid ? 'PASS' : 'FAIL',
        result.version ?? result.reason ?? 'rejected',
      ],
    ],
    'Candidate',
  );
}

export function renderConfigHistory(versions: FullAgentConfig[], entries: AuditEntry[]): string {
  return renderRecordTable(
    ['Version', 'Changed Path', 'Before', 'After', 'Action', 'Signal ID', 'Reason'],
    versions.map((config) => {
      const change = entries.find(
        (entry) => entry.action === 'deploy' && entry.version_after === config.config_version,
      );
      return [
        config.config_version,
        change?.config_path ?? '(baseline)',
        JSON.stringify(change?.old_value ?? null),
        JSON.stringify(change?.new_value ?? null),
        change?.action ?? 'seed',
        change?.signal_id ?? '—',
        change?.reason ?? '—',
      ];
    }),
    'Config History (d = deploy selected, r = roll back)',
  );
}

export function renderAuditLog(entries: AuditEntry[]): string {
  return renderRecordTable(
    ['Timestamp', 'Signal ID', 'Config Path', 'Before', 'After', 'Version', 'Action', 'Reason'],
    entries.map((entry) => [
      new Date(entry.ts).toISOString(),
      entry.signal_id,
      entry.config_path,
      JSON.stringify(entry.old_value ?? null),
      JSON.stringify(entry.new_value ?? null),
      `${entry.version_before ?? '—'} → ${entry.version_after}`,
      entry.action,
      entry.reason ?? '—',
    ]),
    'Audit Log',
  );
}

export async function renderContractCheck(
  versions: FullAgentConfig[],
  signals: unknown[],
): Promise<string> {
  const results: ContractCheckResult[] = [];
  for (const config of versions) {
    const parsed = FullAgentConfigSchema.safeParse(config);
    results.push({
      contract: `FullAgentConfig ${config.config_version}`,
      version: CONFIG_SCHEMA_VERSION,
      valid: parsed.success,
      error: parsed.success ? undefined : parsed.error.message.slice(0, 120),
    });
  }
  signals.forEach((signal, index) => {
    const parsed = OptimizationSignalSchema.safeParse(signal);
    const id =
      signal && typeof signal === 'object' && 'signal_id' in signal
        ? String(signal.signal_id)
        : `record ${index + 1}`;
    results.push({
      contract: `OptimizationSignal ${id}`,
      version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
      valid: parsed.success,
      error: parsed.success ? undefined : parsed.error.message.slice(0, 120),
    });
  });
  return renderContractCheckPanel(results);
}

export function renderAxesSummary(config: FullAgentConfig): string {
  return renderRecordTable(
    ['Axis', 'Config Path', 'Value'],
    [
      ['prompt', 'prompts.system_prompt_version', config.prompts.system_prompt_version],
      ['tool', 'tools.tools', `${Object.keys(config.tools.tools).length} tools`],
      ['planning', 'planning.backtrack_depth', config.planning.backtrack_depth],
      ['workflow', 'workflow.max_iterations', config.workflow.max_iterations],
      ['retrieval', 'retrieval.top_k', config.retrieval.top_k],
      ['routing', 'routing.small_tier_threshold', config.routing.small_tier_threshold],
    ],
    `Active Configuration ${config.config_version}`,
  );
}
