import {
  OptimizationOrchestrator,
  SAMPLE_SIGNAL,
  BASE_CONFIG,
  type AuditEntry,
} from '@soa/orchestrator';
import {
  renderAxesSummary,
  renderSignalQueue,
  renderCandidateView,
  renderConfigHistory,
  renderAuditLog,
  renderContractCheck,
  renderPipelineStages,
} from './views.js';

export async function runOrchCommand(args: string[] = []): Promise<string> {
  const subView = (args[0] || '').toLowerCase();
  const orch = new OptimizationOrchestrator();

  // Seed sample signal in queue
  const signals = [SAMPLE_SIGNAL];
  const activeConfig = await orch.load();
  const versions = await orch.configStore.listVersions();
  const auditEntries = await orch.auditLogger.query();

  // 1. Live Run View
  const liveRunSection = [
    renderPipelineStages(),
    '',
    renderAxesSummary(activeConfig),
    '',
    renderSignalQueue(signals),
  ].join('\n');

  // 2. Inspector View (last records written: candidates, config history, audit log)
  const inspectorSection = [
    renderCandidateView(),
    '',
    renderConfigHistory(versions.length),
    '',
    renderAuditLog(auditEntries),
  ].join('\n');

  // 3. Contract Check View
  const contractCheckSection = await renderContractCheck(
    versions,
    (v) => orch.load(v),
    signals,
  );

  switch (subView) {
    case 'run':
    case 'live':
      return [
        '=== OPTIMIZATION ORCHESTRATOR: LIVE RUN VIEW ===',
        '',
        liveRunSection,
      ].join('\n');

    case 'inspector':
    case 'inspect':
      return [
        '=== OPTIMIZATION ORCHESTRATOR: INSPECTOR VIEW ===',
        '',
        inspectorSection,
      ].join('\n');

    case 'check':
    case 'contract':
      return [
        '=== OPTIMIZATION ORCHESTRATOR: CONTRACT CHECK ===',
        '',
        contractCheckSection,
      ].join('\n');

    default:
      return [
        '=================================================================',
        '             OPTIMIZATION ORCHESTRATOR DASHBOARD                 ',
        '=================================================================',
        '',
        '[VIEW 1: LIVE RUN]',
        liveRunSection,
        '',
        '[VIEW 2: INSPECTOR (LAST RECORDS WRITTEN)]',
        inspectorSection,
        '',
        '[VIEW 3: CONTRACT CHECK (SCHEMAS COMPLIANCE)]',
        contractCheckSection,
        '',
        'Use "soa orch [run|inspector|check]" to focus on a specific view.',
      ].join('\n');
  }
}
