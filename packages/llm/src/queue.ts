export interface RequestQueueOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryPredicate?: (error: unknown) => boolean;
}

export class RequestQueue {
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryPredicate: (error: unknown) => boolean;

  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(options: RequestQueueOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 10000;
    this.retryPredicate =
      options.retryPredicate ??
      ((err: unknown) => {
        if (!err) return false;
        const msg = String(err);
        return (
          msg.includes('429') ||
          msg.includes('413') ||
          msg.includes('rate_limit') ||
          msg.includes('rate limit') ||
          msg.includes('tokens') ||
          msg.includes('ITPM') ||
          msg.includes('OTPM') ||
          msg.includes('500') ||
          msg.includes('502') ||
          msg.includes('503') ||
          msg.includes('504') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('TimeoutError') ||
          msg.includes('timeout') ||
          msg.includes('aborted') ||
          msg.includes('DOMException') ||
          msg.includes('fetch failed')
        );
      });
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      return await this.executeWithRetry(fn);
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        return await fn();
      } catch (err: unknown) {
        attempt++;
        if (attempt > this.maxRetries || !this.retryPredicate(err)) {
          throw err;
        }

        // Exponential backoff with random jitter: base * 2^(attempt-1) + jitter
        let delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
          this.maxDelayMs,
        );

        // If provider explicitly specified a retry delay (e.g. Groq "try again in 2.87s")
        const msg = String(err);
        const retryAfterMatch = msg.match(/try again in ([\d.]+)s/i);
        if (retryAfterMatch?.[1]) {
          const waitSec = parseFloat(retryAfterMatch[1]);
          if (!isNaN(waitSec) && waitSec > 0) {
            delay = Math.ceil(waitSec * 1000) + 500;
          }
        } else if (msg.includes('OTPM') || msg.includes('output tokens per minute')) {
          delay = 10000;
        } else if (
          msg.includes('ITPM') ||
          msg.includes('input tokens per minute') ||
          msg.includes('413')
        ) {
          delay = 15000;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('Exceeded maximum retry attempts');
  }

  get stats(): { active: number; pending: number } {
    return {
      active: this.activeCount,
      pending: this.queue.length,
    };
  }
}
