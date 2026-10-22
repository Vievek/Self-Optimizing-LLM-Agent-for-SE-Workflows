export interface CompactionOptions {
  maxLines?: number;
  headLines?: number;
  tailLines?: number;
  maxChars?: number;
}

export const DEFAULT_COMPACTION_OPTIONS: Required<CompactionOptions> = {
  maxLines: 100,
  headLines: 40,
  tailLines: 40,
  maxChars: 12000,
};

/**
 * Strips terminal ANSI control and color escape sequences.
 */
export function stripAnsi(text: string): string {
  // Matches standard 7-bit and 8-bit C1 ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Intelligently compacts large command or search outputs to fit within model context windows
 * while preserving critical error stack traces at the head and tail, plus an actionable notice.
 */
export function compactToolOutput(
  rawOutput: string,
  toolName: string,
  options: CompactionOptions = {},
): string {
  // read_file relies on explicit line offset and limit pagination; do not alter line numbers
  if (toolName === 'read_file') {
    return stripAnsi(rawOutput);
  }

  const cleaned = stripAnsi(rawOutput);
  const lines = cleaned.split('\n');

  const maxLines = options.maxLines ?? DEFAULT_COMPACTION_OPTIONS.maxLines;
  const headLines = options.headLines ?? DEFAULT_COMPACTION_OPTIONS.headLines;
  const tailLines = options.tailLines ?? DEFAULT_COMPACTION_OPTIONS.tailLines;
  const maxChars = options.maxChars ?? DEFAULT_COMPACTION_OPTIONS.maxChars;

  if (lines.length <= maxLines && cleaned.length <= maxChars) {
    return cleaned;
  }

  // Preserve head and tail lines where setup and errors reside
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const omittedCount = lines.length - head.length - tail.length;

  const notice = [
    `\n... [Output truncated: ${omittedCount} lines omitted to stay within context budget] ...`,
    `... [Showing first ${head.length} lines and last ${tail.length} lines.] ...`,
    `... [To inspect specific files or lines, use 'read_file' with offset & limit, or refine your search pattern.] ...\n`,
  ].join('\n');

  const compacted = [...head, notice, ...tail].join('\n');

  // Hard safety limit on character length
  if (compacted.length > maxChars) {
    const half = Math.floor(maxChars / 2) - 100;
    return (
      compacted.slice(0, half) +
      '\n... [Remaining output truncated due to byte limit] ...\n' +
      compacted.slice(-half)
    );
  }

  return compacted;
}

