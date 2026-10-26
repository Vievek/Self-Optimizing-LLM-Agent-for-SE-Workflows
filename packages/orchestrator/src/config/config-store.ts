import { FullAgentConfigSchema, type ConfigProvider, type FullAgentConfig } from '@soa/contracts';
import type { Store } from '@soa/store';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BASE_CONFIG } from '../test-utils/fixtures.js';

export interface ConfigStoreOptions {
  store?: Store;
  configDir?: string;
  activeVersionPath?: string;
  initialConfig?: FullAgentConfig;
}

/**
 * Loads the default config fixture.
 * Falls back to BASE_CONFIG if the fixture is unavailable or invalid.
 */
async function loadDefaultConfigFixture(): Promise<FullAgentConfig> {
  try {
    const fixturePath = resolve(process.cwd(), 'packages/orchestrator/src/fix/default-config.json');

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
  private readonly activeVersionPath: string;
  private readonly memoryVersions = new Map<string, FullAgentConfig>();
  private activeVersion: string;
  private versionCounter: number;

  constructor(options: ConfigStoreOptions = {}) {
    this.store = options.store;
    this.configDir = options.configDir ?? 'config';
    this.activeVersionPath = options.activeVersionPath ?? `${this.configDir}/active.json`;

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
    const configDir = options.configDir ?? 'config';
    const activeVersionPath = options.activeVersionPath ?? `${configDir}/active.json`;
    let initialConfig = FullAgentConfigSchema.parse(
      options.initialConfig ?? (await loadDefaultConfigFixture()),
    );
    let savedVersions: string[] = [];

    if (options.store) {
      const files = await options.store.list(`${configDir}/`);
      savedVersions = files
        .map((file) => file.match(/(?:^|\/)(cfg_\d{4})\.json$/)?.[1])
        .filter((version): version is string => version !== undefined);
      if (await options.store.exists(activeVersionPath)) {
        const active = await options.store.read<{ version?: unknown }>(activeVersionPath);
        if (typeof active.version !== 'string') {
          throw new Error(`Invalid active config pointer at "${activeVersionPath}".`);
        }
        const versionPath = `${configDir}/${active.version}.json`;
        if (!(await options.store.exists(versionPath))) {
          throw new Error(`Active config version "${active.version}" is missing.`);
        }
        initialConfig = FullAgentConfigSchema.parse(await options.store.read(versionPath));
      } else {
        const latestVersion = [...savedVersions].sort().at(-1);
        if (latestVersion) {
          initialConfig = FullAgentConfigSchema.parse(
            await options.store.read(`${configDir}/${latestVersion}.json`),
          );
        }
      }
    }

    const configStore = new ConfigStore({ ...options, initialConfig });
    for (const version of savedVersions) {
      const number = Number(version.slice(4));
      if (Number.isInteger(number)) {
        configStore.versionCounter = Math.max(configStore.versionCounter, number);
      }
    }
    if (options.store) {
      const versionPath = `${configDir}/${initialConfig.config_version}.json`;
      if (!(await options.store.exists(versionPath))) {
        await options.store.write(versionPath, initialConfig, FullAgentConfigSchema);
      }
      await options.store.write(activeVersionPath, { version: initialConfig.config_version });
    }
    return configStore;
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
      await this.store.write(this.activeVersionPath, { version });
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

  async activateVersion(version: string): Promise<void> {
    const config = await this.load(version);
    this.memoryVersions.set(version, config);
    this.activeVersion = version;
    if (this.store) {
      await this.store.write(this.activeVersionPath, { version });
    }
  }
}
