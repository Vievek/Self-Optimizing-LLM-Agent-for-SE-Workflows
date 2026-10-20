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
import { renderStageProgress, type StageItem } from '../../components/stage-progress.js';

export function renderAxesSummary(config: FullAgentConfig): string {
  const rows = [
    ['prompt', 'prompts.system_prompt_version', config.prompts.system_prompt_version],
    ['tool', 'tools.tools.*', String(Object.keys(config.tools.tools).length) + ' tools'],
    ['planning', 'planning.backtrack_depth', String(config.planning.backtrack_depth)],
    ['workflow', 'workflow.max_iterations', String(config.workflow.max_iterations)],
    ['retrieval', 'retrieval.top_k', String(config.retrieval.top_k)],
    ['routing', 'routing.default_tier', config.routing.default_tier],
  ];
  return renderRecordTable(
    ['Axis', 'Config Path', 'Current Value'],
    rows,
    'Optimization Orchestrator Config',
  );
}

export function renderSignalQueue(signals: OptimizationSignal[]): string {
  const rows = signals.map((s) => {
    const valid = OptimizationSignalSchema.safeParse(s).success;
    return [s.signal_id, s.target.axis, s.confidence.toFixed(2), s.classifier, valid ? 'valid' : 'invalid'];
  });
  return renderRecordTable(
    ['Signal ID', 'Axis', 'Confidence', 'Classifier', 'Status'],
    rows,
    '1. Signal Queue',
  );
}

export function renderCandidateView(): string {
  return renderRecordTable(
    ['Config Path', 'Old Value', 'Proposed Value', 'Validation'],
    [
      [
        'tools.apply_patch.description',
        'Apply a unified diff patch.',
        'Apply a unified diff patch. Paths must be repo-relative.',
        'PASS (simulated)',
      ],
      ['retrieval.top_k', '5', '7', 'PASS (simulated)'],
    ],
    '2. Candidate View',
  );
}

export function renderConfigHistory(versionCount: number): string {
  return renderRecordTable(
    ['Version', 'Changed Path', 'Changed Value', 'Action'],
    [
      ['cfg_0001', '(baseline)', '—', 'seed'],
      ['cfg_0002', 'retrieval.top_k', '5 → 7', 'deploy'],
    ],
    `3. Config History (${versionCount} versions)`,
  );
}

export function renderAuditLog(entries: AuditEntry[]): string {
  const rows =
    entries.length > 0
      ? entries.map((e) => [
          new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19),
          e.signal_id,
          e.config_path,
          e.action,
          e.version_after,
        ])
      : [['—', '(no entries)', '—', '—', '—']];
  return renderRecordTable(
    ['Timestamp', 'Signal ID', 'Config Path', 'Action', 'Version After'],
    rows,
    '4. Audit Log',
  );
}

export async function renderContractCheck(
  versions: string[],
  load: (version: string) => Promise<FullAgentConfig>,
  signals: OptimizationSignal[],
): Promise<string> {
  const results: ContractCheckResult[] = [];
  for (const ver of versions) {
    try {
      const cfg = await load(ver);
      const r = FullAgentConfigSchema.safeParse(cfg);
      results.push({
        contract: `FullAgentConfig ${ver}`,
        version: CONFIG_SCHEMA_VERSION,
        valid: r.success,
        error: r.success ? undefined : r.error.message.slice(0, 80),
      });
    } catch (e) {
      results.push({
        contract: `FullAgentConfig ${ver}`,
        version: CONFIG_SCHEMA_VERSION,
        valid: false,
        error: String(e).slice(0, 80),
      });
    }
  }
  for (const sig of signals) {
    const r = OptimizationSignalSchema.safeParse(sig);
    results.push({
      contract: `OptimizationSignal ${sig.signal_id}`,
      version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
      valid: r.success,
      error: r.success ? undefined : r.error.message.slice(0, 80),
    });
  }
  return renderContractCheckPanel(results);
}

export function renderPipelineStages(): string {
  const stages: StageItem[] = [
    { name: 'Config Seed', status: 'success', detail: 'cfg_0001 written' },
    { name: 'Signal Intake', status: 'success', detail: 'validated against OptimizationSignalSchema' },
    { name: 'Fix Generation', status: 'pending', detail: 'TODO: LlmProvider (no real model calls in CI)' },
    { name: 'Validation', status: 'pending', detail: 'TODO: FullAgentConfigSchema + ranges' },
    { name: 'Deploy', status: 'success', detail: 'cfg_0002 simulated' },
    { name: 'Audit', status: 'success', detail: 'store/logs/orch-audit.jsonl' },
  ];
  return renderStageProgress(stages);
}
