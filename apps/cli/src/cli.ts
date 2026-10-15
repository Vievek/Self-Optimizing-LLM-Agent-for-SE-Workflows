#!/usr/bin/env node
import { CommandRegistry } from './registry.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || '';
  const subArgs = args.slice(1);

  const registry = new CommandRegistry();
  const output = await registry.execute(command, subArgs);
  console.log(output);
}

main().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
