import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_MIN_MS, TuiApp } from './app.js';
import { stripAnsi } from '../theme/text.js';
import type { DashboardView, TuiState, ViewContext } from '../dashboards/types.js';

/** A promise the test settles by hand. */
function deferred<T = string>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A minimal view that claims "x" and "right", and runs a task on "x". */
class TaskView implements DashboardView {
  id = 'exec';
  name = 'Task view';
  title = 'Task view';
  tabs = ['One', 'Two'];
  rightPresses = 0;
  constructor(private readonly work: () => Promise<string | void>) {}
  render(state: TuiState): string {
    return Array.from({ length: state.height }, () => '').join('\n');
  }
  handleKey(key: string, _state: TuiState, ctx: ViewContext): boolean {
    if (key === 'x') {
      void ctx.runTask('Crunching numbers', this.work);
      return true;
    }
    if (key === 'right') {
      this.rightPresses++;
      return true;
    }
    return false;
  }
  keyHints() {
    return [{ key: 'x', label: 'crunch', priority: 6 }];
  }
}

function makeApp(animate: boolean, work: () => Promise<string | void> = async () => 'ok') {
  const app = new TuiApp('exec', 'nord', { animate });
  const view = new TaskView(work);
  app.registerView(view);
  app.setSize(120, 40);
  return { app, view };
}

const frame = (app: TuiApp) => stripAnsi(app.renderCurrent());

describe('TuiApp.runTask (async work with the busy indicator)', () => {
  it('shows the busy verb while the promise runs, then a DONE toast with its message', async () => {
    const { app } = makeApp(false);
    const work = deferred();
    const run = app.runTask('Verifying memory', () => work.promise);
    expect(app.isBusy()).toBe(true);
    expect(frame(app)).toContain('Verifying memory');
    work.resolve('3 memories checked');
    expect(await run).toBe(true);
    expect(app.isBusy()).toBe(false);
    expect(app.getToast()).toBe('[ ✔ DONE ] 3 memories checked');
  });

  it('falls back to options.done, and shows a FAIL toast when the promise rejects', async () => {
    const { app } = makeApp(false);
    expect(await app.runTask('Saving', async () => undefined, { done: 'Saved' })).toBe(true);
    expect(app.getToast()).toBe('[ ✔ DONE ] Saved');
    expect(
      await app.runTask('Saving', async () => {
        throw new Error('disk full');
      }),
    ).toBe(false);
    expect(app.getToast()).toBe('[ ✖ FAIL ] disk full');
  });

  it('runs one task at a time, and a timed busy does not replace it', async () => {
    const { app } = makeApp(false);
    const work = deferred();
    const first = app.runTask('First', () => work.promise);
    expect(await app.runTask('Second', async () => 'no')).toBe(false);
    expect(app.getToast()).toBe('[ ● INFO ] Busy: First');
    app.startBusy('Loading dashboard', 700);
    expect(frame(app)).toContain('First');
    work.resolve('first done');
    expect(await first).toBe(true);
    expect(app.getToast()).toBe('[ ✔ DONE ] first done');
  });

  it('Esc aborts: the late result shows no DONE toast', async () => {
    const { app } = makeApp(false);
    const work = deferred();
    const run = app.runTask('Slow job', () => work.promise);
    app.handleInput('\x1b');
    expect(app.isBusy()).toBe(false);
    work.resolve('too late');
    expect(await run).toBe(false);
    expect(app.getToast()).toBe('[ ✖ FAIL ] Aborted by user');
  });

  it('lets a view run a task from a key and claim keys before tab switching', async () => {
    const work = deferred();
    const { app, view } = makeApp(false, () => work.promise);
    app.handleInput('x');
    expect(app.isBusy()).toBe(true);
    work.resolve('crunched');
    await vi.waitFor(() => expect(app.isBusy()).toBe(false));
    expect(app.getToast()).toBe('[ ✔ DONE ] crunched');

    app.handleInput({ name: 'right' });
    expect(view.rightPresses).toBe(1);
    expect(app.getState().activeTab).toBe(0);
    app.handleInput({ name: 'tab' });
    expect(app.getState().activeTab).toBe(1);
  });

  it("shows the view's own key hints in the status bar", () => {
    const { app } = makeApp(false);
    const status = frame(app).split('\n').at(-1)!;
    expect(status).toContain('crunch');
    expect(status).not.toContain('select');
  });
});

describe('TuiApp.runTask with animation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('animates SOA-BOT until the promise settles (not after expectedMs) and leaves no timers', async () => {
    const { app } = makeApp(true);
    const work = deferred();
    const run = app.runTask('Re-checking memories', () => work.promise, {
      expectedMs: OVERLAY_MIN_MS + 500,
    });
    expect(app.isAnimating()).toBe(true);
    const out = frame(app);
    expect(out).toContain('┗━┳━━━━━┳━┛'); // SOA-BOT's neck
    expect(out).toContain('PROCESSING // Re-checking memories');

    vi.advanceTimersByTime(OVERLAY_MIN_MS * 3);
    expect(app.isBusy()).toBe(true);

    work.resolve('done');
    expect(await run).toBe(true);
    expect(app.isAnimating()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
