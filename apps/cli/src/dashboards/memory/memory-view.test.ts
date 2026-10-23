import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TuiApp } from '../../tui/app.js';
import { stripAnsi } from '../../theme/text.js';
import { MemoryDashboardView } from './memory-view.js';
import { MemoryData } from './memory-data.js';

// A temp store and the fake test runner: no python, nothing written to the repo's store/.
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memory-tui-test-'));
const options = { storeDir, runner: 'fake' as const };
const views: MemoryDashboardView[] = [];

function makeApp(columns = 140, rows = 44): { app: TuiApp; view: MemoryDashboardView } {
  const app = new TuiApp('memory', 'cyber', { animate: false });
  const view = new MemoryDashboardView(options);
  views.push(view);
  app.registerView(view);
  app.setSize(columns, rows);
  return { app, view };
}

const frame = (app: TuiApp) => stripAnsi(app.renderCurrent());
const goToTab = (app: TuiApp, tab: number) => {
  while (app.getState().activeTab !== tab) app.handleInput('tab');
};
const settle = (app: TuiApp) => vi.waitFor(() => expect(app.isBusy()).toBe(false));
const noteIds = () =>
  fs
    .readdirSync(path.join(storeDir, 'memory/notes'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

let scenarioId: string;

beforeAll(async () => {
  const { view } = makeApp();
  await view.prepare();
  scenarioId = noteIds()[0]!;
});

afterAll(() => {
  for (const v of views) v.close();
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe('memory data layer', () => {
  it('seeds an empty store once, then leaves it alone', async () => {
    expect(noteIds()).toHaveLength(6);
    const data = new MemoryData(options);
    expect(await data.ensureSeeded()).toBe(false);
    expect(noteIds()).toHaveLength(6);
    data.close();
  });

  it('replays the focus loop with real context sizes and the final summary', async () => {
    const data = new MemoryData(options);
    const replay = await data.replayScenario();
    const sizes = replay.steps.map((s) => s.contextSize);
    // Grows during a focus block, drops to the summaries when it completes.
    expect(sizes).toEqual([0, 1, 2, 1, 1, 2, 3, 4, 2]);
    expect(replay.summary.notes).toHaveLength(2);
    expect(replay.summary.notes[0]).toContain('TOPIC: Find where usernames are validated');
    data.close();
  });
});

describe('memory dashboard tabs (live data)', () => {
  it('shows LIVE instead of MOCK DATA', () => {
    const out = frame(makeApp().app);
    expect(out).toContain('LIVE · fixture repos');
    expect(out).not.toContain('MOCK DATA');
  });

  it('Pipeline: stages, real counts and the stale-memory evaluation', () => {
    const out = frame(makeApp().app);
    expect(out).toContain('Focus working memory');
    expect(out).toContain('Code-grounded verification');
    expect(out).toContain('NEXT PHASE');
    expect(out).toMatch(/VERIFIED +▰▱▱▱▱▱ 1/);
    expect(out).toMatch(/STALE +▰▰▰▱▱▱ 3/);
    expect(out).toMatch(/memories +6/);
    expect(out).toContain('// STALE-MEMORY EVALUATION');
    expect(out).toMatch(/catch rate +100\.0% \(10\/10 caught\)/);
    expect(out).toMatch(/false alarms +0 of 3 verified/);
    expect(out).toMatch(/accuracy +100\.0% \(16\/16\)/);
    expect(out).toMatch(/avg check +[\d.]+ ms/);
    expect(out).toContain('fake runner');
  });

  it('Pipeline: r re-runs the evaluation with the busy indicator', async () => {
    const { app } = makeApp();
    app.handleInput('r');
    expect(app.isBusy()).toBe(true);
    expect(frame(app)).toContain('Running stale-memory evaluation');
    await settle(app);
    expect(app.getToast()).toBe('[ ✔ DONE ] Stale eval: catch rate 100.0%, accuracy 100.0%');
  });

  it('Memories: real ids and statuses, and the selected card', () => {
    const { app } = makeApp();
    goToTab(app, 1);
    let out = frame(app);
    for (const id of noteIds()) expect(out).toContain(id);
    expect(out).toContain('VERIFIED');
    expect(out).toContain('STALE');
    expect(out).toContain('Reject usernames with a trailing newline');
    expect(out).toContain("regex = r'^[\\w.@+-]+\\Z'");
    expect(out).toMatch(/Checked at +memtest-v1/);
    expect(out).toMatch(/Score +— next phase/);
    expect(out).toMatch(/Action +— next phase/);

    app.handleInput({ name: 'down' });
    out = frame(app);
    expect(out).toContain(`${noteIds()[1]}   STALE`);
  });

  it('Verify: memtest-v1 gives VERIFIED, memtest-v2 gives STALE', async () => {
    const { app } = makeApp();
    goToTab(app, 2);
    app.handleInput({ name: 'return' });
    expect(frame(app)).toContain('Verifying memory');
    await settle(app);
    let out = frame(app);
    expect(out).toContain(`Verify ${scenarioId} at memtest-v1`);
    expect(out).toContain('✔ File exists');
    expect(out).toContain('✔ Fix line found');
    expect(out).toContain('✔ 1/1 evidence tests pass');
    expect(out).toMatch(/Status +VERIFIED/);
    expect(out).toMatch(/\d+ ms · 0 model tokens/);
    expect(out).toContain('fake runner');
    expect(app.getToast()).toBe(`[ ✔ DONE ] ${scenarioId} at memtest-v1: VERIFIED`);

    app.handleInput({ name: 'right' }); // memtest-v2
    expect(app.getState().activeTab).toBe(2);
    app.handleInput({ name: 'return' });
    await settle(app);
    out = frame(app);
    expect(out).toContain(`Verify ${scenarioId} at memtest-v2`);
    expect(out).toContain('✖ Fix line found');
    expect(out).toMatch(/Status +STALE/);
    expect(out).toContain('Fix no longer present in auth/validators.py.');

    const log = fs.readFileSync(path.join(storeDir, 'logs/memory-decisions.jsonl'), 'utf8');
    expect(JSON.parse(log.trim().split('\n').at(-1)!)).toMatchObject({
      phase: 'verify',
      memory_id: scenarioId,
      commit: 'memtest-v2',
      status: 'stale',
    });
  });

  it('Focus loop: n steps through the replay, ending with the summary', async () => {
    const { app, view } = makeApp();
    await view.prepare();
    goToTab(app, 3);
    expect(frame(app)).toContain('step 0/9');
    app.handleInput('n');
    app.handleInput('n');
    let out = frame(app);
    expect(out).toContain('step 2/9');
    expect(out).toContain('START');
    expect(out).toContain("grep -rn 'UsernameValidator' auth/");
    for (let i = 0; i < 10; i++) app.handleInput('n');
    out = frame(app);
    expect(out).toContain('step 9/9');
    expect(out).toContain('// CONSOLIDATED TASK SUMMARY');
    expect(out).toContain('TOPIC: Find where usernames are validated');
    expect(out).toContain('OUTCOME: success');
    expect(out).toMatch(/ 4│.*█/);
  });

  it('Retrieve at memtest-v2 filters the username memory as stale', async () => {
    const { app } = makeApp();
    goToTab(app, 4);
    expect(frame(app)).toContain('Not run at memtest-v2 yet.');
    app.handleInput({ name: 'return' });
    expect(frame(app)).toContain('Re-checking memories');
    await settle(app);
    const out = frame(app);
    const row = out.split('\n').find((l) => l.includes(scenarioId))!;
    expect(row).toContain('STALE');
    expect(row).toContain('✖ filtered (stale)');
    expect(out).toMatch(/6 candidates · \d returned · \d filtered \(stale\)/);
    expect(app.getToast()).toMatch(
      /^\[ ✔ DONE \] Retrieve at memtest-v2: \d returned, \d filtered$/,
    );
  });

  it('Decision log: newest first', () => {
    const { app } = makeApp();
    goToTab(app, 5);
    const out = frame(app);
    const rows = out.split('\n').filter((l) => / (consolidate|verify|retrieve) +mem_/.test(l));
    expect(rows.length).toBeGreaterThan(6);
    // The retrieve test ran last, so retrieve lines come first.
    expect(rows[0]).toContain('retrieve');
    expect(out).toContain('newest first');
  });

  it('shows each tab’s key hints in the status bar', () => {
    const { app } = makeApp(160, 40);
    const status = () => frame(app).split('\n').at(-1)!;
    expect(status()).toContain('re-run eval');
    goToTab(app, 2);
    expect(status()).toMatch(/↑↓ +note .*←→ +commit .*↵ +verify/);
    goToTab(app, 3);
    expect(status()).toContain('next step');
    goToTab(app, 4);
    expect(status()).toMatch(/←→ +commit .*↵ +retrieve/);
  });

  it('fills 80x24, 120x40 and 200x60 exactly on every tab', () => {
    for (const [columns, rows] of [
      [80, 24],
      [120, 40],
      [200, 60],
    ] as const) {
      const { app } = makeApp(columns, rows);
      for (let tab = 0; tab < 6; tab++) {
        goToTab(app, tab);
        const lines = frame(app).split('\n');
        expect(lines).toHaveLength(rows);
        for (const line of lines) expect([...line].length).toBe(columns);
      }
    }
  });
});
