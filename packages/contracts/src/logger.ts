import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ComponentNameSchema = z.enum(['exec', 'heae', 'mem', 'orch', 'cli']);
export type ComponentName = z.infer<typeof ComponentNameSchema>;

export const LogRecordSchema = z.object({
  ts: z.string().datetime(),
  level: LogLevelSchema,
  component: ComponentNameSchema,
  run_id: z.string(),
  task_id: z.string(),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/),
  msg: z.string(),
  context: z.record(z.unknown()).optional(),
});
export type LogRecord = z.infer<typeof LogRecordSchema>;

export interface LoggerOptions {
  component: ComponentName;
  run_id: string;
  task_id: string;
  trace_id: string;
  logDir?: string;
  mirrorToConsole?: boolean;
}

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(bindings: Partial<LoggerOptions>): Logger;
}

export class PinoJsonLogger implements Logger {
  private readonly options: LoggerOptions;
  private readonly logFilePath?: string;

  constructor(options: LoggerOptions) {
    this.options = options;
    if (options.logDir) {
      try {
        fs.mkdirSync(options.logDir, { recursive: true });
        this.logFilePath = path.join(options.logDir, `${options.component}.jsonl`);
      } catch {
        // Fallback gracefully if directory cannot be created
      }
    }
  }

  private write(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      component: this.options.component,
      run_id: this.options.run_id,
      task_id: this.options.task_id,
      trace_id: this.options.trace_id,
      msg,
      ...(context ? { context } : {}),
    };

    const line = JSON.stringify(record);

    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, line + '\n', 'utf8');
      } catch {
        // Silently continue if filesystem write fails in sandbox
      }
    }

    if (this.options.mirrorToConsole) {
      if (level === 'error') {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    }
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.write('debug', msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.write('info', msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.write('warn', msg, context);
  }

  error(msg: string, context?: Record<string, unknown>): void {
    this.write('error', msg, context);
  }

  child(bindings: Partial<LoggerOptions>): Logger {
    return new PinoJsonLogger({
      ...this.options,
      ...bindings,
    });
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new PinoJsonLogger(options);
}
