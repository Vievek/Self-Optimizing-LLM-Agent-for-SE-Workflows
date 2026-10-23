import type { MemoryVerificationStatus, RefinedMemory } from '@soa/contracts';
import type { MemoryDecision } from '@soa/memory-agent';
import type { KeyHint } from '../../components/app-bars.js';
import type { DashboardView, TuiState, ViewContext } from '../types.js';
import {
  ANSI,
  getTheme,
  highlightRow,
  renderBadge,
  renderPanels,
  renderPill,
  renderTopHeader,
  sectionLabel,
  spacer,
  toLines,
  vstack,
  type BadgeVariant,
  type PanelSpec,
  type ThemeColors,
} from '../../theme/index.js';
import {
  STAGE_CARD_HEIGHT,
  renderControlBar,
  renderMetricList,
  renderStageCard,
} from '../../components/index.js';
import { renderChecklist } from '../../commands/memory/verify.js';
import {
  MemoryData,
  type MemoryDataOptions,
  type RetrieveResult,
  type ScenarioReplay,
  type StaleEvalResult,
  type TestRunnerName,
  type VerifyResult,
} from './memory-data.js';

export const MEMORY_TABS = [
  'Pipeline',
  'Memories',
  'Verify',
  'Focus loop',
  'Retrieve',
  'Decision log',
] as const;

const TAB = {
  pipeline: 0,
  memories: 1,
  verify: 2,
  focus: 3,
  retrieve: 4,
  log: 5,
} as const;

/** The repo the fixture notes live in, and the query the Retrieve tab sends. */
const RETRIEVE_REPO = 'memtest/auth';
const RETRIEVE_QUERY = 'Reject usernames with a trailing newline';

interface Stage {
  name: string;
  done: boolean;
  badgeText: string;
  badgeVariant: BadgeVariant;
  desc: string;
  isHeadline?: boolean;
  /** Tab that shows this stage's real data (Enter jumps there). */
  tab?: number;
}

const STAGES: Stage[] = [
  {
    done: true,
    name: 'Focus working memory',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'start_focus -> explore -> complete_focus. Raw steps are dropped, learned summaries are kept.',
    tab: TAB.focus,
  },
  {
    done: true,
    name: 'Note construction',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'The small model writes Task / Problem / Cause / Files / Fix / Evidence. Retry once, then a rule-based fallback.',
    tab: TAB.memories,
  },
  {
    done: true,
    name: 'Linking',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'Links related cards by shared keywords, tags and files, same repo only.',
    tab: TAB.memories,
  },
  {
    done: true,
    name: 'Code-grounded verification',
    badgeText: 'HEADLINE · BUILT',
    badgeVariant: 'headline',
    desc: 'Fix line in the file + evidence tests at the task commit -> verified / stale / unverifiable / not applicable.',
    isHeadline: true,
    tab: TAB.verify,
  },
  {
    done: false,
    name: 'Reflection scoring',
    badgeText: 'NEXT PHASE',
    badgeVariant: 'phase',
    desc: 'Correctness and freshness from verification, plus relevance, evidence and task contribution.',
  },
  {
    done: false,
    name: 'Adaptive retention',
    badgeText: 'NEXT PHASE',
    badgeVariant: 'phase',
    desc: 'KEEP / STRENGTHEN / COMPRESS / DELETE based on status and score.',
  },
];

const STATUS_ORDER: MemoryVerificationStatus[] = [
  'verified',
  'stale',
  'unverifiable',
  'not_applicable',
];

const STATUS_BADGE: Record<MemoryVerificationStatus, BadgeVariant> = {
  verified: 'built',
  stale: 'error',
  unverifiable: 'warn',
  not_applicable: 'info',
};

function statusLabel(status: MemoryVerificationStatus): string {
  return status.replace('_', ' ').toUpperCase();
}

const BADGE_COLUMNS = 'NOT APPLICABLE'.length + 2;

function statusBadge(status: MemoryVerificationStatus, theme: ThemeColors, pad = false): string {
  const label = statusLabel(status);
  const badge = renderBadge(label, STATUS_BADGE[status], theme);
  return pad ? badge + ' '.repeat(Math.max(0, BADGE_COLUMNS - label.length - 2)) : badge;
}

function statusColor(status: MemoryVerificationStatus, theme: ThemeColors): string {
  return {
    verified: theme.success,
    stale: theme.danger,
    unverifiable: theme.warning,
    not_applicable: theme.accent,
  }[status];
}

/** Wraps plain text to `width` columns (long words are cut). */
function wrap(text: string, width: number): string[] {
  const w = Math.max(8, width);
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > w) {
        out.push(line);
        line = '';
      }
      line = line ? `${line} ${word}` : word.slice(0, w);
    }
    out.push(line);
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function runnerText(runner: TestRunnerName | undefined): string {
  if (runner === 'pytest') return 'real pytest';
  if (runner === 'fake') return 'fake runner (no pytest)';
  return 'not started';
}

export class MemoryDashboardView implements DashboardView {
  id = 'memory';
  name = 'Memory Agent';
  title = 'Code-grounded Memory Agent · P. Deepatharshan · IT23190184';
  tabs = [...MEMORY_TABS];

  private readonly dataOptions: MemoryDataOptions;
  private dataInstance?: MemoryData;

  private notes: RefinedMemory[] = [];
  private decisions: MemoryDecision[] = [];
  private staleEval?: StaleEvalResult;
  private replay?: ScenarioReplay;
  private replayPos = 0;
  private verifyCommit = 0;
  private retrieveCommit = 1;
  private verifyResult?: VerifyResult;
  private retrieveResult?: RetrieveResult;
  private snapshotLoaded = false;
  private prepared = false;

  constructor(options: MemoryDataOptions = {}) {
    this.dataOptions = options;
  }

  /** Created on first use, so building the app (and its tests) touches no files. */
  get data(): MemoryData {
    this.dataInstance ??= new MemoryData(this.dataOptions);
    return this.dataInstance;
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  /** Re-reads notes, the decision log and the cached stale eval from disk. */
  refresh(): void {
    this.notes = this.data.loadNotesSync();
    this.decisions = this.data.readDecisionLogSync(Number.POSITIVE_INFINITY);
    this.staleEval = this.data.readStaleEvalSync() ?? this.staleEval;
    this.snapshotLoaded = true;
  }

  private ensureSnapshot(): void {
    if (!this.snapshotLoaded) this.refresh();
  }

  /** Seeds an empty store, loads the replay and runs the stale eval once. */
  async prepare(): Promise<void> {
    await this.data.ensureSeeded();
    this.refresh();
    this.replay = await this.data.replayScenario();
    if (!this.staleEval) this.staleEval = await this.data.runStaleEval();
    this.refresh();
    this.prepared = true;
  }

  enter(ctx: ViewContext): void {
    if (this.prepared) return;
    void ctx.runTask(
      'Loading memory store',
      async () => {
        await this.prepare();
        return `Memory store ready · ${this.notes.length} memories`;
      },
      { expectedMs: 1500 },
    );
  }

  close(): void {
    this.dataInstance?.close();
  }

  private commits(): string[] {
    return this.data.commits();
  }

  private selectedNote(state: TuiState): RefinedMemory | undefined {
    return this.notes[Math.min(state.selectedItemIndex, this.notes.length - 1)];
  }

  /** Commit each note was last checked at, from the decision log. */
  private checkedAt(memory: RefinedMemory): string {
    const last = this.decisions.find((d) => d.memory_id === memory.memory_id);
    return last?.commit ?? memory.verified_at_commit;
  }

  private count(status: MemoryVerificationStatus): number {
    return this.notes.filter((m) => m.verification.status === status).length;
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  private tab(state: TuiState): number {
    return state.activeTab % this.tabs.length;
  }

  itemCount(state: TuiState): number {
    this.ensureSnapshot();
    switch (this.tab(state)) {
      case TAB.pipeline:
        return STAGES.length;
      case TAB.memories:
      case TAB.verify:
        return Math.max(1, this.notes.length);
      case TAB.log:
        return Math.max(1, Math.min(this.decisions.length, 50));
      default:
        return 1;
    }
  }

  handleKey(key: string, state: TuiState, ctx: ViewContext): boolean {
    this.ensureSnapshot();
    const tab = this.tab(state);
    const enter = key === 'return' || key === 'enter';
    const n = this.commits().length;

    switch (tab) {
      case TAB.pipeline: {
        if (key === 'r') {
          void ctx.runTask('Running stale-memory evaluation', async () => {
            this.staleEval = await this.data.runStaleEval();
            const s = this.staleEval.report.summary;
            return `Stale eval: catch rate ${pct(s.catchRate)}, accuracy ${pct(s.accuracy)}`;
          });
          return true;
        }
        if (enter) {
          const stage = STAGES[state.selectedItemIndex];
          if (stage?.tab !== undefined) {
            state.activeTab = stage.tab;
            state.selectedItemIndex = 0;
          }
          return true;
        }
        return false;
      }
      case TAB.memories:
      case TAB.log:
        if (key === 'r') {
          this.refresh();
          ctx.redraw();
          return true;
        }
        return false;
      case TAB.verify: {
        if ((key === 'left' || key === 'right') && n > 0) {
          this.verifyCommit = (this.verifyCommit + (key === 'right' ? 1 : n - 1)) % n;
          return true;
        }
        if (enter) {
          const note = this.selectedNote(state);
          const commit = this.commits()[this.verifyCommit];
          if (!note || !commit) return true;
          void ctx.runTask('Verifying memory', async () => {
            this.verifyResult = await this.data.verifyNote(note.memory_id, commit);
            this.refresh();
            const status = statusLabel(this.verifyResult.outcome.status);
            return `${note.memory_id} at ${commit}: ${status}`;
          });
          return true;
        }
        return false;
      }
      case TAB.focus: {
        if (key === 'n' || enter) {
          if (!this.replay) {
            void ctx.runTask('Replaying focus loop', async () => {
              this.replay = await this.data.replayScenario();
              this.replayPos = 1;
              return 'Scenario loaded';
            });
          } else if (this.replayPos < this.replay.steps.length) {
            this.replayPos++;
          }
          return true;
        }
        if (key === 'r') {
          this.replayPos = 0;
          return true;
        }
        return false;
      }
      case TAB.retrieve: {
        if ((key === 'left' || key === 'right') && n > 0) {
          this.retrieveCommit = (this.retrieveCommit + (key === 'right' ? 1 : n - 1)) % n;
          return true;
        }
        if (enter) {
          const commit = this.commits()[this.retrieveCommit];
          if (!commit) return true;
          void ctx.runTask('Re-checking memories', async () => {
            this.retrieveResult = await this.data.retrieve(RETRIEVE_QUERY, RETRIEVE_REPO, commit);
            this.refresh();
            const r = this.retrieveResult;
            return `Retrieve at ${commit}: ${r.returned} returned, ${r.filtered} filtered`;
          });
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  keyHints(state: TuiState): KeyHint[] {
    const h = (key: string, label: string, priority = 6): KeyHint => ({ key, label, priority });
    switch (this.tab(state)) {
      case TAB.pipeline:
        return [h('↑↓', 'stage', 3), h('↵', 'open'), h('r', 're-run eval')];
      case TAB.memories:
        return [h('↑↓', 'note'), h('r', 'reload', 3)];
      case TAB.verify:
        return [h('↑↓', 'note'), h('←→', 'commit'), h('↵', 'verify')];
      case TAB.focus:
        return [h('n', 'next step'), h('r', 'restart', 3)];
      case TAB.retrieve:
        return [h('←→', 'commit'), h('↵', 'retrieve')];
      default:
        return [h('↑↓', 'entry'), h('r', 'reload', 3)];
    }
  }

  status(state: TuiState): string {
    this.ensureSnapshot();
    const tab = this.tabs[this.tab(state)] ?? 'Pipeline';
    return (
      `${tab} · ${this.notes.length} memories · ${this.count('verified')} verified · ` +
      `${this.count('stale')} stale`
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(state: TuiState): string {
    this.ensureSnapshot();
    const theme = getTheme(state.theme);
    const { width, height } = state;

    const header = renderTopHeader('soa memory', this.title, 'LIVE · fixture repos', theme, width);
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      theme,
      width,
    });

    const [left, right, ratio] = this.panelsFor(state, theme);
    const panels = (h: number) => renderPanels(left, right, { width, height: h, ratio, theme });

    const gap = spacer(height);
    return vstack(
      [toLines(header), gap, toLines(controlRow), gap, { grow: 1, render: panels }],
      width,
      height,
    ).join('\n');
  }

  private panelsFor(state: TuiState, theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    switch (this.tab(state)) {
      case TAB.memories:
        return this.memoriesPanels(state, theme);
      case TAB.verify:
        return this.verifyPanels(state, theme);
      case TAB.focus:
        return this.focusPanels(theme);
      case TAB.retrieve:
        return this.retrievePanels(theme);
      case TAB.log:
        return this.logPanels(state, theme);
      default:
        return this.pipelinePanels(state, theme);
    }
  }

  private emptyStore(theme: ThemeColors): string[] {
    return [
      '',
      `  ${theme.fgMuted}No memories in ${this.data.storeDir}.${ANSI.reset}`,
      `  ${theme.fgMuted}Opening the dashboard seeds it (same as "soa memory seed").${ANSI.reset}`,
    ];
  }

  // --- Pipeline -------------------------------------------------------------

  private pipelinePanels(state: TuiState, theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const selected = state.selectedItemIndex;
    const buildCards = (innerWidth: number) =>
      STAGES.flatMap((stage, i) =>
        toLines(
          renderStageCard({
            ...stage,
            selected: i === selected,
            width: Math.max(4, innerWidth - 2),
            theme,
          }),
        ).map((line) => ` ${line}`),
      );

    const buildStore = (innerWidth: number) => {
      const rightWidth = innerWidth + 2;
      const total = this.notes.length;
      const rule = `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`;
      const row = (label: string, value: string) =>
        `  ${theme.fgMuted}${label.padEnd(14)}${ANSI.reset}${theme.fg}${ANSI.bold}${value}${ANSI.reset}`;
      const links = this.notes.reduce((sum, m) => sum + m.links.length, 0);

      const lines = [
        sectionLabel('Store', theme),
        '',
        ...renderMetricList(
          STATUS_ORDER.map((s) => ({
            badge: statusLabel(s),
            variant: STATUS_BADGE[s],
            value: this.count(s),
          })),
          rightWidth - 6,
          theme,
          { total: Math.max(1, total) },
        ),
        '',
        row('memories', String(total)),
        row('links', String(links)),
        row('decisions', `${this.decisions.length} logged`),
        '',
        rule,
        '',
        sectionLabel('Stale-memory evaluation', theme),
        '',
      ];

      const ev = this.staleEval;
      if (ev) {
        const s = ev.report.summary;
        lines.push(
          row('catch rate', `${pct(s.catchRate)} (${s.staleCaught}/${s.staleExpected} caught)`),
          row('false alarms', `${s.falseAlarms} of ${s.verifiedExpected} verified`),
          row('accuracy', `${pct(s.accuracy)} (${s.correct}/${s.total})`),
          row('avg check', `${s.avgDurationMs.toFixed(1)} ms · 0 model tokens`),
          row('runner', runnerText(ev.runner)),
          `  ${theme.fgDim}ran ${ev.ranAt.slice(0, 16).replace('T', ' ')} UTC · [r] re-run${ANSI.reset}`,
        );
      } else {
        lines.push(`  ${theme.fgMuted}Not run yet · press r to run it${ANSI.reset}`);
      }

      const commits = this.commits();
      lines.push(
        '',
        rule,
        '',
        sectionLabel('Repo status', theme),
        '',
        `  ${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✓ ${ANSI.reset} ${theme.fg}${RETRIEVE_REPO}${ANSI.reset} ${theme.fgMuted}· fixture repo${ANSI.reset}`,
        `  ${theme.fgMuted}  commits ${commits[0] ?? '?'} … ${commits.at(-1) ?? '?'} (${commits.length})${ANSI.reset}`,
        `  ${theme.fgDim} - scoring, retention · next phase${ANSI.reset}`,
      );
      return lines;
    };

    return [
      {
        title: 'Pipeline',
        active: true,
        build: buildCards,
        focus: [selected * STAGE_CARD_HEIGHT, (selected + 1) * STAGE_CARD_HEIGHT],
      },
      { build: buildStore },
      0.62,
    ];
  }

  // --- Memories -------------------------------------------------------------

  private noteRows(
    state: TuiState,
    theme: ThemeColors,
    innerWidth: number,
    focusIndex: number,
  ): string[] {
    if (this.notes.length === 0) return this.emptyStore(theme);
    return this.notes.map((m, i) => {
      const badge = statusBadge(m.verification.status, theme, true);
      const task = m.note.task.replace(/\s+/g, ' ');
      const line = ` ${i === focusIndex ? '▸' : ' '} ${theme.fg}${m.memory_id}${ANSI.reset}  ${badge}  ${theme.fgMuted}${task}${ANSI.reset}`;
      return i === focusIndex ? highlightRow(line, innerWidth, theme) : line;
    });
  }

  private memoriesPanels(state: TuiState, theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const index = Math.min(state.selectedItemIndex, Math.max(0, this.notes.length - 1));
    const note = this.notes[index];
    return [
      {
        title: `Memories · ${this.notes.length}`,
        active: true,
        build: (w) => this.noteRows(state, theme, w, index),
        focus: [index, index + 1],
      },
      {
        title: 'Memory card',
        build: (w) => (note ? this.card(note, theme, w) : this.emptyStore(theme)),
      },
      0.5,
    ];
  }

  private card(m: RefinedMemory, theme: ThemeColors, innerWidth: number): string[] {
    const labelWidth = 16;
    const valueWidth = Math.max(10, innerWidth - labelWidth - 3);
    const field = (label: string, value: string | string[], color = theme.fg): string[] => {
      const values = (Array.isArray(value) ? value : [value]).flatMap((v) =>
        v.trim() === '' ? [] : wrap(v, valueWidth),
      );
      const shown = values.length ? values : ['(none)'];
      const c = values.length ? color : theme.fgDim;
      return shown.map(
        (v, i) =>
          ` ${theme.fgMuted}${(i === 0 ? label : '').padEnd(labelWidth)}${ANSI.reset} ${c}${v}${ANSI.reset}`,
      );
    };
    const n = m.note;
    const status = m.verification.status;
    return [
      ` ${theme.accent}${ANSI.bold}${m.memory_id}${ANSI.reset}  ${statusBadge(status, theme)}`,
      ...field('Repo', m.repo),
      ...field('Source task', m.source_task_id),
      '',
      ...field('Task', n.task),
      ...field('Problem', n.problem),
      ...field('Cause', n.cause),
      ...field('Files', n.files),
      ...field('Fix', n.fix),
      ...field('Fix snippet', n.fix_snippet),
      ...field('Evidence', n.evidence),
      ...field('Evidence tests', n.evidence_tests),
      ...field('Keywords', n.keywords.join(', ')),
      ...field('Tags', n.tags.join(', ')),
      ...field('Links', m.links),
      '',
      ` ${sectionLabel('Verification', theme)}`,
      ...field('Status', statusLabel(status), statusColor(status, theme)),
      ...field('Details', m.verification.details),
      ...field('Checked at', `${this.checkedAt(m)} (${m.verification.checked_at.slice(0, 19)})`),
      ...field('Verified commit', m.verified_at_commit),
      '',
      ...field('Score', '— next phase', theme.fgDim),
      ...field('Action', '— next phase', theme.fgDim),
      ...field('Lifecycle', m.lifecycle),
      ...field('Use count', String(m.use_count)),
    ];
  }

  // --- Verify ---------------------------------------------------------------

  private commitPicker(selected: number, theme: ThemeColors): string {
    const pills = this.commits().map((c, i) => renderPill(c, i === selected, theme));
    return ` ${theme.fgMuted}commit${ANSI.reset} ${theme.accent}◀${ANSI.reset} ${pills.join(' ')} ${theme.accent}▶${ANSI.reset}`;
  }

  private verifyPanels(state: TuiState, theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const index = Math.min(state.selectedItemIndex, Math.max(0, this.notes.length - 1));
    const note = this.notes[index];
    const commit = this.commits()[this.verifyCommit] ?? '';
    const head = [this.commitPicker(this.verifyCommit, theme), ''];

    const buildResult = (innerWidth: number): string[] => {
      if (!note) return this.emptyStore(theme);
      const r = this.verifyResult;
      const fresh = r && r.memory.memory_id === note.memory_id && r.commit === commit;
      if (!fresh) {
        const s = note.verification.status;
        return [
          ` ${theme.fg}${ANSI.bold}${note.memory_id}${ANSI.reset} ${theme.fgMuted}at${ANSI.reset} ${theme.accent}${commit}${ANSI.reset}`,
          '',
          ` ${theme.fgMuted}Press${ANSI.reset} ${theme.accent}↵${ANSI.reset} ${theme.fgMuted}to run the code verifier on the fixture repo.${ANSI.reset}`,
          '',
          ` ${theme.fgMuted}Stored status${ANSI.reset}  ${statusBadge(s, theme)} ${theme.fgDim}checked at ${this.checkedAt(note)}${ANSI.reset}`,
          ...wrap(note.verification.details, innerWidth - 2).map(
            (l) => `  ${theme.fgDim}${l}${ANSI.reset}`,
          ),
        ];
      }
      const o = r.outcome;
      return [
        ` ${theme.fg}${ANSI.bold}Verify ${r.memory.memory_id} at ${r.commit}${ANSI.reset}`,
        ` ${theme.fgDim}Task: ${r.memory.note.task}${ANSI.reset}`,
        '',
        ...renderChecklist(r.memory.note, o),
        '',
        ` ${theme.fgMuted}Status   ${ANSI.reset}${statusBadge(o.status, theme)}`,
        ...wrap(o.details, innerWidth - 11).map(
          (l, i) =>
            ` ${theme.fgMuted}${i === 0 ? 'Details  ' : '         '}${ANSI.reset}${theme.fg}${l}${ANSI.reset}`,
        ),
        ` ${theme.fgMuted}Time     ${ANSI.reset}${theme.fg}${o.durationMs} ms · ${r.tokens} model tokens${ANSI.reset}`,
        ` ${theme.fgMuted}Runner   ${ANSI.reset}${theme.fg}${runnerText(r.runner)}${ANSI.reset}`,
        '',
        ` ${theme.fgDim}Saved to the store and logged to logs/memory-decisions.jsonl.${ANSI.reset}`,
      ];
    };

    return [
      {
        title: 'Pick a memory',
        active: true,
        build: (w) => [...head, ...this.noteRows(state, theme, w, index)],
        focus: [head.length + index, head.length + index + 1],
      },
      { title: 'Code verifier', build: buildResult },
      0.5,
    ];
  }

  // --- Focus loop -----------------------------------------------------------

  private focusPanels(theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const replay = this.replay;
    const shown = replay ? replay.steps.slice(0, this.replayPos) : [];
    const finished = replay !== undefined && this.replayPos >= replay.steps.length;

    const buildSteps = (innerWidth: number): string[] => {
      if (!replay) {
        return ['', ` ${theme.fgMuted}Press n to replay scenario username-regex.${ANSI.reset}`];
      }
      const lines = [
        ` ${theme.fgMuted}${replay.taskId} · ${replay.repo} @ ${replay.baseCommit}${ANSI.reset}`,
        '',
      ];
      if (shown.length === 0) {
        lines.push(` ${theme.fgMuted}Press n to take the first step.${ANSI.reset}`);
      }
      shown.forEach((s, i) => {
        const tag = { start: 'START', explore: 'EXPLORE', complete: 'DONE' }[s.kind];
        const color = { start: theme.accent, explore: theme.fg, complete: theme.success }[s.kind];
        const line = ` ${theme.fgDim}${String(i + 1).padStart(2, '0')}${ANSI.reset} ${color}${ANSI.bold}${tag.padEnd(7)}${ANSI.reset} ${theme.fgMuted}ctx ${s.contextSize}${ANSI.reset}  ${theme.fg}${s.text}${ANSI.reset}`;
        lines.push(i === shown.length - 1 ? highlightRow(line, innerWidth, theme) : line);
      });
      return lines;
    };

    const buildChart = (innerWidth: number): string[] => {
      if (!replay) return [sectionLabel('Context size', theme)];
      const sizes = replay.steps.map((s) => s.contextSize);
      const max = Math.max(1, ...sizes);
      const colWidth = Math.max(1, Math.min(3, Math.floor((innerWidth - 6) / sizes.length)));
      const chart: string[] = [];
      for (let level = max; level >= 1; level--) {
        const cells = sizes.map((size, i) => {
          if (i >= this.replayPos) return ' '.repeat(colWidth);
          const filled = size >= level;
          const color = replay.steps[i]!.kind === 'complete' ? theme.success : theme.accent;
          return filled
            ? `${color}${'█'.repeat(colWidth - (colWidth > 1 ? 1 : 0))}${ANSI.reset}${colWidth > 1 ? ' ' : ''}`
            : ' '.repeat(colWidth);
        });
        chart.push(` ${theme.fgDim}${String(level).padStart(2)}│${ANSI.reset}${cells.join('')}`);
      }
      chart.push(` ${theme.fgDim}  └${'─'.repeat(sizes.length * colWidth)}${ANSI.reset}`);

      const lines = [
        sectionLabel('Context size per step', theme),
        '',
        ...chart,
        ` ${theme.fgDim}raw steps grow inside a focus block, then collapse to one summary${ANSI.reset}`,
        '',
        ` ${theme.fgMuted}step ${this.replayPos}/${replay.steps.length}${ANSI.reset}`,
      ];
      if (finished) {
        const sum = replay.summary;
        lines.push(
          '',
          sectionLabel('Consolidated task summary', theme),
          '',
          ` ${theme.fgMuted}task ${sum.taskId} · ${sum.repo} @ ${sum.baseCommit} · resolved ${sum.resolved}${ANSI.reset}`,
          '',
        );
        for (const note of sum.notes) {
          for (const l of note.split('\n')) {
            lines.push(...wrap(l, innerWidth - 2).map((w) => ` ${theme.fg}${w}${ANSI.reset}`));
          }
          lines.push('');
        }
      }
      return lines;
    };

    const focusLine = shown.length + 1;
    return [
      { title: 'Focus loop', active: true, build: buildSteps, focus: [focusLine, focusLine + 1] },
      { build: buildChart },
      0.55,
    ];
  }

  // --- Retrieve -------------------------------------------------------------

  private retrievePanels(theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const commit = this.commits()[this.retrieveCommit] ?? '';
    const r =
      this.retrieveResult && this.retrieveResult.commit === commit
        ? this.retrieveResult
        : undefined;

    const buildCandidates = (): string[] => {
      const lines = [
        this.commitPicker(this.retrieveCommit, theme),
        '',
        ` ${theme.fgMuted}query${ANSI.reset}  ${theme.fg}"${RETRIEVE_QUERY}"${ANSI.reset}`,
        ` ${theme.fgMuted}repo${ANSI.reset}   ${theme.fg}${RETRIEVE_REPO}${ANSI.reset}`,
        '',
      ];
      if (!r) {
        lines.push(
          ` ${theme.fgMuted}Press${ANSI.reset} ${theme.accent}↵${ANSI.reset} ${theme.fgMuted}to retrieve as a new task at ${commit}: every candidate is re-checked first.${ANSI.reset}`,
        );
        return lines;
      }
      for (const c of r.candidates) {
        const s = c.memory.verification.status;
        const verdict = c.returned
          ? `${theme.success}${ANSI.bold}→ returned${ANSI.reset}`
          : s === 'stale'
            ? `${theme.danger}${ANSI.bold}✖ filtered (stale)${ANSI.reset}`
            : `${theme.fgDim}· not returned (limit)${ANSI.reset}`;
        lines.push(
          ` ${theme.fg}${c.memory.memory_id}${ANSI.reset}  ${statusBadge(s, theme, true)} ${verdict}  ${theme.fgDim}${c.memory.note.task}${ANSI.reset}`,
        );
      }
      lines.push(
        '',
        ` ${theme.fg}${ANSI.bold}${r.candidates.length} candidates · ${r.returned} returned · ${r.filtered} filtered (stale)${ANSI.reset}`,
      );
      return lines;
    };

    const buildTotals = (): string[] => {
      const row = (label: string, value: string) =>
        `  ${theme.fgMuted}${label.padEnd(12)}${ANSI.reset}${theme.fg}${ANSI.bold}${value}${ANSI.reset}`;
      const lines = [sectionLabel('Totals', theme), ''];
      if (r) {
        lines.push(
          row('candidates', String(r.candidates.length)),
          row('returned', String(r.returned)),
          row('filtered', `${r.filtered} stale`),
          row('time', `${r.durationMs} ms · 0 model tokens`),
          row('runner', runnerText(r.runner)),
        );
      } else {
        lines.push(`  ${theme.fgMuted}Not run at ${commit} yet.${ANSI.reset}`);
      }
      lines.push(
        '',
        sectionLabel('How retrieve works', theme),
        '',
        `  ${theme.fgMuted}1. list notes for the repo${ANSI.reset}`,
        `  ${theme.fgMuted}2. re-verify each at the new commit${ANSI.reset}`,
        `  ${theme.fgMuted}3. drop stale notes, rank the rest${ANSI.reset}`,
        `  ${theme.fgMuted}4. return the top 5 (retrieve limit)${ANSI.reset}`,
      );
      return lines;
    };

    return [
      { title: 'Retrieve', active: true, build: buildCandidates },
      { build: buildTotals },
      0.68,
    ];
  }

  // --- Decision log ---------------------------------------------------------

  private logPanels(state: TuiState, theme: ThemeColors): [PanelSpec, PanelSpec, number] {
    const entries = this.decisions.slice(0, 50);
    const index = Math.min(state.selectedItemIndex, Math.max(0, entries.length - 1));
    const selected = entries[index];

    const buildLog = (innerWidth: number): string[] => {
      if (entries.length === 0) {
        return ['', ` ${theme.fgMuted}No decisions logged yet.${ANSI.reset}`];
      }
      return entries.map((d, i) => {
        const time = d.ts.slice(11, 19);
        const line =
          ` ${theme.fgDim}${time}${ANSI.reset} ${theme.fgMuted}${d.phase.padEnd(12)}${ANSI.reset}` +
          `${theme.fg}${d.memory_id}${ANSI.reset} ${theme.accent}${d.commit}${ANSI.reset} ` +
          `${statusColor(d.status, theme)}${ANSI.bold}${statusLabel(d.status)}${ANSI.reset}`;
        return i === index ? highlightRow(line, innerWidth, theme) : line;
      });
    };

    const buildDetail = (innerWidth: number): string[] => {
      const lines = [
        sectionLabel('Entry', theme),
        '',
        ` ${theme.fgMuted}${this.decisions.length} lines · newest first${ANSI.reset}`,
        ` ${theme.fgDim}logs/memory-decisions.jsonl${ANSI.reset}`,
        '',
      ];
      if (!selected) return lines;
      const row = (label: string, value: string) =>
        ` ${theme.fgMuted}${label.padEnd(10)}${ANSI.reset}${theme.fg}${value}${ANSI.reset}`;
      lines.push(
        row('time', selected.ts),
        row('phase', selected.phase),
        row('memory', selected.memory_id),
        row('repo', selected.repo),
        row('commit', selected.commit),
        ` ${theme.fgMuted}${'status'.padEnd(10)}${ANSI.reset}${statusBadge(selected.status, theme)}`,
        row('duration', `${selected.durationMs} ms`),
        '',
        ...wrap(selected.details, innerWidth - 2).map((l) => ` ${theme.fg}${l}${ANSI.reset}`),
      );
      return lines;
    };

    return [
      { title: 'Decision log', active: true, build: buildLog, focus: [index, index + 1] },
      { build: buildDetail },
      0.6,
    ];
  }
}
