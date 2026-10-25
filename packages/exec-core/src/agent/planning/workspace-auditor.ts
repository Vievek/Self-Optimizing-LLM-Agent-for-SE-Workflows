import { AgentTask } from '../types.js';

export interface SubsystemAudit {
  id: string;
  name: string;
  isRequested: boolean;
  isComplete: boolean;
  matchedFiles: string[];
  summary: string;
}

export interface WorkspaceAuditReport {
  existingFileCount: number;
  isFullyComplete: boolean;
  completedSubsystems: SubsystemAudit[];
  missingSubsystems: SubsystemAudit[];
  overlaps: string[];
  suggestedPrompt: string;
  summaryText: string;
}

/**
 * Performs an architectural gap analysis on non-empty workspaces,
 * comparing existing files against prompt requirements to detect completed subsystems,
 * resolve overlapping file variants, and produce tailored follow-up batch prompts.
 */
export class WorkspaceAuditor {
  static auditWorkspace(task: AgentTask, existingFiles: string[] = []): WorkspaceAuditReport {
    const text = task.problemStatement.toLowerCase();
    const existingSet = new Set(existingFiles.map((f) => f.replace(/^\.\//, '')));
    const allFiles = Array.from(existingSet);

    // 1. Models & Entities
    const standardEntities = ['User', 'Project', 'Task', 'Comment', 'Post', 'Order', 'Product'];
    const requestedEntities = standardEntities.filter((e) =>
      new RegExp(`\\b${e}\\b`, 'i').test(task.problemStatement),
    );
    const modelFiles = allFiles.filter((f) =>
      /(?:^|\/)(?:server\/)?models\/[a-zA-Z0-9_-]+\.(?:js|ts|jsx|tsx)$/i.test(f),
    );
    const modelsRequested =
      requestedEntities.length > 0 || /(?:model|schema|entities)\b/i.test(text);
    const modelsComplete =
      modelsRequested &&
      (modelFiles.length >= Math.max(1, requestedEntities.length) || modelFiles.length >= 2);

    const modelsAudit: SubsystemAudit = {
      id: 'models',
      name: 'Database Entity Models',
      isRequested: modelsRequested,
      isComplete: modelsComplete,
      matchedFiles: modelFiles,
      summary: modelsComplete
        ? `Found ${modelFiles.length} model files (${modelFiles
            .slice(0, 4)
            .map((f) => f.split('/').pop())
            .join(', ')})`
        : 'Missing required entity model files',
    };

    // 2. Auth Subsystem
    const authRequested = /(?:jwt|auth|authentication|login|token)\b/i.test(text);
    const authFiles = allFiles.filter((f) => /(?:auth|jwt|passport|middleware\/auth)/i.test(f));
    const authComplete = authRequested && authFiles.length >= 1;

    const authAudit: SubsystemAudit = {
      id: 'auth',
      name: 'JWT Authentication & Middleware',
      isRequested: authRequested,
      isComplete: authComplete,
      matchedFiles: authFiles,
      summary: authComplete
        ? `Found ${authFiles.length} auth files (${authFiles
            .slice(0, 3)
            .map((f) => f.split('/').pop())
            .join(', ')})`
        : 'Missing JWT auth middleware / controller',
    };

    // 3. Backend Routes & Controllers
    const backendRequested = /(?:backend|server|express|api|routes|controllers|endpoints)\b/i.test(
      text,
    );
    const routeFiles = allFiles.filter((f) => /(?:routes|controllers)\//i.test(f));
    const backendComplete = backendRequested && routeFiles.length >= 2;

    const backendAudit: SubsystemAudit = {
      id: 'backend_api',
      name: 'Backend API Routes & Controllers',
      isRequested: backendRequested,
      isComplete: backendComplete,
      matchedFiles: routeFiles,
      summary: backendComplete
        ? `Found ${routeFiles.length} API route & controller files`
        : 'Missing backend routes and controllers',
    };

    // 4. Data Persistence & Mock Seeds
    const persistenceRequested = /(?:persistence|mock|seed|seeds|json-file|database|data)\b/i.test(
      text,
    );
    const dataFiles = allFiles.filter(
      (f) =>
        /(?:server\/data\/|data\/|seeds?\/)/i.test(f) &&
        !f.includes('package') &&
        !f.includes('tsconfig'),
    );
    const persistenceComplete = persistenceRequested && dataFiles.length >= 1;

    const persistenceAudit: SubsystemAudit = {
      id: 'persistence',
      name: 'Data Persistence & Mock Seeds',
      isRequested: persistenceRequested,
      isComplete: persistenceComplete,
      matchedFiles: dataFiles,
      summary: persistenceComplete
        ? `Found ${dataFiles.length} data/seed files (${dataFiles
            .slice(0, 4)
            .map((f) => f.split('/').pop())
            .join(', ')})`
        : 'Missing persistence data / seed files',
    };

    // 5. Frontend UI & Components
    const frontendRequested =
      /(?:frontend|client|react|tailwind|shadcn|ui|components|views|pages)\b/i.test(text);
    const componentFiles = allFiles.filter((f) =>
      /(?:client\/src\/components\/|src\/components\/|client\/src\/App|client\/src\/index)/i.test(
        f,
      ),
    );
    const frontendComplete = frontendRequested && componentFiles.length >= 2;

    const frontendAudit: SubsystemAudit = {
      id: 'frontend_ui',
      name: 'Frontend UI & React Components',
      isRequested: frontendRequested,
      isComplete: frontendComplete,
      matchedFiles: componentFiles,
      summary: frontendComplete
        ? `Found ${componentFiles.length} UI component & view files`
        : 'Missing frontend views and components',
    };

    // 6. Tests
    const testsRequested = /(?:tests?|jest|vitest|supertest|unit test)\b/i.test(text);
    const testFiles = allFiles.filter((f) => /(?:test|spec)\.(?:js|ts|jsx|tsx)$/i.test(f));
    const testsComplete = testsRequested && testFiles.length >= 1;

    const testsAudit: SubsystemAudit = {
      id: 'tests',
      name: 'Automated Test Suites',
      isRequested: testsRequested,
      isComplete: testsComplete,
      matchedFiles: testFiles,
      summary: testsComplete
        ? `Found ${testFiles.length} test files (${testFiles
            .slice(0, 3)
            .map((f) => f.split('/').pop())
            .join(', ')})`
        : 'Missing test suites',
    };

    // 7. Docs & Config
    const docsFiles = allFiles.filter((f) =>
      /(?:README\.md|\.env\.example|package\.json)$/i.test(f),
    );
    const docsComplete = docsFiles.some((f) => /README\.md$/i.test(f));
    const docsAudit: SubsystemAudit = {
      id: 'docs',
      name: 'Documentation & Config',
      isRequested: true,
      isComplete: docsComplete,
      matchedFiles: docsFiles,
      summary: docsComplete
        ? `Found documentation and configs (${docsFiles.map((f) => f.split('/').pop()).join(', ')})`
        : 'Missing README or configs',
    };

    const allSubsystems = [
      modelsAudit,
      authAudit,
      backendAudit,
      persistenceAudit,
      frontendAudit,
      testsAudit,
      docsAudit,
    ];

    const requestedSubsystems = allSubsystems.filter((s) => s.isRequested);
    const completedSubsystems = requestedSubsystems.filter((s) => s.isComplete);
    const missingSubsystems = requestedSubsystems.filter((s) => !s.isComplete);

    // Detect overlaps/similarities
    const overlaps: string[] = [];
    if (dataFiles.length > 0 && /seed/i.test(text)) {
      overlaps.push(
        `Mock data files already exist in server/data/ (${dataFiles.map((f) => f.split('/').pop()).join(', ')}). Preserving existing persistence format instead of generating duplicate seed scripts.`,
      );
    }
    if (modelFiles.length > 0 && requestedEntities.length > 0) {
      overlaps.push(
        `Canonical entity models (${modelFiles.map((f) => f.split('/').pop()).join(', ')}) already exist. Reusing existing schemas without overwrite.`,
      );
    }
    if (componentFiles.length > 0 && /(?:tailwind|shadcn)/i.test(text)) {
      overlaps.push(
        `Frontend components already exist in client/src/components/. Reusing existing UI components instead of regenerating boilerplate entrypoints.`,
      );
    }

    const isFullyComplete = existingFiles.length >= 15 && missingSubsystems.length === 0;

    // Generate tailored suggested prompt
    let suggestedPrompt = '';
    if (isFullyComplete) {
      suggestedPrompt =
        'Add a Kanban drag-and-drop board to ProjectList using Tailwind CSS with Supertest end-to-end authentication tests';
    } else if (missingSubsystems.some((s) => s.id === 'frontend_ui')) {
      suggestedPrompt =
        'Build React frontend views (Navbar, Sidebar, ProjectList, TaskList, CommentSection) with Tailwind CSS, shadcn/ui components, and Jest tests connecting to existing backend routes.';
    } else if (missingSubsystems.some((s) => s.id === 'tests')) {
      suggestedPrompt =
        'Add comprehensive unit and integration tests for backend controllers and frontend components with Jest.';
    } else {
      suggestedPrompt = task.problemStatement;
    }

    const summaryText = isFullyComplete
      ? `All ${completedSubsystems.length} requested subsystems are already implemented across ${existingFiles.length} existing files.`
      : `${completedSubsystems.length} subsystems complete; ${missingSubsystems.length} subsystems missing: ${missingSubsystems.map((s) => s.name).join(', ')}.`;

    return {
      existingFileCount: existingFiles.length,
      isFullyComplete,
      completedSubsystems,
      missingSubsystems,
      overlaps,
      suggestedPrompt,
      summaryText,
    };
  }

  /**
   * Formats a clean ASCII box report for terminal output.
   */
  static formatAuditReport(report: WorkspaceAuditReport, targetDir: string = '.'): string {
    const lines: string[] = [];
    const sep = '='.repeat(70);
    const subsep = '-'.repeat(70);

    lines.push('\n' + sep);
    lines.push(
      report.isFullyComplete
        ? `🔍 Workspace Audit: Project Already Complete (${report.existingFileCount} files detected)`
        : `🔍 Workspace Audit: Partial Project Detected (${report.existingFileCount} existing files)`,
    );
    lines.push(sep);

    if (report.completedSubsystems.length > 0) {
      lines.push('✅ Completed Subsystems in Workspace:');
      for (const s of report.completedSubsystems) {
        lines.push(`  • ${s.name}: ${s.summary}`);
      }
    }

    if (report.overlaps.length > 0) {
      lines.push('\n⚠️  Semantic Overlaps Resolved:');
      for (const o of report.overlaps) {
        lines.push(`  • ${o}`);
      }
    }

    if (report.missingSubsystems.length > 0) {
      lines.push('\n❌ Missing Subsystems to Implement:');
      for (const m of report.missingSubsystems) {
        lines.push(`  • ${m.name}: ${m.summary}`);
      }
    }

    lines.push('\n' + subsep);
    if (report.isFullyComplete) {
      lines.push('🎉 Status: All core capabilities requested in your prompt are already present!');
      lines.push('   Skipping redundant file creation. Proceeding to rapid verification.');
      lines.push('\n💡 Want to extend or enhance this project? You can run:');
      lines.push(`   pnpm run-agent "${report.suggestedPrompt}" "${targetDir}"`);
    } else {
      lines.push('🚀 Recommended Next Step (Ready-to-Run Batch Prompt):');
      lines.push('   Copy and run this exact command to batch-generate only the missing parts:');
      lines.push(`\n   pnpm run-agent "${report.suggestedPrompt}" "${targetDir}"`);
    }
    lines.push(sep + '\n');

    return lines.join('\n');
  }
}
