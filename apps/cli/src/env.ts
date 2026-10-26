import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseAndApplyEnv(envPath: string): void {
  try {
    if (typeof (process as any).loadEnvFile === 'function') {
      (process as any).loadEnvFile(envPath);
    }
  } catch {
    // Fall back to line parser
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
}

function findEnvInParents(startDir: string): string | undefined {
  const visited = new Set<string>();
  let cur = path.resolve(startDir);

  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const envPath = path.join(cur, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/**
 * Automatically locates and loads .env into process.env.
 * Checks both the target workspace (process.cwd()) AND the SOA agent repository root.
 */
export function autoLoadEnv(startDir: string = process.cwd()): void {
  // 1. Search upwards from cwd (e.g. target workspace if it has its own .env)
  const cwdEnv = findEnvInParents(startDir);
  if (cwdEnv) {
    parseAndApplyEnv(cwdEnv);
  }

  // 2. Search upwards from this package's directory (the SOA repo root containing agent tokens)
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const repoEnv = findEnvInParents(thisDir);
    if (repoEnv && repoEnv !== cwdEnv) {
      parseAndApplyEnv(repoEnv);
    }
  } catch {
    // Ignore URL resolution errors
  }
}
