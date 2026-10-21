#!/usr/bin/env node
import { CommandRegistry } from './registry.js';
import { TuiApp } from './tui/app.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || '';
  const subArgs = args.slice(1);

  // If invoked as `soa` or `soa tui` (without --print), launch interactive TUI mode!
  const isPrintOnly = subArgs.includes('--print');
  const targetView = subArgs.filter((a) => a !== '--print')[0] || 'exec';

  if ((!command || command === 'tui') && !isPrintOnly) {
    const app = new TuiApp(targetView);
    await app.runInteractive();
    return;
  }

  if (command === 'tui' && isPrintOnly) {
    const app = new TuiApp(targetView);
    console.log(app.renderCurrent());
    return;
  }

  // If invoked with `--tui` flag on any module (e.g. `soa memory --tui`)
  if (subArgs.includes('--tui') && ['exec', 'heae', 'memory', 'orch', 'menu'].includes(command.toLowerCase())) {
    const app = new TuiApp(command.toLowerCase());
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
