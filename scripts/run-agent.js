#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TraceSpanSchema } from '../packages/contracts/dist/index.js';
import { AgentRunner, createReActLlmCaller } from '../packages/exec-core/dist/index.js';
import { ProviderRegistry } from '../packages/llm/dist/index.js';
import { FixtureSandboxService } from '../packages/sandbox/dist/index.js';

async function main() {
  const args = process.argv.slice(2);
  const prompt =
    args[0] ||
    'Create a simple Node.js express server with a health check route and a .env.example file';
  const targetDir = args[1]
    ? path.resolve(process.cwd(), args[1])
    : path.resolve(process.cwd(), 'scratch/sandboxes/demo-app');

  console.log('='.repeat(70));
  console.log('🚀 SOA Autonomous Execution Core Runner');
  console.log('='.repeat(70));
  console.log(`📋 Prompt:     "${prompt}"`);
  console.log(`📁 Target Dir: ${targetDir}`);
  const keyStatus = process.env.GROQ_API_KEY
    ? 'Groq Key Configured ✅'
    : process.env.GEMINI_API_KEY
      ? 'Gemini Key Configured ✅'
      : 'Missing (Set GROQ_API_KEY in .env) ❌';
  console.log(`🔑 API Key:    ${keyStatus}`);
  console.log(`⚙️  Config:     ${process.env.MODELS_CONFIG_PATH ?? 'packages/llm/models.testing.yaml'}`);
  console.log('='.repeat(70));

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Initialize Sandbox Service pointing to target directory
  const sandbox = new FixtureSandboxService({
    workDirRoot: path.dirname(targetDir),
    fixturesRoot: targetDir,
  });

  const taskId = `task_${Date.now()}`;
  const wsId = `ws_${taskId}`;
  sandbox.registerWorkspace(wsId, targetDir);

  // 2. Initialize LLM Provider Registry
  const registry = new ProviderRegistry();
  const baseCaller = createReActLlmCaller({ registry });

  // Logging wrapper to show agent thought process in real-time
  const reactLlmCaller = async (messages, opts) => {
    // 2-second pacing prevents burst token-per-minute rate limits on free tiers
    await new Promise((r) => setTimeout(r, 2000));
    const tierLabel = opts?.tier?.toUpperCase() ?? 'SLM';
    console.log(`\n🧠 [${tierLabel}] Reasoning with model: ${opts?.model}...`);
    const resp = await baseCaller(messages, opts);
    console.log(`📝 Output:\n${resp.content.trim()}\n`);
    return resp;
  };

  // 3. Initialize Agent Runner
  const runner = new AgentRunner();

  console.log('\n[1/3] Decomposing task and generating execution plan...');
  const result = await runner.run(
    {
      taskId,
      problemStatement: prompt,
      repo: 'local/workspace',
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
      maxIterations: Number(process.env.MAX_ITERATIONS) || 50,
      maxTurnsPerSubtask: Number(process.env.MAX_TURNS_PER_SUBTASK) || 12,
    },
  );

  const totalWallMs = result.outcomeEvidence.cost.wall_ms;
  const totalWallSec = (totalWallMs / 1000).toFixed(1);
  const totalWallMin = (totalWallMs / 60000).toFixed(2);
  const tokensIn = result.outcomeEvidence.cost.tokens_in;
  const tokensOut = result.outcomeEvidence.cost.tokens_out;
  const totalTokens = tokensIn + tokensOut;

  // Validate every emitted span against official OpenTelemetry SOA contract schema
  let validSpans = 0;
  for (const span of result.spans) {
    if (TraceSpanSchema.safeParse(span).success) {
      validSpans++;
    }
  }
  const isFullyCompliant = validSpans === result.spans.length;

  console.log('\n' + '='.repeat(70));
  console.log('🏁 Execution Completed!');
  console.log('='.repeat(70));
  console.log(`Status:            ${result.resolved ? 'RESOLVED ✅' : 'COMPLETED / REVIEW NEEDED ⚠️'}`);
  console.log(`Total Spans:       ${result.spans.length} spans`);
  console.log(`Contract Validity: ${isFullyCompliant ? `100% Contract-Compliant (${validSpans}/${result.spans.length}) ✅` : 'Contract Mismatch ❌'}`);
  console.log(`Time Taken:        ${totalWallSec}s (${totalWallMin} min)`);
  console.log(`Tokens In:         ${tokensIn.toLocaleString()}`);
  console.log(`Tokens Out:        ${tokensOut.toLocaleString()}`);
  console.log(`Total Tokens:      ${totalTokens.toLocaleString()}`);

  console.log('\n📂 Files in workspace:');
  function listFilesRecursively(dir, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = path.join(prefix, entry.name);
        if (entry.isDirectory()) {
          listFilesRecursively(path.join(dir, entry.name), relPath);
        } else {
          console.log(` - ${relPath}`);
        }
      }
    } catch {
      // Ignore directory read error
    }
  }
  listFilesRecursively(targetDir);

  console.log('\n' + '='.repeat(70));
  console.log('📜 Complete OpenTelemetry Traces (@soa/contracts Conformance):');
  console.log('='.repeat(70));
  for (let i = 0; i < result.spans.length; i++) {
    const span = result.spans[i];
    const durationMs = new Date(span.end_ts).getTime() - new Date(span.start_ts).getTime();
    console.log(`\n[${i + 1}/${result.spans.length}] 🏷️  Span: "${span.name}" | Status: ${span.status} | Duration: ${durationMs}ms`);
    console.log(`    Span ID:   ${span.span_id}`);
    console.log(`    Parent ID: ${span.parent_span_id ?? 'root'}`);
    console.log(`    Start:     ${span.start_ts}`);
    console.log(`    End:       ${span.end_ts}`);
    console.log(`    Attributes:`);
    console.log(JSON.stringify(span.attributes, null, 4).replace(/^/gm, '      '));
  }
}

main().catch((err) => {
  console.error('\n❌ Execution Failed:', err);
  process.exit(1);
});

