import { MEMORY_TABS, MemoryDashboardView } from '../../dashboards/memory/memory-view.js';
import { TuiApp } from '../../tui/app.js';
import type { MemoryCommandOptions } from './context.js';

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 40;

/** "pipeline", "decision-log", "Focus loop" or a 1-based number -> tab index. */
export function tabIndex(name: string): number | undefined {
  const n = Number(name);
  if (Number.isInteger(n) && n >= 1 && n <= MEMORY_TABS.length) return n - 1;
  const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const i = MEMORY_TABS.findIndex((t) => key(t) === key(name));
  return i >= 0 ? i : undefined;
}

export interface TuiPrintOptions extends MemoryCommandOptions {
  columns?: number;
  rows?: number;
}

/**
 * `soa memory tui [tab]`: one frame of the live Memory dashboard, printed after the data is
 * loaded (store seeded if empty, stale eval run once). For the interactive app use `soa memory --tui`.
 */
export async function tuiPrintCommand(
  args: string[],
  options: TuiPrintOptions = {},
): Promise<string> {
  const name = args.find((a) => !a.startsWith('--')) ?? 'pipeline';
  const tab = tabIndex(name);
  if (tab === undefined) {
    return `Unknown tab "${name}". Use one of: ${MEMORY_TABS.join(', ')} (or 1-${MEMORY_TABS.length}).`;
  }
  const view = new MemoryDashboardView(options);
  try {
    await view.prepare();
    const app = new TuiApp('memory', 'cyber', { animate: false });
    app.registerView(view);
    app.setSize(
      options.columns ?? (process.stdout.columns || DEFAULT_COLUMNS),
      options.rows ?? (process.stdout.rows || DEFAULT_ROWS),
    );
    for (let i = 0; i < tab; i++) app.handleInput('tab');
    return app.renderCurrent();
  } finally {
    view.close();
  }
}
