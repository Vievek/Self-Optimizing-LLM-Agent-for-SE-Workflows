import { OUTCOME_EVIDENCE_SCHEMA_VERSION } from '@soa/contracts';
import { TaskLoader } from '@soa/eval-harness';
import { MockExecCore, MockHeae } from '@soa/mocks';
import { renderRecordTable } from './components/record-table.js';
import { renderStageProgress, StageItem } from './components/stage-progress.js';
import { renderContractCheckPanel } from './components/contract-check-panel.js';
import { runContractHealthCheck } from './contract-health.js';
import { runOrchCommand } from './commands/orch/index.js';
import type { Store } from '@soa/store';

export type CommandHandler = (args: string[]) => Promise<string>;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandHandler>();
  private readonly store?: Store;

  constructor(options: { store?: Store } = {}) {
    this.store = options.store;
    this.registerDefaults();
  }

  register(command: string, handler: CommandHandler): void {
    this.commands.set(command.toLowerCase(), handler);
  }

  async execute(command: string, args: string[]): Promise<string> {
    const handler = this.commands.get(command.toLowerCase());
    if (!handler) {
      return this.renderHelp();
    }
    return handler(args);
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  private registerDefaults(): void {
    // 1. soa check - Run contract validation checks
    this.register('check', async () => {
      const results = runContractHealthCheck();
      return renderContractCheckPanel(results);
    });

    // 2. soa exec - Run Execution Core task execution view
    this.register('exec', async (args) => {
      const taskId = args[0] || 'django__django-11099';
      const exec = new MockExecCore();
      const { spans } = await exec.runTask(taskId);

      const stages: StageItem[] = [
        { name: 'Load Task', status: 'success' },
        { name: 'AST Retrieval', status: 'success' },
        { name: 'Route Tier', status: 'success', detail: 'SLM / LLM Router scored 0.88' },
        { name: 'Patch Generation', status: 'success' },
        { name: 'Verify in Sandbox', status: 'success', detail: '5/5 passed' },
      ];

      const progress = renderStageProgress(stages);

      const headers = ['Span ID', 'Name', 'Duration (ms)', 'Status', 'Attributes'];
      const rows = spans.map((s) => {
        const start = new Date(s.start_ts).getTime();
        const end = new Date(s.end_ts).getTime();
        return [
          s.span_id.slice(0, 8),
          s.name,
          end - start,
          s.status,
          JSON.stringify(s.attributes).slice(0, 30) + '...',
        ];
      });

      const table = renderRecordTable(headers, rows, `Task Execution: ${taskId}`);
      return `${progress}\n\n${table}`;
    });

    // 3. soa heae - Run HEAE evaluation view
    this.register('heae', async (args) => {
      const taskId = args[0] || 'django__django-11099';
      const heae = new MockHeae();
      const mockEvidence = {
        schema_version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
        evidence_id: 'ev_01J9X8ABCDEF0123456789ABCD',
        run_id: 'run_20261015T1000_baseline_01',
        task_id: taskId,
        trace_id: '0123456789abcdef0123456789abcdef',
        repo: 'django/django',
        base_commit: 'fb8b75e7a9b8f2d',
        outcome: { resolved: false, tests_passed: 4, tests_failed: 1, patch_applied: true },
        memory_uses: [],
        failure_labels: [{ class: 'tool' as const, node_ids: ['tool_1'], confidence: 0.92 }],
        cost: { tokens_in: 500, tokens_out: 120, wall_ms: 2500 },
      };

      const signals = await heae.evaluateAndAttribute(mockEvidence, []);

      const headers = ['Signal ID', 'Class', 'Axis', 'Target Path', 'Action', 'Confidence'];
      const rows = signals.map((s) => [
        s.signal_id,
        s.failure_class,
        s.target.axis,
        s.target.config_path,
        s.suggested_action,
        s.confidence,
      ]);

      return renderRecordTable(headers, rows, `HEAE Failure Attribution: ${taskId}`);
    });

    // 4. soa memory - Memory Agent TUI: soa memory <sub> [args]
    this.register('memory', async (args) => {
      const { runMemoryCommand } = await import('./commands/memory/index.js');
      return runMemoryCommand(args);
    });

    // 5. soa orch - Run Optimization Orchestrator view (Phase 1 TUI)
    this.register('orch', async (args) => {
      return runOrchCommand(args, this.store ? { store: this.store } : {});
    });

    // 6. soa bench - SWE-bench Lite subset overview
    this.register('bench', async () => {
      let taskLoader: TaskLoader;
      try {
        taskLoader = new TaskLoader();
      } catch (e) {
        return `Error loading bench tasks: ${e instanceof Error ? e.message : String(e)}`;
      }

      const pilot = taskLoader.getPilotTasks();
      const calibration = taskLoader.getCalibrationTasks();
      const core30 = taskLoader.getCore30Tasks();
      const sequence = taskLoader.getSequenceTasks();

      const headers = ['Subset Slice', 'Task Count', 'Purpose'];
      const rows = [
        ['pilot', pilot.length, '10-task feasibility & model pilot'],
        ['calibration', calibration.length, '20-task no-optimization baseline reference'],
        ['core-30', core30.length, '30-task slice for 4-condition memory comparison'],
        ['sequence', sequence.length, '60-task continual learning evolution sequence'],
      ];

      return renderRecordTable(
        headers,
        rows,
        `SWE-bench Lite Dataset (Total: ${taskLoader.size} tasks)`,
      );
    });

    // 7. soa tui - Launch or render interactive TUI views
    this.register('tui', async (args) => {
      const initialView = args[0] || 'exec';
      const { TuiApp } = await import('./tui/app.js');
      const app = new TuiApp(initialView);
      return app.renderCurrent();
    });
  }

  private renderHelp(): string {
    return `
Usage: soa <component> [args...]

Interactive TUI:
  soa                Launch interactive Claude Code-style TUI with LazyVim menu
  soa tui [module]   Launch interactive TUI focused on a module (exec, heae, memory, orch)

Available Components:
  soa check          Check status and schema compliance of all shared contracts
  soa exec [taskId]  Run execution trace and view stage progress & span tables
  soa heae [taskId]  Run HEAE failure attribution and view diagnostic signals
  soa memory <sub>   Memory notes: seed, list, show, verify, check, stale-eval
  soa orch [command] Process signals, inspect config history, audit, deploy, and roll back
  soa bench          Inspect SWE-bench Lite subset partitioning and task counts
`;
  }
}
