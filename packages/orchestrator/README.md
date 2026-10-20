# @soa/orchestrator

Optimization Orchestrator (Shevoni Rogers). Converts HEAE `OptimizationSignal` records into schema-validated, versioned `FullAgentConfig` updates that Execution Core loads through `ConfigProvider.load()` — no code change inside the other components.

Phase 1 skeleton only: modules, contracts, fixtures, TUI, and mock tests. Axis optimizers, LLM fix generation, git commits, and the 100-task eval are stubs.

## Records

| Direction | Schema | Store path |
| --- | --- | --- |
| Read | `OptimizationSignal` (2.0) | `store/events/optimization_signals.jsonl` |
| Write | `FullAgentConfig` / `Config` (1.0) | `store/config/cfg_NNNN.json` |
| Write | audit entries | `store/logs/orch-audit.jsonl` |

Parse with the Zod schema before every write and after every read. Do not add private fields; open a contract PR instead.

## Run the TUI

From the monorepo root (after `pnpm install` and `pnpm build`):

```bash
pnpm --filter @soa/cli exec node dist/cli.js orch
```

Or, from `apps/cli` after build: `node dist/cli.js orch`.

`soa orch` shows: live pipeline stages, axis summary, signal queue, candidate inspector, config history, audit log, and a contract check (pass/fail per config version and signal). It uses `MockLlmProvider` and `MemoryStore` — no real model calls.

## Tests

```bash
pnpm --filter @soa/orchestrator test
```

CI must keep using mocks. Do not call a model API from this package.

## Module map (later WBS tasks)

| Module | Responsibility |
| --- | --- |
| `config/config-store.ts` | `ConfigProvider.load(version?)`, `cfg_NNNN` snapshots |
| `config/git-config-store.ts` | isomorphic-git commits / rollback (stub) |
| `signals/` | intake + router by `target.axis` |
| `fix/` | LLM-as-judge candidate via `LlmProvider` (stub) |
| `validation/` | `FullAgentConfigSchema` + range checks |
| `optimizers/` | prompt, tool, planning, workflow, retrieval, routing |
| `deploy/` | activate a version so the next `load()` returns it |
| `audit/` | queryable log, 90-day retention (prune later) |
| `stability/` | one change per `group_id`; regression rollback (partial) |
| `eval/` | 100-task simulated run: convergence, stability, recovery (stub) |
