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
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 3000;
    this.retryPredicate =
      options.retryPredicate ??
      ((err: unknown) => {
        if (!err) return false;
        const msg = String(err);
        return (
          msg.includes('429') ||
          msg.includes('rate limit') ||
          msg.includes('500') ||
          msg.includes('502') ||
          msg.includes('503') ||
          msg.includes('504') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
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
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
          this.maxDelayMs,
        );
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
