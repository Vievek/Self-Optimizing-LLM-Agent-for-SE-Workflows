import {
  CONFIG_SCHEMA_VERSION,
  FullAgentConfigSchema,
  type ConfigProvider,
  type FullAgentConfig,
} from '@soa/contracts';
import type { Store } from '@soa/store';
import { BASE_CONFIG } from '../test-utils/fixtures.js';

export interface ConfigStoreOptions {
  store?: Store;
  configDir?: string;
  initialConfig?: FullAgentConfig;
}

/**
 * ConfigStore – FR4 implementation
 *
 * Manages versioned FullAgentConfig snapshots (cfg_0001, cfg_0002, ...).
 * Enforces validation against FullAgentConfigSchema on every read and write.
 * Implements ConfigProvider interface for Execution Core interop.
 */
export class ConfigStore implements ConfigProvider {
  private readonly store?: Store;
  private readonly configDir: string;
  private readonly memoryVersions = new Map<string, FullAgentConfig>();
  private activeVersion: string;
  private versionCounter: number;

  constructor(options: ConfigStoreOptions = {}) {
    this.store = options.store;
    this.configDir = options.configDir ?? 'store/config';
    const seed = options.initialConfig ?? BASE_CONFIG;

    // Validate initial seed config
    const validated = FullAgentConfigSchema.parse(seed);
    this.activeVersion = validated.config_version;
    this.versionCounter = parseInt(this.activeVersion.replace(/^cfg_/, ''), 10) || 1;
    this.memoryVersions.set(this.activeVersion, validated);
  }

  /**
   * Loads config by version. If no version is specified, returns active version.
   */
  async load(version?: string): Promise<FullAgentConfig> {
    const targetVersion = version ?? this.activeVersion;

    if (this.memoryVersions.has(targetVersion)) {
      const cfg = this.memoryVersions.get(targetVersion)!;
      return FullAgentConfigSchema.parse(structuredClone(cfg));
    }

    if (this.store) {
      const filePath = `${this.configDir}/${targetVersion}.json`;
      if (await this.store.exists(filePath)) {
        const raw = await this.store.read<FullAgentConfig>(filePath);
        const parsed = FullAgentConfigSchema.parse(raw);
        this.memoryVersions.set(targetVersion, parsed);
        return parsed;
      }
    }

    throw new Error(`Config version "${targetVersion}" not found in store.`);
  }

  /**
   * Saves a new validated version snapshot.
   */
  async saveVersion(config: FullAgentConfig): Promise<string> {
    const validated = FullAgentConfigSchema.parse(config);
    const ver = validated.config_version;

    this.memoryVersions.set(ver, validated);
    this.activeVersion = ver;

    const num = parseInt(ver.replace(/^cfg_/, ''), 10);
    if (!Number.isNaN(num) && num > this.versionCounter) {
      this.versionCounter = num;
    }

    if (this.store) {
      const filePath = `${this.configDir}/${ver}.json`;
      await this.store.write(filePath, validated, FullAgentConfigSchema);
    }

    return ver;
  }

  /**
   * Generates next version ID (e.g., cfg_0002).
   */
  getNextVersionId(): string {
    const next = this.versionCounter + 1;
    return `cfg_${String(next).padStart(4, '0')}`;
  }

  /**
   * Returns list of known version identifiers.
   */
  async listVersions(): Promise<string[]> {
    const versions = new Set<string>(this.memoryVersions.keys());
    if (this.store) {
      try {
        const files = await this.store.list(this.configDir);
        for (const file of files) {
          const match = file.match(/cfg_\d{4}/);
          if (match) {
            versions.add(match[0]);
          }
        }
      } catch {
        // Directory may not exist yet
      }
    }
    return Array.from(versions).sort();
  }

  getActiveVersion(): string {
    return this.activeVersion;
  }

  setActiveVersion(version: string): void {
    if (!this.memoryVersions.has(version)) {
      throw new Error(`Cannot activate unknown config version "${version}".`);
    }
    this.activeVersion = version;
  }
}
