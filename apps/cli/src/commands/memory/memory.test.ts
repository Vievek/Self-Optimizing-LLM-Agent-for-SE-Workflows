import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMemoryCommand } from './index.js';
import { stripAnsi } from './colors.js';

// Every test runs against a temp store and the fixture sandbox with the fake test runner.
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memory-cli-test-'));
const run = async (...args: string[]) =>
  stripAnsi(await runMemoryCommand(args, { storeDir, runner: 'fake' }));

const noteIds = () =>
  fs
    .readdirSync(path.join(storeDir, 'memory/notes'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

afterAll(() => fs.rmSync(storeDir, { recursive: true, force: true }));

describe('soa memory before seeding', () => {
  it('list and check say the store is empty', async () => {
    expect(await run('list')).toContain('Run "soa memory seed" first');
    expect(await run('check')).toContain('Run "soa memory seed" first');
  });
});

describe('soa memory help', () => {
  it.each([[[]], [['help']], [['--help']]])('lists the subcommands for %j', async (args) => {
    const out = await run(...args);
    for (const sub of ['seed', 'list', 'show', 'verify', 'check', 'stale-eval', 'help']) {
      expect(out).toContain(`  ${sub}`);
    }
    expect(out).not.toContain('Unknown');
  });

  it('names an unknown subcommand and shows the help', async () => {
    const out = await run('frobnicate');
    expect(out).toContain('Unknown memory subcommand "frobnicate"');
    expect(out).toContain('Usage: soa memory <subcommand>');
  });
});

describe('soa memory with a seeded store', () => {
  let seedOut: string;
  let firstId: string;

  beforeAll(async () => {
    // Seeding twice must not pile up notes: seed clears store/memory first.
    await run('seed');
    seedOut = await run('seed');
    firstId = noteIds()[0]!;
  });

  it('seed creates six memories covering every status, with no model tokens', async () => {
    expect(noteIds()).toHaveLength(6);
    expect(seedOut).toContain('Seeded 6 memories');
    expect(seedOut).toContain(
      '6 memories · 1 verified · 3 stale · 1 unverifiable · 1 not applicable',
    );
    expect(seedOut).toContain('scenario username-regex');
    expect(seedOut).toContain('stale-set test-now-fails-v4');
    expect(seedOut).toContain('mock model, 0 tokens');
    expect(seedOut).toContain('Test runner: fake runner');
  });

  it('list shows the header counts and one row per memory', async () => {
    const out = await run('list');
    expect(out.split('\n')[0]).toBe(
      '6 memories · 1 verified · 3 stale · 1 unverifiable · 1 not applicable',
    );
    for (const id of noteIds()) expect(out).toContain(id);
    for (const s of ['verified', 'stale', 'unverifiable', 'not_applicable']) {
      expect(out).toContain(` ${s} `);
    }
    expect(out).toMatch(/\| ID +\| Task +\| Repo +\| Status +\| Checked at \| Links \|/);
  });

  it('list --status filters the rows', async () => {
    const out = await run('list', '--status', 'stale');
    expect(out).toContain('Showing 3 with status stale.');
    const rows = out.split('\n').filter((l) => l.startsWith('| mem_'));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toContain(' stale ');
  });

  it('list rejects an unknown status or option', async () => {
    expect(await run('list', '--status', 'maybe')).toContain('Unknown status "maybe"');
    expect(await run('list', '--status')).toContain('Unknown status ""');
    expect(await run('list', '--wat')).toContain('Unknown option "--wat"');
  });

  it('show prints the full card, with score and action left for the next phase', async () => {
    const out = await run('show', firstId);
    expect(out).toContain(`Memory ${firstId}`);
    expect(out).toContain('Task:             Reject usernames with a trailing newline');
    expect(out).toContain('Files:            auth/validators.py');
    expect(out).toContain("Fix snippet:      regex = r'^[\\w.@+-]+\\Z'");
    expect(out).toContain(
      'Evidence tests:   tests/test_validators.py::test_rejects_trailing_newline',
    );
    expect(out).toContain('Status:           verified');
    expect(out).toContain('Checked at:       memtest-v1');
    expect(out).toContain('Score:            — next phase');
    expect(out).toContain('Action:           — next phase');
  });

  it('show accepts a unique id prefix and explains unknown ids', async () => {
    expect(await run('show', firstId.slice(0, firstId.length - 2))).toContain(`Memory ${firstId}`);
    expect(await run('show', 'mem_nope')).toBe(
      'No memory with id "mem_nope". Run "soa memory list" to see ids.',
    );
    expect(await run('show', 'mem_')).toContain('matches 6 memories');
    expect(await run('show')).toBe('Usage: soa memory show <id>');
  });

  it('verify at memtest-v2 marks the verified note stale, saves it and logs it', async () => {
    const out = await run('verify', firstId, 'memtest-v2');
    expect(out).toContain('✔ File exists');
    expect(out).toContain('✖ Fix line found');
    expect(out).toContain('– 0/1 evidence tests run');
    expect(out).toContain('Status:   STALE');
    expect(out).toContain('Details:  Fix no longer present in auth/validators.py.');
    expect(out).toMatch(/Time: +\d+ ms · 0 model tokens/);
    expect(out).toContain('Test runner: fake runner');

    expect(await run('show', firstId)).toContain('Status:           stale');
    expect(await run('list')).toContain('0 verified · 4 stale');
    const log = fs.readFileSync(path.join(storeDir, 'logs/memory-decisions.jsonl'), 'utf8');
    const last = JSON.parse(log.trim().split('\n').at(-1)!);
    expect(last).toMatchObject({
      phase: 'verify',
      memory_id: firstId,
      commit: 'memtest-v2',
      status: 'stale',
    });
    const row = (await run('list')).split('\n').find((l) => l.includes(firstId))!;
    expect(row).toContain('memtest-v2');
  });

  it('verify shows passing and failing tests, and re-verifies at v1', async () => {
    const v4 = await run('verify', firstId, 'memtest-v4');
    expect(v4).toContain('✔ Fix line found');
    expect(v4).toContain('✖ 0/1 evidence tests pass');
    expect(v4).toContain('Status:   STALE');
    const v1 = await run('verify', firstId, 'memtest-v1');
    expect(v1).toContain('✔ 1/1 evidence tests pass');
    expect(v1).toContain('Status:   VERIFIED');
  });

  it('verify explains bad input instead of throwing', async () => {
    expect(await run('verify', firstId, 'memtest-v9')).toBe(
      'Unknown commit "memtest-v9". Available: memtest-v1, memtest-v2, memtest-v3, memtest-v4, memtest-v5.',
    );
    expect(await run('verify', 'mem_nope', 'memtest-v1')).toContain('No memory with id "mem_nope"');
    expect(await run('verify', firstId)).toContain('Usage: soa memory verify <id> <commit>');
  });

  it('check validates every stored note', async () => {
    const out = await run('check');
    expect(out).toContain('Status: 6/6 contracts valid');
    expect(out.match(/\[PASS\] RefinedMemory mem_/g)).toHaveLength(6);
  });

  it('stale-eval reports a 100% catch rate and no false alarms', async () => {
    const out = await run('stale-eval');
    expect(out).toContain('Stale-memory test set (16 cases)');
    expect(out).toMatch(/Catch rate: +100\.0% \(10\/10 stale notes caught\)/);
    expect(out).toContain('False alarms: 0');
    expect(out).toMatch(/Accuracy: +100\.0%/);
    expect(out).toMatch(/Avg time: +[\d.]+ ms per case/);
    expect(out).toContain('Test runner: fake runner');
  });
});

describe('soa memory with a broken note file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memory-cli-bad-'));
  const runBad = async (...args: string[]) =>
    stripAnsi(await runMemoryCommand(args, { storeDir: dir, runner: 'fake' }));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeAll(async () => {
    await runBad('seed');
    const notes = path.join(dir, 'memory/notes');
    const file = path.join(notes, fs.readdirSync(notes).sort()[0]!);
    const note = JSON.parse(fs.readFileSync(file, 'utf8'));
    note.verification.status = 'maybe';
    fs.writeFileSync(file, JSON.stringify(note));
  });

  it('check flags the invalid note', async () => {
    const out = await runBad('check');
    expect(out).toContain('Status: 5/6 contracts valid');
    expect(out).toContain('[FAIL]');
    expect(out).toContain('verification.status');
  });

  it('list reports the error as a message, not a stack trace', async () => {
    const out = await runBad('list');
    expect(out).toMatch(/^memory list failed: /);
    expect(out).not.toMatch(/\n\s+at /);
  });
});
