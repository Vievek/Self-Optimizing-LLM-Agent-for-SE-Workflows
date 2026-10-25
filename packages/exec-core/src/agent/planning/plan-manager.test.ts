import { describe, it, expect } from 'vitest';
import { PlanSpanAttributesSchema } from '@soa/contracts';
import { PlanGenerator } from './plan-generator.js';
import { PlanManager } from './plan-manager.js';
import { AgentTask } from '../types.js';
import { ModelSelector } from '../../routing/model-selector.js';

describe('PlanGenerator and PlanManager', () => {
  const sampleTask: AgentTask = {
    taskId: 'django__django-11001',
    repo: 'django/django',
    problemStatement:
      'Incorrect SQL ordering when RawSQL is used in order_by in django/db/models/sql/compiler.py and tests/test_compiler.py',
  };

  describe('PlanGenerator', () => {
    it('generates deterministic subtask plan with routing features', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);

      expect(subtasks.length).toBe(5); // explore, localize, edit_multi_file, test, plan

      // Verify sequence of types
      expect(subtasks[0]?.type).toBe('explore');
      expect(subtasks[1]?.type).toBe('localize');
      expect(subtasks[2]?.type).toBe('edit_multi_file');
      expect(subtasks[3]?.type).toBe('test');
      expect(subtasks[4]?.type).toBe('plan');

      // Verify extracted target files
      expect(subtasks[0]?.targetFiles).toContain('django/db/models/sql/compiler.py');
      expect(subtasks[0]?.targetFiles).toContain('tests/test_compiler.py');

      // Verify routing features attached
      for (const st of subtasks) {
        expect(st.features).toBeDefined();
        expect(st.features?.step_type).toBe(st.type);
      }
    });

    it('routes subtasks to SLM and LLM tiers using ModelSelector', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const selector = new ModelSelector();

      // Check model selector decisions on generated subtasks
      const decisions = subtasks.map((st) => ({
        type: st.type,
        decision: selector.selectTier(st.features!),
      }));

      // Explore and test execution qualify for SLM tier
      const exploreDec = decisions.find((d) => d.type === 'explore');
      expect(exploreDec?.decision.tier).toBe('slm');

      // Complex multi-file code edit escalates to LLM tier
      const editDec = decisions.find((d) => d.type === 'edit_multi_file');
      expect(editDec?.decision.tier).toBe('llm');
    });

    it('decomposes multi-bug statements into an atomic subtask queue using SLM caller', async () => {
      const mockSlmCaller = async () =>
        JSON.stringify({
          isMultiBug: true,
          issues: [
            {
              id: 1,
              title: 'Missing bcryptjs dependency',
              targetFiles: ['server/package.json'],
              action: 'Add bcryptjs to server/package.json dependencies',
            },
            {
              id: 2,
              title: 'Conflicting route setup',
              targetFiles: ['server/index.js', 'server/server.js'],
              action: 'Mount auth routes in index.js',
            },
            {
              id: 3,
              title: 'Schema field mismatch',
              targetFiles: ['server/models/Project.js', 'server/controllers/projectController.js'],
              action: 'Change user reference to owner',
            },
          ],
        });

      const generator = new PlanGenerator({ slmCaller: mockSlmCaller });
      const multiBugTask: AgentTask = {
        taskId: 'multi-bug-task-1',
        repo: 'local/workspace',
        problemStatement:
          'Missing bcryptjs in server/package.json. Conflicting routes in server/index.js and server/server.js. Schema field mismatch in models/Project.js.',
      };

      const subtasks = await generator.generatePlan(multiBugTask);

      // Expected: Step 0 (recon) + 3 * (localize + edit) + Step Final (verify) = 1 + 6 + 1 = 8 subtasks
      expect(subtasks.length).toBe(8);

      expect(subtasks[0]?.id).toContain('step_0_recon');
      expect(subtasks[0]?.type).toBe('explore');

      // Issue 1
      expect(subtasks[1]?.id).toContain('issue_1_localize');
      expect(subtasks[1]?.type).toBe('localize');
      expect(subtasks[1]?.targetFiles).toEqual(['server/package.json']);
      expect(subtasks[2]?.id).toContain('issue_1_edit');
      expect(subtasks[2]?.type).toBe('edit_single_file');

      // Issue 2 (multi-file)
      expect(subtasks[3]?.id).toContain('issue_2_localize');
      expect(subtasks[4]?.id).toContain('issue_2_edit');
      expect(subtasks[4]?.type).toBe('edit_multi_file');

      // Final Verify
      expect(subtasks[7]?.id).toContain('verify_all');
      expect(subtasks[7]?.type).toBe('plan');
    });

    it('coalesces multiple issues targeting the exact same file into a single atomic issue', async () => {
      const mockSlmCaller = async () =>
        JSON.stringify({
          isMultiBug: true,
          issues: [
            {
              id: 1,
              title: 'Missing bcryptjs',
              targetFiles: ['server/package.json'],
              action: 'Add bcryptjs to dependencies',
            },
            {
              id: 2,
              title: 'Missing dotenv',
              targetFiles: ['server/package.json'],
              action: 'Add dotenv to dependencies',
            },
            {
              id: 3,
              title: 'Route conflict',
              targetFiles: ['server/server.js'],
              action: 'Reconcile routes',
            },
          ],
        });

      const generator = new PlanGenerator({ slmCaller: mockSlmCaller });
      const multiBugTask: AgentTask = {
        taskId: 'coalesce-test',
        repo: 'local/workspace',
        problemStatement: 'Fix dependencies in server/package.json and routes in server/server.js',
      };

      const subtasks = await generator.generatePlan(multiBugTask);

      // 3 raw issues -> 2 coalesced issues (Issue 1 & 2 merged for server/package.json)
      // Expected subtasks: recon + 2 * (localize + edit) + verify = 1 + 4 + 1 = 6 subtasks
      expect(subtasks.length).toBe(6);
      expect(subtasks[1]?.goal).toContain('Missing bcryptjs & Missing dotenv');
      expect(subtasks[2]?.goal).toContain(
        'Add bcryptjs to dependencies. Additionally: Add dotenv to dependencies',
      );
    });

    it('falls back to deterministic multi-bug heuristic when SLM caller is not configured', async () => {
      const generator = new PlanGenerator();
      const multiBugTask: AgentTask = {
        taskId: 'multi-bug-heuristic',
        repo: 'local/workspace',
        problemStatement:
          'Missing bcryptjs in server/package.json.\nConflicting route setup in server/server.js and server/index.js.\nUndefined updateUser in server/controllers/authController.js.',
      };

      const subtasks = await generator.generatePlan(multiBugTask);

      // Heuristic detects >= 2 distinct issues with file references
      expect(subtasks.length).toBeGreaterThanOrEqual(5);
      expect(subtasks[0]?.type).toBe('explore');
      const editSubtasks = subtasks.filter(
        (s) => s.type === 'edit_single_file' || s.type === 'edit_multi_file',
      );
      expect(editSubtasks.length).toBeGreaterThanOrEqual(2);
    });

    it('respects verify_after_edit: false in planning config', async () => {
      const generator = new PlanGenerator({ config: { verify_after_edit: false } });
      const subtasks = await generator.generatePlan(sampleTask);

      expect(subtasks.length).toBe(4);
      expect(subtasks.some((s) => s.id.includes('verify'))).toBe(false);
    });

    it('classifies full_scaffold and generates phased queue with architectural contract', async () => {
      const generator = new PlanGenerator();
      const scaffoldTask: AgentTask = {
        taskId: 'scaffold-mern-1',
        repo: 'local/workspace',
        problemStatement:
          'Build a full-stack MERN Project Management System with User, Project, Task, and Comment models, JWT auth, and Tailwind CSS.',
      };

      const intent = await generator.classifyIntent(scaffoldTask);
      expect(intent).toBe('full_scaffold');

      const subtasks = await generator.generatePlan(scaffoldTask);

      // Phased queue: Recon -> Setup -> Models -> Backend -> Frontend -> Verify (6 phases)
      expect(subtasks.length).toBe(6);
      expect(subtasks[0]?.id).toContain('step_0_recon');
      expect(subtasks[0]?.type).toBe('explore');

      expect(subtasks[1]?.id).toContain('scaffold_phase_1_setup');
      expect(subtasks[1]?.type).toBe('edit_multi_file');

      expect(subtasks[2]?.id).toContain('scaffold_phase_2_models');
      expect(subtasks[2]?.type).toBe('edit_multi_file');

      expect(subtasks[3]?.id).toContain('scaffold_phase_3_backend');
      expect(subtasks[4]?.id).toContain('scaffold_phase_4_frontend');
      expect(subtasks[5]?.id).toContain('scaffold_phase_5_verify');

      // Verify Architectural Contract is attached across subtasks
      expect(subtasks[0]?.contract).toBeDefined();
      expect(subtasks[0]?.contract).toContain('ARCHITECTURAL CONTRACT');
      expect(subtasks[0]?.contract).toContain('Project: { title: String, owner: ObjectId(User)');
      expect(subtasks[2]?.contract).toBe(subtasks[0]?.contract);

      // Verify concrete target files are used instead of directory globs
      expect(subtasks[3]?.targetFiles).toContain('server/routes/auth.js');
      expect(subtasks[3]?.targetFiles).toContain('server/controllers/authController.js');
      expect(subtasks[3]?.targetFiles).toContain('server/middleware/authMiddleware.js');
      expect(subtasks[3]?.targetFiles.some((f) => f === 'server/routes')).toBe(false);
    });

    it('decomposes full_scaffold dynamically using SLM caller when available', async () => {
      const mockSlmCaller = async (_prompt: string, sysPrompt?: string) => {
        if (sysPrompt?.includes('Intent Classifier')) {
          return JSON.stringify({ intent: 'full_scaffold', reasoning: 'New stack' });
        }
        return JSON.stringify({
          contract: '# DYNAMIC ARCHITECTURAL CONTRACT\n- User: { id, name }',
          phases: [
            {
              id: 'config',
              title: 'Config & App Entry',
              type: 'edit_single_file',
              goal: 'Create package.json and index.js',
              targetFiles: ['package.json', 'index.js'],
            },
            {
              id: 'api',
              title: 'API Endpoints',
              type: 'edit_multi_file',
              goal: 'Create routes and controllers',
              targetFiles: ['src/routes.js', 'src/controllers.js'],
            },
          ],
        });
      };

      const generator = new PlanGenerator({ slmCaller: mockSlmCaller });
      const scaffoldTask: AgentTask = {
        taskId: 'dynamic-scaffold-1',
        repo: 'local/workspace',
        problemStatement:
          'Build a lightweight Express microservice with routes.js and controllers.js',
      };

      const subtasks = await generator.generatePlan(scaffoldTask);
      expect(subtasks.length).toBe(4); // Recon + 2 phases + Verify
      expect(subtasks[0]?.type).toBe('explore');
      expect(subtasks[1]?.id).toContain('scaffold_config');
      expect(subtasks[1]?.targetFiles).toEqual(['package.json', 'index.js']);
      expect(subtasks[2]?.id).toContain('scaffold_api');
      expect(subtasks[2]?.targetFiles).toEqual(['src/routes.js', 'src/controllers.js']);
      expect(subtasks[3]?.id).toContain('scaffold_verify');
      expect(subtasks[1]?.contract).toContain('# DYNAMIC ARCHITECTURAL CONTRACT');
    });

    it('skips already completed phases when existingFiles are present in dynamic scaffolding', async () => {
      const mockSlmCaller = async (_prompt: string, sysPrompt?: string) => {
        if (sysPrompt?.includes('Intent Classifier')) {
          return JSON.stringify({ intent: 'full_scaffold', reasoning: 'New stack' });
        }
        return JSON.stringify({
          contract: '# DYNAMIC ARCHITECTURAL CONTRACT\n- User: { id, name }',
          phases: [
            {
              id: 'config',
              title: 'Config & App Entry',
              type: 'edit_single_file',
              goal: 'Create package.json and index.js',
              targetFiles: ['package.json', 'index.js'],
            },
            {
              id: 'api',
              title: 'API Endpoints',
              type: 'edit_multi_file',
              goal: 'Create routes and controllers',
              targetFiles: ['src/routes.js', 'src/controllers.js'],
            },
          ],
        });
      };

      const generator = new PlanGenerator({ slmCaller: mockSlmCaller });
      const scaffoldTask: AgentTask = {
        taskId: 'dynamic-scaffold-delta',
        repo: 'local/workspace',
        problemStatement:
          'Build a lightweight Express microservice with routes.js and controllers.js',
      };

      // package.json and index.js are already present
      const existingFiles = ['package.json', 'index.js'];
      const subtasks = await generator.generatePlan(scaffoldTask, existingFiles);

      // Recon skipped (workspace populated) and config phase skipped (files exist)
      // Only api phase and verify remain
      expect(subtasks.length).toBe(2);
      expect(subtasks[0]?.id).toContain('scaffold_api');
      expect(subtasks[0]?.targetFiles).toEqual(['src/routes.js', 'src/controllers.js']);
      expect(subtasks[1]?.id).toContain('scaffold_verify');
    });

    it('skips setup and models in heuristic scaffolding when they already exist on disk', async () => {
      const generator = new PlanGenerator();
      const scaffoldTask: AgentTask = {
        taskId: 'heuristic-delta-1',
        repo: 'local/workspace',
        problemStatement:
          'Build a full-stack MERN Project Management System with User, Project, Task, and Comment models, JWT auth, and Tailwind CSS.',
      };

      const existingFiles = [
        'package.json',
        '.env.example',
        'server.js',
        'server/models/User.js',
        'server/models/Project.js',
        'server/models/Task.js',
        'server/models/Comment.js',
      ];

      const subtasks = await generator.generatePlan(scaffoldTask, existingFiles);

      // Recon, Setup, and Models skipped!
      // Only Backend, Frontend, and Verify remain (3 phases)
      expect(subtasks.length).toBe(3);
      expect(subtasks[0]?.id).toContain('scaffold_phase_3_backend');
      expect(subtasks[1]?.id).toContain('scaffold_phase_4_frontend');
      expect(subtasks[2]?.id).toContain('scaffold_phase_5_verify');
    });

    it('classifies explain_only and generates read-only investigation plan without edit subtasks', async () => {
      const generator = new PlanGenerator();
      const explainTask: AgentTask = {
        taskId: 'explain-task-1',
        repo: 'local/workspace',
        problemStatement:
          'Explain how authentication and JWT tokens are verified in server/middleware/auth.js',
      };

      const intent = await generator.classifyIntent(explainTask);
      expect(intent).toBe('explain_only');

      const subtasks = await generator.generatePlan(explainTask);

      // Read-only plan: Recon -> AST Retrieve -> Conclude (3 steps)
      expect(subtasks.length).toBe(3);
      expect(subtasks[0]?.type).toBe('explore');
      expect(subtasks[1]?.type).toBe('localize');
      expect(subtasks[2]?.type).toBe('plan');

      // Ensure NO edit or write subtasks are created for explain_only
      expect(
        subtasks.some((s) => s.type === 'edit_single_file' || s.type === 'edit_multi_file'),
      ).toBe(false);
    });

    it('classifies tasks using 4-way SLM intent caller', async () => {
      const mockSlmCaller = async (_prompt: string, sysPrompt?: string) => {
        if (sysPrompt?.includes('Intent Classifier')) {
          return JSON.stringify({
            intent: 'explain_only',
            reasoning: 'User is asking for an architectural explanation',
          });
        }
        return JSON.stringify({ isMultiBug: false, issues: [] });
      };

      const generator = new PlanGenerator({ slmCaller: mockSlmCaller });
      const task: AgentTask = {
        taskId: 'slm-intent-check',
        repo: 'local/workspace',
        problemStatement: 'Walk me through the database relationships between Project and Task',
      };

      const intent = await generator.classifyIntent(task);
      expect(intent).toBe('explain_only');
    });

    it('supports custom decomposer override', async () => {
      const generator = new PlanGenerator({
        customDecomposer: (task) => [
          {
            id: 'custom_1',
            stepIndex: 0,
            type: 'edit_single_file',
            goal: `Quick patch for ${task.taskId}`,
            targetFiles: ['patch.py'],
            estimatedTokens: 500,
            status: 'pending',
            retryCount: 0,
          },
        ],
      });

      const subtasks = await generator.generatePlan(sampleTask);
      expect(subtasks.length).toBe(1);
      expect(subtasks[0]?.id).toBe('custom_1');
    });
  });

  describe('PlanManager', () => {
    it('manages sequential plan advancement and completion', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      expect(manager.isCompleted()).toBe(false);
      expect(manager.getActiveSubtask()?.stepIndex).toBe(0);
      expect(manager.getActiveSubtask()?.status).toBe('in_progress');

      // Complete all steps one by one
      while (!manager.isCompleted()) {
        const completed = manager.markActiveCompleted();
        expect(completed?.status).toBe('completed');
      }

      expect(manager.isCompleted()).toBe(true);
      expect(manager.getProgress().completed).toBe(subtasks.length);
      expect(manager.getProgress().failed).toBe(0);
    });

    it('emits valid PlanSpanAttributes adhering to @soa/contracts', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      // Initial state
      const initialAttrs = manager.getPlanSpanAttributes();
      expect(PlanSpanAttributesSchema.safeParse(initialAttrs).success).toBe(true);
      expect(initialAttrs.step_index).toBe(0);
      expect(initialAttrs.replan_reason).toBeNull();

      manager.markActiveCompleted();

      // Step 1
      const step1Attrs = manager.getPlanSpanAttributes();
      expect(step1Attrs.step_index).toBe(1);
    });

    it('handles failure, retries, and backtracking within backtrack_depth', async () => {
      const generator = new PlanGenerator({ config: { backtrack_depth: 2 } });
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks, { backtrack_depth: 2 });

      // Step 0 -> Complete
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(1);

      // Step 1 -> Complete
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(2);

      // Step 2 -> Fails
      manager.markActiveFailed('Syntax error in compiler.py');
      const failedSubtask = manager.getActiveSubtask();
      expect(failedSubtask?.status).toBe('failed');
      expect(failedSubtask?.lastError).toContain('Syntax error');
      expect(failedSubtask?.retryCount).toBe(1);

      // Can backtrack to Step 1
      expect(manager.canBacktrack()).toBe(true);
      const rolledBack = manager.backtrack('Need to re-analyze compiler.py syntax');

      expect(rolledBack?.stepIndex).toBe(1);
      expect(rolledBack?.status).toBe('in_progress');
      expect(manager.getState().replanCount).toBe(1);
      expect(manager.getState().replanReason).toBe('Need to re-analyze compiler.py syntax');

      // Span attributes include replan_reason
      const spanAttrs = manager.getPlanSpanAttributes();
      expect(spanAttrs.step_index).toBe(1);
      expect(spanAttrs.replan_reason).toBe('Need to re-analyze compiler.py syntax');
    });

    it('supports dynamic replanning of remaining subtasks', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      // Complete step 0
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(1);

      // Dynamic replan for remaining steps
      manager.replan(
        [
          {
            id: 'emergency_patch_step',
            stepIndex: 1,
            type: 'edit_single_file',
            goal: 'Direct targeted hotfix',
            targetFiles: ['django/db/models/sql/compiler.py'],
            estimatedTokens: 1000,
            status: 'pending',
            retryCount: 0,
          },
        ],
        'Replaced analysis with hotfix due to critical bug',
      );

      const state = manager.getState();
      expect(state.subtasks.length).toBe(2); // Retained step 0 + 1 new step
      expect(state.replanCount).toBe(1);
      expect(state.replanReason).toBe('Replaced analysis with hotfix due to critical bug');
      expect(manager.getActiveSubtask()?.id).toBe('emergency_patch_step');
    });

    describe('analyze_bug Intent Classification and Plan Generation', () => {
      it('heuristically classifies code audit and bug scanning queries as analyze_bug', () => {
        const generator = new PlanGenerator();

        expect(
          generator.classifyIntentHeuristically(
            'Explain the architecture of this MERN project, analyze all route controllers against model schemas, and identify any potential bugs or security flaws.',
          ),
        ).toBe('analyze_bug');

        expect(
          generator.classifyIntentHeuristically(
            'Audit this repository for security vulnerabilities and bugs',
          ),
        ).toBe('analyze_bug');

        expect(
          generator.classifyIntentHeuristically(
            'Scan the codebase and identify all errors and schema mismatches',
          ),
        ).toBe('analyze_bug');

        // Pure explanation queries stay explain_only
        expect(
          generator.classifyIntentHeuristically(
            'Explain how authentication and JWT tokens work in this project',
          ),
        ).toBe('explain_only');

        // Scaffold queries stay full_scaffold
        expect(
          generator.classifyIntentHeuristically(
            'Build a full-stack MERN project management app with User, Task, and Project models',
          ),
        ).toBe('full_scaffold');

        // Bug fix queries stay single_bug
        expect(
          generator.classifyIntentHeuristically(
            'Fix TypeError in server/controllers/authController.js',
          ),
        ).toBe('single_bug');
      });

      it('generates a 4-step specialized audit pipeline for analyze_bug', () => {
        const generator = new PlanGenerator();
        const auditTask: AgentTask = {
          taskId: 'audit-task-1',
          repo: 'local/test',
          problemStatement:
            'Explain the architecture of this MERN project, analyze all route controllers against model schemas, and identify any potential bugs or security flaws.',
        };

        const subtasks = generator.generateAnalyzeBugPlan(auditTask);

        expect(subtasks.length).toBe(4);
        expect(subtasks[0]?.id).toBe(`${auditTask.taskId}_audit_0_recon`);
        expect(subtasks[0]?.type).toBe('explore');

        expect(subtasks[1]?.id).toBe(`${auditTask.taskId}_audit_1_backend`);
        expect(subtasks[1]?.type).toBe('localize');
        expect(subtasks[1]?.targetFiles).toEqual(
          expect.arrayContaining(['server/index.js', 'server/middleware/authMiddleware.js']),
        );

        expect(subtasks[2]?.id).toBe(`${auditTask.taskId}_audit_2_frontend`);
        expect(subtasks[2]?.type).toBe('localize');
        expect(subtasks[2]?.targetFiles).toEqual(
          expect.arrayContaining(['client/src/App.js', 'client/package.json']),
        );

        expect(subtasks[3]?.id).toBe(`${auditTask.taskId}_audit_3_conclude`);
        expect(subtasks[3]?.type).toBe('plan');

        // Verify routing tiers
        const selector = new ModelSelector({ routingRule: 'role_hierarchy' });
        expect(selector.selectTier(subtasks[0]!.features!).tier).toBe('slm');
        expect(selector.selectTier(subtasks[1]!.features!).tier).toBe('llm');
        expect(selector.selectTier(subtasks[2]!.features!).tier).toBe('llm');
        expect(selector.selectTier(subtasks[3]!.features!).tier).toBe('llm');
      });
    });
  });
});
