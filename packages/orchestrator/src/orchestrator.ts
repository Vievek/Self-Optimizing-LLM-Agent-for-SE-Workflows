import {
  type FullAgentConfig,
  type OptimizationSignal,
  type ConfigProvider,
} from '@soa/contracts';
import { ConfigStore } from './config/config-store.js';
import { SignalRouter } from './signals/signal-router.js';
import { ConfigValidator, type ValidationResult } from './validation/config-validator.js';
import { Deployer } from './deploy/deployer.js';
import { AuditLogger, type AuditEntry } from './audit/audit-logger.js';
import { StabilityController } from './stability/stability-controller.js';
import { createDefaultOptimizers } from './optimizers/index.js';
import type { LlmProvider } from '@soa/llm';
import { FixGenerator } from './fix/fix-generator.js';

export interface OrchestratorOptions {
  configStore?: ConfigStore;
  auditLogger?: AuditLogger;
  stabilityController?: StabilityController;
  router?: SignalRouter;
  validator?: ConfigValidator;
  deployer?: Deployer;
  llmProvider?: LlmProvider;
}

export interface OptimizationResult {
  status: 'deployed' | 'rejected' | 'skipped';
  newVersion?: string;
  previousVersion: string;
  config?: FullAgentConfig;
  reason?: string;
  validation?: ValidationResult;
}

/**
 * OptimizationOrchestrator – Main Orchestrator component pipeline.
 *
 * Implements ConfigProvider. Coordinates intake, routing, validation,
 * deployment, rollback, audit logging, and stability controls.
 */
export class OptimizationOrchestrator implements ConfigProvider {
  public readonly configStore: ConfigStore;
  public readonly auditLogger: AuditLogger;
  public readonly stabilityController: StabilityController;
  public readonly router: SignalRouter;
  public readonly validator: ConfigValidator;
  public readonly deployer: Deployer;
  public readonly fixGenerator?: FixGenerator;

  constructor(options: OrchestratorOptions = {}) {
    this.configStore = options.configStore ?? new ConfigStore();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.stabilityController = options.stabilityController ?? new StabilityController();
    this.validator = options.validator ?? new ConfigValidator();
    this.deployer = options.deployer ?? new Deployer(this.configStore, this.auditLogger);

    if (options.router) {
      this.router = options.router;
    } else {
      this.router = new SignalRouter();
      for (const opt of createDefaultOptimizers()) {
        this.router.register(opt);
      }
    }

    if (options.llmProvider) {
      this.fixGenerator = new FixGenerator(options.llmProvider);
    }
  }

  async load(version?: string): Promise<FullAgentConfig> {
    return this.configStore.load(version);
  }

  async processSignal(signal: OptimizationSignal): Promise<OptimizationResult> {
    const currentVer = this.configStore.getActiveVersion();
    const currentConfig = await this.configStore.load(currentVer);

    // 1. Stability control: at most one change per group_id
    if (!this.stabilityController.canProcessGroup(signal.group_id)) {
      const reason = `Signal group "${signal.group_id}" has already produced a configuration update.`;
      await this.auditLogger.record({
        ts: Date.now(),
        signal_id: signal.signal_id,
        config_path: signal.target.config_path,
        version_after: currentVer,
        action: 'reject',
        reason,
      });
      return {
        status: 'rejected',
        previousVersion: currentVer,
        reason,
      };
    }

    // 2. Route signal to axis optimizer
    let candidateConfig: FullAgentConfig | null = null;
    try {
      candidateConfig = this.router.route(signal, currentConfig);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        status: 'rejected',
        previousVersion: currentVer,
        reason,
      };
    }

    if (!candidateConfig) {
      return {
        status: 'skipped',
        previousVersion: currentVer,
        reason: `Axis optimizer for "${signal.target.axis}" returned no changes.`,
      };
    }

    // 3. Validation: verify against FullAgentConfigSchema and parameter ranges
    // Read the modified value at the target path
    const valResult = this.validator.validateCandidate(
      currentConfig,
      signal.target.config_path,
      this.readPathValue(candidateConfig, signal.target.config_path),
    );

    if (!valResult.valid || !valResult.config) {
      const reason = valResult.error ?? 'Validation failed';
      await this.auditLogger.record({
        ts: Date.now(),
        signal_id: signal.signal_id,
        config_path: signal.target.config_path,
        old_value: valResult.oldValue,
        new_value: valResult.newValue,
        version_before: currentVer,
        version_after: currentVer,
        action: 'reject',
        reason,
      });
      return {
        status: 'rejected',
        previousVersion: currentVer,
        reason,
        validation: valResult,
      };
    }

    // 4. Deploy: commit new version so next load() returns it immediately
    const nextVer = await this.deployer.deploy(valResult.config, {
      signalId: signal.signal_id,
      configPath: signal.target.config_path,
      oldValue: valResult.oldValue,
      newValue: valResult.newValue,
    });

    // 5. Update stability controller
    this.stabilityController.recordGroupProcessed(signal.group_id);

    return {
      status: 'deployed',
      newVersion: nextVer,
      previousVersion: currentVer,
      config: await this.configStore.load(nextVer),
      validation: valResult,
    };
  }

  async rollback(targetVersion: string, reason: string = 'Manual rollback'): Promise<FullAgentConfig> {
    const versionBefore = this.configStore.getActiveVersion();
    const restored = await this.configStore.load(targetVersion);

    this.configStore.setActiveVersion(targetVersion);

    await this.auditLogger.record({
      ts: Date.now(),
      signal_id: `rollback_to_${targetVersion}`,
      config_path: '*',
      version_before: versionBefore,
      version_after: targetVersion,
      action: 'rollback',
      reason,
    });

    return restored;
  }

  private readPathValue(config: FullAgentConfig, path: string): unknown {
    const segments = path.split('.');
    let curr: any = config;
    if (segments[0] === 'tools' && segments[1] !== 'tools' && segments[1] !== 'schema_version') {
      segments.splice(1, 0, 'tools');
    }
    for (const s of segments) {
      if (curr === undefined || curr === null) return undefined;
      curr = curr[s];
    }
    return curr;
  }
}
