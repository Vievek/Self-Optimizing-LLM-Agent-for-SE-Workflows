import { FullAgentConfigSchema, type ConfigProvider, type FullAgentConfig } from '@soa/contracts';
import type { Store } from '@soa/store';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BASE_CONFIG } from '../test-utils/fixtures.js';

export interface ConfigStoreOptions {
  store?: Store;
  configDir?: string;
  initialConfig?: FullAgentConfig;
}

/**
 * Loads the default config fixture.
 * Falls back to BASE_CONFIG if the fixture is unavailable or invalid.
 */
async function loadDefaultConfigFixture(): Promise<FullAgentConfig> {
  try {
    const fixturePath = resolve(
      process.cwd(),
      'packages/orchestrator/fixtures/default-config.json',
    );

    const contents = await readFile(fixturePath, 'utf8');
    return FullAgentConfigSchema.parse(JSON.parse(contents));
  } catch {
    return FullAgentConfigSchema.parse(BASE_CONFIG);
  }
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

    // Explicit initialConfig takes priority.
    const seed = FullAgentConfigSchema.parse(options.initialConfig ?? BASE_CONFIG);

    this.activeVersion = seed.config_version;
    this.versionCounter = parseInt(this.activeVersion.replace(/^cfg_/, ''), 10) || 1;

    this.memoryVersions.set(this.activeVersion, seed);
  }

  /**
   * Creates a ConfigStore using the default JSON fixture when no
   * initialConfig is supplied. BASE_CONFIG is used as a fallback.
   */
  static async create(options: ConfigStoreOptions = {}): Promise<ConfigStore> {
    if (options.initialConfig) {
      return new ConfigStore(options);
    }

    const initialConfig = await loadDefaultConfigFixture();

    return new ConfigStore({
      ...options,
      initialConfig,
    });
  }

  /**
   * Loads config by version. If no version is specified, returns active version.
   */
  async load(version?: string): Promise<FullAgentConfig> {
    const targetVersion = version ?? this.activeVersion;

    if (this.memoryVersions.has(targetVersion)) {
      const config = this.memoryVersions.get(targetVersion)!;
      return FullAgentConfigSchema.parse(structuredClone(config));
    }

    if (this.store) {
      const filePath = `${this.configDir}/${targetVersion}.json`;

      if (await this.store.exists(filePath)) {
        const raw = await this.store.read<FullAgentConfig>(filePath);
        const parsed = FullAgentConfigSchema.parse(raw);

        this.memoryVersions.set(targetVersion, parsed);
        return structuredClone(parsed);
      }
    }

    throw new Error(`Config version "${targetVersion}" not found in store.`);
  }

  /**
   * Saves a new validated version snapshot.
   */
  async saveVersion(config: FullAgentConfig): Promise<string> {
    const validated = FullAgentConfigSchema.parse(config);
    const version = validated.config_version;

    if (this.store) {
      const filePath = `${this.configDir}/${version}.json`;
      await this.store.write(filePath, validated, FullAgentConfigSchema);
    }

    this.memoryVersions.set(version, validated);
    this.activeVersion = version;

    const number = parseInt(version.replace(/^cfg_/, ''), 10);

    if (!Number.isNaN(number) && number > this.versionCounter) {
      this.versionCounter = number;
    }

    return version;
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
        // Directory may not exist yet.
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
