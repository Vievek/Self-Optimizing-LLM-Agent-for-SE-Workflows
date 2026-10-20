import type { FullAgentConfig } from '@soa/contracts';
import type { ConfigStore } from '../config/config-store.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface DeployOptions {
  signalId: string;
  configPath: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Deployer – FR5
 *
 * Deploys validated candidate configurations into the ConfigStore
 * and records deployment into the audit log.
 */
export class Deployer {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly auditLogger?: AuditLogger,
  ) {}

  async deploy(
    candidate: FullAgentConfig,
    options?: DeployOptions,
  ): Promise<string> {
    const versionBefore = this.configStore.getActiveVersion();
    const nextVer = this.configStore.getNextVersionId();

    const deployedConfig: FullAgentConfig = {
      ...structuredClone(candidate),
      config_version: nextVer,
    };

    const savedVersion = await this.configStore.saveVersion(deployedConfig);

    if (this.auditLogger && options) {
      await this.auditLogger.record({
        ts: Date.now(),
        signal_id: options.signalId,
        config_path: options.configPath,
        old_value: options.oldValue,
        new_value: options.newValue,
        version_before: versionBefore,
        version_after: savedVersion,
        action: 'deploy',
      });
    }

    return savedVersion;
  }
}
