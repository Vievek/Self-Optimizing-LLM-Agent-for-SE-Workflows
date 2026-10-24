#!/usr/bin/env node
import { runHeaeCli } from './heae-cli.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = await runHeaeCli(args);

  console.log(output);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`HEAE CLI Error: ${message}`);
  process.exitCode = 1;
});
