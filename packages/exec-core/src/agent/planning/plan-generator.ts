import { PlanningConfig, CONFIG_SCHEMA_VERSION } from '@soa/contracts';
import type { ProviderRegistry } from '@soa/llm';
import { AgentTask, SubTask } from '../types.js';
import { SubtaskRoutingFeatures, SubtaskType } from '../../routing/types.js';

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  schema_version: CONFIG_SCHEMA_VERSION,
  backtrack_depth: 3,
  verify_after_edit: true,
  subtask_timeout_s: 300,
};

export type TaskIntent = 'full_scaffold' | 'single_bug' | 'multi_bug' | 'explain_only';

export interface DecomposedIssue {
  id: number;
  title: string;
  targetFiles: string[];
  action: string;
}

export interface DecomposedIssuesResponse {
  isMultiBug: boolean;
  issues: DecomposedIssue[];
}

export interface IntentClassificationResponse {
  intent: TaskIntent;
  reasoning?: string;
}

export const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `You are an expert Software Engineering Intent Classifier for an autonomous coding agent.
Analyze the user prompt and classify it into EXACTLY ONE category:
- "full_scaffold": Creating, generating, building, or scaffolding a brand new project, stack, or multi-component application from scratch.
- "single_bug": Fixing a single specific bug, test failure, syntax error, or targeted issue in existing code.
- "multi_bug": Fixing multiple distinct bugs, field mismatches, schema discrepancies, missing dependencies, conflicting files, or multi-item audit logs across an existing project.
- "explain_only": Answering questions, explaining code architecture, reviewing or diagnosing an issue without modifying files.

CRITICAL RULES:
1. If the prompt describes existing files with bugs, discrepancies, field name mismatches (e.g. controller assumes X but model defines Y), missing exports, or errors, classify it as "multi_bug" (or "single_bug").
2. NEVER classify existing file bug fixes as "full_scaffold", even if the word "project" appears in file names like projectController.js or Project.js! "full_scaffold" is strictly for creating a brand new project from scratch.

Respond ONLY with a valid JSON object matching this schema, with no markdown code blocks or preamble:
{
  "intent": "full_scaffold" | "single_bug" | "multi_bug" | "explain_only",
  "reasoning": "brief explanation"
}`;

export const DECOMPOSITION_SYSTEM_PROMPT = `You are an expert Software Architecture Decomposer for an autonomous coding agent.
Analyze the provided problem statement.
Determine if it describes a single bug/feature or MULTIPLE distinct issues across different files or subsystems.

If it contains multiple distinct issues (e.g. 2 or more separate bugs, missing dependencies, routing mismatches, schema discrepancies):
1. Set "isMultiBug" to true.
2. Segment them into an array of atomic issues in the order they should be fixed.
3. CRITICAL COALESCING RULE: Group related issues that target the SAME file or subsystem into a single cohesive queue item (for example, combine all missing dependencies or configuration updates for server/package.json into ONE single issue). Do not create separate tasks for the same file.
4. For each issue, list the target file paths mentioned or implied, and the specific action required.

If it describes only a single issue, feature, or bug, set "isMultiBug" to false with an empty or single-item "issues" array.

Respond ONLY with a valid JSON object matching this schema, with no markdown code blocks or preamble:
{
  "isMultiBug": true,
  "issues": [
    {
      "id": 1,
      "title": "Short title of issue 1",
      "targetFiles": ["path/to/file.ext"],
      "action": "Clear description of fix needed"
    }
  ]
}`;

export interface DecomposedScaffoldPhase {
  id: string;
  title: string;
  type?: 'edit_single_file' | 'edit_multi_file';
  goal: string;
  targetFiles: string[];
}

export interface DecomposedScaffoldResponse {
  contract?: string;
  phases: DecomposedScaffoldPhase[];
}

export const SCAFFOLD_DECOMPOSITION_PROMPT = `You are an expert Software Architecture Planner for an autonomous coding agent.
Analyze the user request to create, scaffold, or build a new software project or application.
Decompose the project into a strict Architectural Contract and ordered implementation phases.

CRITICAL REQUIREMENTS:
1. Each phase must contain an explicit list of CONCRETE file paths to create (e.g. "server/models/User.js", "server/routes/auth.js"). NEVER use bare directory names like "server/routes" or "client/src".
2. INCREMENTAL / DELTA SCAFFOLDING RULE:
   - Check the list of existing workspace files provided in the prompt.
   - If files already exist in the workspace, DO NOT queue phases or targets to re-create or overwrite them!
   - Plan phases ONLY for the REMAINING MISSING subsystems and files needed to fulfill the user's requested application.
3. COHESIVE SUBSYSTEM GROUPING:
   - Do NOT create tiny single-file phases (e.g. do NOT create a separate phase just for an .env file or single config file alone). Group environment and configuration files directly into their respective subsystem phase (e.g. group client setup, tailwind, and UI components into the Frontend phase; group server configs, models, and routes into backend phases).
   - All code generation phases use "type": "edit_multi_file".
4. Provide an Architectural Contract specifying canonical entity schemas, required fields, API routes, and authentication rules.
5. If all application code is already present, return an empty "phases": [] array so the agent can proceed straight to verification.
6. The number of phases is dynamic—create as many or as few cohesive phases as needed to implement the remaining files.

Respond ONLY with a valid JSON object matching this schema, with no markdown code blocks or preamble:
{
  "contract": "Strict architectural contract with schemas, fields, routes, and auth rules",
  "phases": [
    {
      "id": "models",
      "title": "Database Entity Models",
      "type": "edit_multi_file",
      "goal": "Create database entity models conforming to contract schemas.",
      "targetFiles": ["server/models/User.js", "server/models/Project.js", "server/models/Task.js", "server/models/Comment.js"]
    },
    {
      "id": "backend_api",
      "title": "Backend Logic & API Routes",
      "type": "edit_multi_file",
      "goal": "Implement backend controllers, routes, and auth middleware.",
      "targetFiles": ["server/routes/auth.js", "server/routes/projects.js", "server/controllers/authController.js", "server/controllers/projectController.js", "server/middleware/authMiddleware.js"]
    }
  ]
}`;

export interface PlanGeneratorOptions {
  config?: Partial<PlanningConfig>;
  customDecomposer?: (task: AgentTask) => Promise<SubTask[]> | SubTask[];
  providerRegistry?: ProviderRegistry;
  slmCaller?: (prompt: string, systemPrompt?: string) => Promise<string>;
}

export class PlanGenerator {
  private readonly config: PlanningConfig;
  private readonly customDecomposer?: (task: AgentTask) => Promise<SubTask[]> | SubTask[];
  private readonly providerRegistry?: ProviderRegistry;
  private readonly slmCaller?: (prompt: string, systemPrompt?: string) => Promise<string>;

  constructor(options: PlanGeneratorOptions = {}) {
    this.config = {
      ...DEFAULT_PLANNING_CONFIG,
      ...options.config,
    };
    this.customDecomposer = options.customDecomposer;
    this.providerRegistry = options.providerRegistry;
    this.slmCaller = options.slmCaller;
  }

  /**
   * Decomposes an AgentTask into an ordered sequence of structured SubTasks.
   * Routes deterministically using 4-Way Intent Classification:
   * - full_scaffold -> Phased Scaffolding Queue with Architectural Contract
   * - single_bug -> Standard 5-step SWE-bench pipeline
   * - multi_bug -> Coalesced multi-issue subtask queue
   * - explain_only -> Read-only AST exploration & synthesis pipeline
   */
  async generatePlan(task: AgentTask, existingFiles?: string[]): Promise<SubTask[]> {
    if (this.customDecomposer) {
      return await this.customDecomposer(task);
    }

    const intent = await this.classifyIntent(task);
    console.log(
      `🧠 [Task Intent] "${intent}" for task: "${task.problemStatement.slice(0, 90)}..."`,
    );

    let subtasks: SubTask[];
    switch (intent) {
      case 'explain_only':
        subtasks = this.generateExplainOnlyPlan(task);
        break;

      case 'full_scaffold': {
        const dynamicScaffoldSubtasks = await this.tryDecomposeScaffold(task, existingFiles);
        if (dynamicScaffoldSubtasks && dynamicScaffoldSubtasks.length > 0) {
          subtasks = dynamicScaffoldSubtasks;
        } else {
          subtasks = this.generatePhasedScaffoldingPlan(task, existingFiles);
        }
        break;
      }

      case 'multi_bug': {
        const multiBugSubtasks = await this.tryDecomposeMultiBug(task);
        if (multiBugSubtasks && multiBugSubtasks.length > 0) {
          subtasks = multiBugSubtasks;
        } else {
          subtasks = this.generateDeterministicPlan(task);
        }
        break;
      }

      case 'single_bug':
      default:
        subtasks = this.generateDeterministicPlan(task);
        break;
    }

    console.log(
      `📋 [Plan Generated] ${subtasks.length} subtasks queued: ${subtasks.map((s) => s.type).join(' -> ')}`,
    );
    return subtasks;
  }

  /**
   * Classifies user intent into one of 4 categories using SLM or heuristic fallback.
   */
  async classifyIntent(task: AgentTask): Promise<TaskIntent> {
    const text = task.problemStatement.trim();
    let intent: TaskIntent | undefined;

    // 1. Try SLM classification if available
    if (this.slmCaller) {
      try {
        const raw = await this.slmCaller(text, INTENT_CLASSIFICATION_SYSTEM_PROMPT);
        const parsed = this.parseIntentResponse(raw);
        if (parsed?.intent) {
          intent = parsed.intent;
        } else {
          const decompParsed = this.parseDecompositionResponse(raw);
          if (decompParsed?.isMultiBug) {
            intent = 'multi_bug';
          }
        }
      } catch {
        // Fall back to heuristic classification
      }
    } else if (this.providerRegistry) {
      try {
        const largeProvider = this.providerRegistry.getProvider('large');
        const activeConfig = this.providerRegistry.getConfig();
        const model = activeConfig.large?.model ?? 'large';

        const response = await largeProvider.chat({
          model,
          messages: [
            { role: 'system', content: INTENT_CLASSIFICATION_SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          maxTokens: 300,
        });

        const parsed = this.parseIntentResponse(response.content);
        if (parsed?.intent) {
          intent = parsed.intent;
        } else {
          const decompParsed = this.parseDecompositionResponse(response.content);
          if (decompParsed?.isMultiBug) {
            intent = 'multi_bug';
          }
        }
      } catch {
        // Fall back to heuristic classification
      }
    }

    // 2. Guardrail against SLM confusion (e.g. 3B SLM confusing Project.js with new project scaffolding)
    const heuristicIssues = this.extractMultiBugIssuesHeuristically(text);
    const targetFiles = this.extractTargetFiles(text);
    const hasBugPatterns =
      /(?:assumes|names the field|populate|mismatch|bug|issue|error|conflict|missing|fails|broken)\b/i.test(
        text,
      );

    if (intent === 'full_scaffold' && hasBugPatterns) {
      intent = heuristicIssues.length >= 2 ? 'multi_bug' : 'single_bug';
    }

    if (!intent) {
      intent = this.classifyIntentHeuristically(text);
    }

    return intent;
  }

  /**
   * Deterministic heuristic classifier for offline unit tests and rapid zero-token fallback.
   */
  classifyIntentHeuristically(text: string): TaskIntent {
    const lower = text.toLowerCase().trim();

    // 1. explain_only: question patterns without modification verbs
    const isQuestion =
      /^(?:explain|what is|how does|how do|why is|why does|walk me through|where is|describe|analyze)\b/i.test(
        lower,
      ) ||
      (/\?$/.test(lower) &&
        !/\b(?:fix|create|build|implement|refactor|error|bug|issue|missing)\b/i.test(lower));

    if (isQuestion) {
      return 'explain_only';
    }

    // 2. full_scaffold: project/stack creation
    const isScaffold =
      /^(?:create|build|setup|implement|generate|initialize|scaffold|make)\b/i.test(lower) &&
      /(?:full-stack|mern|mean|stack|project management|system|application|app)\b/i.test(lower);

    if (isScaffold) {
      return 'full_scaffold';
    }

    // 3. multi_bug: multiple distinct issues extracted or multiple files with error/conflict indicators
    const heuristicIssues = this.extractMultiBugIssuesHeuristically(text);
    if (heuristicIssues.length >= 2) {
      return 'multi_bug';
    }
    const targetFiles = this.extractTargetFiles(text);
    if (targetFiles.length >= 2 && /(?:and|conflict|missing|mismatch|error|both)\b/i.test(lower)) {
      return 'multi_bug';
    }

    // 4. Default creation without stack keyword -> full_scaffold
    if (/^(?:create|build|setup|scaffold)\b/i.test(lower)) {
      return 'full_scaffold';
    }

    // 5. Default bug-fixing
    return 'single_bug';
  }

  /**
   * Generates a phased scaffolding plan with an immutable Architectural Contract anchor.
   */
  generatePhasedScaffoldingPlan(task: AgentTask, existingFiles: string[] = []): SubTask[] {
    const contract = this.extractArchitecturalContract(task.problemStatement);
    const extractedFiles = this.extractTargetFiles(task.problemStatement);
    const subtasks: SubTask[] = [];
    const existingSet = new Set(existingFiles.map((f) => f.replace(/^\.\//, '')));

    const entities = ['User', 'Project', 'Task', 'Comment', 'Post', 'Order', 'Product'].filter((e) =>
      new RegExp(`\\b${e}\\b`, 'i').test(task.problemStatement),
    );
    const entityList = entities.length > 0 ? entities : ['User', 'Project', 'Task', 'Comment'];

    const modelFiles = entityList.map((e) => `server/models/${e}.js`);
    const routeFiles = [
      'server/routes/auth.js',
      ...entityList.map((e) => `server/routes/${e.toLowerCase()}s.js`),
    ];
    const controllerFiles = [
      'server/controllers/authController.js',
      ...entityList.map((e) => `server/controllers/${e.toLowerCase()}Controller.js`),
    ];
    const backendFiles = [...routeFiles, ...controllerFiles, 'server/middleware/authMiddleware.js'];

    const hasFrontend = /(?:frontend|client|react|tailwind|shadcn|ui|pages|components)\b/i.test(
      task.problemStatement,
    );
    const frontendFiles = [
      'client/src/App.jsx',
      'client/src/main.jsx',
      ...entityList.map((e) => `client/src/components/${e}List.jsx`),
    ];

    const allExpectedFiles = Array.from(
      new Set([
        'package.json',
        '.env.example',
        'server.js',
        ...modelFiles,
        ...backendFiles,
        ...(hasFrontend ? frontendFiles : []),
        ...extractedFiles,
      ]),
    );

    let stepIndex = 0;

    // Phase 0: Workspace Reconnaissance (only if workspace was empty)
    if (existingFiles.length === 0) {
      const exploreFeatures: SubtaskRoutingFeatures = {
        step_type: 'explore',
        estimated_tokens: 500,
        file_count: 1,
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_step_0_recon`,
        stepIndex: stepIndex++,
        type: 'explore',
        goal: `Inspect workspace layout with list_directory once. Verify empty or existing project layout. Conclude immediately with Final Answer.`,
        targetFiles: allExpectedFiles.slice(0, 5),
        estimatedTokens: 500,
        status: 'pending',
        retryCount: 0,
        features: exploreFeatures,
        contract,
      });
    }

    // Phase 1: Environment & Project Config (skip if package.json & server.js exist)
    const missingSetup = ['package.json', '.env.example', 'server.js'].filter(
      (f) => !existingSet.has(f),
    );
    if (missingSetup.length > 0) {
      const configFeatures: SubtaskRoutingFeatures = {
        step_type: 'edit_multi_file',
        estimated_tokens: 1500,
        file_count: missingSetup.length,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: 2,
      };

      subtasks.push({
        id: `${task.taskId}_scaffold_phase_1_setup`,
        stepIndex: stepIndex++,
        type: 'edit_multi_file',
        goal: `Create root package.json, .env.example, and build/server configs. Conclude promptly once configs are created.`,
        targetFiles: missingSetup,
        estimatedTokens: 1500,
        status: 'pending',
        retryCount: 0,
        features: configFeatures,
        contract,
      });
    }

    // Phase 2: Database Models & Schemas (skip if models exist)
    const missingModels = modelFiles.filter((f) => !existingSet.has(f));
    if (missingModels.length > 0) {
      const modelFeatures: SubtaskRoutingFeatures = {
        step_type: 'edit_multi_file',
        estimated_tokens: 2500,
        file_count: missingModels.length,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: missingModels.length,
      };

      subtasks.push({
        id: `${task.taskId}_scaffold_phase_2_models`,
        stepIndex: stepIndex++,
        type: 'edit_multi_file',
        goal: `Create database entity models conforming strictly to the ARCHITECTURAL CONTRACT schemas and field names.`,
        targetFiles: missingModels,
        estimatedTokens: 2500,
        status: 'pending',
        retryCount: 0,
        features: modelFeatures,
        contract,
      });
    }

    // Phase 3: Backend Logic & Express Routes (skip if backend exists)
    const missingBackend = backendFiles.filter((f) => !existingSet.has(f));
    if (missingBackend.length > 0) {
      const backendFeatures: SubtaskRoutingFeatures = {
        step_type: 'edit_multi_file',
        estimated_tokens: 3000,
        file_count: missingBackend.length,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: 5,
      };

      subtasks.push({
        id: `${task.taskId}_scaffold_phase_3_backend`,
        stepIndex: stepIndex++,
        type: 'edit_multi_file',
        goal: `Implement backend Express routes, controllers, and auth middleware conforming to the ARCHITECTURAL CONTRACT.`,
        targetFiles: missingBackend,
        estimatedTokens: 3000,
        status: 'pending',
        retryCount: 0,
        features: backendFeatures,
        contract,
      });
    }

    // Phase 4: Frontend UI Components & Client (skip if frontend exists)
    if (hasFrontend) {
      const missingFrontend = frontendFiles.filter((f) => !existingSet.has(f));
      if (missingFrontend.length > 0) {
        const frontendFeatures: SubtaskRoutingFeatures = {
          step_type: 'edit_multi_file',
          estimated_tokens: 3500,
          file_count: missingFrontend.length,
          prior_failures: 0,
          requires_cross_file_reasoning: true,
          symbol_count: 5,
        };

        subtasks.push({
          id: `${task.taskId}_scaffold_phase_4_frontend`,
          stepIndex: stepIndex++,
          type: 'edit_multi_file',
          goal: `Create client views, UI components, and API integration conforming to the ARCHITECTURAL CONTRACT.`,
          targetFiles: missingFrontend,
          estimatedTokens: 3500,
          status: 'pending',
          retryCount: 0,
          features: frontendFeatures,
          contract,
        });
      }
    }

    // Phase 5: Verification & Mock Seeds
    if (this.config.verify_after_edit) {
      const verifyFeatures: SubtaskRoutingFeatures = {
        step_type: 'plan',
        estimated_tokens: 600,
        file_count: Math.max(1, allExpectedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_scaffold_phase_5_verify`,
        stepIndex: stepIndex++,
        type: 'plan',
        goal: `Verify that all requested project files exist on disk using list_directory once, and verify mock data / test seeds. Conclude immediately.`,
        targetFiles: allExpectedFiles,
        estimatedTokens: 600,
        status: 'pending',
        retryCount: 0,
        features: verifyFeatures,
        contract,
      });
    }

    return subtasks;
  }

  /**
   * Generates a read-only investigation and explanation plan without file modifications.
   */
  generateExplainOnlyPlan(task: AgentTask): SubTask[] {
    const extractedFiles = this.extractTargetFiles(task.problemStatement);
    const subtasks: SubTask[] = [];

    // Step 0: Locate Relevant Code
    const exploreFeatures: SubtaskRoutingFeatures = {
      step_type: 'explore',
      estimated_tokens: 500,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    subtasks.push({
      id: `${task.taskId}_explain_0_recon`,
      stepIndex: 0,
      type: 'explore',
      goal: `Inspect workspace layout with list_directory to locate files relevant to: "${task.problemStatement.slice(0, 80)}". Conclude immediately.`,
      targetFiles: extractedFiles,
      estimatedTokens: 500,
      status: 'pending',
      retryCount: 0,
      features: exploreFeatures,
    });

    // Step 1: AST Code Graph Retrieval
    const retrieveFeatures: SubtaskRoutingFeatures = {
      step_type: 'localize',
      estimated_tokens: 800,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: true,
      symbol_count: 3,
    };

    subtasks.push({
      id: `${task.taskId}_explain_1_retrieve`,
      stepIndex: 1,
      type: 'localize',
      goal: `Query AST code graph with retrieve_context to locate symbols, callers, callees, and definitions. If necessary, read targeted file sections. Do NOT edit files.`,
      targetFiles: extractedFiles,
      estimatedTokens: 800,
      status: 'pending',
      retryCount: 0,
      features: retrieveFeatures,
    });

    // Step 2: Synthesis & Final Answer
    const explainFeatures: SubtaskRoutingFeatures = {
      step_type: 'plan',
      estimated_tokens: 1000,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    subtasks.push({
      id: `${task.taskId}_explain_2_conclude`,
      stepIndex: 2,
      type: 'plan',
      goal: `Synthesize a comprehensive technical explanation with code snippets, relationships, or architecture flow directly in your Final Answer.`,
      targetFiles: extractedFiles,
      estimatedTokens: 1000,
      status: 'pending',
      retryCount: 0,
      features: explainFeatures,
    });

    return subtasks;
  }

  /**
   * Synthesizes an immutable Architectural Contract anchor from the problem statement.
   */
  extractArchitecturalContract(text: string): string {
    const lines: string[] = ['# ARCHITECTURAL CONTRACT (IMMUTABLE SCHEMA)'];

    // Identify standard entity models mentioned
    const standardEntities = ['User', 'Project', 'Task', 'Comment', 'Post', 'Order', 'Product'];
    const foundEntities = standardEntities.filter((e) => new RegExp(`\\b${e}\\b`, 'i').test(text));

    if (foundEntities.length > 0) {
      lines.push('## Canonical Entity Models & Required Field Names:');
      for (const ent of foundEntities) {
        if (ent.toLowerCase() === 'project') {
          lines.push(
            `- Project: { title: String, owner: ObjectId(User), tasks: [ObjectId(Task)], status: String }`,
          );
        } else if (ent.toLowerCase() === 'task') {
          lines.push(
            `- Task: { title: String, description: String, project: ObjectId(Project), assignedTo: ObjectId(User), status: String }`,
          );
        } else if (ent.toLowerCase() === 'comment') {
          lines.push(
            `- Comment: { content: String, author: ObjectId(User), task: ObjectId(Task) }`,
          );
        } else if (ent.toLowerCase() === 'user') {
          lines.push(
            `- User: { name: String, email: String, password: String(hashed), role: String }`,
          );
        } else {
          lines.push(`- ${ent}: { id: String, name: String, createdAt: Date }`);
        }
      }
    }

    // Identify authentication mechanism
    if (/jwt|token|auth/i.test(text)) {
      lines.push('\n## Authentication Contract:');
      lines.push('- Bearer JWT token passed in Authorization header: "Bearer <token>"');
      lines.push(
        '- Auth middleware attaches authenticated user to: "req.user" with fields { id, email, role }',
      );
    }

    // Standard API Routes
    lines.push('\n## Canonical Route Endpoints:');
    lines.push('- Auth: /api/auth (register, login, me)');
    for (const ent of foundEntities) {
      if (ent.toLowerCase() !== 'user') {
        const plural = ent.toLowerCase() + 's';
        lines.push(`- ${ent}: /api/${plural} (GET /, POST /, GET /:id, PUT /:id, DELETE /:id)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Attempts to segment multiple issues into an atomic SubTask queue using SLM or heuristic fallback.
   */
  private async tryDecomposeMultiBug(task: AgentTask): Promise<SubTask[] | null> {
    // 1. Try SLM Semantic Decomposition if provider or caller available
    if (this.slmCaller) {
      try {
        const raw = await this.slmCaller(task.problemStatement, DECOMPOSITION_SYSTEM_PROMPT);
        const parsed = this.parseDecompositionResponse(raw);
        if (parsed?.isMultiBug && parsed.issues?.length >= 2) {
          return this.buildQueueSubtasks(task, parsed.issues);
        }
      } catch {
        // Fall back to heuristic check
      }
    } else if (this.providerRegistry) {
      try {
        const largeProvider = this.providerRegistry.getProvider('large');
        const activeConfig = this.providerRegistry.getConfig();
        const model = activeConfig.large?.model ?? 'large';

        const response = await largeProvider.chat({
          model,
          messages: [
            { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
            { role: 'user', content: task.problemStatement },
          ],
          temperature: 0.1,
          maxTokens: 1000,
        });

        const parsed = this.parseDecompositionResponse(response.content);
        if (parsed?.isMultiBug && parsed.issues?.length >= 2) {
          return this.buildQueueSubtasks(task, parsed.issues);
        }
      } catch {
        // Fall back to heuristic check
      }
    }

    // 2. Deterministic Heuristic Fallback (e.g. offline unit testing)
    const heuristicIssues = this.extractMultiBugIssuesHeuristically(task.problemStatement);
    if (heuristicIssues.length >= 2) {
      return this.buildQueueSubtasks(task, heuristicIssues);
    }

    return null;
  }

  /**
   * Attempts to dynamically decompose a new project / full_scaffold request into
   * stack-tailored implementation phases and concrete target files using LLM or SLM.
   */
  async tryDecomposeScaffold(
    task: AgentTask,
    existingFiles: string[] = [],
  ): Promise<SubTask[] | null> {
    let parsed: DecomposedScaffoldResponse | null = null;
    const existingNotice =
      existingFiles.length > 0
        ? `\n\nExisting files already present in the workspace (${existingFiles.length} files):\n${existingFiles.map((f) => `- ${f}`).join('\n')}\n\nIMPORTANT: Do NOT recreate or overwrite these existing files. Plan phases ONLY for missing files!`
        : '\n\nWorkspace is currently empty. Plan the full project from scratch.';

    const promptText = `${task.problemStatement}${existingNotice}`;

    if (this.slmCaller) {
      try {
        const raw = await this.slmCaller(promptText, SCAFFOLD_DECOMPOSITION_PROMPT);
        parsed = this.parseScaffoldResponse(raw);
      } catch {
        // Fall back to provider or heuristic
      }
    }

    if (!parsed && this.providerRegistry) {
      try {
        const largeProvider = this.providerRegistry.getProvider('large');
        const activeConfig = this.providerRegistry.getConfig();
        const model = activeConfig.large?.model ?? 'large';

        const response = await largeProvider.chat({
          model,
          messages: [
            { role: 'system', content: SCAFFOLD_DECOMPOSITION_PROMPT },
            { role: 'user', content: promptText },
          ],
          temperature: 0.1,
          maxTokens: 1500,
        });

        parsed = this.parseScaffoldResponse(response.content);
      } catch {
        // Fall back to heuristic
      }
    }

    if (parsed && Array.isArray(parsed.phases)) {
      return this.buildScaffoldQueueSubtasks(task, parsed, existingFiles);
    }

    return null;
  }

  /**
   * Builds an ordered SubTask queue from dynamic scaffold decomposition.
   */
  buildScaffoldQueueSubtasks(
    task: AgentTask,
    response: DecomposedScaffoldResponse,
    existingFiles: string[] = [],
  ): SubTask[] {
    const contract =
      response.contract?.trim() || this.extractArchitecturalContract(task.problemStatement);
    const subtasks: SubTask[] = [];
    let stepIndex = 0;
    const existingSet = new Set(existingFiles.map((f) => f.replace(/^\.\//, '')));

    // Filter out target files that already exist on disk
    const filteredPhases = response.phases
      .map((phase) => ({
        ...phase,
        targetFiles: phase.targetFiles.filter((f) => !existingSet.has(f.replace(/^\.\//, ''))),
      }))
      .filter((phase) => phase.targetFiles.length > 0);

    const allTargetFiles = Array.from(new Set(filteredPhases.flatMap((p) => p.targetFiles)));

    // Phase 0: Workspace Reconnaissance (only if workspace was empty)
    if (existingFiles.length === 0) {
      const exploreFeatures: SubtaskRoutingFeatures = {
        step_type: 'explore',
        estimated_tokens: 500,
        file_count: Math.max(1, allTargetFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_step_0_recon`,
        stepIndex: stepIndex++,
        type: 'explore',
        goal: `Inspect workspace layout with list_directory once. Verify empty or existing project layout. Conclude immediately with Final Answer.`,
        targetFiles: allTargetFiles.slice(0, 5),
        estimatedTokens: 500,
        status: 'pending',
        retryCount: 0,
        features: exploreFeatures,
        contract,
      });
    }

    // Dynamic Implementation Phases
    for (const phase of filteredPhases) {
      const type: SubtaskType = 'edit_multi_file';
      const fileCount = Math.max(1, phase.targetFiles.length);
      const estTokens = Math.min(4000, 1500 + fileCount * 500);

      const features: SubtaskRoutingFeatures = {
        step_type: 'edit_multi_file',
        estimated_tokens: estTokens,
        file_count: fileCount,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: Math.max(2, fileCount),
      };

      const phaseKey = phase.id
        ? phase.id.toLowerCase().replace(/[^a-z0-9_]/g, '_')
        : `phase_${stepIndex}`;

      subtasks.push({
        id: `${task.taskId}_scaffold_${phaseKey}`,
        stepIndex: stepIndex++,
        type,
        goal: phase.goal,
        targetFiles: phase.targetFiles,
        estimatedTokens: estTokens,
        status: 'pending',
        retryCount: 0,
        features,
        contract,
      });
    }

    // Final Phase: Verification
    if (this.config.verify_after_edit) {
      const allExpectedFiles = Array.from(new Set([...existingFiles, ...allTargetFiles]));
      const verifyFeatures: SubtaskRoutingFeatures = {
        step_type: 'plan',
        estimated_tokens: 600,
        file_count: Math.max(1, allExpectedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_scaffold_verify`,
        stepIndex: stepIndex++,
        type: 'plan',
        goal: `Verify that all created project files exist on disk using list_directory once, and verify mock data / test seeds. Conclude immediately.`,
        targetFiles: allExpectedFiles,
        estimatedTokens: 600,
        status: 'pending',
        retryCount: 0,
        features: verifyFeatures,
        contract,
      });
    }

    return subtasks;
  }

  /**
   * Builds an ordered SubTask queue for sequential execution of decomposed issues.
   */
  buildQueueSubtasks(task: AgentTask, rawIssues: DecomposedIssue[]): SubTask[] {
    const issues = this.coalesceIssues(rawIssues);
    const subtasks: SubTask[] = [];
    let stepIndex = 0;

    const allTargetFiles = Array.from(new Set(issues.flatMap((i) => i.targetFiles)));

    // Step 0: Workspace Reconnaissance
    const exploreFeatures: SubtaskRoutingFeatures = {
      step_type: 'explore',
      estimated_tokens: 500,
      file_count: Math.max(1, allTargetFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    subtasks.push({
      id: `${task.taskId}_step_0_recon`,
      stepIndex: stepIndex++,
      type: 'explore',
      goal: `Inspect workspace layout and verify presence of target files (${allTargetFiles.slice(0, 5).join(', ')}). Conclude immediately with Final Answer.`,
      targetFiles: allTargetFiles,
      estimatedTokens: 500,
      status: 'pending',
      retryCount: 0,
      features: exploreFeatures,
    });

    // Paired Subtasks for each Issue: Localize -> Edit
    for (let idx = 0; idx < issues.length; idx++) {
      const issue = issues[idx]!;
      const issueNum = idx + 1;

      // Localize Subtask (AST-First)
      const locFeatures: SubtaskRoutingFeatures = {
        step_type: 'localize',
        estimated_tokens: 700,
        file_count: issue.targetFiles.length,
        prior_failures: 0,
        requires_cross_file_reasoning: issue.targetFiles.length > 1,
        symbol_count: 2,
      };

      subtasks.push({
        id: `${task.taskId}_issue_${issueNum}_localize`,
        stepIndex: stepIndex++,
        type: 'localize',
        goal: `[Issue ${issueNum}/${issues.length}: ${issue.title}] Use retrieve_context (AST graph) and read_file to inspect ${issue.targetFiles.join(', ')} and locate required code change for: ${issue.action}. Do not edit files yet.`,
        targetFiles: issue.targetFiles,
        estimatedTokens: 700,
        status: 'pending',
        retryCount: 0,
        features: locFeatures,
      });

      // Edit Subtask
      const isMultiFile = issue.targetFiles.length > 1;
      const editType: SubtaskType = isMultiFile ? 'edit_multi_file' : 'edit_single_file';
      const editFeatures: SubtaskRoutingFeatures = {
        step_type: editType,
        estimated_tokens: 1500,
        file_count: issue.targetFiles.length,
        prior_failures: 0,
        requires_cross_file_reasoning: isMultiFile,
        symbol_count: 2,
      };

      subtasks.push({
        id: `${task.taskId}_issue_${issueNum}_edit`,
        stepIndex: stepIndex++,
        type: editType,
        goal: `[Issue ${issueNum}/${issues.length}: ${issue.title}] Apply precision edit in ${issue.targetFiles.join(', ')}. Action: ${issue.action}. Do not modify unrelated files.`,
        targetFiles: issue.targetFiles,
        estimatedTokens: 1500,
        status: 'pending',
        retryCount: 0,
        features: editFeatures,
      });
    }

    // Final Verification Step
    if (this.config.verify_after_edit) {
      const verifyFeatures: SubtaskRoutingFeatures = {
        step_type: 'plan',
        estimated_tokens: 600,
        file_count: Math.max(1, allTargetFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_step_${stepIndex}_verify_all`,
        stepIndex: stepIndex++,
        type: 'plan',
        goal: `Verify that all ${issues.length} resolved issues are cleanly applied across the codebase with no syntax errors. Conclude immediately with Final Answer.`,
        targetFiles: allTargetFiles,
        estimatedTokens: 600,
        status: 'pending',
        retryCount: 0,
        features: verifyFeatures,
      });
    }

    return subtasks;
  }

  /**
   * Deterministic software engineering task decomposition based on problem statement analysis (single bug default).
   */
  generateDeterministicPlan(task: AgentTask): SubTask[] {
    const extractedFiles = this.extractTargetFiles(task.problemStatement);
    const subtasks: SubTask[] = [];

    // Bug-fixing / SWE-bench workflow: Step 0 (explore) -> Step 1 (localize) -> Step 2 (edit) -> Step 3 (test) -> Step 4 (verify)
    // Step 0: Exploration & Context Retrieval
    const step0Type: SubtaskType = 'explore';
    const exploreFeatures: SubtaskRoutingFeatures = {
      step_type: step0Type,
      estimated_tokens: 600,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    subtasks.push({
      id: `${task.taskId}_step_0_explore`,
      stepIndex: 0,
      type: step0Type,
      goal: `Inspect directory layout and verify target files (${extractedFiles.join(', ')}). Conclude immediately.`,
      targetFiles: extractedFiles,
      estimatedTokens: exploreFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: exploreFeatures,
    });

    // Step 1: Localization (AST-First)
    const step1Type: SubtaskType = 'localize';
    const localizeFeatures: SubtaskRoutingFeatures = {
      step_type: step1Type,
      estimated_tokens: 800,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: extractedFiles.length > 1,
      symbol_count: 4,
    };

    subtasks.push({
      id: `${task.taskId}_step_1_localize`,
      stepIndex: 1,
      type: step1Type,
      goal: `Use retrieve_context (AST graph) and read_file to inspect code and identify buggy functions or symbols.`,
      targetFiles: extractedFiles,
      estimatedTokens: localizeFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: localizeFeatures,
    });

    // Step 2: Implementation / Surgical Edit
    const isMultiFile = extractedFiles.length > 1;
    const step2Type: SubtaskType = isMultiFile ? 'edit_multi_file' : 'edit_single_file';
    const editFeatures: SubtaskRoutingFeatures = {
      step_type: step2Type,
      estimated_tokens: 1500,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: isMultiFile,
      symbol_count: 3,
    };

    subtasks.push({
      id: `${task.taskId}_step_2_edit`,
      stepIndex: 2,
      type: step2Type,
      goal: `Apply minimal surgical patch to fix the bug using edit_file. Do not modify unrelated code.`,
      targetFiles: extractedFiles,
      estimatedTokens: editFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: editFeatures,
    });

    // Step 3: Test Execution
    const step3Type: SubtaskType = 'test';
    const testFeatures: SubtaskRoutingFeatures = {
      step_type: step3Type,
      estimated_tokens: 800,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    subtasks.push({
      id: `${task.taskId}_step_3_test`,
      stepIndex: 3,
      type: step3Type,
      goal: `Run and verify test cases validating the fix without regressions.`,
      targetFiles: extractedFiles.filter((f) => f.includes('test')),
      estimatedTokens: testFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: testFeatures,
    });

    // Step 4: Verification (if verify_after_edit is true)
    if (this.config.verify_after_edit) {
      const step4Type: SubtaskType = 'plan';
      const verifyFeatures: SubtaskRoutingFeatures = {
        step_type: step4Type,
        estimated_tokens: 900,
        file_count: Math.max(1, extractedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 2,
      };

      subtasks.push({
        id: `${task.taskId}_step_4_verify`,
        stepIndex: 4,
        type: step4Type,
        goal: `Inspect git diff and ensure code cleanliness and compliance with problem requirements.`,
        targetFiles: extractedFiles,
        estimatedTokens: verifyFeatures.estimated_tokens,
        status: 'pending',
        retryCount: 0,
        features: verifyFeatures,
      });
    }

    return subtasks;
  }

  /**
   * Coalesces issues targeting the exact same file or subsystem into a single atomic issue.
   */
  private coalesceIssues(issues: DecomposedIssue[]): DecomposedIssue[] {
    const coalesced: DecomposedIssue[] = [];
    const fileKeyMap = new Map<string, DecomposedIssue>();

    for (const issue of issues) {
      const fileKey = issue.targetFiles.slice().sort().join('|');
      if (fileKey && fileKeyMap.has(fileKey)) {
        const existing = fileKeyMap.get(fileKey)!;
        existing.title = `${existing.title} & ${issue.title}`;
        existing.action = `${existing.action}. Additionally: ${issue.action}`;
      } else {
        const copy: DecomposedIssue = {
          id: issue.id,
          title: issue.title,
          targetFiles: [...issue.targetFiles],
          action: issue.action,
        };
        coalesced.push(copy);
        if (fileKey) {
          fileKeyMap.set(fileKey, copy);
        }
      }
    }

    return coalesced.map((item, idx) => ({ ...item, id: idx + 1 }));
  }

  /**
   * Deterministic heuristic fallback to extract multi-bug issues when SLM is offline.
   */
  private extractMultiBugIssuesHeuristically(text: string): DecomposedIssue[] {
    const rawSegments = text
      .split(/(?:\r?\n)+|(?<=[.!?])\s*(?=[A-Z0-9])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    const issues: DecomposedIssue[] = [];
    let id = 1;

    for (const segment of rawSegments) {
      const files = this.extractTargetFiles(segment);
      if (
        files.length > 0 ||
        /^(?:missing|error|cannot find|conflict|undefined|expected|fix|update|mismatch)\b/i.test(
          segment,
        )
      ) {
        issues.push({
          id: id++,
          title: segment.slice(0, 80),
          targetFiles: files.length > 0 ? files : this.extractTargetFiles(text).slice(0, 2),
          action: segment,
        });
      }
    }

    return issues.length >= 2 ? issues : [];
  }

  /**
   * Parses the JSON response emitted by the SLM decomposition prompt.
   */
  private parseDecompositionResponse(content: string): DecomposedIssuesResponse | null {
    try {
      let raw = content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '');
        raw = raw.replace(/\s*```\s*$/, '');
        raw = raw.trim();
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        raw = jsonMatch[0];
      }

      const parsed = JSON.parse(raw) as DecomposedIssuesResponse;
      if (typeof parsed?.isMultiBug === 'boolean' && Array.isArray(parsed?.issues)) {
        return parsed;
      }
    } catch {
      // Return null on parsing failure
    }
    return null;
  }

  /**
   * Parses the JSON response emitted by the scaffold decomposition prompt.
   */
  private parseScaffoldResponse(content: string): DecomposedScaffoldResponse | null {
    try {
      let raw = content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '');
        raw = raw.replace(/\s*```\s*$/, '');
        raw = raw.trim();
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        raw = jsonMatch[0];
      }

      const parsed = JSON.parse(raw) as DecomposedScaffoldResponse;
      if (Array.isArray(parsed?.phases)) {
        const validPhases = parsed.phases.filter(
          (p) =>
            typeof p.goal === 'string' &&
            Array.isArray(p.targetFiles) &&
            p.targetFiles.length > 0,
        );
        return {
          contract: typeof parsed.contract === 'string' ? parsed.contract : undefined,
          phases: validPhases,
        };
      }
    } catch {
      // Return null on parsing failure
    }
    return null;
  }

  /**
   * Parses the JSON response emitted by the SLM intent classification prompt.
   */
  private parseIntentResponse(content: string): IntentClassificationResponse | null {
    try {
      let raw = content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '');
        raw = raw.replace(/\s*```\s*$/, '');
        raw = raw.trim();
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        raw = jsonMatch[0];
      }

      const parsed = JSON.parse(raw) as IntentClassificationResponse;
      const validIntents: TaskIntent[] = [
        'full_scaffold',
        'single_bug',
        'multi_bug',
        'explain_only',
      ];
      if (validIntents.includes(parsed?.intent)) {
        return parsed;
      }
    } catch {
      // Return null on parsing failure
    }
    return null;
  }

  /**
   * Extracts probable file paths or module references mentioned in the problem statement.
   */
  private extractTargetFiles(text: string): string[] {
    const fileRegex = /([a-zA-Z0-9_\-./]+\.(?:py|ts|tsx|js|jsx|java|json|yaml|yml|md|rs|go))/g;
    const matches = text.match(fileRegex) || [];
    return Array.from(new Set(matches));
  }
}
