import fs from 'node:fs';
import path from 'node:path';
import { autoLoadEnv } from '../../../env.js';
import { TraceSpanSchema, type TraceSpan } from '@soa/contracts';
import { AgentRunner, createReActLlmCaller, WorkspaceGraphBuilder } from '@soa/exec-core';
import { ProviderRegistry } from '@soa/llm';
import { FixtureSandboxService } from '@soa/sandbox';
import { getWorkspaceAstNodes } from '../views/ast-graph-view.js';
import { exportReportToFile } from './clipboard-service.js';

// Ensure workspace .env is loaded
autoLoadEnv();

export interface ExecLiveTurn {
  turnIndex: number;
  thought?: string;
  action?: string;
  actionInput?: Record<string, unknown> | string;
  observation?: string;
  status: 'running' | 'ok' | 'error';
}

export type TaskIntentType =
  | 'full_scaffold'
  | 'single_bug'
  | 'multi_bug'
  | 'explain_only'
  | 'analyze_bug';

export interface ExecPipelineStage {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  goal?: string;
}

export interface ExecLiveState {
  taskId: string;
  prompt: string;
  targetDir: string;
  taskIntent: TaskIntentType;
  stages: ExecPipelineStage[];
  activeStageIndex: number;
  currentPhase: 'explore' | 'localize' | 'edit' | 'test' | 'verify' | 'idle';
  phaseStatuses: Record<string, 'pending' | 'running' | 'success' | 'failed'>;
  activeTier: 'SLM' | 'LLM';
  activeModel: string;
  routerScore: number;
  thinking: string;
  turns: ExecLiveTurn[];
  spans: TraceSpan[];
  tokensIn: number;
  tokensOut: number;
  retryCount: number;
  patchDiff?: string;
  patchHash?: string;
  finalAnswer?: string;
  resolved?: boolean;
  statusText: string;
  isExecuting: boolean;
  isInsertMode?: boolean;
  lastCompletedPrompt?: string;
  startTime?: number;
  durationMs?: number;
  contractSummary?: {
    contractText?: string;
    entities?: string[];
    targetFiles?: string[];
    endpoints?: string[];
  };
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms <= 0) return '0.0s';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remainingSec = Math.floor(sec % 60);
  return `${mins}m ${remainingSec}s`;
}

export interface SavedTraceSummary {
  id: string;
  filename: string;
  timestamp: number;
  dateStr: string;
  prompt: string;
  intent: TaskIntentType;
  resolved?: boolean;
  turnCount: number;
}

export function createDefaultStages(): ExecPipelineStage[] {
  return [
    { id: 'explore', name: 'Explore', status: 'pending' },
    { id: 'localize', name: 'Localize', status: 'pending' },
    { id: 'edit', name: 'Edit Patch', status: 'pending' },
    { id: 'test', name: 'Test Sandbox', status: 'pending' },
    { id: 'verify', name: 'Verify Patch', status: 'pending' },
  ];
}

export function determinePipelineStages(_prompt?: string): {
  intent: TaskIntentType;
  stages: ExecPipelineStage[];
} {
  return {
    intent: 'single_bug',
    stages: createDefaultStages(),
  };
}

export function correlateTurnsWithSpans(turns: ExecLiveTurn[], spans: TraceSpan[]): void {
  const toolSpans = (spans || []).filter((s) => s.name === 'tool_call');
  let toolSpanIdx = 0;
  for (const turn of turns) {
    if (turn.action && turn.action !== 'reasoning' && toolSpanIdx < toolSpans.length) {
      const matchingSpan = toolSpans[toolSpanIdx++];
      if (!turn.actionInput && matchingSpan?.attributes?.args) {
        turn.actionInput = matchingSpan.attributes.args as Record<string, unknown>;
      }
      if (!turn.observation) {
        const toolName = matchingSpan?.attributes?.tool_name ?? turn.action;
        if (matchingSpan?.attributes?.error) {
          turn.observation = `Error: ${matchingSpan.attributes.error}`;
          turn.status = 'error';
        } else if (turn.action === 'write_file') {
          const files = (matchingSpan?.attributes?.args as any)?.files;
          const pathArg = (matchingSpan?.attributes?.args as any)?.path;
          if (Array.isArray(files)) {
            const list = files.map((f: any) => f.path || f).join(', ');
            turn.observation = `Successfully wrote ${files.length} file(s): ${list}`;
          } else if (pathArg) {
            turn.observation = `Successfully wrote file: ${pathArg}`;
          } else {
            turn.observation = `Tool ${toolName} completed successfully`;
          }
        } else if (turn.action === 'list_directory') {
          const pathArg = (matchingSpan?.attributes?.args as any)?.path ?? '.';
          turn.observation = `Inspected workspace directory '${pathArg}'`;
        } else if (turn.action === 'read_file') {
          const pathArg = (matchingSpan?.attributes?.args as any)?.path;
          turn.observation = `Read contents of ${pathArg}`;
        } else {
          turn.observation = `Tool ${toolName} completed successfully (${matchingSpan?.attributes?.latency_ms ?? 0}ms)`;
        }
      }
    }
  }
}

export class ExecRunnerService {
  private static instance: ExecRunnerService;
  private state: ExecLiveState;
  private listeners: Array<(state: ExecLiveState) => void> = [];

  private constructor() {
    this.state = this.createDefaultState();
  }

  static getInstance(): ExecRunnerService {
    if (!ExecRunnerService.instance) {
      ExecRunnerService.instance = new ExecRunnerService();
    }
    return ExecRunnerService.instance;
  }

  getState(): ExecLiveState {
    return this.state;
  }

  subscribe(listener: (state: ExecLiveState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Safe dispatch
      }
    }
  }

  updateStatus(status: string): void {
    this.state.statusText = status;
    this.notify();
  }

  setInsertMode(active: boolean): void {
    this.state.isInsertMode = active;
    this.notify();
  }

  setPrompt(prompt: string): void {
    this.state.prompt = prompt;
    this.notify();
  }

  appendPromptChar(char: string): void {
    this.state.prompt += char;
    this.notify();
  }

  backspacePrompt(): void {
    this.state.prompt = this.state.prompt.slice(0, -1);
    this.notify();
  }

  clearPrompt(): void {
    this.state.prompt = '';
    this.notify();
  }

  private createDefaultState(): ExecLiveState {
    const { intent, stages } = determinePipelineStages('');
    return {
      taskId: 'task_' + Date.now(),
      prompt: '',
      targetDir: process.cwd(),
      taskIntent: intent,
      stages,
      activeStageIndex: 0,
      currentPhase: 'idle',
      phaseStatuses: {
        explore: 'pending',
        localize: 'pending',
        edit: 'pending',
        test: 'pending',
        verify: 'pending',
      },
      activeTier: 'SLM',
      activeModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      routerScore: 0.0,
      thinking: '',
      turns: [],
      spans: [],
      tokensIn: 0,
      tokensOut: 0,
      retryCount: 0,
      patchDiff: undefined,
      patchHash: undefined,
      finalAnswer: undefined,
      resolved: undefined,
      statusText: 'Ready · Press [i] or [Enter] to insert prompt and run',
      isExecuting: false,
      contractSummary: undefined,
      isInsertMode: false,
      lastCompletedPrompt: undefined,
      startTime: undefined,
      durationMs: undefined,
    };
  }

  /** Resets state back to a completely clean, fresh session */
  resetToFresh(): void {
    this.state = this.createDefaultState();
    this.notify();
  }

  /** Gets count of saved trace files in the workspace */
  getSavedTracesCount(workspaceDir: string = process.cwd()): number {
    try {
      const traceDir = path.join(workspaceDir, '.soa', 'traces');
      if (!fs.existsSync(traceDir)) return 0;
      return fs.readdirSync(traceDir).filter((f) => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /** Lists all saved traces in <targetDir>/.soa/traces/ sorted by date descending */
  listAllTraces(targetDir: string = process.cwd()): SavedTraceSummary[] {
    try {
      const traceDir = path.join(targetDir, '.soa', 'traces');
      if (!fs.existsSync(traceDir)) return [];
      const files = fs.readdirSync(traceDir).filter((f) => f.endsWith('.json') && f !== 'latest.json');
      const summaries: SavedTraceSummary[] = [];

      for (const f of files) {
        try {
          const fullPath = path.join(traceDir, f);
          const raw = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(raw);
          const stat = fs.statSync(fullPath);
          summaries.push({
            id: f.replace('.json', ''),
            filename: f,
            timestamp: stat.mtimeMs,
            dateStr: new Date(stat.mtimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            prompt: data.prompt || '(empty prompt)',
            intent: (data.intent as TaskIntentType) || 'single_bug',
            resolved: data.resolved,
            turnCount: Array.isArray(data.turns) ? data.turns.length : 0,
          });
        } catch {}
      }

      summaries.sort((a, b) => b.timestamp - a.timestamp);
      return summaries;
    } catch {
      return [];
    }
  }

  /** Loads a specific trace file into state */
  loadTraceFile(filename: string, targetDir: string = process.cwd()): boolean {
    try {
      const filePath = path.join(targetDir, '.soa', 'traces', filename);
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);

      this.state.lastCompletedPrompt = data.prompt || '';
      this.state.prompt = '';
      this.state.thinking = '';
      this.state.taskId = data.taskId || ('task_' + Date.now());
      this.state.targetDir = targetDir;
      this.state.taskIntent = (data.intent as TaskIntentType) || 'single_bug';
      this.state.finalAnswer = data.finalAnswer;
      this.state.resolved = data.resolved;
      this.state.tokensIn = data.tokensIn || 0;
      this.state.tokensOut = data.tokensOut || 0;
      this.state.durationMs = data.durationMs;
      if (!this.state.durationMs && Array.isArray(data.spans) && data.spans.length > 0) {
        const first = new Date(data.spans[0].start_ts).getTime();
        const last = new Date(data.spans[data.spans.length - 1].end_ts).getTime();
        if (!isNaN(first) && !isNaN(last) && last >= first) {
          this.state.durationMs = last - first;
        }
      }
      this.state.patchDiff = data.patchDiff;
      this.state.patchHash = data.patchHash;
      this.state.spans = data.spans || [];
      this.state.turns = data.turns || [];
      this.state.contractSummary = data.contractSummary;
      this.state.stages = (data.stages && data.stages.length > 0)
        ? data.stages
        : createDefaultStages();
      correlateTurnsWithSpans(this.state.turns, this.state.spans);
      const durStr = formatDuration(this.state.durationMs);
      this.state.statusText = `Loaded trace [${filename}] · ${this.state.turns.length} turns · ${durStr}`;
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  /** Explicitly loads recent execution traces on user demand */
  loadRecentTrace(workspaceDir: string = process.cwd()): boolean {
    return this.loadTraceFile('latest.json', workspaceDir);
  }

  /**
   * Executes the autonomous SE agent workflow via real @soa/exec-core runner.
   * Pure presentation bridge: delegates planning, routing, and tool execution to AgentRunner.
   */
  async executeTask(prompt: string, targetWorkspace?: string): Promise<ExecLiveState> {
    const targetDir = targetWorkspace ? path.resolve(targetWorkspace) : process.cwd();
    const taskId = `task_${Date.now()}`;
    const wsId = `ws_${taskId}`;
    const startMs = Date.now();

    this.state.isExecuting = true;
    this.state.isInsertMode = false;
    this.state.startTime = startMs;
    this.state.durationMs = undefined;
    this.state.taskId = taskId;
    this.state.prompt = prompt;
    this.state.targetDir = targetDir;
    this.state.stages = createDefaultStages();
    this.state.activeStageIndex = 0;
    this.state.currentPhase = 'explore';
    this.state.statusText = 'Analyzing request and initializing agent...';
    this.state.turns = [];
    this.state.spans = [];
    this.state.finalAnswer = undefined;
    this.state.resolved = undefined;
    this.notify();

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Silence stdout/stderr during interactive execution to protect TUI alt-screen buffer
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    let traceSaved = false;
    const saveTraceData = (resolved?: boolean, statusText?: string, isFinal: boolean = false) => {
      const payload = {
        taskId,
        prompt,
        intent: this.state.taskIntent,
        resolved: resolved ?? this.state.resolved,
        tokensIn: this.state.tokensIn,
        tokensOut: this.state.tokensOut,
        spans: this.state.spans,
        turns: this.state.turns,
        stages: this.state.stages,
        patchDiff: this.state.patchDiff,
        patchHash: this.state.patchHash,
        finalAnswer: this.state.finalAnswer,
        durationMs: Date.now() - startMs,
        statusText: statusText ?? this.state.statusText,
        contractSummary: this.state.contractSummary,
        savedAt: new Date().toISOString(),
      };
      this.saveLocalTrace(targetDir, payload, isFinal);
    };

    const flushTrace = (resolved?: boolean, statusText?: string) => {
      if (traceSaved) return;
      traceSaved = true;
      saveTraceData(resolved, statusText, true);
    };

    const sigintHandler = () => {
      flushTrace(false, 'Halted by user (Ctrl+C / SIGINT)');
      this.state.isExecuting = false;
      this.state.statusText = 'Halted by user (Ctrl+C)';
      this.notify();
      process.exit(130);
    };
    process.once('SIGINT', sigintHandler);

    try {
      const sandbox = new FixtureSandboxService({
        workDirRoot: path.dirname(targetDir),
        fixturesRoot: targetDir,
      });
      sandbox.registerWorkspace(wsId, targetDir);

      const registry = new ProviderRegistry();
      const baseCaller = createReActLlmCaller({ registry });

      const reactLlmCaller = async (messages: any[], opts?: { tier?: 'slm' | 'llm'; model?: string }) => {
        const tier = (opts?.tier?.toUpperCase() as 'SLM' | 'LLM') ?? 'SLM';
        this.state.activeTier = tier;
        if (opts?.model) this.state.activeModel = opts.model;
        this.state.statusText = `[${tier}] Reasoning with ${opts?.model ?? 'model'}...`;
        this.notify();

        try {
          const resp = await baseCaller(messages, opts);
          const content = resp.content ?? '';

          // 1. Detect dynamic LLM intent classification output
          try {
            const parsed = JSON.parse(content.trim());
            if (parsed.intent) {
              this.state.taskIntent = parsed.intent;
              this.state.statusText = `Intent: [${parsed.intent.toUpperCase()}] · ${parsed.reasoning ?? 'Decomposing plan'}`;
              this.notify();
            }
          } catch {
            // Normal reasoning turn
          }

          // 2. Parse live thought, action & action input
          const thoughtMatch = content.match(/(?:Thought|\*\*Thought\*\*):\s*([\s\S]*?)(?=(?:Action|\*\*Action\*\*|Final Answer|\*\*Final Answer\*\*|$))/i);
          const actionMatch = content.match(/(?:Action|\*\*Action\*\*):\s*([a-zA-Z0-9_-]+)/i);
          const actionInputMatch = content.match(/(?:Action Input|\*\*Action Input\*\*):\s*([\s\S]*?)(?=(?:\n\s*(?:Observation|\*\*Observation\*\*|Thought|\*\*Thought\*\*|Action|\*\*Action\*\*|Final Answer|\*\*Final Answer\*\*)|$))/i);
          const finalAnswerMatch = content.match(/(?:Final Answer|\*\*Final Answer\*\*):\s*([\s\S]*$)/i);

          if (thoughtMatch?.[1]) {
            this.state.thinking = thoughtMatch[1].trim().slice(0, 300);
          }
          if (finalAnswerMatch?.[1]) {
            this.state.finalAnswer = finalAnswerMatch[1].trim();
          }

          // Backfill observation onto previous turn if available from incoming messages
          if (this.state.turns.length > 0) {
            const lastTurn = this.state.turns[this.state.turns.length - 1];
            if (lastTurn && !lastTurn.observation) {
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.role === 'user' && typeof lastMsg.content === 'string') {
                const obsMatch = lastMsg.content.match(/(?:Observation|\*\*Observation\*\*):\s*([\s\S]*?)(?=(?:\n\n⚠️|\n\nNOTICE|$))/i);
                if (obsMatch?.[1]) {
                  lastTurn.observation = obsMatch[1].trim();
                } else if (lastMsg.content.startsWith('Observation')) {
                  lastTurn.observation = lastMsg.content.split('\n\n⚠️')[0]?.trim();
                }
              }
            }
          }

          let parsedActionInput: Record<string, unknown> | string | undefined = undefined;
          if (actionInputMatch?.[1]) {
            const rawInput = actionInputMatch[1].trim();
            try {
              parsedActionInput = JSON.parse(rawInput);
            } catch {
              parsedActionInput = rawInput;
            }
          }

          const actionName = actionMatch?.[1]?.trim()?.toLowerCase() ?? '';
          if (actionName || thoughtMatch?.[1]) {
            this.state.turns.push({
              turnIndex: this.state.turns.length + 1,
              thought: thoughtMatch?.[1]?.trim() ?? content.slice(0, 200),
              action: actionName || 'reasoning',
              actionInput: parsedActionInput,
              status: 'ok',
            });
            // Update latest.json incrementally so progress is never lost on crash or kill
            saveTraceData(false, this.state.statusText, false);
          }

          // Progress active stage dynamically on tool executions
          const stageIdx = this.state.activeStageIndex;
          if (actionName.includes('test') || actionName.includes('bash') || actionName.includes('write')) {
            const nextIdx = Math.min(this.state.stages.length - 1, stageIdx + 1);
            if (this.state.stages[stageIdx]) this.state.stages[stageIdx].status = 'completed';
            if (this.state.stages[nextIdx]) this.state.stages[nextIdx].status = 'running';
            this.state.activeStageIndex = nextIdx;
          }

          this.notify();
          return resp;
        } catch (err: any) {
          this.state.statusText = `LLM call warning: ${err.message ?? String(err)}`;
          this.notify();
          throw err;
        }
      };

      const runner = new AgentRunner();
      const result = await runner.run(
        {
          taskId,
          problemStatement: prompt,
          repo: path.basename(targetDir),
          baseCommit: 'main',
        },
        {
          workspaceId: wsId,
          sandbox,
          taskId,
          workingDir: targetDir,
        },
        {
          providerRegistry: registry,
          reactLlmCaller,
          maxIterations: 30,
          maxTurnsPerSubtask: 20,
        },
      );

      this.state.spans = result.spans ?? [];
      this.state.tokensIn = result.outcomeEvidence?.cost?.tokens_in ?? 0;
      this.state.tokensOut = result.outcomeEvidence?.cost?.tokens_out ?? 0;
      this.state.patchHash = result.outcomeEvidence?.outcome?.patch_applied ? 'hash_' + Date.now().toString(16) : undefined;
      this.state.finalAnswer = result.finalAnswer || this.state.finalAnswer;
      this.state.resolved = result.resolved;
      correlateTurnsWithSpans(this.state.turns, this.state.spans);

      // Extract real stages from backend subtasks
      if (result.planState?.subtasks && result.planState.subtasks.length > 0) {
        this.state.stages = result.planState.subtasks.map((st, idx) => {
          const isDone = idx < result.planState.activeStepIndex || Boolean(result.resolved);
          const isCurrent = idx === result.planState.activeStepIndex && !result.resolved;
          const rawName = st.id.replace(new RegExp(`^${taskId}_(step_\\d+_)?`), '').replace(/_/g, ' ');
          return {
            id: st.id,
            name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
            status: isDone ? 'completed' : isCurrent ? 'running' : 'pending',
            goal: st.goal,
          };
        });

        // Collect entities and targetFiles for architectural contract summary
        const allTargets: string[] = [];
        let contractText: string | undefined = undefined;
        for (const st of result.planState.subtasks) {
          if (st.contract && !contractText) {
            contractText = st.contract;
          }
          if (st.targetFiles) allTargets.push(...st.targetFiles);
        }

        const standardEntities = ['User', 'Todo', 'Project', 'Task', 'Comment', 'Post', 'Order', 'Product', 'Auth', 'Item'];
        const foundEntities = standardEntities.filter((e) =>
          new RegExp(`\\b${e}\\b`, 'i').test(prompt + ' ' + (contractText ?? '')),
        );

        this.state.contractSummary = {
          contractText,
          entities: foundEntities.length > 0 ? foundEntities : undefined,
          targetFiles: allTargets.length > 0 ? Array.from(new Set(allTargets)) : undefined,
        };
      }

      this.state.statusText = result.resolved ? 'Resolved successfully · All checks passed' : 'Execution completed';
      if (this.state.finalAnswer) {
        exportReportToFile(this.state.finalAnswer, targetDir);
      }
      flushTrace(result.resolved, this.state.statusText);
    } catch (err: any) {
      this.state.statusText = `Execution error: ${err.message ?? String(err)}`;
      flushTrace(false, this.state.statusText);
    } finally {
      process.removeListener('SIGINT', sigintHandler);
      flushTrace(this.state.resolved, this.state.statusText);
      console.log = originalLog;
      console.error = originalError;
      this.state.isExecuting = false;
      this.state.lastCompletedPrompt = prompt;
      this.state.prompt = '';
      this.state.thinking = '';
      this.state.durationMs = Date.now() - startMs;
      this.notify();
    }

    return this.state;
  }

  /** Saves trace into <targetDir>/.soa/traces/ */
  private saveLocalTrace(targetDir: string, data: Record<string, unknown>, writeArchive: boolean = true): void {
    try {
      const traceDir = path.join(targetDir, '.soa', 'traces');
      if (!fs.existsSync(traceDir)) {
        fs.mkdirSync(traceDir, { recursive: true });
      }
      const serialized = JSON.stringify(data, null, 2);
      const latestFile = path.join(traceDir, 'latest.json');
      fs.writeFileSync(latestFile, serialized, 'utf8');

      if (writeArchive) {
        const timestamp = Date.now();
        const traceFile = path.join(traceDir, `trace_${timestamp}.json`);
        fs.writeFileSync(traceFile, serialized, 'utf8');
      }
    } catch {
      // Local trace write warning ignored
    }
  }
}
