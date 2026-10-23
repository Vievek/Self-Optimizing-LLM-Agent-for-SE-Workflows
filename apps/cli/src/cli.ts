#!/usr/bin/env node
import { CommandRegistry } from './registry.js';
import { TuiApp } from './tui/app.js';
import { parseCliOptions } from './tui/cli-options.js';

const TUI_MODULES = ['exec', 'heae', 'memory', 'orch', 'menu'];

async function main(): Promise<void> {
  // --no-anim: static frames, no timers. Also implied when stdout is not a terminal.
  const { args, animate } = parseCliOptions(process.argv.slice(2), Boolean(process.stdout.isTTY));

  const command = args[0] || '';
  const subArgs = args.slice(1);

  // `soa` or `soa tui [view]` (without --print) launches the interactive TUI.
  const isPrintOnly = subArgs.includes('--print');
  const targetView = subArgs.filter((a) => !a.startsWith('--'))[0] || 'exec';

  if ((!command || command === 'tui') && !isPrintOnly) {
    const app = new TuiApp(targetView, 'cyber', { animate });
    await app.runInteractive();
    return;
  }

  if (command === 'tui' && isPrintOnly) {
    const app = new TuiApp(targetView, 'cyber', { animate: false });
    console.log(app.renderCurrent());
    return;
  }

  // `--tui` on a module (e.g. `soa memory --tui`)
  if (subArgs.includes('--tui') && TUI_MODULES.includes(command.toLowerCase())) {
    const app = new TuiApp(command.toLowerCase(), 'cyber', { animate });
    await app.runInteractive();
    return;
  }

  // Standard CLI command execution (for scripts, CI pipes, and headless inspection)
  const registry = new CommandRegistry();
  const output = await registry.execute(command, subArgs);
  console.log(output);
}

main().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
