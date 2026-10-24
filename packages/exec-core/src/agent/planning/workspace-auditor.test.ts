import { describe, it, expect } from 'vitest';
import { WorkspaceAuditor } from './workspace-auditor.js';
import { AgentTask } from '../types.js';

describe('WorkspaceAuditor', () => {
  const mernTask: AgentTask = {
    taskId: 'test-mern-task',
    repo: 'local/workspace',
    problemStatement:
      'Build a full-stack MERN Project Management System with User, Project, Task, and Comment models, JWT authentication, Tailwind CSS, shadcn/ui, and JSON-file mock persistence. Include .env.example, seed data, tests, and README.',
  };

  it('detects a 100% complete workspace and produces extension prompts', () => {
    const fullyCompleteFiles = [
      'server/models/User.js',
      'server/models/Project.js',
      'server/models/Task.js',
      'server/models/Comment.js',
      'server/middleware/authMiddleware.js',
      'server/controllers/authController.js',
      'server/controllers/projectController.js',
      'server/controllers/taskController.js',
      'server/controllers/commentController.js',
      'server/routes/authRoutes.js',
      'server/routes/projectRoutes.js',
      'server/routes/taskRoutes.js',
      'server/routes/commentRoutes.js',
      'server/data/users.json',
      'server/data/projects.json',
      'server/data/tasks.json',
      'server/data/comments.json',
      'client/src/components/Navbar.js',
      'client/src/components/Sidebar.js',
      'client/src/components/ProjectList.js',
      'client/src/components/TaskList.js',
      'client/src/components/CommentSection.js',
      'client/src/App.js',
      'client/src/index.js',
      'server/tests/authController.test.js',
      'client/src/__tests__/App.test.js',
      'package.json',
      '.env.example',
      'README.md',
    ];

    const report = WorkspaceAuditor.auditWorkspace(mernTask, fullyCompleteFiles);

    expect(report.isFullyComplete).toBe(true);
    expect(report.missingSubsystems.length).toBe(0);
    expect(report.completedSubsystems.length).toBeGreaterThanOrEqual(6);
    expect(report.overlaps.length).toBeGreaterThan(0);
    expect(report.suggestedPrompt).toContain('Kanban');

    const formatted = WorkspaceAuditor.formatAuditReport(report, '/path/to/test');
    expect(formatted).toContain('Project Already Complete');
    expect(formatted).toContain('All core capabilities requested in your prompt are already present');
  });

  it('detects a partially complete workspace (backend done, frontend missing) and generates tailored batch prompt', () => {
    const backendOnlyFiles = [
      'server/models/User.js',
      'server/models/Project.js',
      'server/models/Task.js',
      'server/models/Comment.js',
      'server/middleware/authMiddleware.js',
      'server/controllers/authController.js',
      'server/routes/authRoutes.js',
      'server/data/users.json',
      'server/data/projects.json',
      'package.json',
      '.env.example',
      'README.md',
    ];

    const report = WorkspaceAuditor.auditWorkspace(mernTask, backendOnlyFiles);

    expect(report.isFullyComplete).toBe(false);
    expect(report.completedSubsystems.some((s) => s.id === 'models')).toBe(true);
    expect(report.missingSubsystems.some((s) => s.id === 'frontend_ui')).toBe(true);
    expect(report.suggestedPrompt).toContain('Build React frontend views');

    const formatted = WorkspaceAuditor.formatAuditReport(report, '/path/to/test');
    expect(formatted).toContain('Partial Project Detected');
    expect(formatted).toContain('Missing Subsystems to Implement');
    expect(formatted).toContain('pnpm run-agent "Build React frontend views');
  });

  it('resolves semantic overlaps when mock persistence JSON files already exist', () => {
    const existingWithJsonData = [
      'server/data/users.json',
      'server/data/projects.json',
      'server/models/User.js',
      'server/models/Project.js',
    ];

    const report = WorkspaceAuditor.auditWorkspace(mernTask, existingWithJsonData);

    expect(report.overlaps.some((o) => o.includes('Mock data files already exist'))).toBe(true);
  });
});
