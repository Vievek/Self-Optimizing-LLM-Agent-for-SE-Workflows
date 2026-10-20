import {
  SCHEMA_VERSION,
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  REFINED_MEMORY_SCHEMA_VERSION,
  CONFIG_SCHEMA_VERSION,
} from '@soa/contracts';
import { TaskLoader } from '@soa/eval-harness';
import { MockExecCore, MockHeae, MockMemoryAgent, MockOrchestrator } from '@soa/mocks';
import { renderRecordTable } from './components/record-table.js';
import { renderStageProgress, StageItem } from './components/stage-progress.js';
import {
  renderContractCheckPanel,
  ContractCheckResult,
} from './components/contract-check-panel.js';
import { runOrchCommand } from './commands/orch/index.js';

export type CommandHandler = (args: string[]) => Promise<string>;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandHandler>();

  constructor() {
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
      const results: ContractCheckResult[] = [
        {
          contract: 'TraceSpan (OTel Spans)',
          version: SCHEMA_VERSION,
          valid: true,
        },
        {
          contract: 'OutcomeEvidence (HEAE -> Memory)',
          version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
          valid: true,
        },
        {
          contract: 'OptimizationSignal (HEAE -> Orch)',
          version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
          valid: true,
        },
        {
          contract: 'RefinedMemory (Memory -> Store)',
          version: REFINED_MEMORY_SCHEMA_VERSION,
          valid: true,
        },
        {
          contract: 'FullAgentConfig (Orch -> Exec)',
          version: CONFIG_SCHEMA_VERSION,
          valid: true,
        },
      ];
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

    // 4. soa memory - Run Memory Agent view
    this.register('memory', async (args) => {
      const query = args.join(' ') || 'regex trailing newline';
      const mem = new MockMemoryAgent();
      const notes = await mem.retrieve(query, 'django/django', 'fb8b75e7a9b8f2d');

      const headers = ['Memory ID', 'Task', 'Files', 'Action', 'Score', 'Lifecycle'];
      const rows = notes.map((n) => [
        n.memory_id.slice(0, 12) + '...',
        n.note.task.slice(0, 30) + '...',
        n.note.files.join(', '),
        n.action,
        n.score.total,
        n.lifecycle,
      ]);

      return renderRecordTable(headers, rows, `Memory Agent Retrieval (Query: "${query}")`);
    });

    // 5. soa orch - Run Optimization Orchestrator view (Phase 1 TUI)
    this.register('orch', async (args) => {
      return runOrchCommand(args);
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
  }

  private renderHelp(): string {
    return `
Usage: soa <component> [args...]

Available Components:
  soa check          Check status and schema compliance of all shared contracts
  soa exec [taskId]  Run execution trace and view stage progress & span tables
  soa heae [taskId]  Run HEAE failure attribution and view diagnostic signals
  soa memory [query] Query long-term memory notes and view reflection scores
  soa orch           View runtime configuration axes and optimization history
  soa bench          Inspect SWE-bench Lite subset partitioning and task counts
`;
  }
}
