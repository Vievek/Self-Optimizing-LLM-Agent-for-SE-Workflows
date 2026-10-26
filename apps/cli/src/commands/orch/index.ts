import type { OptimizationSignal } from '@soa/contracts';
import {
  AuditLogger,
  ConfigStore,
  OptimizationOrchestrator,
  SignalIntake,
} from '@soa/orchestrator';
import { FileStore, type Store } from '@soa/store';
import {
  renderAxesSummary,
  renderAuditLog,
  renderCandidateView,
  renderConfigHistory,
  renderContractCheck,
  renderDroppedSignals,
  renderSignalQueue,
} from './views.js';

const EVENTS_PATH = 'store/events/optimization_signals.jsonl';

export interface OrchCommandOptions {
  store?: Store;
}

async function createContext(options: OrchCommandOptions) {
  const store = options.store ?? new FileStore('.');
  const configStore = await ConfigStore.create({
    store,
    configDir: 'store/config',
  });
  const auditLogger = new AuditLogger({
    store,
    logPath: 'store/logs/orch-audit.jsonl',
  });
  await auditLogger.prune();
  const orchestrator = new OptimizationOrchestrator({ configStore, auditLogger });
  const intake = new SignalIntake({ store, eventsPath: EVENTS_PATH });
  return { store, configStore, auditLogger, orchestrator, intake };
}

async function readQueue(context: Awaited<ReturnType<typeof createContext>>): Promise<{
  valid: OptimizationSignal[];
  dropped: Array<{ signalId?: string; raw: unknown; reason: string }>;
}> {
  const result = await context.intake.readFromStore();
  for (const dropped of result.dropped) {
    const existing = dropped.signalId
      ? await context.auditLogger.query({ signal_id: dropped.signalId, action: 'reject' })
      : [];
    if (existing.some((entry) => entry.reason === dropped.reason)) continue;
    await context.auditLogger.record({
      ts: Date.now(),
      signal_id: dropped.signalId ?? `invalid_${Date.now()}`,
      config_path: '*',
      version_before: context.configStore.getActiveVersion(),
      version_after: context.configStore.getActiveVersion(),
      action: 'reject',
      reason: dropped.reason,
    });
  }
  return result;
}

async function queueView(context: Awaited<ReturnType<typeof createContext>>): Promise<string> {
  const { valid, dropped } = await readQueue(context);
  const items = await Promise.all(
    valid.map(async (signal) => {
      const entries = await context.auditLogger.query({ signal_id: signal.signal_id });
      const latest = entries.sort((a, b) => b.ts - a.ts)[0];
      return {
        signal,
        status:
          latest?.action === 'deploy'
            ? 'deployed'
            : latest?.action === 'reject'
              ? 'rejected'
              : 'pending',
      };
    }),
  );
  return [renderSignalQueue(items), renderDroppedSignals(dropped)].join('\n\n');
}

async function historyView(context: Awaited<ReturnType<typeof createContext>>): Promise<string> {
  const versionIds = await context.configStore.listVersions();
  const versions = await Promise.all(
    versionIds.map((version) => context.configStore.load(version)),
  );
  const audit = await context.auditLogger.query();
  return renderConfigHistory(versions, audit);
}

function parseAuditFilter(args: string[]): {
  signal_id?: string;
  config_path?: string;
  since?: number;
} {
  const filter: { signal_id?: string; config_path?: string; since?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    const value = args[i + 1];
    if (!value) throw new Error(`Missing value for ${option}.`);
    if (option === '--signal') filter.signal_id = value;
    else if (option === '--path') filter.config_path = value;
    else if (option === '--since') {
      const timestamp = Date.parse(value);
      if (Number.isNaN(timestamp)) throw new Error(`Invalid date "${value}". Use an ISO date.`);
      filter.since = timestamp;
    } else {
      throw new Error(`Unknown audit filter "${option}".`);
    }
    i++;
  }
  return filter;
}

async function processSignals(
  context: Awaited<ReturnType<typeof createContext>>,
  requestedId?: string,
  processAll = false,
): Promise<string> {
  const { valid, dropped } = await readQueue(context);
  const selected = requestedId
    ? valid.filter((signal) => signal.signal_id === requestedId)
    : processAll
      ? valid
      : valid.slice(0, 1);
  if (requestedId && selected.length === 0) {
    return [
      `No valid queued signal found with ID "${requestedId}".`,
      ...(dropped.length ? ['', renderDroppedSignals(dropped)] : []),
    ].join('\n');
  }
  if (selected.length === 0) return renderDroppedSignals(dropped);

  const candidates: string[] = [];
  for (const signal of selected) {
    const result = await context.orchestrator.processSignal(signal);
    const validation = result.validation;
    candidates.push(
      renderCandidateView({
        signalId: signal.signal_id,
        configPath: signal.target.config_path,
        oldValue: validation?.oldValue,
        newValue: validation?.newValue,
        valid: result.status === 'deployed' || validation?.valid === true,
        reason: result.reason,
        version: result.newVersion,
      }),
    );
  }
  if (dropped.length) candidates.push(renderDroppedSignals(dropped));
  return candidates.join('\n\n');
}

function help(unknown?: string): string {
  return [
    ...(unknown ? [`Unknown orchestrator command "${unknown}".`, ''] : []),
    'Usage: soa orch [command] [options]',
    '',
    '  dashboard             Show live config, queue, history, audit, and contract status',
    '  queue                 Show validated incoming signals and rejection reasons',
    '  process [signal-id]   Process the next signal or the selected signal',
    '  process --all         Process all valid queued signals',
    '  history               List config versions and the changes recorded for each',
    '  deploy <version>      Activate an existing config version',
    '  rollback <version>    Restore an earlier config version',
    '  audit [filters]       Search with --signal <id>, --path <path>, --since <date>',
    '  check                 Validate stored configs and incoming signals',
    '',
    'Place OptimizationSignal JSONL records in store/events/optimization_signals.jsonl.',
  ].join('\n');
}

export async function runOrchCommand(
  args: string[] = [],
  options: OrchCommandOptions = {},
): Promise<string> {
  const [rawCommand = 'dashboard', ...rest] = args;
  const command = rawCommand.toLowerCase();
  if (command === 'help' || command === '--help' || command === '-h') return help();

  const context = await createContext(options);
  try {
    switch (command) {
      case 'dashboard':
      case 'run': {
        const active = await context.configStore.load();
        const [queue, history, audit, versions] = await Promise.all([
          queueView(context),
          historyView(context),
          context.auditLogger.query(),
          Promise.all(
            (await context.configStore.listVersions()).map((version) =>
              context.configStore.load(version),
            ),
          ),
        ]);
        const rawSignals = (await context.store.exists(EVENTS_PATH))
          ? await context.store.readJsonl<unknown>(EVENTS_PATH)
          : [];
        const contractCheck = await renderContractCheck(versions, rawSignals);
        return [
          `SOA ORCH · active ${active.config_version}`,
          '',
          renderAxesSummary(active),
          '',
          queue,
          '',
          history,
          '',
          renderAuditLog(audit),
          '',
          contractCheck,
          '',
          'Commands: queue · process [id|--all] · history · deploy <version> · rollback <version> · audit · check',
        ].join('\n');
      }
      case 'queue':
        return await queueView(context);
      case 'process': {
        const processAll = rest.includes('--all');
        const signalId = rest.find((arg) => !arg.startsWith('--'));
        return await processSignals(context, signalId, processAll);
      }
      case 'history':
        return await historyView(context);
      case 'deploy': {
        const version = rest[0];
        if (!version) return help('deploy requires a version');
        const previous = context.configStore.getActiveVersion();
        await context.configStore.activateVersion(version);
        await context.auditLogger.record({
          ts: Date.now(),
          signal_id: `manual_deploy_${Date.now()}`,
          config_path: '*',
          version_before: previous,
          version_after: version,
          action: 'deploy',
          reason: 'Manually activated an existing config version.',
        });
        return `Active config is now ${version}.`;
      }
      case 'rollback': {
        const version = rest[0];
        if (!version) return help('rollback requires a version');
        const restored = await context.orchestrator.rollback(version);
        return `Rolled back to ${restored.config_version}; load() now returns this version.`;
      }
      case 'audit': {
        const filter = parseAuditFilter(rest);
        return renderAuditLog(await context.auditLogger.query(filter));
      }
      case 'check': {
        const versions = await Promise.all(
          (await context.configStore.listVersions()).map((version) =>
            context.configStore.load(version),
          ),
        );
        const signals = (await context.store.exists(EVENTS_PATH))
          ? await context.store.readJsonl<unknown>(EVENTS_PATH)
          : [];
        return await renderContractCheck(versions, signals);
      }
      default:
        return help(rawCommand);
    }
  } catch (error) {
    return `soa orch ${command} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
