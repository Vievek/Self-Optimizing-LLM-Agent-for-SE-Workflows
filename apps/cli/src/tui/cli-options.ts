/** Global CLI flags for the TUI. */
export interface CliOptions {
  /** Arguments with the global flags removed. */
  args: string[];
  /** False with --no-anim or when stdout is not a terminal: no timers, no boot splash. */
  animate: boolean;
}

export function parseCliOptions(argv: string[], stdoutIsTTY: boolean): CliOptions {
  const noAnim = argv.includes('--no-anim');
  return {
    args: argv.filter((a) => a !== '--no-anim'),
    animate: !noAnim && stdoutIsTTY,
  };
}
