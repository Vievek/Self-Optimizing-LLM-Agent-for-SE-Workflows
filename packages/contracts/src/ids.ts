import crypto from 'node:crypto';

// Crockford's Base32 character set (excludes I, L, O, U to avoid confusion)
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;

/**
 * Generates a 26-character universally unique lexicographically sortable identifier (ULID).
 * 10 characters: 48-bit timestamp in milliseconds.
 * 16 characters: 80-bit cryptographic randomness.
 */
export function generateUlid(timestampMs: number = Date.now()): string {
  let timeStr = '';
  let time = timestampMs;
  for (let i = 9; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    timeStr = ENCODING.charAt(mod) + timeStr;
    time = Math.floor(time / ENCODING_LEN);
  }

  const randomBytes = crypto.randomBytes(10);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    const byte = randomBytes[i % 10] ?? 0;
    const randIndex = (byte + i * 3) % ENCODING_LEN;
    randStr += ENCODING.charAt(randIndex);
  }

  return timeStr + randStr;
}

/** Generates a memory ID with prefix 'mem_', e.g. 'mem_01J9X8...' */
export function generateMemoryId(timestampMs?: number): string {
  return `mem_${generateUlid(timestampMs)}`;
}

/** Generates an evidence ID with prefix 'ev_', e.g. 'ev_01J9X8...' */
export function generateEvidenceId(timestampMs?: number): string {
  return `ev_${generateUlid(timestampMs)}`;
}

/** Generates an optimization signal ID with prefix 'sig_', e.g. 'sig_run_01_task_01' or 'sig_01J9X8...' */
export function generateSignalId(runId?: string, taskId?: string, seq?: number): string {
  if (runId && taskId && seq !== undefined) {
    const cleanRun = runId.replace(/^run_/, '');
    const cleanTask = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `sig_${cleanRun}_${cleanTask}_${String(seq).padStart(2, '0')}`;
  }
  return `sig_${generateUlid()}`;
}

/** Generates a configuration version alias with prefix 'cfg_', e.g. 'cfg_0007' */
export function generateConfigVersion(num: number): string {
  return `cfg_${String(num).padStart(4, '0')}`;
}

/** Generates an OpenTelemetry-compliant 32-character hex trace ID */
export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Generates an OpenTelemetry-compliant 16-character hex span ID */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Generates a run ID following Section 3.13: run_<yyyymmddThhmm>_<condition>_<nn>
 * e.g. 'run_20261015T0900_baseline_01'
 */
export function generateRunId(
  condition: 'baseline' | 'amem' | 'focus' | 'memory_full' | 'orch_off' | 'orch_on' | string,
  seq = 1,
  date: Date = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const formattedDate = `${yyyy}${mm}${dd}T${hh}${min}`;
  const formattedSeq = String(seq).padStart(2, '0');
  return `run_${formattedDate}_${condition}_${formattedSeq}`;
}

// Validator functions
export function isValidMemoryId(id: string): boolean {
  return /^mem_[0-9A-HJKMNP-TV-Z]{26}$/i.test(id) || /^mem_[a-zA-Z0-9_-]+$/.test(id);
}

export function isValidEvidenceId(id: string): boolean {
  return /^ev_[0-9A-HJKMNP-TV-Z]{26}$/i.test(id) || /^ev_[a-zA-Z0-9_-]+$/.test(id);
}

export function isValidSignalId(id: string): boolean {
  return /^sig_[a-zA-Z0-9_-]+$/.test(id);
}

export function isValidConfigVersion(version: string): boolean {
  return /^cfg_[0-9]{4}$|^[0-9a-f]{40}$/.test(version);
}

export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId);
}

export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/.test(spanId);
}

export function isValidRunId(runId: string): boolean {
  return /^run_\d{8}T\d{4}_[a-zA-Z0-9_-]+_\d{2}$/.test(runId);
}
